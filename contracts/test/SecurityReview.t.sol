// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PoolFixtureTest} from "./PrivacyPool.t.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {MerkleTreeWithHistory} from "../src/MerkleTreeWithHistory.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";
import {CommitmentVerifier} from "../src/verifiers/CommitmentVerifier.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

contract ReviewReceiver {
    address target;
    bytes attempt;
    bool reject;
    bool public reentered;
    uint256 public receipts;
    function configure(address p, bytes memory data, bool fails) external { target = p; attempt = data; reject = fails; }
    receive() external payable {
        require(!reject, "receiver rejects ETH");
        receipts++;
        (bool ok,) = target.call(attempt);
        reentered = ok;
    }
}

/// Real frozen Groth16 verifiers and valid fixtures; no mock verifier in this suite.
contract SecurityReviewTest is PoolFixtureTest {
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function test_contextRecomputedCannotRedirectProof() public {
        _ready();
        for (uint256 i; i < 4; i++) {
            WithdrawFixture memory f = _withdrawFixture(".withdraw1");
            if (i == 0) f.w.recipient = address(0xBAD);
            if (i == 1) f.w.relayer = address(0xBAD);
            if (i == 2) f.w.fee++;
            if (i == 3) f.w.deadline = block.timestamp + 3600;
            f.pubSignals[5] = pool.computeContext(f.w);
            vm.expectRevert(PrivacyPool.InvalidProof.selector);
            pool.withdraw(f.w, f.proof, f.pubSignals);
        }
    }

    function test_allPublicSignalsBoundByRealVerifier() public {
        _ready();
        for (uint256 i; i < 6; i++) {
            WithdrawFixture memory f = _withdrawFixture(".withdraw1");
            f.pubSignals[i]++;
            assertFalse(withdrawVerifier.verifyProof(f.proof.pA, f.proof.pB, f.proof.pC, f.pubSignals));
        }
        WithdrawFixture memory invalid = _withdrawFixture(".withdraw1");
        invalid.pubSignals[0] = FIELD;
        assertFalse(withdrawVerifier.verifyProof(invalid.proof.pA, invalid.proof.pB, invalid.proof.pC, invalid.pubSignals));
    }

    function test_duplicatePrecommitmentCanStrandSecondDeposit() public {
        _ready();
        vm.deal(depositorOf(0), 1 ether);
        vm.prank(depositorOf(0));
        uint256 duplicate = pool.deposit{value: 1 ether}(vm.parseJsonUint(json, ".deposits[0].precommitment"));
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        pool.withdraw(f.w, f.proof, f.pubSignals); // historical root is valid; first note spends successfully
        json = vm.readFile("test/fixtures/security.json");
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequitDuplicate");
        assertEq(ps[0], duplicate);
        assertEq(ps[1], f.pubSignals[1]);
        assertTrue(commitmentVerifier.verifyProof(p.pA, p.pB, p.pC, ps), "second deposit has a genuine ownership proof");
        vm.prank(depositorOf(0));
        vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
        pool.ragequit(p, ps); // even public exit is blocked by the reused nullifier
        assertEq(address(pool).balance, 4.1 ether);
    }

    function testFuzz_competingValidExitsOnlyOneSucceeds(bool rageFirst) public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequit0");
        if (rageFirst) {
            vm.prank(depositorOf(0));
            pool.ragequit(p, ps);
            vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
            pool.withdraw(f.w, f.proof, f.pubSignals);
            assertEq(address(pool).balance, 2.5 ether);
        } else {
            pool.withdraw(f.w, f.proof, f.pubSignals);
            vm.prank(depositorOf(0));
            vm.expectRevert(PrivacyPool.NullifierAlreadySpent.selector);
            pool.ragequit(p, ps);
            assertEq(address(pool).balance, 3.1 ether);
        }
        assertTrue(pool.nullifierHashes(ps[1]));
    }

    function test_sameChainOtherPoolRejectsProof() public {
        PrivacyPool other = new PrivacyPool(OWNER, POSTMAN, IWithdrawVerifier(address(withdrawVerifier)), ICommitmentVerifier(address(commitmentVerifier)), 0);
        assertTrue(other.SCOPE() != pool.SCOPE());
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        vm.expectRevert(PrivacyPool.ContextMismatch.selector);
        other.withdraw(f.w, f.proof, f.pubSignals);
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequit0");
        vm.prank(depositorOf(0));
        vm.expectRevert(PrivacyPool.NotDepositor.selector);
        other.ragequit(p, ps);
    }

    function test_changeRetainsOriginExclusionAndPublicExitAfterWindDown() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        pool.withdraw(f.w, f.proof, f.pubSignals);
        vm.startPrank(POSTMAN);
        for (uint256 i; i < 16; i++) pool.updateASPRoot(i + 123, "excluded original label");
        vm.stopPrank();
        WithdrawFixture memory change = _withdrawFixture(".withdraw2");
        vm.expectRevert(PrivacyPool.UnknownASPRoot.selector);
        pool.withdraw(change.w, change.proof, change.pubSignals);
        vm.prank(OWNER); pool.windDown();
        string memory base = json;
        json = vm.readFile("test/fixtures/security.json");
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequitChange");
        json = base;
        assertEq(ps[2], 0.6 ether);
        assertEq(ps[3], vm.parseJsonUint(json, ".deposits[0].label"));
        vm.prank(depositorOf(1));
        vm.expectRevert(PrivacyPool.NotDepositor.selector); pool.ragequit(p, ps);
        vm.prank(depositorOf(0)); pool.ragequit(p, ps);
        assertEq(address(pool).balance, 2.5 ether);
    }

    function _receiver(address at, WithdrawFixture memory f, bool reject) internal returns (ReviewReceiver r) {
        ReviewReceiver prototype = new ReviewReceiver();
        vm.etch(at, address(prototype).code);
        r = ReviewReceiver(payable(at));
        r.configure(address(pool), abi.encodeCall(pool.withdraw, (f.w, f.proof, f.pubSignals)), reject);
    }

    function test_recipientFailureRollsBackAllEffectsThenRetryWorks() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        ReviewReceiver r = _receiver(f.w.recipient, f, true);
        uint256 root = pool.getLastRoot();
        vm.expectRevert(PrivacyPool.TransferFailed.selector); pool.withdraw(f.w, f.proof, f.pubSignals);
        assertFalse(pool.nullifierHashes(f.pubSignals[1]));
        assertFalse(pool.commitments(f.pubSignals[0]));
        assertEq(pool.getLastRoot(), root); assertEq(pool.nextIndex(), 3);
        r.configure(address(pool), abi.encodeCall(pool.withdraw, (f.w, f.proof, f.pubSignals)), false);
        pool.withdraw(f.w, f.proof, f.pubSignals);
        assertEq(r.receipts(), 1); assertFalse(r.reentered());
        assertEq(f.w.recipient.balance, f.pubSignals[2] - f.w.fee);
    }

    function test_relayerFailureAlsoRevertsRecipientPayment() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        _receiver(f.w.relayer, f, true);
        vm.expectRevert(PrivacyPool.TransferFailed.selector); pool.withdraw(f.w, f.proof, f.pubSignals);
        assertEq(f.w.recipient.balance, 0); assertEq(address(pool).balance, 3.5 ether);
        assertFalse(pool.nullifierHashes(f.pubSignals[1])); assertEq(pool.nextIndex(), 3);
    }

    function test_relayerReentrancyCannotSpendTwice() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        ReviewReceiver r = _receiver(f.w.relayer, f, false);
        pool.withdraw(f.w, f.proof, f.pubSignals);
        assertEq(r.receipts(), 1); assertFalse(r.reentered()); assertEq(f.w.relayer.balance, f.w.fee);
    }

    function test_ragequitFailureRollsBackNullifier() public {
        _depositAll();
        WithdrawFixture memory unused = _withdrawFixture(".withdraw1");
        _receiver(depositorOf(1), unused, true);
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequit1");
        vm.prank(depositorOf(1)); vm.expectRevert(PrivacyPool.TransferFailed.selector); pool.ragequit(p, ps);
        assertFalse(pool.nullifierHashes(ps[1])); assertEq(address(pool).balance, 3.5 ether);
    }

    function test_stateRootExpiresAt100Insertions() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        vm.deal(address(this), 100);
        for (uint256 i; i < 99; i++) pool.deposit{value: 1}(i);
        assertTrue(pool.isKnownRoot(f.pubSignals[3]));
        pool.deposit{value: 1}(100);
        assertFalse(pool.isKnownRoot(f.pubSignals[3]));
        vm.expectRevert(PrivacyPool.UnknownStateRoot.selector); pool.withdraw(f.w, f.proof, f.pubSignals);
    }

    function test_lastASPContainingLabelEvictedAfter15PostsAfterRemoval() public {
        _ready();
        uint256 old = pool.currentASPRoot();
        vm.startPrank(POSTMAN);
        pool.updateASPRoot(555, "removal");
        for (uint256 i; i < 14; i++) pool.updateASPRoot(555, "same removal root");
        assertTrue(pool.isKnownASPRoot(old));
        pool.updateASPRoot(555, "same removal root");
        vm.stopPrank();
        assertFalse(pool.isKnownASPRoot(old));
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        vm.expectRevert(PrivacyPool.UnknownASPRoot.selector); pool.withdraw(f.w, f.proof, f.pubSignals);
    }

    /// Test-only capacity injection: slot 141 packs currentRootIndex (offset 0) and nextIndex (offset 4).
    /// This checks terminal control flow, not a million real insertions or correctness of a synthetic full tree.
    function test_capacityBlocksPartialWithdrawalButRagequitRemainsAvailable() public {
        _ready();
        uint256 slot = uint256(vm.load(address(pool), bytes32(uint256(141))));
        vm.store(address(pool), bytes32(uint256(141)), bytes32((slot & uint256(type(uint32).max)) | (uint256(2 ** 20) << 32)));
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        vm.expectRevert(MerkleTreeWithHistory.MerkleTreeFull.selector); pool.withdraw(f.w, f.proof, f.pubSignals);
        assertFalse(pool.nullifierHashes(f.pubSignals[1]));
        vm.deal(address(this), 1); vm.expectRevert(MerkleTreeWithHistory.MerkleTreeFull.selector); pool.deposit{value: 1}(1);
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(".ragequit0");
        vm.prank(depositorOf(0)); pool.ragequit(p, ps);
        assertEq(address(pool).balance, 2.5 ether);
    }

    function test_fullSpendAlsoNeedsCapacityAndLastSlotIsUsable() public {
        _ready();
        WithdrawFixture memory f = _withdrawFixture(".withdraw1");
        pool.withdraw(f.w, f.proof, f.pubSignals);
        WithdrawFixture memory full = _withdrawFixture(".withdraw2");
        uint256 slot = uint256(vm.load(address(pool), bytes32(uint256(141))));
        vm.store(address(pool), bytes32(uint256(141)), bytes32((slot & uint256(type(uint32).max)) | (uint256(2 ** 20) << 32)));
        vm.expectRevert(MerkleTreeWithHistory.MerkleTreeFull.selector);
        pool.withdraw(full.w, full.proof, full.pubSignals);
        assertFalse(pool.nullifierHashes(full.pubSignals[1]));
        vm.store(address(pool), bytes32(uint256(141)), bytes32((slot & uint256(type(uint32).max)) | (uint256(2 ** 20 - 1) << 32)));
        pool.withdraw(full.w, full.proof, full.pubSignals);
        assertEq(pool.nextIndex(), 2 ** 20);
        assertTrue(pool.nullifierHashes(full.pubSignals[1]));
        assertEq(address(pool).balance, 2.5 ether);
    }

    function testFuzz_depositBoundsAndSurplusAccounting(uint128 value, uint96 surplus) public {
        value = uint128(bound(value, 1, type(uint128).max));
        vm.deal(address(this), value);
        pool.deposit{value: value}(42);
        // Forced/out-of-band ETH is surplus, not a deposit liability. vm.deal models that independent balance change.
        vm.deal(address(pool), uint256(value) + surplus);
        assertGe(address(pool).balance, value);
        assertEq(address(pool).balance - value, surplus);
        assertEq(pool.nonce(), 1);
    }
}

/// Stateful accounting with REAL proofs. Bootstrap guarantees a successful spend in every invariant run.
contract ValidProofHandler is PoolFixtureTest {
    uint256 public successful;
    uint256 public rejected;
    uint256 public skipped;
    uint256 public paid;
    constructor(PrivacyPool target) { pool = target; json = vm.readFile("test/fixtures/pool.json"); }
    function bootstrap() external { spend(false); require(successful == 1, "valid proof path must execute"); }
    function spend(bool change) public {
        WithdrawFixture memory f = _withdrawFixture(change ? ".withdraw2" : ".withdraw1");
        try pool.withdraw(f.w, f.proof, f.pubSignals) { successful++; paid += f.pubSignals[2]; }
        catch { rejected++; }
    }
    function exit(uint8 which) external {
        if (which > 1) { skipped++; return; }
        (PrivacyPool.Groth16Proof memory p, uint256[4] memory ps) = _ragequitFixture(which == 0 ? ".ragequit0" : ".ragequit1");
        vm.prank(depositorOf(which));
        try pool.ragequit(p, ps) { successful++; paid += ps[2]; }
        catch { rejected++; }
    }
    function donate(uint64 amount) external { vm.deal(address(pool), address(pool).balance + amount); }
}

contract RealProofInvariantTest is PoolFixtureTest {
    ValidProofHandler handler;
    function setUp() public override {
        super.setUp(); _ready();
        handler = new ValidProofHandler(pool);
        handler.bootstrap();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.spend.selector;
        selectors[1] = handler.exit.selector;
        selectors[2] = handler.donate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }
    function invariant_liabilitiesCoveredDespiteSurplus() public view {
        assertLe(handler.paid(), 3.5 ether);
        assertGe(address(pool).balance, 3.5 ether - handler.paid());
        assertTrue(pool.nullifierHashes(_withdrawFixture(".withdraw1").pubSignals[1]));
        assertGe(handler.successful(), 1); // never vacuous: valid partial spend occurred
    }
    function afterInvariant() public {
        emit log_named_uint("successful operations (includes mandatory valid partial spend)", handler.successful());
        emit log_named_uint("rejected operations", handler.rejected());
        emit log_named_uint("skipped operations", handler.skipped());
    }
}
