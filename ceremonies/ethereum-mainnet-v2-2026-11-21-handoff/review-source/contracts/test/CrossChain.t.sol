// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";
import {CommitmentVerifier} from "../src/verifiers/CommitmentVerifier.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

/**
 * The same pool address on two chains. One deployer at one nonce gives the SAME pool address on every chain, so the
 * address alone never tells two pools apart (Robinhood Chain Testnet's pool and a local chain's, or a later Robinhood
 * Chain mainnet pool). SCOPE binds block.chainid, which makes them separate domains: labels, commitments and the
 * withdrawal context all differ, and a proof made for one pool is rejected by the other.
 *
 * Replays the chain-31337 fixture (scripts/privacy/gen-fixtures.ts) on a pool at the fixture's address under another
 * chain id: Local chain B (31338) and Robinhood Chain Testnet (46630). Regenerate the fixture with
 * `npm run zk:fixtures`.
 */
contract CrossChainReplayTest is Test {
    address constant DEPLOYER = 0x1111111111111111111111111111111111111111;
    address constant OWNER = address(0xA11CE);
    address constant POSTMAN = address(0xB0B);
    string json;

    function _poolOn(uint256 chainId) internal returns (PrivacyPool pool) {
        vm.chainId(chainId);
        WithdrawVerifier wv = new WithdrawVerifier();
        CommitmentVerifier cv = new CommitmentVerifier();
        vm.prank(DEPLOYER); // nonce 0, as for the fixture pool
        pool = new PrivacyPool(OWNER, POSTMAN, IWithdrawVerifier(address(wv)), ICommitmentVerifier(address(cv)), 0);
    }

    function _depositor(uint256 i) internal pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(uint160(0xD000 + i));
    }

    function _uints(string memory key) internal view returns (uint256[] memory) {
        return vm.parseJsonUintArray(json, key);
    }

    function _proof(string memory key) internal view returns (PrivacyPool.Groth16Proof memory p) {
        uint256[] memory a = _uints(string.concat(key, ".pA"));
        uint256[] memory b = _uints(string.concat(key, ".pB"));
        uint256[] memory c = _uints(string.concat(key, ".pC"));
        p.pA = [a[0], a[1]];
        p.pB = [[b[0], b[1]], [b[2], b[3]]];
        p.pC = [c[0], c[1]];
    }

    function _replay(uint256 chainId) internal {
        json = vm.readFile("test/fixtures/pool.json");
        PrivacyPool pool = _poolOn(chainId);
        assertEq(address(pool), vm.parseJsonAddress(json, ".pool"), "same address as the chain-31337 fixture pool");
        assertTrue(pool.SCOPE() != vm.parseJsonUint(json, ".scope"), "another chain id gives another SCOPE");

        // The same three deposits (same precommitments) get other labels and commitments on this chain.
        for (uint256 i = 0; i < 3; i++) {
            string memory k = string.concat(".deposits[", vm.toString(i), "]");
            uint256 value = vm.parseJsonUint(json, string.concat(k, ".value"));
            vm.deal(_depositor(i), value);
            vm.prank(_depositor(i));
            uint256 c = pool.deposit{value: value}(vm.parseJsonUint(json, string.concat(k, ".precommitment")));
            assertTrue(c != vm.parseJsonUint(json, string.concat(k, ".commitment")), "the commitment differs per chain");
        }
        vm.prank(POSTMAN);
        pool.updateASPRoot(vm.parseJsonUint(json, ".aspRoot"), "fixture root replayed");

        // A withdrawal proof from the fixture chain: its context hashes the other SCOPE.
        PrivacyPool.Withdrawal memory w = PrivacyPool.Withdrawal({
            recipient: vm.parseJsonAddress(json, ".withdraw1.withdrawal.recipient"),
            relayer: vm.parseJsonAddress(json, ".withdraw1.withdrawal.relayer"),
            fee: vm.parseJsonUint(json, ".withdraw1.withdrawal.fee"),
            deadline: vm.parseJsonUint(json, ".withdraw1.withdrawal.deadline")
        });
        uint256[] memory ws = _uints(".withdraw1.pubSignals");
        uint256[6] memory wsig;
        for (uint256 i = 0; i < 6; i++) {
            wsig[i] = ws[i];
        }
        vm.expectRevert(PrivacyPool.ContextMismatch.selector);
        pool.withdraw(w, _proof(".withdraw1"), wsig);

        // A ragequit proof from the fixture chain, sent by the same depositor: its label is not a deposit here.
        uint256[] memory rs = _uints(".ragequit1.pubSignals");
        uint256[4] memory rsig;
        for (uint256 i = 0; i < 4; i++) {
            rsig[i] = rs[i];
        }
        vm.prank(_depositor(1));
        vm.expectRevert(PrivacyPool.NotDepositor.selector);
        pool.ragequit(_proof(".ragequit1"), rsig);

        assertEq(address(pool).balance, 3.5 ether, "nothing left the pool");
    }

    function test_fixtureProofsRejectedOnLocalChainBId() public {
        _replay(31338);
    }

    function test_fixtureProofsRejectedOnRobinhoodChainTestnetId() public {
        _replay(46630);
    }
}
