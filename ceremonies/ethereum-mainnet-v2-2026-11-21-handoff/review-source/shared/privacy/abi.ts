/**
 * PrivacyPool ABI (human-readable). Keep in sync with contracts/src/PrivacyPool.sol.
 */
import { parseAbi } from "viem";

export const PRIVACY_POOL_ABI = parseAbi([
  // ── views ──
  "function SCOPE() view returns (uint256)",
  "function ASSET() view returns (address)",
  "function TREE_DEPTH() view returns (uint32)",
  "function owner() view returns (address)",
  "function aspPostman() view returns (address)",
  "function dead() view returns (bool)",
  "function minDeposit() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function nextIndex() view returns (uint32)",
  "function getLastRoot() view returns (uint256)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function currentASPRoot() view returns (uint256)",
  "function isKnownASPRoot(uint256 root) view returns (bool)",
  // the association-set root ring: slot i of 16, the slot of the newest post, and the ring's size (public getters)
  "function aspRoots(uint256) view returns (uint256)",
  "function currentASPRootIndex() view returns (uint32)",
  "function ASP_ROOT_HISTORY_SIZE() view returns (uint32)",
  "function nullifierHashes(uint256) view returns (bool)",
  "function commitments(uint256) view returns (bool)",
  "function depositors(uint256 label) view returns (address)",
  "function computeContext((address recipient,address relayer,uint256 fee,uint256 deadline) w) view returns (uint256)",
  // ── user actions ──
  "function deposit(uint256 precommitment) payable returns (uint256 commitment)",
  "function withdraw((address recipient,address relayer,uint256 fee,uint256 deadline) w, (uint256[2] pA,uint256[2][2] pB,uint256[2] pC) proof, uint256[6] pubSignals)",
  "function ragequit((uint256[2] pA,uint256[2][2] pB,uint256[2] pC) proof, uint256[4] pubSignals)",
  // ── admin ──
  "function updateASPRoot(uint256 root, string cid)",
  "function windDown()",
  "function setASPPostman(address postman)",
  "function setMinDeposit(uint256 value)",
  "function transferOwnership(address newOwner)",
  // ── events ──
  "event Deposited(address indexed depositor, uint256 commitment, uint256 label, uint256 value, uint256 precommitment, uint32 leafIndex)",
  "event Withdrawn(address indexed recipient, address indexed relayer, uint256 value, uint256 fee, uint256 spentNullifier, uint256 newCommitment, uint32 leafIndex)",
  "event Ragequit(address indexed ragequitter, uint256 commitment, uint256 label, uint256 value)",
  "event LeafInserted(uint32 indexed leafIndex, uint256 leaf, uint256 root)",
  "event ASPRootUpdated(uint256 indexed root, string cid)",
  "event PoolDied()",
  "event ASPPostmanUpdated(address indexed postman)",
  "event MinDepositUpdated(uint256 value)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  // ── errors ──
  "error PoolIsDead()",
  "error InvalidDepositValue()",
  "error InvalidFieldElement()",
  "error UnknownStateRoot()",
  "error UnknownASPRoot()",
  "error NullifierAlreadySpent()",
  "error InvalidProof()",
  "error ContextMismatch()",
  "error InvalidWithdrawal()",
  "error Expired()",
  "error UnknownCommitment()",
  "error NotDepositor()",
  "error TransferFailed()",
  "error Unauthorized()",
  "error Reentrancy()",
]);
