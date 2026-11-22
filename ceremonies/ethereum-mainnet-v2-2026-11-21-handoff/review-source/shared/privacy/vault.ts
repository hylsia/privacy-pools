/**
 * Encrypted seed vault + backup file format.
 *
 * Uses WebCrypto (available in browsers and Node >= 20): PBKDF2-SHA256 → AES-256-GCM.
 * The same blob is used for local persistence and for the exported backup file,
 * so "the backup works" and "the local vault unlocks" are the same code path.
 *
 * Version 2 (encryptSeedV2) is one vault for every network: it names no chain and no pool, and its additional data
 * binds only the format, the version and the protocol. Version 1 files (one chain and pool, in plain text and in the
 * additional data) are still read; encryptSeed() still writes them, for tests and fixtures only.
 * Existing exports remain protocol v1. The API in v2/vault.ts uses the same envelope with an authenticated v2
 * protocol ID and its own fingerprint domain; an envelope version alone never selects the note protocol.
 */
import type { Address } from "viem";
import { PROTOCOL_VERSION } from "./constants";
import { deriveMasterKeys } from "./notes";
import { deriveMasterKeysV2 } from "./v2/notes";
import { protocolDefinition, type PrivacyProtocol, isV2Protocol } from "./protocols";
import { hash1 } from "./poseidon";
import type { BackupFile, BackupFileV1, BackupFileV2 } from "./types";

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this environment");
  return c.subtle;
};

export const PBKDF2_ITERATIONS = 600_000;
/** Bound work from untrusted files before invoking PBKDF2. Legacy low-cost fixtures remain readable. */
export const MAX_PBKDF2_ITERATIONS = 10_000_000;
const MIN_PASSWORD_LENGTH = 8;
const FORMAT = "hylsia-privacy-backup" as const;

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  decode(text: string): Uint8Array {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export function generateSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return seed;
}

export function seedFingerprint(seed: Uint8Array): string {
  return seedFingerprintForProtocol(seed, PROTOCOL_VERSION);
}

export function seedFingerprintForProtocol(seed: Uint8Array, protocol: PrivacyProtocol): string {
  protocolDefinition(protocol);
  const keys = isV2Protocol(protocol) ? deriveMasterKeysV2(seed, protocol) : deriveMasterKeys(seed);
  return hash1(keys.masterNullifier).toString(10);
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface VaultContext {
  chainId: number;
  pool: Address;
}

/** Additional data of a v1 file: its protocol, chain and pool. */
const aadV1 = (b: { protocol: string; chainId: number; pool: string }) => `${b.protocol}:${b.chainId}:${b.pool.toLowerCase()}`;
/** Additional data of a v2 file: format, version and protocol, nothing about a network. */
const aadV2 = (protocol: string) => `${FORMAT}:2:${protocol}`;

/** PBKDF2 + AES-GCM over the seed, with the given additional data. */
async function seal(seed: Uint8Array, password: string, iterations: number, aad: string) {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error("Unsupported PBKDF2 iteration count");
  }
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, iterations);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
      key,
      seed as BufferSource,
    ),
  );
  const kdf: BackupFileV1["kdf"] = { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64.encode(salt) };
  const cipher: BackupFileV1["cipher"] = { name: "AES-GCM", iv: b64.encode(iv) };
  return { kdf, cipher, ciphertext: b64.encode(ct) };
}

/** @deprecated legacy single-pool envelope writer; tests and fixtures only. */
export async function encryptSeed(
  seed: Uint8Array,
  password: string,
  ctx: VaultContext,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<BackupFileV1> {
  const aad = aadV1({ protocol: PROTOCOL_VERSION, chainId: ctx.chainId, pool: ctx.pool });
  const { kdf, cipher, ciphertext } = await seal(seed, password, iterations, aad);
  return {
    format: FORMAT,
    version: 1,
    protocol: PROTOCOL_VERSION,
    chainId: ctx.chainId,
    pool: ctx.pool,
    createdAt: new Date().toISOString(),
    kdf,
    cipher,
    ciphertext,
    fingerprint: seedFingerprint(seed),
  };
}

/** The v2 backup: one seed for every network. AAD `hylsia-privacy-backup:2:${PROTOCOL_VERSION}`. */
export async function encryptSeedV2(
  seed: Uint8Array,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<BackupFileV2> {
  return encryptProtocolSeed(seed, password, PROTOCOL_VERSION, iterations);
}

/** Envelope v2 writer, explicitly bound to one supported protocol. Never relabel an existing ciphertext. */
export async function encryptProtocolSeed(
  seed: Uint8Array,
  password: string,
  protocol: PrivacyProtocol,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<BackupFileV2> {
  protocolDefinition(protocol);
  const { kdf, cipher, ciphertext } = await seal(seed, password, iterations, aadV2(protocol));
  return {
    format: FORMAT,
    version: 2,
    protocol,
    createdAt: new Date().toISOString(),
    kdf,
    cipher,
    ciphertext,
    fingerprint: seedFingerprintForProtocol(seed, protocol),
  };
}

export class VaultError extends Error {
  constructor(
    public readonly code: "BAD_FORMAT" | "WRONG_CONTEXT" | "WRONG_PASSWORD" | "CORRUPT",
    message: string,
  ) {
    super(message);
  }
}

const unknownFormat = () => new VaultError("BAD_FORMAT", "Backup file has an unknown format");

/** A backup as found (parsed JSON or a stored blob), checked field by field and copied without unknown fields. */
function checkBackup(obj: unknown): BackupFile {
  if (!obj || typeof obj !== "object") throw unknownFormat();
  const b = obj as Record<string, unknown>;
  if (b.format !== FORMAT) throw unknownFormat();
  if (b.version !== 1 && b.version !== 2) {
    if (typeof b.version === "number" && b.version > 2) {
      throw new VaultError("BAD_FORMAT", `Backup file version ${b.version} is newer than this app supports`);
    }
    throw unknownFormat();
  }
  const kdf = b.kdf as Record<string, unknown> | null | undefined;
  const cipher = b.cipher as Record<string, unknown> | null | undefined;
  const iterations = kdf?.iterations;
  if (
    typeof b.protocol !== "string" ||
    !kdf ||
    typeof kdf !== "object" ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    typeof iterations !== "number" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_PBKDF2_ITERATIONS ||
    typeof kdf.salt !== "string" ||
    !cipher ||
    typeof cipher !== "object" ||
    cipher.name !== "AES-GCM" ||
    typeof cipher.iv !== "string" ||
    typeof b.ciphertext !== "string" ||
    typeof b.fingerprint !== "string" ||
    !/^\d+$/.test(b.fingerprint)
  ) {
    throw unknownFormat();
  }
  const createdAt = typeof b.createdAt === "string" ? b.createdAt : "";
  const kdfOut: BackupFileV1["kdf"] = { name: "PBKDF2", hash: "SHA-256", iterations, salt: kdf.salt };
  const cipherOut: BackupFileV1["cipher"] = { name: "AES-GCM", iv: cipher.iv };
  if (b.version === 2) {
    return {
      format: FORMAT,
      version: 2,
      protocol: b.protocol,
      createdAt,
      kdf: kdfOut,
      cipher: cipherOut,
      ciphertext: b.ciphertext,
      fingerprint: b.fingerprint,
    };
  }
  if (typeof b.chainId !== "number" || !Number.isSafeInteger(b.chainId) || typeof b.pool !== "string") throw unknownFormat();
  return {
    format: FORMAT,
    version: 1,
    protocol: b.protocol,
    chainId: b.chainId,
    pool: b.pool as Address,
    createdAt,
    kdf: kdfOut,
    cipher: cipherOut,
    ciphertext: b.ciphertext,
    fingerprint: b.fingerprint,
  };
}

/** Reads a backup file, version 1 or 2. */
export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new VaultError("BAD_FORMAT", "Backup file is not valid JSON");
  }
  return checkBackup(obj);
}

function checkProtocol(b: BackupFile, protocol: PrivacyProtocol): void {
  protocolDefinition(protocol);
  if (b.protocol !== protocol) {
    throw new VaultError("WRONG_CONTEXT", `Backup protocol ${b.protocol} does not match ${protocol}`);
  }
  if (isV2Protocol(protocol) && b.version !== 2) {
    throw new VaultError("BAD_FORMAT", "The v2 protocol requires a version 2 backup envelope");
  }
}

/** Protocol-specific imports reject the wrong derivation domain before asking WebCrypto to decrypt. */
export function parseProtocolBackup(text: string, protocol: PrivacyProtocol): BackupFile {
  const backup = parseBackup(text);
  checkProtocol(backup, protocol);
  return backup;
}

/**
 * Decrypts a backup, version 1 or 2. `expected` is checked for v1 only (a v1 file names its chain and pool); a v2
 * file names neither.
 */
export async function decryptSeed(backup: BackupFile, password: string, expected?: VaultContext): Promise<Uint8Array> {
  return decryptProtocolSeed(backup, password, PROTOCOL_VERSION, expected);
}

/** Protocol-specific restore; existing decryptSeed remains bound to v1. */
export async function decryptProtocolSeed(
  backup: BackupFile,
  password: string,
  protocol: PrivacyProtocol,
  expected?: VaultContext,
): Promise<Uint8Array> {
  const b = checkBackup(backup);
  checkProtocol(b, protocol);
  if (b.version === 1 && expected && (b.chainId !== expected.chainId || b.pool.toLowerCase() !== expected.pool.toLowerCase())) {
    throw new VaultError(
      "WRONG_CONTEXT",
      `Backup belongs to chain ${b.chainId} / pool ${b.pool}, but this app is configured for chain ${expected.chainId} / pool ${expected.pool}`,
    );
  }
  const aad = b.version === 1 ? aadV1(b) : aadV2(b.protocol);
  subtle(); // a missing WebCrypto is reported as such, not as a wrong password
  let seed: Uint8Array;
  try {
    const key = await deriveAesKey(password, b64.decode(b.kdf.salt), b.kdf.iterations);
    seed = new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: b64.decode(b.cipher.iv) as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
        key,
        b64.decode(b.ciphertext) as BufferSource,
      ),
    );
  } catch {
    throw new VaultError("WRONG_PASSWORD", "Wrong password or corrupted backup");
  }
  if (seed.length !== 32) throw new VaultError("CORRUPT", "Decrypted seed has an unexpected length");
  if (seedFingerprintForProtocol(seed, protocol) !== b.fingerprint) {
    throw new VaultError("CORRUPT", "Backup fingerprint does not match its contents");
  }
  return seed;
}
