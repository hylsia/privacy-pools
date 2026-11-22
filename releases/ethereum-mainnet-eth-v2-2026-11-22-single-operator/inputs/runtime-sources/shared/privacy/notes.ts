/**
 * Note model and deterministic key derivation.
 *
 * A user owns one random 32-byte master seed (generated on-device, backed up
 * encrypted). Every secret the pool needs is derived from it, so the seed plus
 * the public chain history is sufficient to recover every note:
 *
 *   masterNullifier = keccak(seed || "nullifier") mod p
 *   masterSecret    = keccak(seed || "secret")    mod p
 *   nullifier(i,j)  = Poseidon4(masterNullifier, scope, i, j)
 *   secret(i,j)     = Poseidon4(masterSecret,    scope, i, j)
 *
 * i = deposit index (0,1,2,...), j = hop index inside that deposit's chain
 * (0 for the deposit itself, j+1 for the change note created by withdrawal j).
 *
 *   precommitment = Poseidon2(nullifier, secret)
 *   label         = Poseidon2(scope, depositNonce)           (assigned on-chain)
 *   commitment    = Poseidon3(value, label, precommitment)
 *   nullifierHash = Poseidon1(nullifier)
 */
import { keccak256, concat, toBytes, type Hex } from "viem";
import { SNARK_SCALAR_FIELD } from "./constants";
import { hash1, hash2, hash3, hash4 } from "./poseidon";

export interface MasterKeys {
  masterNullifier: bigint;
  masterSecret: bigint;
}

export interface NoteSecrets {
  nullifier: bigint;
  secret: bigint;
}

/** A note the user can spend (or has spent). All values are field elements. */
export interface Note {
  /** deposit index i */
  depositIndex: number;
  /** V2 public derivation input. Its depositIndex is the original leaf ordinal, used for display only. */
  recoveryNonce?: bigint;
  /** hop index j (0 = original deposit) */
  hop: number;
  value: bigint;
  label: bigint;
  nullifier: bigint;
  secret: bigint;
  precommitment: bigint;
  commitment: bigint;
  nullifierHash: bigint;
  /** position of the commitment in the state tree */
  leafIndex: number;
  /** chain metadata (not needed for proving) */
  blockNumber: bigint;
  txHash: Hex;
  spent: boolean;
  spentBy?: { kind: "withdraw" | "ragequit"; txHash: Hex; blockNumber: bigint };
}

export function deriveMasterKeys(seed: Uint8Array): MasterKeys {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const masterNullifier = BigInt(keccak256(concat([seed, toBytes("nullifier")]))) % SNARK_SCALAR_FIELD;
  const masterSecret = BigInt(keccak256(concat([seed, toBytes("secret")]))) % SNARK_SCALAR_FIELD;
  return { masterNullifier, masterSecret };
}

export function deriveNoteSecrets(
  keys: MasterKeys,
  scope: bigint,
  depositIndex: number,
  hop: number,
): NoteSecrets {
  return {
    nullifier: hash4(keys.masterNullifier, scope, BigInt(depositIndex), BigInt(hop)),
    secret: hash4(keys.masterSecret, scope, BigInt(depositIndex), BigInt(hop)),
  };
}

export const computePrecommitment = (s: NoteSecrets): bigint => hash2(s.nullifier, s.secret);
export const computeLabel = (scope: bigint, nonce: bigint): bigint => hash2(scope, nonce);
export const computeCommitment = (value: bigint, label: bigint, precommitment: bigint): bigint =>
  hash3(value, label, precommitment);
export const computeNullifierHash = (nullifier: bigint): bigint => hash1(nullifier);

/** Serialize bigints for JSON / circuit inputs. */
export const toDec = (v: bigint | number): string => BigInt(v).toString(10);
export const toHex32 = (v: bigint): Hex => `0x${v.toString(16).padStart(64, "0")}`;
