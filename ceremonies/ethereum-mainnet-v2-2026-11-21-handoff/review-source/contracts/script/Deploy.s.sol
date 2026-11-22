// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {PrivacyPool} from "../src/PrivacyPool.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";
import {CommitmentVerifier} from "../src/verifiers/CommitmentVerifier.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

/**
 * Deploys the verifiers and the native-ETH PrivacyPool on one network.
 * Linked libraries (PoseidonT3 / PoseidonT4) are deployed automatically by `forge script`.
 *
 * Hylsia is built for Robinhood Chain Testnet (46630); Robinhood Chain mainnet can follow later as a new registry
 * entry, with these same contracts. Deploy from ONE frozen build and checkout: metadata changes the bytecode, and with
 * it the CREATE2 addresses of the linked libraries. For Robinhood Chain Testnet use scripts/privacy/deploy.ts
 * (`npm run zk:deploy:robinhood`), which checks the RPC and the chain id first.
 *
 * Env:
 *   PRIVACY_DEPLOYER_PRIVATE_KEY  (optional) without it, forge's own wallet flags sign:
 *                                 --account <keystore> --sender <addr>, or --ledger --sender <addr>
 *   PRIVACY_POOL_OWNER            (default: deployer)
 *   PRIVACY_ASP_POSTMAN           (default: owner)
 *   PRIVACY_MIN_DEPOSIT_WEI       (default: 0)
 *   PRIVACY_DEPLOYMENT_OUT        (optional) record path inside deployments/, relative to contracts/
 *
 * Guards (the script reverts before anything is sent):
 *   - forge's default sender is refused;
 *   - off anvil, anvil's ten default accounts are refused as deployer, owner or postman.
 *
 * Record: written only by `forge script --broadcast`; a dry run prints "dry run: no deployment record written".
 *   - PRIVACY_DEPLOYMENT_OUT when set;
 *   - else, on anvil with any chain id other than the local development ids 31337/31338 (Robinhood Chain Testnet's
 *     46630, for one): deployments/local/<chainId>.json, which scripts/privacy/sync-deployments.ts never reads (a
 *     local chain must never be served as a real pool);
 *   - else deployments/<chainId>.json (local ids 31337/31338 reach the app only through `--include-local`).
 */
contract Deploy is Script {
    string internal constant PROTOCOL = "hylsia-pp-v1";
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    /// the local development chains (Local chain A and B); every other chain id is a public network's
    uint256 internal constant LOCAL_CHAIN_A = 31337;
    uint256 internal constant LOCAL_CHAIN_B = 31338;

    function run() external {
        bool onAnvil = _isAnvil();
        uint256 deployBlock = block.number;

        uint256 pk = _envUintOr("PRIVACY_DEPLOYER_PRIVATE_KEY", 0);
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address owner = _envAddressOr("PRIVACY_POOL_OWNER", deployer);
        address postman = _envAddressOr("PRIVACY_ASP_POSTMAN", owner);
        uint256 minDeposit = _envUintOr("PRIVACY_MIN_DEPOSIT_WEI", 0);
        _guard(deployer, owner, postman, onAnvil);

        WithdrawVerifier withdrawVerifier = new WithdrawVerifier();
        CommitmentVerifier commitmentVerifier = new CommitmentVerifier();
        PrivacyPool pool = new PrivacyPool(
            owner, postman, IWithdrawVerifier(address(withdrawVerifier)), ICommitmentVerifier(address(commitmentVerifier)), minDeposit
        );
        vm.stopBroadcast();

        console2.log("chainId            ", block.chainid);
        console2.log("deployer           ", deployer);
        console2.log("PrivacyPool        ", address(pool));
        console2.log("WithdrawVerifier   ", address(withdrawVerifier));
        console2.log("CommitmentVerifier ", address(commitmentVerifier));
        console2.log("owner              ", owner);
        console2.log("aspPostman         ", postman);
        console2.log("SCOPE              ", pool.SCOPE());

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            console2.log("dry run: no deployment record written");
            return;
        }

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeString(obj, "protocol", PROTOCOL);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "pool", address(pool));
        vm.serializeAddress(obj, "withdrawVerifier", address(withdrawVerifier));
        vm.serializeAddress(obj, "commitmentVerifier", address(commitmentVerifier));
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "aspPostman", postman);
        vm.serializeString(obj, "scope", vm.toString(pool.SCOPE()));
        vm.serializeString(obj, "minDepositWei", vm.toString(minDeposit));
        string memory json = vm.serializeString(obj, "deployBlock", vm.toString(deployBlock));

        string memory out = _recordPath(onAnvil);
        string memory dir = _dirname(out);
        if (bytes(dir).length > 0) vm.createDir(dir, true);
        vm.writeJson(json, out);
        console2.log("deployment record  ", out);
    }

    /// anvil answers `anvil_nodeInfo`; a public node, or no RPC at all, does not.
    function _isAnvil() internal returns (bool) {
        try vm.rpc("anvil_nodeInfo", "[]") returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }

    function _guard(address deployer, address owner, address postman, bool onAnvil) internal pure {
        require(
            deployer != DEFAULT_SENDER,
            "Deploy: refusing forge's default sender; sign with --account <name> --sender <addr>, --ledger --sender <addr>, or PRIVACY_DEPLOYER_PRIVATE_KEY"
        );
        if (onAnvil) return;
        for (uint32 i = 0; i < 10; i++) {
            address a = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i));
            require(deployer != a, "Deploy: the deployer is an anvil default account; off anvil, deploy from your own key");
            require(owner != a, "Deploy: PRIVACY_POOL_OWNER is an anvil default account; off anvil, use your own address");
            require(postman != a, "Deploy: PRIVACY_ASP_POSTMAN is an anvil default account; off anvil, use your own address");
        }
    }

    function _recordPath(bool onAnvil) internal view returns (string memory) {
        string memory out = vm.envOr("PRIVACY_DEPLOYMENT_OUT", string(""));
        if (bytes(out).length > 0) return out;
        string memory file = string.concat(vm.toString(block.chainid), ".json");
        bool localChain = block.chainid == LOCAL_CHAIN_A || block.chainid == LOCAL_CHAIN_B;
        if (onAnvil && !localChain) return string.concat("deployments/local/", file);
        return string.concat("deployments/", file);
    }

    /// Unset or blank: the fallback. Anything else must parse, or the script reverts.
    function _envUintOr(string memory name, uint256 fallbackValue) internal view returns (uint256) {
        string memory v = vm.envOr(name, string(""));
        if (bytes(v).length == 0) return fallbackValue;
        return vm.parseUint(v);
    }

    function _envAddressOr(string memory name, address fallbackValue) internal view returns (address) {
        string memory v = vm.envOr(name, string(""));
        if (bytes(v).length == 0) return fallbackValue;
        return vm.parseAddress(v);
    }

    function _dirname(string memory path) internal pure returns (string memory) {
        bytes memory b = bytes(path);
        for (uint256 i = b.length; i > 0; i--) {
            if (b[i - 1] == "/") {
                bytes memory d = new bytes(i - 1);
                for (uint256 j = 0; j < i - 1; j++) {
                    d[j] = b[j];
                }
                return string(d);
            }
        }
        return "";
    }
}
