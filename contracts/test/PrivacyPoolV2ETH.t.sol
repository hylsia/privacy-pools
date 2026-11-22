// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PrivacyPoolV2Test} from "./PrivacyPoolV2.t.sol";
import {PrivacyPoolV2} from "../src/v2/PrivacyPoolV2.sol";
import {PrivacyPoolV2ETH} from "../src/v2/PrivacyPoolV2ETH.sol";
import {ICommitmentVerifier, IWithdrawVerifier} from "../src/interfaces/IVerifiers.sol";

/// Real development proofs exercise the native ETH release wrapper. This does not certify production keys.
contract PrivacyPoolV2ETHTest is PrivacyPoolV2Test {
    function _expectedProtocol() internal pure override returns (string memory) { return "hylsia-pp-v2-eth"; }

    function _createPool(address o, address p, IWithdrawVerifier w, ICommitmentVerifier c, uint256 minimum)
        internal override returns (PrivacyPoolV2)
    { return new PrivacyPoolV2ETH(o, p, w, c, minimum); }

    function test_nativeETHAssetAndAdministrativeSeparation() public view {
        assertEq(pool.ASSET(), 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        assertEq(pool.owner(), OWNER);
        assertEq(pool.aspPostman(), POSTMAN);
        assertEq(pool.MAX_VALUE(), type(uint128).max);
    }

    function test_nativeETHRejectsInvalidDeploymentRolesOrVerifierCode() public {
        vm.expectRevert("Nonzero publisher required");
        new PrivacyPoolV2ETH(OWNER, address(0), IWithdrawVerifier(address(withdrawVerifier)), ICommitmentVerifier(address(commitmentVerifier)), 0);
        vm.expectRevert("Verifier code required");
        new PrivacyPoolV2ETH(OWNER, POSTMAN, IWithdrawVerifier(address(0x1234)), ICommitmentVerifier(address(commitmentVerifier)), 0);
        vm.expectRevert("Minimum deposit exceeds circuit range");
        new PrivacyPoolV2ETH(OWNER, POSTMAN, IWithdrawVerifier(address(withdrawVerifier)), ICommitmentVerifier(address(commitmentVerifier)), uint256(type(uint128).max) + 1);
    }

    function test_sharedOwnerPublisherCanDeployAndPublish() public {
        PrivacyPoolV2ETH single = new PrivacyPoolV2ETH(OWNER, OWNER, IWithdrawVerifier(address(withdrawVerifier)), ICommitmentVerifier(address(commitmentVerifier)), 0);
        assertEq(single.owner(), OWNER);
        assertEq(single.aspPostman(), OWNER);
        vm.prank(OWNER);
        single.updateASPRoot(123, "single operator");
        assertEq(single.currentASPRoot(), 123);
    }

    function test_sharedOwnerPublisherRetainsPrivateSpendAndPublicExit() public {
        vm.prank(OWNER);
        pool.transferOwnership(POSTMAN);
        _ready();
        _withdraw(".withdraw0");
        vm.prank(POSTMAN);
        pool.windDown();
        (PrivacyPoolV2.Groth16Proof memory proof, uint256[4] memory signals) = _exit(".ragequit1");
        vm.prank(address(0xD001));
        pool.ragequit(proof, signals);
        assertEq(address(0xD001).balance, 1 ether);
        assertEq(address(pool).balance, 1.1 ether);
    }
}
