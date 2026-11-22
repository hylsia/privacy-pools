// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrivacyPoolV2} from "../src/v2/PrivacyPoolV2.sol";
import {WithdrawVerifierV2Dev} from "../src/v2/dev-verifiers/WithdrawVerifierV2Dev.sol";
import {CommitmentVerifierV2Dev} from "../src/v2/dev-verifiers/CommitmentVerifierV2Dev.sol";
import {CommitmentVerifier} from "../src/verifiers/CommitmentVerifier.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

/// Real proofs for the isolated v2 candidate, including a copied deposit submitted first.
abstract contract PoolV2FixtureTest is Test {
    PrivacyPoolV2 pool;
    WithdrawVerifierV2Dev withdrawVerifier;
    CommitmentVerifierV2Dev commitmentVerifier;
    string json;
    address constant OWNER = address(0xA11CE);
    address constant POSTMAN = address(0xB0B);

    function setUp() public virtual {
        vm.chainId(31337);
        withdrawVerifier = new WithdrawVerifierV2Dev();
        commitmentVerifier = new CommitmentVerifierV2Dev();
        vm.prank(0x1111111111111111111111111111111111111111);
        pool = _createPool(
            OWNER,
            POSTMAN,
            IWithdrawVerifier(address(withdrawVerifier)),
            ICommitmentVerifier(address(commitmentVerifier)),
            0
        );
        json = vm.readFile("test/fixtures/v2/pool.json");
        assertEq(address(pool), vm.parseJsonAddress(json, ".pool"));
        assertEq(pool.SCOPE(), vm.parseJsonUint(json, ".scope"));
        assertEq(pool.PROTOCOL_VERSION(), _expectedProtocol());
    }

    function _expectedProtocol() internal pure virtual returns (string memory) { return "hylsia-pp-v2-candidate"; }

    function _createPool(address o, address p, IWithdrawVerifier w, ICommitmentVerifier c, uint256 minimum) internal virtual returns (PrivacyPoolV2) {
        return new PrivacyPoolV2(o, p, w, c, minimum);
    }

    function _proof(string memory key) internal view returns (PrivacyPoolV2.Groth16Proof memory p) {
        uint256[] memory a = vm.parseJsonUintArray(json, string.concat(key, ".pA"));
        uint256[] memory b = vm.parseJsonUintArray(json, string.concat(key, ".pB"));
        uint256[] memory c = vm.parseJsonUintArray(json, string.concat(key, ".pC"));
        p.pA = [a[0], a[1]];
        p.pB = [[b[0], b[1]], [b[2], b[3]]];
        p.pC = [c[0], c[1]];
    }

    function _exit(string memory key)
        internal
        view
        returns (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps)
    {
        p = _proof(key);
        uint256[] memory values = vm.parseJsonUintArray(json, string.concat(key, ".pubSignals"));
        for (uint256 i; i < 4; i++) {
            ps[i] = values[i];
        }
    }

    function _withdraw(string memory key) internal {
        PrivacyPoolV2.Withdrawal memory w = PrivacyPoolV2.Withdrawal({
            recipient: vm.parseJsonAddress(json, string.concat(key, ".withdrawal.recipient")),
            relayer: vm.parseJsonAddress(json, string.concat(key, ".withdrawal.relayer")),
            fee: vm.parseJsonUint(json, string.concat(key, ".withdrawal.fee")),
            deadline: vm.parseJsonUint(json, string.concat(key, ".withdrawal.deadline"))
        });
        uint256[] memory values = vm.parseJsonUintArray(json, string.concat(key, ".pubSignals"));
        uint256[6] memory ps;
        for (uint256 i; i < 6; i++) {
            ps[i] = values[i];
        }
        pool.withdraw(w, _proof(key), ps);
    }

    function _deposit(uint256 i) internal {
        string memory key = string.concat(".deposits[", vm.toString(i), "]");
        uint256 value = vm.parseJsonUint(json, string.concat(key, ".value"));
        uint256 pre = vm.parseJsonUint(json, string.concat(key, ".precommitment"));
        uint256 recoveryNonce = vm.parseJsonUint(json, string.concat(key, ".recoveryNonce"));
        address depositor = address(uint160(0xD000 + i));
        vm.deal(depositor, value);
        vm.prank(depositor);
        uint256 commitment = pool.deposit{value: value}(pre, recoveryNonce);
        assertEq(commitment, vm.parseJsonUint(json, string.concat(key, ".commitment")));
    }

    function _ready() internal {
        for (uint256 i; i < 3; i++) {
            _deposit(i);
        }
        assertEq(pool.getLastRoot(), vm.parseJsonUint(json, ".stateRootAfterDeposits"));
        vm.prank(POSTMAN);
        pool.updateASPRoot(vm.parseJsonUint(json, ".aspRoot"), "v2 development fixture");
    }

}

contract PrivacyPoolV2Test is PoolV2FixtureTest {
    function test_copiedDepositCannotStrandOriginalRagequit() public {
        _ready();
        _withdraw(".withdraw0"); // copied precommitment submitted first by another wallet
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit1");
        assertFalse(pool.nullifierHashes(ps[1]));
        vm.prank(address(0xD001));
        pool.ragequit(p, ps);
        assertEq(address(0xD001).balance, 1 ether);
        assertEq(address(pool).balance, 1.1 ether); // other deposit + first note's change
    }

    function test_duplicateSecretsSupportTwoPrivateWithdrawalChains() public {
        _ready();
        _withdraw(".withdraw0");
        _withdraw(".withdraw1");
        _withdraw(".withdrawChange0");
        _withdraw(".withdrawChange1");
        assertEq(address(pool).balance, 0.5 ether);
        assertEq(address(0xa1).balance, 1.96 ether);
        assertEq(address(0xf1).balance, 0.04 ether);
    }

    function test_duplicateSecretsCanBothRagequit() public {
        _ready();
        for (uint256 i; i < 2; i++) {
            (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(i == 0 ? ".ragequit0" : ".ragequit1");
            vm.prank(address(uint160(0xD000 + i)));
            pool.ragequit(p, ps);
        }
        assertEq(address(pool).balance, 0.5 ether);
    }

    function test_ragequitOfCopiedDepositDoesNotConsumeOriginalPrivateSpend() public {
        _ready();
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit0");
        vm.prank(address(0xD000));
        pool.ragequit(p, ps);
        _withdraw(".withdraw1FromDeposits");
        assertEq(address(pool).balance, 1.1 ether);
    }

    function test_changeRagequitUsesSameSpendNullifierAsPrivatePath() public {
        _ready();
        _withdraw(".withdraw0");
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequitChange0");
        vm.prank(address(0xD000));
        pool.ragequit(p, ps);
        assertEq(address(0xD000).balance, 0.6 ether);
        assertTrue(pool.nullifierHashes(ps[1]));
    }

    function test_sameNoteCannotSpendViaBothExitPaths() public {
        _ready();
        _withdraw(".withdraw0");
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit0");
        vm.prank(address(0xD000));
        vm.expectRevert(PrivacyPoolV2.NullifierAlreadySpent.selector);
        pool.ragequit(p, ps);
    }

    function test_ragequitReplayFails() public {
        _ready();
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit1");
        vm.startPrank(address(0xD001));
        pool.ragequit(p, ps);
        vm.expectRevert(PrivacyPoolV2.NullifierAlreadySpent.selector);
        pool.ragequit(p, ps);
        vm.stopPrank();
    }

    function test_privateSpendReplayFails() public {
        _ready();
        _withdraw(".withdraw0");
        vm.expectRevert(PrivacyPoolV2.NullifierAlreadySpent.selector);
        _withdraw(".withdraw0");
    }

    function test_copierCannotRagequitOriginalLabel() public {
        _ready();
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit1");
        vm.prank(address(0xD000));
        vm.expectRevert(PrivacyPoolV2.NotDepositor.selector);
        pool.ragequit(p, ps);
    }

    function test_v2ProofRejectedByV1Verifier() public {
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit0");
        assertFalse(new CommitmentVerifier().verifyProof(p.pA, p.pB, p.pC, ps));
    }

    function test_v1ProofRejectedByV2Verifier() public view {
        string memory legacy = vm.readFile("test/fixtures/pool.json");
        uint256[] memory a = vm.parseJsonUintArray(legacy, ".ragequit0.pA");
        uint256[] memory b = vm.parseJsonUintArray(legacy, ".ragequit0.pB");
        uint256[] memory c = vm.parseJsonUintArray(legacy, ".ragequit0.pC");
        uint256[] memory values = vm.parseJsonUintArray(legacy, ".ragequit0.pubSignals");
        uint256[4] memory ps = [values[0], values[1], values[2], values[3]];
        assertFalse(commitmentVerifier.verifyProof([a[0], a[1]], [[b[0], b[1]], [b[2], b[3]]], [c[0], c[1]], ps));
    }

    function test_invalidRecoveryNonceRejectsBeforeAcceptingFunds() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(PrivacyPoolV2.InvalidFieldElement.selector);
        pool.deposit{value: 1 ether}(1, 0);
        vm.expectRevert(PrivacyPoolV2.InvalidFieldElement.selector);
        pool.deposit{value: 1 ether}(1, type(uint256).max);
        assertEq(address(pool).balance, 0);
        assertEq(pool.nonce(), 0);
    }

    function test_originalRagequitStillWorksAfterWindDown() public {
        _ready();
        vm.prank(OWNER);
        pool.windDown();
        (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory ps) = _exit(".ragequit1");
        vm.prank(address(0xD001));
        pool.ragequit(p, ps);
        assertEq(address(0xD001).balance, 1 ether);
    }
}
