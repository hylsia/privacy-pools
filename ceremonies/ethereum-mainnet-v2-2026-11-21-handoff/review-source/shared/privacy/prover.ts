/**
 * Groth16 proving helpers (snarkjs). Works in the browser and in Node.
 * Artifacts are passed as bytes so callers can verify their integrity first.
 */
// snarkjs is loaded lazily so the browser bundle only pays for it when proving.
const loadSnarkjs = () => import("snarkjs");
import { TREE_DEPTH } from "./constants";
import { toDec } from "./notes";
import type { Groth16ProofCalldata, SnarkProof } from "./types";

export interface ProvingArtifacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
}

export interface WithdrawCircuitInputs {
  withdrawnValue: bigint;
  stateRoot: bigint;
  ASPRoot: bigint;
  context: bigint;
  label: bigint;
  existingValue: bigint;
  existingNullifier: bigint;
  existingSecret: bigint;
  newNullifier: bigint;
  newSecret: bigint;
  stateSiblings: bigint[];
  stateIndex: number;
  ASPSiblings: bigint[];
  ASPIndex: number;
}

export interface CommitmentCircuitInputs {
  value: bigint;
  label: bigint;
  nullifier: bigint;
  secret: bigint;
}

export interface ProofResult {
  proof: Groth16ProofCalldata;
  publicSignals: bigint[];
  raw: SnarkProof;
}

/** Convert a snarkjs proof into the (pA, pB, pC) layout the Solidity verifier expects. */
export function toCalldata(proof: SnarkProof): Groth16ProofCalldata {
  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    // G2 coordinates are swapped for the EVM pairing precompile.
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

const mem = (data: Uint8Array) => ({ type: "mem" as const, data });

async function prove(input: Record<string, unknown>, artifacts: ProvingArtifacts): Promise<ProofResult> {
  const snarkjs = await loadSnarkjs();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, mem(artifacts.wasm), mem(artifacts.zkey));
  return { proof: toCalldata(proof), publicSignals: publicSignals.map((s) => BigInt(s)), raw: proof };
}

export async function proveWithdraw(inputs: WithdrawCircuitInputs, artifacts: ProvingArtifacts): Promise<ProofResult> {
  if (inputs.stateSiblings.length !== TREE_DEPTH || inputs.ASPSiblings.length !== TREE_DEPTH) {
    throw new Error("sibling paths must have TREE_DEPTH entries");
  }
  return prove(
    {
      withdrawnValue: toDec(inputs.withdrawnValue),
      stateRoot: toDec(inputs.stateRoot),
      ASPRoot: toDec(inputs.ASPRoot),
      context: toDec(inputs.context),
      label: toDec(inputs.label),
      existingValue: toDec(inputs.existingValue),
      existingNullifier: toDec(inputs.existingNullifier),
      existingSecret: toDec(inputs.existingSecret),
      newNullifier: toDec(inputs.newNullifier),
      newSecret: toDec(inputs.newSecret),
      stateSiblings: inputs.stateSiblings.map(toDec),
      stateIndex: toDec(inputs.stateIndex),
      ASPSiblings: inputs.ASPSiblings.map(toDec),
      ASPIndex: toDec(inputs.ASPIndex),
    },
    artifacts,
  );
}

export async function proveCommitment(inputs: CommitmentCircuitInputs, artifacts: ProvingArtifacts): Promise<ProofResult> {
  return prove(
    {
      value: toDec(inputs.value),
      label: toDec(inputs.label),
      nullifier: toDec(inputs.nullifier),
      secret: toDec(inputs.secret),
    },
    artifacts,
  );
}

/** Local verification against a verification key (sanity check before paying for gas). */
export async function verifyLocally(vkey: unknown, result: ProofResult): Promise<boolean> {
  const snarkjs = await loadSnarkjs();
  return snarkjs.groth16.verify(vkey, result.publicSignals.map(toDec), result.raw);
}
