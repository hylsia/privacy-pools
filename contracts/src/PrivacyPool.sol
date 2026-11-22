// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";
import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "./interfaces/IVerifiers.sol";

/**
 * @title  PrivacyPool (native ETH)
 * @notice Hylsia Privacy Pool, built for Robinhood Chain Testnet and Ethereum Sepolia.
 *         Users deposit ETH against a commitment and later withdraw by proving — in
 *         zero knowledge — that they own an unspent note whose deposit label belongs
 *         to the current association set (ASP). Withdrawals can send change back into
 *         the pool as a fresh commitment. A ragequit path lets the original depositor
 *         exit without the ASP, at the cost of publicly revealing the link.
 *
 * Administrative powers (disclosed deliberately, see docs/privacy-pools/README.md):
 *   - owner:       windDown() (stops NEW deposits only), setASPPostman, setMinDeposit,
 *                  transferOwnership. The owner cannot move user funds, cannot pause
 *                  withdrawals or ragequits, and cannot upgrade this contract.
 *   - aspPostman:  updateASPRoot(). Controls which deposits can use the private
 *                  withdrawal path. Cannot block the ragequit path.
 *
 * Non-upgradeable. No proxy. No fee switch on deposits.
 */
contract PrivacyPool is MerkleTreeWithHistory {
    // ───────────────────────────── types ─────────────────────────────

    struct Withdrawal {
        address recipient;
        address relayer; // receives `fee`; address(0) when self-relaying with fee 0
        uint256 fee; // paid out of the withdrawn value
        uint256 deadline; // unix seconds; 0 = no expiry
    }

    struct Groth16Proof {
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
    }

    // ─────────────────────────── constants ───────────────────────────

    /// @notice Sentinel for the native asset (ETH).
    address public constant ASSET = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    /// @notice Values are range-checked to 128 bits inside the circuits.
    uint256 public constant MAX_VALUE = type(uint128).max;
    uint32 public constant ASP_ROOT_HISTORY_SIZE = 16;

    // ─────────────────────────── immutables ──────────────────────────

    /// @notice Domain separator: uint256(keccak256(abi.encodePacked(address(this), chainid, ASSET))) % p
    uint256 public immutable SCOPE;
    IWithdrawVerifier public immutable WITHDRAW_VERIFIER;
    ICommitmentVerifier public immutable COMMITMENT_VERIFIER;

    // ───────────────────────────── state ─────────────────────────────

    address public owner;
    address public aspPostman;
    bool public dead;
    uint256 public minDeposit;
    /// @notice Deposit counter; label = Poseidon(SCOPE, nonce) with nonce starting at 1.
    uint256 public nonce;

    uint256[ASP_ROOT_HISTORY_SIZE] public aspRoots;
    uint32 public currentASPRootIndex;

    mapping(uint256 nullifierHash => bool spent) public nullifierHashes;
    mapping(uint256 commitment => bool exists) public commitments;
    mapping(uint256 label => address depositor) public depositors;

    uint256 private _reentrancyStatus = 1;

    // ───────────────────────────── events ────────────────────────────

    event Deposited(
        address indexed depositor,
        uint256 commitment,
        uint256 label,
        uint256 value,
        uint256 precommitment,
        uint32 leafIndex
    );
    event Withdrawn(
        address indexed recipient,
        address indexed relayer,
        uint256 value,
        uint256 fee,
        uint256 spentNullifier,
        uint256 newCommitment,
        uint32 leafIndex
    );
    event Ragequit(address indexed ragequitter, uint256 commitment, uint256 label, uint256 value);
    event ASPRootUpdated(uint256 indexed root, string cid);
    event PoolDied();
    event ASPPostmanUpdated(address indexed postman);
    event MinDepositUpdated(uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ───────────────────────────── errors ────────────────────────────

    error PoolIsDead();
    error InvalidDepositValue();
    error InvalidFieldElement();
    error UnknownStateRoot();
    error UnknownASPRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error ContextMismatch();
    error InvalidWithdrawal();
    error Expired();
    error UnknownCommitment();
    error NotDepositor();
    error TransferFailed();
    error Unauthorized();
    error Reentrancy();

    // ─────────────────────────── modifiers ───────────────────────────

    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert Reentrancy();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyPostman() {
        if (msg.sender != aspPostman) revert Unauthorized();
        _;
    }

    // ──────────────────────────── constructor ────────────────────────

    constructor(
        address _owner,
        address _aspPostman,
        IWithdrawVerifier _withdrawVerifier,
        ICommitmentVerifier _commitmentVerifier,
        uint256 _minDeposit
    ) {
        if (_owner == address(0) || address(_withdrawVerifier) == address(0) || address(_commitmentVerifier) == address(0)) {
            revert Unauthorized();
        }
        owner = _owner;
        aspPostman = _aspPostman;
        WITHDRAW_VERIFIER = _withdrawVerifier;
        COMMITMENT_VERIFIER = _commitmentVerifier;
        minDeposit = _minDeposit;
        SCOPE = uint256(keccak256(abi.encodePacked(address(this), block.chainid, ASSET))) % SNARK_SCALAR_FIELD;
        emit OwnershipTransferred(address(0), _owner);
        emit ASPPostmanUpdated(_aspPostman);
        emit MinDepositUpdated(_minDeposit);
    }

    // ───────────────────────────── deposit ───────────────────────────

    /**
     * @notice Deposit `msg.value` wei against `precommitment = Poseidon(nullifier, secret)`.
     * @dev    The contract assigns the label and computes the commitment itself, so a
     *         note can never claim more value than was actually transferred.
     */
    function deposit(uint256 precommitment) external payable nonReentrant returns (uint256 commitment) {
        if (dead) revert PoolIsDead();
        if (msg.value == 0 || msg.value < minDeposit || msg.value > MAX_VALUE) revert InvalidDepositValue();
        if (precommitment >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();

        uint256 label = PoseidonT3.hash([SCOPE, ++nonce]);
        commitment = PoseidonT4.hash([msg.value, label, precommitment]);

        depositors[label] = msg.sender;
        commitments[commitment] = true;
        uint32 leafIndex = _insert(commitment);

        emit Deposited(msg.sender, commitment, label, msg.value, precommitment, leafIndex);
    }

    // ──────────────────────────── withdraw ───────────────────────────

    /// @notice Context the proof must be bound to for a given withdrawal request.
    function computeContext(Withdrawal calldata w) public view returns (uint256) {
        return uint256(keccak256(abi.encode(SCOPE, w.recipient, w.relayer, w.fee, w.deadline))) % SNARK_SCALAR_FIELD;
    }

    /**
     * @notice Spend a note privately.
     * @param w          Public withdrawal parameters (bound into the proof via `context`).
     * @param proof      Groth16 proof for circuits/withdraw.circom.
     * @param pubSignals [newCommitmentHash, existingNullifierHash, withdrawnValue, stateRoot, ASPRoot, context]
     */
    function withdraw(Withdrawal calldata w, Groth16Proof calldata proof, uint256[6] calldata pubSignals)
        external
        nonReentrant
    {
        uint256 newCommitment = pubSignals[0];
        uint256 nullifierHash = pubSignals[1];
        uint256 withdrawnValue = pubSignals[2];
        uint256 stateRoot = pubSignals[3];
        uint256 aspRoot = pubSignals[4];
        uint256 context = pubSignals[5];

        if (context != computeContext(w)) revert ContextMismatch();
        if (w.deadline != 0 && block.timestamp > w.deadline) revert Expired();
        if (withdrawnValue == 0 || w.fee > withdrawnValue || w.recipient == address(0)) revert InvalidWithdrawal();
        if (w.fee > 0 && w.relayer == address(0)) revert InvalidWithdrawal();
        if (!isKnownRoot(stateRoot)) revert UnknownStateRoot();
        if (!isKnownASPRoot(aspRoot)) revert UnknownASPRoot();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();
        if (!WITHDRAW_VERIFIER.verifyProof(proof.pA, proof.pB, proof.pC, pubSignals)) revert InvalidProof();

        // effects
        nullifierHashes[nullifierHash] = true;
        commitments[newCommitment] = true;
        uint32 leafIndex = _insert(newCommitment);

        // interactions
        _send(w.recipient, withdrawnValue - w.fee);
        if (w.fee > 0) _send(w.relayer, w.fee);

        emit Withdrawn(w.recipient, w.relayer, withdrawnValue, w.fee, nullifierHash, newCommitment, leafIndex);
    }

    // ──────────────────────────── ragequit ───────────────────────────

    /**
     * @notice Exit without the ASP. Only the original depositor of `label` may call it,
     *         and the link between the deposit and this exit becomes public.
     * @param pubSignals [commitment, nullifierHash, value, label]
     */
    function ragequit(Groth16Proof calldata proof, uint256[4] calldata pubSignals) external nonReentrant {
        uint256 commitment = pubSignals[0];
        uint256 nullifierHash = pubSignals[1];
        uint256 value = pubSignals[2];
        uint256 label = pubSignals[3];

        if (depositors[label] != msg.sender) revert NotDepositor();
        if (!commitments[commitment]) revert UnknownCommitment();
        if (nullifierHashes[nullifierHash]) revert NullifierAlreadySpent();
        if (!COMMITMENT_VERIFIER.verifyProof(proof.pA, proof.pB, proof.pC, pubSignals)) revert InvalidProof();

        nullifierHashes[nullifierHash] = true;
        _send(msg.sender, value);

        emit Ragequit(msg.sender, commitment, label, value);
    }

    // ───────────────────────── association set ───────────────────────

    /// @notice Publish a new association-set root. `cid` points at the published set (informational).
    function updateASPRoot(uint256 root, string calldata cid) external onlyPostman {
        if (root == 0 || root >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
        uint32 idx = (currentASPRootIndex + 1) % ASP_ROOT_HISTORY_SIZE;
        currentASPRootIndex = idx;
        aspRoots[idx] = root;
        emit ASPRootUpdated(root, cid);
    }

    function currentASPRoot() public view returns (uint256) {
        return aspRoots[currentASPRootIndex];
    }

    /// @notice True if `root` is one of the last ASP_ROOT_HISTORY_SIZE published ASP roots.
    function isKnownASPRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 current = currentASPRootIndex;
        uint32 i = current;
        do {
            if (root == aspRoots[i]) return true;
            if (i == 0) i = ASP_ROOT_HISTORY_SIZE;
            i--;
        } while (i != current);
        return false;
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Permanently stop new deposits. Withdrawals and ragequits keep working.
    function windDown() external onlyOwner {
        if (dead) revert PoolIsDead();
        dead = true;
        emit PoolDied();
    }

    function setASPPostman(address postman) external onlyOwner {
        aspPostman = postman;
        emit ASPPostmanUpdated(postman);
    }

    function setMinDeposit(uint256 value) external onlyOwner {
        minDeposit = value;
        emit MinDepositUpdated(value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ──────────────────────────── internal ───────────────────────────

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
