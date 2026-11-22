// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Groth16 verifier for circuits/withdraw.circom (6 public signals).
interface IWithdrawVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[6] calldata pubSignals
    ) external view returns (bool);
}

/// @notice Groth16 verifier for circuits/commitment.circom (4 public signals).
interface ICommitmentVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}
