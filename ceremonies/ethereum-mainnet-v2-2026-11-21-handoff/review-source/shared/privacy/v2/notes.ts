/** Experimental v2 derivation. Never use these functions with a v1 pool or proving key. */
import { concat, keccak256, toBytes } from "viem";
import { SNARK_SCALAR_FIELD } from "../constants";
import type { MasterKeys, Note, NoteSecrets } from "../notes";
import { hash2, hash4 } from "../poseidon";
import {
  V2_PROTOCOL,
  isV2Protocol,
  type V2PrivacyProtocol,
} from "../protocols";

export { V2_PROTOCOL } from "../protocols";

export type NoteV2 = Note & { recoveryNonce: bigint };

export function deriveMasterKeysV2(
  seed: Uint8Array,
  protocol: V2PrivacyProtocol = V2_PROTOCOL
): MasterKeys {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  if (!isV2Protocol(protocol))
    throw new Error("Unsupported v2 derivation protocol");
  const derive = (purpose: string) =>
    BigInt(keccak256(concat([seed, toBytes(`${protocol}:${purpose}`)]))) %
    SNARK_SCALAR_FIELD;
  return {
    masterNullifier: derive("nullifier"),
    masterSecret: derive("secret"),
  };
}

/** Public, per-deposit entropy. No shared device counter or recovery search gap. */
export function createRecoveryNonce(): bigint {
  for (;;) {
    // 248 uniformly random bits fit the field without modular bias.
    const bytes = crypto.getRandomValues(new Uint8Array(31));
    const nonce = bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
    if (nonce !== 0n) return nonce;
  }
}

export function deriveNoteSecretsV2(
  keys: MasterKeys,
  scope: bigint,
  recoveryNonce: bigint,
  hop: number
): NoteSecrets {
  if (recoveryNonce <= 0n || recoveryNonce >= SNARK_SCALAR_FIELD)
    throw new Error("invalid recovery nonce");
  if (!Number.isSafeInteger(hop) || hop < 0)
    throw new Error("invalid note hop");
  return {
    nullifier: hash4(keys.masterNullifier, scope, recoveryNonce, BigInt(hop)),
    secret: hash4(keys.masterSecret, scope, recoveryNonce, BigInt(hop)),
  };
}

/** Both withdrawal and ragequit circuits bind spending to the contract-assigned label. */
export const computeNullifierHashV2 = (
  nullifier: bigint,
  label: bigint
): bigint => hash2(nullifier, label);
