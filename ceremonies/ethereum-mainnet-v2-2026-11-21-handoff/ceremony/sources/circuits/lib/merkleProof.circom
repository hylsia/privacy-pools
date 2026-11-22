pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

/**
 * Recomputes the root of a fixed-depth binary Merkle tree with Poseidon-2
 * inner nodes. `index` is the leaf position; its bits select left/right.
 * Matches shared/privacy/merkleTree.ts and MerkleTreeWithHistory.sol.
 */
template MerkleProof(depth) {
    signal input leaf;
    signal input index;
    signal input siblings[depth];
    signal output root;

    // Num2Bits also enforces index < 2^depth.
    component bits = Num2Bits(depth);
    bits.in <== index;

    signal hashes[depth + 1];
    signal left[depth];
    signal right[depth];
    component hashers[depth];

    hashes[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        // bit = 0 → current node is the left child; bit = 1 → right child
        left[i]  <== hashes[i] + bits.out[i] * (siblings[i] - hashes[i]);
        right[i] <== siblings[i] + bits.out[i] * (hashes[i] - siblings[i]);
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        hashes[i + 1] <== hashers[i].out;
    }
    root <== hashes[depth];
}
