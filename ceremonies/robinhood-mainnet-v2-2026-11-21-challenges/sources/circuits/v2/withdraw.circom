pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "../lib/merkleProof.circom";

/**
 * Hylsia Privacy Pool v2 candidate — withdrawal circuit.
 *
 * Proves, without revealing which note is spent:
 *   1. knowledge of (nullifier, secret) behind a commitment in the state tree,
 *   2. the note's label is a member of the association-set (ASP) tree,
 *   3. withdrawnValue <= existingValue, and the change goes into a fresh
 *      commitment with the same label,
 *   4. the nullifier hash that will be marked spent,
 *   5. a binding to `context` (recipient, relayer, fee, deadline, scope).
 *
 * Public signals (snarkjs order — outputs first, then public inputs):
 *   [newCommitmentHash, existingNullifierHash, withdrawnValue, stateRoot, ASPRoot, context]
 */
template WithdrawV2(depth) {
    // ── public inputs ──
    signal input withdrawnValue;
    signal input stateRoot;
    signal input ASPRoot;
    signal input context;

    // ── private inputs ──
    signal input label;
    signal input existingValue;
    signal input existingNullifier;
    signal input existingSecret;
    signal input newNullifier;
    signal input newSecret;
    signal input stateSiblings[depth];
    signal input stateIndex;
    signal input ASPSiblings[depth];
    signal input ASPIndex;

    // ── outputs ──
    signal output newCommitmentHash;
    signal output existingNullifierHash;

    // Value conservation. All three values are range-checked to 128 bits, so
    // remainingValue = existingValue - withdrawnValue cannot wrap around the field.
    component existingRange = Num2Bits(128);
    existingRange.in <== existingValue;
    component withdrawnRange = Num2Bits(128);
    withdrawnRange.in <== withdrawnValue;
    signal remainingValue;
    remainingValue <== existingValue - withdrawnValue;
    component remainingRange = Num2Bits(128);
    remainingRange.in <== remainingValue;

    // Existing commitment = Poseidon(value, label, Poseidon(nullifier, secret))
    component existingPrecommitment = Poseidon(2);
    existingPrecommitment.inputs[0] <== existingNullifier;
    existingPrecommitment.inputs[1] <== existingSecret;
    component existingCommitment = Poseidon(3);
    existingCommitment.inputs[0] <== existingValue;
    existingCommitment.inputs[1] <== label;
    existingCommitment.inputs[2] <== existingPrecommitment.out;

    // Membership of the commitment in the state tree
    component stateProof = MerkleProof(depth);
    stateProof.leaf <== existingCommitment.out;
    stateProof.index <== stateIndex;
    for (var i = 0; i < depth; i++) {
        stateProof.siblings[i] <== stateSiblings[i];
    }
    stateProof.root === stateRoot;

    // Membership of the *same* label in the ASP tree
    component aspProof = MerkleProof(depth);
    aspProof.leaf <== label;
    aspProof.index <== ASPIndex;
    for (var i = 0; i < depth; i++) {
        aspProof.siblings[i] <== ASPSiblings[i];
    }
    aspProof.root === ASPRoot;

    // Nullifier hash that the contract marks as spent
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== existingNullifier;
    // Assigned per deposit; repeated secrets on different labels cannot consume each other.
    nullifierHasher.inputs[1] <== label;
    existingNullifierHash <== nullifierHasher.out;

    // Change note: same label, remaining value, fresh secrets
    component newPrecommitment = Poseidon(2);
    newPrecommitment.inputs[0] <== newNullifier;
    newPrecommitment.inputs[1] <== newSecret;
    component newCommitment = Poseidon(3);
    newCommitment.inputs[0] <== remainingValue;
    newCommitment.inputs[1] <== label;
    newCommitment.inputs[2] <== newPrecommitment.out;
    newCommitmentHash <== newCommitment.out;

    // Bind the public context into the constraint system so the proof cannot
    // be replayed with a different recipient / relayer / fee / deadline.
    signal contextSquare;
    contextSquare <== context * context;
}

component main { public [withdrawnValue, stateRoot, ASPRoot, context] } = WithdrawV2(20);
