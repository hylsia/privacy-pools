// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {PrivacyPoolV2} from "../src/v2/PrivacyPoolV2.sol";
import {PrivacyPoolV2ETH} from "../src/v2/PrivacyPoolV2ETH.sol";
import {WithdrawVerifierV2Dev} from "../src/v2/dev-verifiers/WithdrawVerifierV2Dev.sol";
import {CommitmentVerifierV2Dev} from "../src/v2/dev-verifiers/CommitmentVerifierV2Dev.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

/// This development entry cannot target Robinhood mainnet/testnet or use application/deployer secret env values.
contract DeployV2Dev is Script {
    function run() external {
        require(block.chainid == 31337 || block.chainid == 31338, "V2 dev deployment: local chain IDs only");
        bool local;
        try vm.rpc("anvil_nodeInfo", "[]") returns (bytes memory) {
            local = true;
        }
            catch {}
        require(local, "V2 dev deployment: Anvil required");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(deployer != DEFAULT_SENDER, "V2 dev deployment: explicit sender required");
        address publisher = vm.envOr("PRIVACY_ASP_POSTMAN", deployer);
        WithdrawVerifierV2Dev w = new WithdrawVerifierV2Dev();
        CommitmentVerifierV2Dev c = new CommitmentVerifierV2Dev();
        PrivacyPoolV2 pool = vm.envOr("PRIVACY_V2_NATIVE_ETH_LOCAL", false)
            ? new PrivacyPoolV2ETH(deployer, publisher, IWithdrawVerifier(address(w)), ICommitmentVerifier(address(c)), 0)
            : new PrivacyPoolV2(deployer, publisher, IWithdrawVerifier(address(w)), ICommitmentVerifier(address(c)), 0);
        vm.stopBroadcast();
        console2.log("V2 development pool", address(pool));
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        string memory out = vm.envOr("PRIVACY_V2_DEV_RECORD", string("deployments/local/v2-dev.json"));
        require(bytes(out).length >= 18 && _localPath(out), "V2 dev record must remain under deployments/local/");
        vm.createDir("deployments/local", true);
        string memory obj = "v2-development";
        vm.serializeAddress(obj, "pool", address(pool));
        vm.serializeAddress(obj, "withdrawVerifier", address(w));
        vm.serializeAddress(obj, "commitmentVerifier", address(c));
        vm.serializeAddress(obj, "publisher", publisher);
        vm.serializeString(obj, "protocol", pool.PROTOCOL_VERSION());
        string memory record = vm.serializeString(obj, "scope", vm.toString(pool.SCOPE()));
        vm.writeJson(record, out);
    }

    function _localPath(string memory value) private pure returns (bool) {
        bytes memory b = bytes(value);
        bytes memory prefix = bytes("deployments/local/");
        if (b.length <= prefix.length) return false;
        for (uint256 i; i < prefix.length; i++) {
            if (b[i] != prefix[i]) return false;
        }
        for (uint256 i = prefix.length; i < b.length; i++) {
            if (b[i] == "/" || b[i] == "\\") return false;
            if (i + 1 < b.length && b[i] == "." && b[i + 1] == ".") return false;
        }
        return true;
    }
}
