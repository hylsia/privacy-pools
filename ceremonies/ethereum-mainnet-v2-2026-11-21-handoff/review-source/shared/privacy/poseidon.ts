/**
 * Poseidon hash wrappers.
 *
 * poseidon-lite implements the same Poseidon instantiation as circomlib
 * (BN254, t = n+1, 8 full rounds, 57/56/60 partial rounds) and the same one as
 * poseidon-solidity, so the JS, circuit and Solidity sides agree. The e2e test
 * (scripts/privacy/e2e.ts) proves this by verifying a browser-side proof
 * against on-chain roots.
 */
import { poseidon1 } from "poseidon-lite/poseidon1";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";

export type FieldElement = bigint;

export const hash1 = (a: bigint): FieldElement => poseidon1([a]);
export const hash2 = (a: bigint, b: bigint): FieldElement => poseidon2([a, b]);
export const hash3 = (a: bigint, b: bigint, c: bigint): FieldElement => poseidon3([a, b, c]);
export const hash4 = (a: bigint, b: bigint, c: bigint, d: bigint): FieldElement =>
  poseidon4([a, b, c, d]);
