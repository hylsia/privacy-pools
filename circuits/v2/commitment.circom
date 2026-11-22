pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

/**
 * Hylsia Privacy Pool v2 candidate — commitment (ragequit) circuit.
 *
 * Proves knowledge of the secrets behind a commitment with a *public* value
 * and label. Used by the exit path that does not depend on the ASP: the
 * contract checks msg.sender is the original depositor of `label`.
 *
 * Public signals: [commitment, nullifierHash, value, label]
 */
template CommitmentProofV2() {
    // ── public inputs ──
    signal input value;
    signal input label;
    // ── private inputs ──
    signal input nullifier;
    signal input secret;
    // ── outputs ──
    signal output commitment;
    signal output nullifierHash;

    component range = Num2Bits(128);
    range.in <== value;

    component precommitment = Poseidon(2);
    precommitment.inputs[0] <== nullifier;
    precommitment.inputs[1] <== secret;

    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== value;
    commitmentHasher.inputs[1] <== label;
    commitmentHasher.inputs[2] <== precommitment.out;
    commitment <== commitmentHasher.out;

    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    // Assigned per deposit; repeated secrets on different labels cannot consume each other.
    nullifierHasher.inputs[1] <== label;
    nullifierHash <== nullifierHasher.out;
}

component main { public [value, label] } = CommitmentProofV2();
