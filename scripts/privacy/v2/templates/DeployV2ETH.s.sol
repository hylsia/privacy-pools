// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PrivacyPoolV2ETH} from "../src/v2/PrivacyPoolV2ETH.sol";
import {WithdrawVerifierV2ETH} from "../src/verifiers/WithdrawVerifierV2ETH.sol";
import {CommitmentVerifierV2ETH} from "../src/verifiers/CommitmentVerifierV2ETH.sol";
import {IWithdrawVerifier, ICommitmentVerifier} from "../src/interfaces/IVerifiers.sol";

/// Packaged with the final ceremony verifiers. An optional environment key is consumed only for explicit signing.
contract DeployV2ETH is Script {
    function run() external {
        uint256 chainId = vm.envUint("PRIVACY_DEPLOY_CHAIN_ID");
        require((chainId == 1 || chainId == 4663) && block.chainid == chainId, "Selected mainnet chain ID required");
        address owner = vm.envAddress("PRIVACY_POOL_OWNER");
        address publisher = vm.envAddress("PRIVACY_ASP_POSTMAN");
        uint256 minimum = vm.envUint("PRIVACY_MIN_DEPOSIT_WEI");
        if (vm.envOr("PRIVACY_DEPLOY_USE_ENV_KEY", false)) {
            uint256 key = vm.envUint("DEPLOY_PRIVATE_KEY_MAINNET");
            require(vm.addr(key) == vm.envAddress("PRIVACY_DEPLOYER_ADDRESS"), "Environment signer mismatch");
            vm.startBroadcast(key);
        } else vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        require(deployer == vm.envAddress("PRIVACY_DEPLOYER_ADDRESS") && deployer != DEFAULT_SENDER, "Explicit matching deployer required");
        WithdrawVerifierV2ETH w = new WithdrawVerifierV2ETH();
        CommitmentVerifierV2ETH c = new CommitmentVerifierV2ETH();
        PrivacyPoolV2ETH pool = new PrivacyPoolV2ETH(owner, publisher, IWithdrawVerifier(address(w)), ICommitmentVerifier(address(c)), minimum);
        vm.stopBroadcast();
        console2.log("PrivacyPoolV2ETH", address(pool));
        console2.log("WithdrawVerifierV2ETH", address(w));
        console2.log("CommitmentVerifierV2ETH", address(c));
        console2.log("SCOPE", pool.SCOPE());
    }
}
