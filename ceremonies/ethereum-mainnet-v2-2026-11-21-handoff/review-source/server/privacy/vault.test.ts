/**
 * The encrypted vault and its backup files (shared/privacy/vault.ts): version 2, one vault for every network, and
 * version 1, bound to one chain and pool, which every release must still read.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import type { BackupFile, BackupFileV1, BackupFileV2 } from "../../shared/privacy/types";
import { decryptSeed, encryptSeed, encryptSeedV2, generateSeed, parseBackup, seedFingerprint, VaultError } from "../../shared/privacy/vault";

const POOL = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const PASSWORD = "correct horse battery";
const ITERATIONS = 1_000; // fast; the app uses PBKDF2_ITERATIONS
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** The VaultError code a promise rejects with ("ok" when it resolves). */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof VaultError ? err.code : `not a VaultError: ${String(err)}`;
  }
}

/** A v2-shaped file sealed here, by hand, under the given additional data. */
async function sealV2By(seed: Uint8Array, password: string, additionalData: string): Promise<BackupFileV2> {
  const subtle = globalThis.crypto.subtle;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
  ]);
  // (a copy: WebCrypto wants an ArrayBuffer-backed view, and `seed` may be typed over ArrayBufferLike)
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(additionalData) }, key, new Uint8Array(seed)));
  return {
    format: "hylsia-privacy-backup",
    version: 2,
    protocol: PROTOCOL_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    ciphertext: b64(ct),
    fingerprint: seedFingerprint(seed),
  };
}

describe("backup v2: one vault for every network", () => {
  it("round-trips the seed through the exported file", async () => {
    const seed = generateSeed();
    const backup = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    expect(backup).toMatchObject({ format: "hylsia-privacy-backup", version: 2, protocol: PROTOCOL_VERSION, fingerprint: seedFingerprint(seed) });
    expect(backup.kdf).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS });
    expect(backup.cipher.name).toBe("AES-GCM");
    const text = JSON.stringify(backup, null, 2);
    const parsed = parseBackup(text);
    expect(parsed).toEqual(backup);
    expect(hex(await decryptSeed(parsed, PASSWORD))).toBe(hex(seed));
    expect(hex(await decryptSeed(backup, PASSWORD))).toBe(hex(seed));
  });

  it("names no chain and no pool", async () => {
    const backup = await encryptSeedV2(generateSeed(), PASSWORD, ITERATIONS);
    expect(Object.keys(backup).sort()).toEqual(["cipher", "ciphertext", "createdAt", "fingerprint", "format", "kdf", "protocol", "version"]);
    const text = JSON.stringify(backup);
    expect(text).not.toMatch(/chainId|"pool"|46630|31338/);
    expect(text.toLowerCase()).not.toContain(POOL.toLowerCase());
  });

  it("decrypts the same whatever network the app is on (a context applies to v1 only)", async () => {
    const seed = generateSeed();
    const backup = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    for (const ctx of [{ chainId: 46630, pool: POOL }, { chainId: 31338, pool: POOL }, { chainId: 1, pool: "0x1111111111111111111111111111111111111111" as Address }]) {
      expect(hex(await decryptSeed(backup, PASSWORD, ctx))).toBe(hex(seed));
    }
  });

  it("uses a fresh salt and IV each time and rejects a wrong or short password", async () => {
    const seed = generateSeed();
    const a = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    const b = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(await outcome(decryptSeed(a, "wrong password"))).toBe("WRONG_PASSWORD");
    await expect(encryptSeedV2(seed, "short", ITERATIONS)).rejects.toThrow(/at least 8/);
  });

  it("binds the additional data hylsia-privacy-backup:2:<protocol>, and rejects tampered additional data", async () => {
    const seed = generateSeed();
    // control: sealed by hand under exactly that string, the file decrypts
    const right = await sealV2By(seed, PASSWORD, `hylsia-privacy-backup:2:${PROTOCOL_VERSION}`);
    expect(hex(await decryptSeed(right, PASSWORD))).toBe(hex(seed));
    // any other additional data fails, like a wrong password, before any seed comes out
    for (const aad of [
      "hylsia-privacy-backup:2:hylsia-pp-v2",
      "hylsia-privacy-backup:1:" + PROTOCOL_VERSION,
      `${PROTOCOL_VERSION}:46630:${POOL.toLowerCase()}`, // v1's additional data
      "",
    ]) {
      expect(await outcome(decryptSeed(await sealV2By(seed, PASSWORD, aad), PASSWORD))).toBe("WRONG_PASSWORD");
    }
  });

  it("will not let a v1 file pass as v2, or a v2 file as v1", async () => {
    const seed = generateSeed();
    const v1 = await encryptSeed(seed, PASSWORD, { chainId: 46630, pool: POOL }, ITERATIONS);
    const { chainId: _c, pool: _p, ...rest } = v1;
    const v1AsV2: BackupFileV2 = { ...rest, version: 2 };
    expect(await outcome(decryptSeed(parseBackup(JSON.stringify(v1AsV2)), PASSWORD))).toBe("WRONG_PASSWORD");

    const v2 = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    const v2AsV1: BackupFileV1 = { ...v2, version: 1, chainId: 46630, pool: POOL };
    expect(await outcome(decryptSeed(v2AsV1, PASSWORD))).toBe("WRONG_PASSWORD");
    expect(await outcome(decryptSeed(v2AsV1, PASSWORD, { chainId: 46630, pool: POOL }))).toBe("WRONG_PASSWORD");
  });

  it("reports a changed protocol, ciphertext or fingerprint precisely", async () => {
    const seed = generateSeed();
    const backup = await encryptSeedV2(seed, PASSWORD, ITERATIONS);
    expect(await outcome(decryptSeed({ ...backup, protocol: "hylsia-pp-v2" }, PASSWORD))).toBe("WRONG_CONTEXT");
    expect(await outcome(decryptSeed({ ...backup, ciphertext: backup.ciphertext.slice(0, -4) + "AAAA" }, PASSWORD))).toBe("WRONG_PASSWORD");
    const other = seedFingerprint(generateSeed());
    expect(await outcome(decryptSeed({ ...backup, fingerprint: other }, PASSWORD))).toBe("CORRUPT");
  });
});

describe("backup v1: still read", () => {
  it("decrypts with and without a context", async () => {
    const seed = generateSeed();
    const ctx = { chainId: 46630, pool: POOL };
    const backup = await encryptSeed(seed, PASSWORD, ctx, ITERATIONS);
    expect(backup).toMatchObject({ version: 1, chainId: 46630, pool: POOL, protocol: PROTOCOL_VERSION, fingerprint: seedFingerprint(seed) });
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed).toEqual(backup);
    expect(hex(await decryptSeed(parsed, PASSWORD))).toBe(hex(seed));
    expect(hex(await decryptSeed(parsed, PASSWORD, ctx))).toBe(hex(seed));
    expect(hex(await decryptSeed(parsed, PASSWORD, { chainId: 46630, pool: POOL.toLowerCase() as Address }))).toBe(hex(seed));
  });

  it("gives WRONG_CONTEXT for another chain or pool, and checks the context before the password", async () => {
    const backup = await encryptSeed(generateSeed(), PASSWORD, { chainId: 46630, pool: POOL }, ITERATIONS);
    expect(await outcome(decryptSeed(backup, PASSWORD, { chainId: 31338, pool: POOL }))).toBe("WRONG_CONTEXT");
    expect(await outcome(decryptSeed(backup, PASSWORD, { chainId: 46630, pool: "0x1111111111111111111111111111111111111111" }))).toBe("WRONG_CONTEXT");
    expect(await outcome(decryptSeed(backup, "wrong password", { chainId: 1, pool: POOL }))).toBe("WRONG_CONTEXT");
    expect(await outcome(decryptSeed(backup, "wrong password"))).toBe("WRONG_PASSWORD");
  });

  it("keeps v1's own additional data: a v1 file moved to another chain or pool does not decrypt", async () => {
    const backup = await encryptSeed(generateSeed(), PASSWORD, { chainId: 46630, pool: POOL }, ITERATIONS);
    expect(await outcome(decryptSeed({ ...backup, chainId: 31338 }, PASSWORD))).toBe("WRONG_PASSWORD");
    expect(await outcome(decryptSeed({ ...backup, pool: "0x1111111111111111111111111111111111111111" }, PASSWORD))).toBe("WRONG_PASSWORD");
  });
});

describe("parseBackup", () => {
  const good = async () => JSON.parse(JSON.stringify(await encryptSeedV2(generateSeed(), PASSWORD, ITERATIONS))) as Record<string, unknown>;

  it("rejects what is not a backup file", async () => {
    const bad = (text: string) => {
      try {
        parseBackup(text);
        return "ok";
      } catch (err) {
        return err instanceof VaultError ? `${err.code}: ${err.message}` : String(err);
      }
    };
    expect(bad("not json")).toBe("BAD_FORMAT: Backup file is not valid JSON");
    expect(bad("{}")).toBe("BAD_FORMAT: Backup file has an unknown format");
    expect(bad("null")).toBe("BAD_FORMAT: Backup file has an unknown format");
    const g = await good();
    expect(bad(JSON.stringify({ ...g, version: 3 }))).toBe("BAD_FORMAT: Backup file version 3 is newer than this app supports");
    expect(bad(JSON.stringify({ ...g, format: "other" }))).toMatch(/^BAD_FORMAT/);
    expect(bad(JSON.stringify({ ...g, version: 1 }))).toMatch(/^BAD_FORMAT/); // a v1 file names its chain and pool
    expect(bad(JSON.stringify({ ...g, kdf: { ...(g.kdf as object), name: "scrypt" } }))).toMatch(/^BAD_FORMAT/);
    expect(bad(JSON.stringify({ ...g, kdf: { ...(g.kdf as object), iterations: 0 } }))).toMatch(/^BAD_FORMAT/);
    expect(bad(JSON.stringify({ ...g, cipher: { name: "AES-CBC", iv: "x" } }))).toMatch(/^BAD_FORMAT/);
    expect(bad(JSON.stringify({ ...g, fingerprint: undefined }))).toMatch(/^BAD_FORMAT/);
    expect(bad(JSON.stringify(g))).toBe("ok");
  });

  it("keeps only the fields of its version", async () => {
    const g = await good();
    const parsed: BackupFile = parseBackup(JSON.stringify({ ...g, chainId: 46630, pool: POOL, note: "hi" }));
    expect(parsed.version).toBe(2);
    expect(parsed).not.toHaveProperty("chainId");
    expect(parsed).not.toHaveProperty("pool");
    expect(parsed).not.toHaveProperty("note");
  });
});
