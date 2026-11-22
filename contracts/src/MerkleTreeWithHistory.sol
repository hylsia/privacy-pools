// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/**
 * @title MerkleTreeWithHistory
 * @notice Append-only incremental Merkle tree (depth 20, Poseidon-2 inner nodes)
 *         that remembers the last ROOT_HISTORY_SIZE roots, so proofs built against
 *         a slightly stale root remain valid while other users insert leaves.
 * @dev    Mirrors shared/privacy/merkleTree.ts and circuits/lib/merkleProof.circom.
 */
abstract contract MerkleTreeWithHistory {
    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint32 public constant TREE_DEPTH = 20;
    uint32 public constant ROOT_HISTORY_SIZE = 100;

    /// @notice Zero leaf: uint256(keccak256("hylsia.privacy-pool.v1.zero")) % p
    uint256 public immutable ZERO_VALUE;

    uint256[TREE_DEPTH] internal filledSubtrees;
    uint256[TREE_DEPTH + 1] internal zeros;
    uint256[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    event LeafInserted(uint32 indexed leafIndex, uint256 leaf, uint256 root);

    error MerkleTreeFull();

    constructor() {
        uint256 zero = uint256(keccak256("hylsia.privacy-pool.v1.zero")) % SNARK_SCALAR_FIELD;
        ZERO_VALUE = zero;
        uint256 current = zero;
        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            zeros[i] = current;
            filledSubtrees[i] = current;
            current = PoseidonT3.hash([current, current]);
        }
        zeros[TREE_DEPTH] = current;
        roots[0] = current;
    }

    /// @dev Inserts `leaf` at the next free position and records the new root.
    function _insert(uint256 leaf) internal returns (uint32 index) {
        uint32 insertIndex = nextIndex;
        if (insertIndex == uint32(2) ** TREE_DEPTH) revert MerkleTreeFull();

        uint32 currentIndex = insertIndex;
        uint256 currentLevelHash = leaf;
        uint256 left;
        uint256 right;

        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = PoseidonT3.hash([left, right]);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = insertIndex + 1;

        emit LeafInserted(insertIndex, leaf, currentLevelHash);
        return insertIndex;
    }

    /// @notice True if `root` is one of the last ROOT_HISTORY_SIZE roots.
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 current = currentRootIndex;
        uint32 i = current;
        do {
            if (root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != current);
        return false;
    }

    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }

    function getZero(uint32 level) external view returns (uint256) {
        return zeros[level];
    }
}
