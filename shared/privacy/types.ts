import type { Address, Hex } from "viem";

export interface Groth16ProofCalldata {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

/** snarkjs proof object (strings). */
export interface SnarkProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface DepositedEvent {
  kind: "deposit";
  depositor: Address;
  commitment: bigint;
  label: bigint;
  value: bigint;
  precommitment: bigint;
  /** Present only in protocol v2's distinct Deposited event. */
  recoveryNonce?: bigint;
  leafIndex: number;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export interface WithdrawnEvent {
  kind: "withdraw";
  recipient: Address;
  relayer: Address;
  value: bigint;
  fee: bigint;
  spentNullifier: bigint;
  newCommitment: bigint;
  leafIndex: number;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export interface RagequitEvent {
  kind: "ragequit";
  ragequitter: Address;
  commitment: bigint;
  label: bigint;
  value: bigint;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export interface ASPRootUpdatedEvent {
  kind: "asproot";
  root: bigint;
  cid: string;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export type PoolEvent = DepositedEvent | WithdrawnEvent | RagequitEvent | ASPRootUpdatedEvent;

/** Withdraw circuit public signal layout (outputs first, then public inputs). */
export const WITHDRAW_PUBLIC_SIGNALS = {
  newCommitmentHash: 0,
  existingNullifierHash: 1,
  withdrawnValue: 2,
  stateRoot: 3,
  ASPRoot: 4,
  context: 5,
} as const;

/** Commitment (ragequit) circuit public signal layout. */
export const COMMITMENT_PUBLIC_SIGNALS = {
  commitment: 0,
  nullifierHash: 1,
  value: 2,
  label: 3,
} as const;

/**
 * Encrypted backup file format, version 1 (see shared/privacy/vault.ts): bound to one chain and pool, both written
 * in plain text and in the additional data `${protocol}:${chainId}:${pool lowercase}`. Still read; written only by
 * the deprecated encryptSeed().
 */
export interface BackupFileV1 {
  format: "hylsia-privacy-backup";
  version: 1;
  protocol: string;
  chainId: number;
  pool: Address;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  /** Poseidon1(masterNullifier) — lets the app confirm a backup matches the active vault without decrypting it. */
  fingerprint: string;
}

/**
 * Encrypted backup file format, version 2: one vault (one seed) for every network. It names no chain and no pool;
 * the additional data is `hylsia-privacy-backup:2:${protocol}`, so a v1 file cannot pass as v2 or the reverse.
 */
export interface BackupFileV2 {
  format: "hylsia-privacy-backup";
  version: 2;
  protocol: string;
  createdAt: string;
  kdf: BackupFileV1["kdf"];
  cipher: BackupFileV1["cipher"];
  ciphertext: string;
  /** Poseidon1(masterNullifier), as in v1 */
  fingerprint: string;
}

export type BackupFile = BackupFileV1 | BackupFileV2;
