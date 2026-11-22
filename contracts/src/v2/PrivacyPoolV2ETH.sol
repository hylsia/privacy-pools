// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PrivacyPoolV2} from "./PrivacyPoolV2.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../interfaces/IVerifiers.sol";

/// Native ETH v2 release target. Production deployment additionally requires reviewed final verifiers and release evidence.
/// Shares v2's label-bound nullifiers, random public recovery nonce, private change and depositor-only public exit.
contract PrivacyPoolV2ETH is PrivacyPoolV2 {
    constructor(
        address poolOwner,
        address publisher,
        IWithdrawVerifier withdrawVerifier,
        ICommitmentVerifier commitmentVerifier,
        uint256 minimumDeposit
    ) PrivacyPoolV2(poolOwner, publisher, withdrawVerifier, commitmentVerifier, minimumDeposit) {
        require(publisher != address(0), "Nonzero publisher required");
        require(minimumDeposit <= MAX_VALUE, "Minimum deposit exceeds circuit range");
        require(address(withdrawVerifier).code.length > 0 && address(commitmentVerifier).code.length > 0, "Verifier code required");
    }

    function PROTOCOL_VERSION() public pure override returns (string memory) {
        return "hylsia-pp-v2-eth";
    }
}
