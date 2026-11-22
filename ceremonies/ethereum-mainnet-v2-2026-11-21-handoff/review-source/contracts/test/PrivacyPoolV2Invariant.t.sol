// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PoolV2FixtureTest} from "./PrivacyPoolV2.t.sol";
import {PrivacyPoolV2} from "../src/v2/PrivacyPoolV2.sol";

/// Stateful operations use the real v2 fixture proofs, including both deposits that share their secrets.
contract V2AccountingHandler is PoolV2FixtureTest {
    uint256 public paid;
    uint256 public donated;
    uint256 public successful;
    uint256 public rejected;
    uint256 public bootstrapNullifier;

    constructor(PrivacyPoolV2 target) {
        pool = target;
        json = vm.readFile("test/fixtures/v2/pool.json");
        uint256[] memory signals = vm.parseJsonUintArray(json, ".withdraw0.pubSignals");
        bootstrapNullifier = signals[1];
    }

    function bootstrap() external {
        this.spend(0);
        require(successful == 1, "v2 invariant requires an actual successful private withdrawal");
    }

    function spend(uint8 which) external {
        string memory key = which % 4 == 0 ? ".withdraw0" : which % 4 == 1 ? ".withdraw1" : which % 4 == 2 ? ".withdrawChange0" : ".withdrawChange1";
        PrivacyPoolV2.Withdrawal memory w = PrivacyPoolV2.Withdrawal({
            recipient: vm.parseJsonAddress(json, string.concat(key, ".withdrawal.recipient")),
            relayer: vm.parseJsonAddress(json, string.concat(key, ".withdrawal.relayer")),
            fee: vm.parseJsonUint(json, string.concat(key, ".withdrawal.fee")),
            deadline: vm.parseJsonUint(json, string.concat(key, ".withdrawal.deadline"))
        });
        uint256[] memory values = vm.parseJsonUintArray(json, string.concat(key, ".pubSignals"));
        uint256[6] memory signals;
        for (uint256 i; i < 6; i++) signals[i] = values[i];
        try pool.withdraw(w, _proof(key), signals) { paid += signals[2]; successful++; }
        catch { rejected++; }
    }

    function exit(uint8 which) external {
        uint256 choice = which % 4;
        string memory key = choice == 0 ? ".ragequit0" : choice == 1 ? ".ragequit1" : choice == 2 ? ".ragequit2" : ".ragequitChange0";
        (PrivacyPoolV2.Groth16Proof memory proof, uint256[4] memory signals) = _exit(key);
        vm.prank(address(uint160(0xD000 + (choice == 3 ? 0 : choice))));
        try pool.ragequit(proof, signals) { paid += signals[2]; successful++; }
        catch { rejected++; }
    }

    function donate(uint96 amount) external {
        donated += amount;
        vm.deal(address(pool), address(pool).balance + amount);
    }
}

contract V2RealProofInvariantTest is PoolV2FixtureTest {
    V2AccountingHandler handler;

    function setUp() public override {
        super.setUp();
        _ready();
        handler = new V2AccountingHandler(pool);
        handler.bootstrap();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.spend.selector;
        selectors[1] = handler.exit.selector;
        selectors[2] = handler.donate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_v2PayoutsRemainCoveredWithDuplicateSecretsAndSurplus() public view {
        assertLe(handler.paid(), 2.5 ether);
        assertEq(address(pool).balance, 2.5 ether - handler.paid() + handler.donated());
        assertGe(handler.successful(), 1);
    }

    function invariant_v2SpentNullifierNeverReopens() public view {
        assertTrue(pool.nullifierHashes(handler.bootstrapNullifier()));
    }
}

contract V2ExitOrderFuzzTest is PoolV2FixtureTest {
    function testFuzz_duplicateDepositsBothExitRegardlessOfOrder(bool reverse) public {
        _ready();
        for (uint256 step; step < 2; step++) {
            uint256 i = reverse ? 1 - step : step;
            (PrivacyPoolV2.Groth16Proof memory p, uint256[4] memory signals) = _exit(i == 0 ? ".ragequit0" : ".ragequit1");
            vm.prank(address(uint160(0xD000 + i)));
            pool.ragequit(p, signals);
        }
        assertEq(address(pool).balance, 0.5 ether);
        assertEq(address(0xD000).balance, 1 ether);
        assertEq(address(0xD001).balance, 1 ether);
    }
}
