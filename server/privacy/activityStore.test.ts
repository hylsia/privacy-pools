/**
 * client/src/privacy/activityStore.ts: the device activity log and each pool's deposit reservations, encrypted at rest
 * with a key from the vault seed (HKDF-SHA256 to a non-extractable AES-256-GCM key), the move of the older plaintext
 * log on unlock, the set-aside of a log that does not decrypt, the serialised writes, and what Forget removes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  ACTIVITY_KEY_INFO,
  ACTIVITY_KEY_SALT,
  createReservations,
  createSerialWriter,
  deriveActivityKey,
  ENVELOPE_VERSION,
  EnvelopeError,
  loadActivityLog,
  LOG_FORMAT,
  logAad,
  mergeLogs,
  nextReservedIndex,
  retireReservations,
  open,
  RESERVATIONS_FORMAT,
  reservationsAad,
  seal,
  writeActivityLog,
  type LogEntry,
  type LogSession,
} from "../../client/src/privacy/activityStore";
import { DEVICE_KEYS, poolStorageKey } from "../../client/src/privacy/config";
import { clearActivityStorage, clearPendingDeposits, forgetDeviceStorage, type StorageLike } from "../../client/src/privacy/migrate";
import { serialize } from "../../client/src/privacy/storage";
import { encryptSeed, seedFingerprint } from "../../shared/privacy/vault";

/** localStorage over a Map, in insertion order like the browser's; `full` makes setItem fail like a full storage. */
class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  full: ((key: string) => boolean) | null = null;
  writes: string[] = [];
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.m.set(k, v);
  }
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.full?.(k)) throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
    this.writes.push(k);
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  snapshot() {
    return Object.fromEntries(this.m);
  }
}

const subtle = globalThis.crypto.subtle;
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const OTHER_POOL = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const A = { chainId: 46630, pool: POOL };
const B = { chainId: 31338, pool: POOL }; // the same address on another chain
const C = { chainId: 46630, pool: OTHER_POOL };

const seedA = new Uint8Array(32).fill(7);
const seedB = new Uint8Array(32).fill(9);

// what must never be readable at rest
const RECIPIENT = "0x00000000000000000000000000000000000000B1" as Address;
const DEPOSIT_TX = `0x${"ab".repeat(32)}` as Hex;
const WITHDRAW_TX = `0x${"cd".repeat(32)}` as Hex;
const AMOUNT = 123_456_789_000_000_000n; // 0.123456789 ETH
const FEE = 617_283_945_000_000n;
const LABEL = 987654321987654321987654321n;
const COMMITMENT = 1234567890123456789012345678901234567890n;

const entry = (e: Partial<LogEntry> & { id: string; createdAt: number }): LogEntry => ({
  kind: "deposit",
  status: "confirmed",
  updatedAt: e.createdAt,
  amountWei: 10n ** 16n,
  chainId: A.chainId,
  pool: A.pool,
  ...e,
});

const LOG: LogEntry[] = [
  entry({ id: "w1", kind: "withdraw", createdAt: 2_000, amountWei: AMOUNT, feeWei: FEE, recipient: RECIPIENT, via: "relayer", txHash: WITHDRAW_TX }),
  entry({ id: "d1", kind: "deposit", createdAt: 1_000, amountWei: AMOUNT, txHash: DEPOSIT_TX, label: LABEL, commitment: COMMITMENT }),
];

let keyA: CryptoKey;
let keyA2: CryptoKey; // derived again from the same seed
let keyB: CryptoKey;
let fpA: string;
let fpB: string;
let sessionA: LogSession;
let sessionB: LogSession;

beforeAll(async () => {
  keyA = await deriveActivityKey(seedA);
  keyA2 = await deriveActivityKey(new Uint8Array(seedA));
  keyB = await deriveActivityKey(seedB);
  fpA = seedFingerprint(seedA);
  fpB = seedFingerprint(seedB);
  sessionA = { key: keyA, fingerprint: fpA };
  sessionB = { key: keyB, fingerprint: fpB };
});

afterEach(() => vi.restoreAllMocks());

/** Every form a sensitive value could take in storage: hex with and without 0x in any case, and decimals. */
function leaks(text: string): string[] {
  const hay = text.toLowerCase();
  const needles: [string, string][] = [
    ["recipient", RECIPIENT.toLowerCase()],
    ["recipient (no 0x)", RECIPIENT.slice(2).toLowerCase()],
    ["deposit tx", DEPOSIT_TX.slice(2)],
    ["withdrawal tx", WITHDRAW_TX.slice(2)],
    ["amount", AMOUNT.toString()],
    ["fee", FEE.toString()],
    ["label", LABEL.toString()],
    ["commitment", COMMITMENT.toString()],
    ["entry kind", "withdraw"],
    ["relayer route", "relayer"],
  ];
  return needles.filter(([, n]) => hay.includes(n)).map(([what]) => what);
}

/** What loadActivityLog returns for a device with nothing to move, set aside or report (entries apart). */
const NOTHING_ELSE = { entries: [], setAsideNow: false, setAside: false, plaintext: "none", unreadableRemoved: false, left: [] };

/** Flips one bit of a base64 field of an envelope string. */
function flip(envelope: string, field: "iv" | "ct", at = 0): string {
  const e = JSON.parse(envelope);
  const bytes = unb64(e[field]);
  bytes[at] ^= 0x01;
  return JSON.stringify({ ...e, [field]: b64(bytes) });
}

describe("deriveActivityKey (HKDF-SHA256 over the seed)", () => {
  it("is a non-extractable AES-256-GCM key for encrypt and decrypt only, and the same seed gives the same key", async () => {
    expect(keyA.extractable).toBe(false);
    expect(keyA.type).toBe("secret");
    expect(keyA.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...keyA.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(subtle.exportKey("raw", keyA)).rejects.toThrow();
    await expect(subtle.exportKey("jwk", keyA)).rejects.toThrow();
    // derived again (a reload, the next unlock): it opens what the first one sealed
    const text = await seal(keyA, LOG_FORMAT, logAad(fpA), LOG);
    expect(await open(keyA2, LOG_FORMAT, logAad(fpA), text)).toEqual(LOG);
  });

  it("refuses a seed that is not 32 bytes", async () => {
    await expect(deriveActivityKey(new Uint8Array(31))).rejects.toThrow(/32 bytes/);
    await expect(deriveActivityKey(new Uint8Array(33))).rejects.toThrow(/32 bytes/);
  });

  it("is its own key: another info, another salt, the raw seed or another seed do not open the log", async () => {
    const text = await seal(keyA, LOG_FORMAT, logAad(fpA), LOG);
    const hkdf = async (salt: string, info: string) =>
      subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(info) },
        await subtle.importKey("raw", seedA, "HKDF", false, ["deriveKey"]),
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
    // the documented parameters reproduce the key (so the derivation is exactly HKDF-SHA256(seed, salt, info))
    expect(await open(await hkdf(ACTIVITY_KEY_SALT, ACTIVITY_KEY_INFO), LOG_FORMAT, logAad(fpA), text)).toEqual(LOG);
    const others = [
      await hkdf(ACTIVITY_KEY_SALT, "hylsia-activity-log:v2"),
      await hkdf("another salt", ACTIVITY_KEY_INFO),
      await subtle.importKey("raw", seedA, "AES-GCM", false, ["decrypt"]), // the seed itself as the key
      keyB,
    ];
    for (const k of others) await expect(open(k, LOG_FORMAT, logAad(fpA), text)).rejects.toMatchObject({ code: "DECRYPT" });
  });
});

describe("the envelope", () => {
  it("round-trips bigints, holds only format, version, iv and ct, and shows nothing of the log", async () => {
    const text = await seal(keyA, LOG_FORMAT, logAad(fpA), LOG);
    const env = JSON.parse(text);
    expect(Object.keys(env).sort()).toEqual(["ct", "format", "iv", "version"]);
    expect(env).toMatchObject({ format: "hylsia-activity", version: 1 });
    expect(unb64(env.iv)).toHaveLength(12);
    expect(leaks(text)).toEqual([]);
    const back = (await open(keyA, LOG_FORMAT, logAad(fpA), text)) as LogEntry[];
    expect(back).toEqual(LOG);
    expect(typeof back[0].amountWei).toBe("bigint");
  });

  it("binds the format, the version and the vault fingerprint in its additional data", () => {
    expect(logAad(fpA)).toBe(`hylsia-activity:${ENVELOPE_VERSION}:${fpA}`);
    expect(reservationsAad(fpA, { chainId: 46630, pool: POOL })).toBe(`hylsia-pending-deposits:1:${fpA}:46630:${POOL.toLowerCase()}`);
  });

  it("does not open with another vault's key, or with this key for another vault's fingerprint", async () => {
    const text = await seal(keyA, LOG_FORMAT, logAad(fpA), LOG);
    await expect(open(keyB, LOG_FORMAT, logAad(fpA), text)).rejects.toMatchObject({ code: "DECRYPT" });
    await expect(open(keyB, LOG_FORMAT, logAad(fpB), text)).rejects.toMatchObject({ code: "DECRYPT" });
    await expect(open(keyA, LOG_FORMAT, logAad(fpB), text)).rejects.toMatchObject({ code: "DECRYPT" });
  });

  it("fails on a changed ciphertext, IV or additional data, and on a changed, truncated or newer envelope", async () => {
    const text = await seal(keyA, LOG_FORMAT, logAad(fpA), LOG);
    const env = JSON.parse(text);
    for (const at of [0, 5, unb64(env.ct).length - 1]) {
      await expect(open(keyA, LOG_FORMAT, logAad(fpA), flip(text, "ct", at))).rejects.toMatchObject({ code: "DECRYPT" });
    }
    await expect(open(keyA, LOG_FORMAT, logAad(fpA), flip(text, "iv", 0))).rejects.toMatchObject({ code: "DECRYPT" });
    await expect(open(keyA, LOG_FORMAT, logAad(fpA), flip(text, "iv", 11))).rejects.toMatchObject({ code: "DECRYPT" });
    // additional data: another format, version or vault in it
    await expect(open(keyA, LOG_FORMAT, `hylsia-activity:2:${fpA}`, text)).rejects.toMatchObject({ code: "DECRYPT" });
    await expect(open(keyA, LOG_FORMAT, reservationsAad(fpA, A), text)).rejects.toMatchObject({ code: "DECRYPT" });
    // the envelope itself
    const bad = [
      JSON.stringify({ ...env, version: 2 }),
      JSON.stringify({ ...env, format: RESERVATIONS_FORMAT }),
      JSON.stringify({ ...env, iv: b64(unb64(env.iv).slice(0, 11)) }),
      JSON.stringify({ ...env, ct: b64(unb64(env.ct).slice(0, 15)) }),
      JSON.stringify({ ...env, ct: "%%%" }),
      JSON.stringify([env]),
      "not json",
      "",
    ];
    for (const t of bad) await expect(open(keyA, LOG_FORMAT, logAad(fpA), t)).rejects.toBeInstanceOf(EnvelopeError);
    // the reservations' format does not open as a log either
    const res = await seal(keyA, RESERVATIONS_FORMAT, reservationsAad(fpA, A), [{ depositIndex: 1 }]);
    await expect(open(keyA, LOG_FORMAT, logAad(fpA), res)).rejects.toMatchObject({ code: "FORMAT" });
  });

  it("uses a fresh random IV on every write", async () => {
    const texts = await Promise.all(Array.from({ length: 64 }, () => seal(keyA, LOG_FORMAT, logAad(fpA), LOG)));
    const ivs = new Set(texts.map((t) => JSON.parse(t).iv));
    const cts = new Set(texts.map((t) => JSON.parse(t).ct));
    expect(ivs.size).toBe(64);
    expect(cts.size).toBe(64); // the same log never gives the same ciphertext twice
    // and through the store: two writes of the same log leave two different envelopes
    const store = new MemoryStorage();
    await writeActivityLog(store, sessionA, LOG);
    const first = store.getItem(DEVICE_KEYS.activity);
    await writeActivityLog(store, sessionA, LOG);
    expect(JSON.parse(store.getItem(DEVICE_KEYS.activity)!).iv).not.toBe(JSON.parse(first!).iv);
  });
});

describe("the encrypted log (hylsia.pp.activity.v3)", () => {
  it("is stored as an envelope and a stale empty tab cannot erase the stored log", async () => {
    const store = new MemoryStorage();
    expect(await writeActivityLog(store, sessionA, LOG)).toBe(true);
    expect(Object.keys(store.snapshot())).toEqual([DEVICE_KEYS.activity]);
    expect(leaks(JSON.stringify(store.snapshot()))).toEqual([]);
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded).toEqual({ ...NOTHING_ELSE, entries: LOG });
    expect(await writeActivityLog(store, sessionA, [])).toBe(true);
    expect((await loadActivityLog(store, sessionA)).entries).toEqual(LOG);
    const empty = new MemoryStorage();
    expect(await writeActivityLog(empty, sessionA, [])).toBe(true);
    expect(empty.snapshot()).toEqual({});
  });

  it("writes nothing when the vault was forgotten while it encrypted (live false), and reports a full storage", async () => {
    const store = new MemoryStorage();
    expect(await writeActivityLog(store, sessionA, LOG, () => false)).toBe(false);
    expect(store.snapshot()).toEqual({});
    store.full = () => true;
    expect(await writeActivityLog(store, sessionA, LOG)).toBe(false);
    expect(store.snapshot()).toEqual({});
  });
});

describe("moving the plaintext log (v2) into the encrypted log on unlock", () => {
  const plain = (entries: LogEntry[]) => serialize(entries);

  it("merges by entry id, writes the merged log encrypted, then deletes the plaintext", async () => {
    const store = new MemoryStorage();
    store.setItem(
      DEVICE_KEYS.legacyActivity,
      plain([
        entry({ id: "both", createdAt: 300, status: "pending", updatedAt: 300 }), // older copy of the same entry
        entry({ id: "v2only", createdAt: 100, recipient: RECIPIENT, txHash: WITHDRAW_TX, amountWei: AMOUNT, kind: "withdraw" }),
        entry({ id: "newer", createdAt: 200, status: "pending", updatedAt: 200 }),
      ]),
    );
    await writeActivityLog(store, sessionA, [
      entry({ id: "both", createdAt: 300, status: "confirmed", updatedAt: 400 }),
      entry({ id: "v3only", createdAt: 500 }),
      entry({ id: "newer", createdAt: 200, status: "pending", updatedAt: 150 }), // the plaintext copy is newer here
    ]);
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded.plaintext).toBe("moved");
    expect(loaded.entries.map((e) => [e.id, e.status])).toEqual([
      ["v3only", "confirmed"],
      ["both", "confirmed"], // the encrypted copy, updated later, wins
      ["newer", "pending"],
      ["v2only", "confirmed"],
    ]);
    expect(loaded.entries.find((e) => e.id === "newer")!.updatedAt).toBe(200); // the newer copy won
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBeNull();
    expect(Object.keys(store.snapshot())).toEqual([DEVICE_KEYS.activity]);
    expect(leaks(JSON.stringify(store.snapshot()))).toEqual([]);
    // what was written is the merged log
    expect((await loadActivityLog(store, sessionA)).entries).toEqual(loaded.entries);
  });

  it("moves what migrate.ts produced from legacy per-pool keys (bigints in their stored form, entries tagged)", async () => {
    const store = new MemoryStorage({
      [DEVICE_KEYS.legacyActivity]: serialize([entry({ id: "legacy", createdAt: 1, amountWei: AMOUNT, chainId: 31337, pool: OTHER_POOL.toLowerCase() })]),
    });
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded.plaintext).toBe("moved");
    expect(loaded.entries).toEqual([expect.objectContaining({ id: "legacy", amountWei: AMOUNT, chainId: 31337, pool: OTHER_POOL.toLowerCase() })]);
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBeNull();
  });

  it("never deletes the plaintext before the encrypted write has succeeded", async () => {
    const v2 = plain([entry({ id: "keep-me", createdAt: 10, recipient: RECIPIENT })]);
    const store = new MemoryStorage({ [DEVICE_KEYS.legacyActivity]: v2 });
    store.full = (k) => k === DEVICE_KEYS.activity; // the encrypted write fails
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded.plaintext).toBe("kept");
    expect(loaded.left).toEqual([DEVICE_KEYS.legacyActivity]); // the provider deletes it after its next successful write
    expect(loaded.entries.map((e) => e.id)).toEqual(["keep-me"]); // the session still shows it
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBe(v2); // untouched
    expect(store.getItem(DEVICE_KEYS.activity)).toBeNull();
    // forgotten while it ran (live false): nothing is written or deleted either
    store.full = null;
    const again = await loadActivityLog(store, sessionA, () => false);
    expect(again.plaintext).toBe("none");
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBe(v2);
    expect(store.getItem(DEVICE_KEYS.activity)).toBeNull();
    // storage works again: the next unlock moves it
    expect((await loadActivityLog(store, sessionA)).plaintext).toBe("moved");
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBeNull();
  });

  it("is idempotent, also when interrupted after the encrypted write (both keys present)", async () => {
    const v2 = plain(LOG);
    const store = new MemoryStorage({ [DEVICE_KEYS.legacyActivity]: v2 });
    const first = await loadActivityLog(store, sessionA);
    // as if the tab closed between the write and the delete: the plaintext is back
    store.setItem(DEVICE_KEYS.legacyActivity, v2);
    const second = await loadActivityLog(store, sessionA);
    expect(second.entries).toEqual(first.entries); // no duplicates
    expect(second.plaintext).toBe("moved");
    const settled = store.snapshot();
    const third = await loadActivityLog(store, sessionA);
    expect(third).toEqual({ ...NOTHING_ELSE, entries: first.entries });
    expect(store.snapshot()).toEqual(settled); // nothing more to do: nothing written
  });

  it("deletes a plaintext log that cannot be parsed, unread, and keeps the encrypted log", async () => {
    for (const bad of ["{not json", '{"entries":[]}', '"a string"', '[{"$bigint":"zz"}]', "null"]) {
      const store = new MemoryStorage();
      await writeActivityLog(store, sessionA, LOG);
      store.setItem(DEVICE_KEYS.legacyActivity, bad);
      const loaded = await loadActivityLog(store, sessionA);
      expect(loaded).toMatchObject({ unreadableRemoved: true, plaintext: "none", left: [] });
      expect(loaded.entries).toEqual(LOG);
      expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBeNull();
    }
    // a list whose entries are unusable is readable, and simply empty: it goes too
    const store = new MemoryStorage({ [DEVICE_KEYS.legacyActivity]: '[1, null, {"id": 5}, {"kind": "deposit"}]' });
    expect(await loadActivityLog(store, sessionA)).toEqual({ ...NOTHING_ELSE, plaintext: "moved" });
    expect(store.snapshot()).toEqual({});
  });
});

describe("a single-network build's per-pool plaintext logs (hylsia.pp.<chainId>.<pool>.activity) next to the device vault", () => {
  const prefixA = `hylsia.pp.${A.chainId}.${A.pool.toLowerCase()}`;
  const prefixC = `hylsia.pp.${C.chainId}.${C.pool.toLowerCase()}`;
  const prefixB = `hylsia.pp.${B.chainId}.${B.pool.toLowerCase()}`;
  // as that build stored them: no chainId or pool in the entries, bigints in their stored form
  const perPool = (entries: LogEntry[]) => serialize(entries.map(({ chainId: _c, pool: _p, ...rest }) => rest));
  // that build's per-pool vault key: a v1 backup (fast PBKDF2; only its fingerprint is read here)
  const backupOf = async (seed: Uint8Array, at: { chainId: number; pool: Address }) => serialize(await encryptSeed(seed, "per-pool vault", at, 1_000));

  it("are moved into the encrypted log on unlock when they are this vault's or have no vault, each entry tagged with its pool", async () => {
    const store = new MemoryStorage({
      [`${prefixA}.activity`]: perPool([entry({ id: "no-vault", createdAt: 30, recipient: RECIPIENT, txHash: WITHDRAW_TX, amountWei: AMOUNT, kind: "withdraw" })]),
      [`${prefixC}.activity`]: perPool([entry({ id: "own-vault", createdAt: 20 })]),
      [`${prefixA}.events`]: '{"events":[]}',
    });
    // the per-pool vault key of C holds this vault: its log is this vault's
    store.setItem(`${prefixC}.vault`, await backupOf(seedA, C));
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded).toMatchObject({ plaintext: "moved", unreadableRemoved: false, left: [] });
    expect(loaded.entries.map((e) => [e.id, e.chainId, e.pool])).toEqual([
      ["no-vault", A.chainId, A.pool.toLowerCase()],
      ["own-vault", C.chainId, C.pool.toLowerCase()],
    ]);
    expect(typeof loaded.entries[0].amountWei).toBe("bigint");
    expect(store.getItem(`${prefixA}.activity`)).toBeNull();
    expect(store.getItem(`${prefixC}.activity`)).toBeNull();
    expect(Object.keys(store.snapshot()).sort()).toEqual([DEVICE_KEYS.activity, `${prefixA}.events`, `${prefixC}.vault`].sort());
    expect(leaks(JSON.stringify(store.snapshot()))).toEqual([]);
    expect((await loadActivityLog(store, sessionA)).entries).toEqual(loaded.entries);
  });

  it("leave another vault's log as it is, delete an unreadable one, and keep them all when the encrypted write fails", async () => {
    const other = perPool([entry({ id: "other-vault", createdAt: 5 })]);
    const mine = perPool([entry({ id: "mine", createdAt: 6 })]);
    const store = new MemoryStorage({
      [`${prefixB}.vault`]: await backupOf(seedB, B),
      [`${prefixB}.activity`]: other, // another vault's key set: its log stays until Forget
      [`${prefixC}.activity`]: "{broken",
      [`${prefixA}.activity`]: mine,
    });
    store.full = (k) => k === DEVICE_KEYS.activity;
    const kept = await loadActivityLog(store, sessionA);
    expect(kept).toMatchObject({ plaintext: "kept", unreadableRemoved: true, left: [`${prefixA}.activity`] });
    expect(kept.entries.map((e) => e.id)).toEqual(["mine"]);
    expect(store.getItem(`${prefixA}.activity`)).toBe(mine);
    expect(store.getItem(`${prefixC}.activity`)).toBeNull(); // unreadable: deleted unread
    expect(store.getItem(`${prefixB}.activity`)).toBe(other);
    store.full = null;
    expect(await loadActivityLog(store, sessionA)).toMatchObject({ plaintext: "moved", left: [] });
    expect(store.getItem(`${prefixA}.activity`)).toBeNull();
    expect(store.getItem(`${prefixB}.activity`)).toBe(other);
    // a stale session (live false) touches none of them
    store.setItem(`${prefixA}.activity`, mine);
    expect(await loadActivityLog(store, sessionA, () => false)).toMatchObject({ plaintext: "none" });
    expect(store.getItem(`${prefixA}.activity`)).toBe(mine);
  });
});

describe("a stored log that does not decrypt is set aside (quarantine)", () => {
  it("moves a changed log to the quarantine key unread, starts empty, and does not fail again", async () => {
    const store = new MemoryStorage();
    await writeActivityLog(store, sessionA, LOG);
    const tampered = flip(store.getItem(DEVICE_KEYS.activity)!, "ct", 3);
    store.setItem(DEVICE_KEYS.activity, tampered);
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded).toEqual({ ...NOTHING_ELSE, setAsideNow: true, setAside: true });
    expect(store.getItem(DEVICE_KEYS.activity)).toBeNull();
    expect(store.getItem(DEVICE_KEYS.activityQuarantine)).toBe(tampered); // as it was
    // no loop: the next unlock finds no unreadable log, only the set-aside copy
    expect(await loadActivityLog(store, sessionA)).toEqual({ ...NOTHING_ELSE, setAside: true });
    // the new log works next to it
    await writeActivityLog(store, sessionA, LOG);
    expect((await loadActivityLog(store, sessionA)).entries).toEqual(LOG);
  });

  it("sets aside another vault's log, an unknown envelope, garbage, and a log that decrypts to something else", async () => {
    const others = [
      await seal(keyB, LOG_FORMAT, logAad(fpB), LOG), // a stale log of another vault
      JSON.stringify({ ...JSON.parse(await seal(keyA, LOG_FORMAT, logAad(fpA), LOG)), version: 2 }),
      "garbage",
      await seal(keyA, LOG_FORMAT, logAad(fpA), { not: "a list" }),
      serialize(LOG), // plaintext in the encrypted key
    ];
    for (const raw of others) {
      const store = new MemoryStorage({ [DEVICE_KEYS.activity]: raw });
      const loaded = await loadActivityLog(store, sessionA);
      expect(loaded.setAsideNow).toBe(true);
      expect(loaded.entries).toEqual([]);
      expect(store.snapshot()).toEqual({ [DEVICE_KEYS.activityQuarantine]: raw });
    }
  });

  it("still merges a plaintext log after setting the encrypted one aside", async () => {
    const store = new MemoryStorage({ [DEVICE_KEYS.activity]: "garbage", [DEVICE_KEYS.legacyActivity]: serialize(LOG) });
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded).toMatchObject({ setAsideNow: true, setAside: true, plaintext: "moved", entries: LOG });
    expect(Object.keys(store.snapshot()).sort()).toEqual([DEVICE_KEYS.activity, DEVICE_KEYS.activityQuarantine].sort());
  });

  it("makes room when storage is full (the copy replaces the unreadable log)", async () => {
    const raw = await seal(keyB, LOG_FORMAT, logAad(fpB), LOG);
    const store = new MemoryStorage({ [DEVICE_KEYS.activity]: raw });
    let refused = 0;
    store.full = (k) => k === DEVICE_KEYS.activityQuarantine && refused++ === 0; // full until the log is removed
    const loaded = await loadActivityLog(store, sessionA);
    expect(loaded.setAsideNow).toBe(true);
    expect(store.snapshot()).toEqual({ [DEVICE_KEYS.activityQuarantine]: raw });
    // and when it cannot be kept at all, it still goes, so the next unlock does not fail on it again
    const stuck = new MemoryStorage({ [DEVICE_KEYS.activity]: raw });
    stuck.full = () => true;
    expect((await loadActivityLog(stuck, sessionA)).setAsideNow).toBe(true);
    expect(stuck.snapshot()).toEqual({});
  });

  it("writes nothing to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const store = new MemoryStorage({ [DEVICE_KEYS.activity]: "garbage", [DEVICE_KEYS.legacyActivity]: "{broken" });
    await loadActivityLog(store, sessionA);
    await createReservations(() => store).update(sessionA, A, (l) => [...l, { depositIndex: 0 }]);
    store.setItem(poolStorageKey(B, "pendingDeposits"), "broken");
    await createReservations(() => store).read(sessionA, B);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("mergeLogs", () => {
  it("keeps one entry per id, newest first, the later update winning and the first list on a tie", () => {
    const merged = mergeLogs(
      [entry({ id: "a", createdAt: 1, updatedAt: 5, status: "confirmed" }), entry({ id: "b", createdAt: 3 })],
      [entry({ id: "a", createdAt: 1, updatedAt: 5, status: "pending" }), entry({ id: "c", createdAt: 2 }), entry({ id: "b", createdAt: 3, updatedAt: 9, status: "failed" })],
    );
    expect(merged.map((e) => [e.id, e.status])).toEqual([
      ["b", "failed"],
      ["c", "confirmed"],
      ["a", "confirmed"],
    ]);
  });
});

describe("serialised writes (createSerialWriter)", () => {
  it("runs one write at a time and the last state wins: a waiting write is replaced by a newer one, none is lost", async () => {
    const writer = createSerialWriter();
    const store = new MemoryStorage();
    let running = 0;
    let most = 0;
    const ran: number[] = [];
    const write = (n: number) => async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      // each write carries the whole log as it was when scheduled (here: entries 0..n)
      const ok = await writeActivityLog(store, sessionA, Array.from({ length: n + 1 }, (_, i) => entry({ id: `e${i}`, createdAt: i })));
      ran.push(n);
      running--;
      return ok;
    };
    const results = await Promise.all([0, 1, 2, 3, 4].map((n) => writer.schedule(write(n))));
    expect(results).toEqual([true, true, true, true, true]);
    expect(most).toBe(1); // never two encryptions racing to storage
    expect(ran).toEqual([0, 4]); // 1-3 were replaced by 4 while 0 ran
    // the stored log is the last state, in the order it was written
    expect((await loadActivityLog(store, sessionA)).entries.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1", "e0"]);
  });

  it("flush waits for every write; cancel drops the waiting one; a running one is stopped by its guard", async () => {
    const writer = createSerialWriter();
    const store = new MemoryStorage();
    let live = true;
    const slow = writer.schedule(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return writeActivityLog(store, sessionA, LOG, () => live);
    });
    const waiting = writer.schedule(async () => writeActivityLog(store, sessionA, [...LOG, entry({ id: "late", createdAt: 0 })]));
    // Forget: the waiting write is dropped, the running one sees its guard turn false
    writer.cancel();
    live = false;
    expect(await waiting).toBe(false);
    expect(await slow).toBe(false);
    await writer.flush();
    expect(store.snapshot()).toEqual({});
    // and the writer keeps working afterwards
    live = true;
    void writer.schedule(() => writeActivityLog(store, sessionA, LOG));
    await writer.flush();
    expect((await loadActivityLog(store, sessionA)).entries).toEqual(LOG);
  });

  it("survives a write that throws", async () => {
    const writer = createSerialWriter();
    expect(await writer.schedule(async () => Promise.reject(new Error("boom")))).toBe(false);
    expect(await writer.schedule(async () => true)).toBe(true);
  });
});

describe("deposit reservations (hylsia.pp.<chainId>.<pool>.pendingDeposits)", () => {
  it("are sealed with the same key and envelope, bound to their pool; an empty list leaves no key", async () => {
    const store = new MemoryStorage();
    const r = createReservations(() => store);
    const res = await r.update(sessionA, A, (l) => [...l, { depositIndex: 3 }]);
    expect(res).toEqual({ list: [{ depositIndex: 3 }], saved: true });
    await r.update(sessionA, A, (l) => l.map((d) => ({ ...d, txHash: DEPOSIT_TX })));
    const raw = store.getItem(poolStorageKey(A, "pendingDeposits"))!;
    expect(JSON.parse(raw)).toMatchObject({ format: "hylsia-pending-deposits", version: 1 });
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["ct", "format", "iv", "version"]);
    expect(leaks(raw)).toEqual([]);
    expect(raw).not.toMatch(/depositIndex|txHash/);
    expect(await open(keyA, RESERVATIONS_FORMAT, reservationsAad(fpA, A), raw)).toEqual([{ depositIndex: 3, txHash: DEPOSIT_TX }]);
    expect(await r.read(sessionA, A)).toEqual([{ depositIndex: 3, txHash: DEPOSIT_TX }]);
    await r.update(sessionA, A, () => []);
    expect(store.snapshot()).toEqual({});
  });

  it("do not open for another pool, another chain or another vault: such a list reads as none and is never removed or overwritten", async () => {
    const store = new MemoryStorage();
    const r = createReservations(() => store);
    await r.update(sessionA, A, () => [{ depositIndex: 1, txHash: DEPOSIT_TX }]);
    const raw = store.getItem(poolStorageKey(A, "pendingDeposits"))!;
    for (const other of [B, C]) {
      store.setItem(poolStorageKey(other, "pendingDeposits"), raw); // copied under another pool's key
      expect(await r.read(sessionA, other)).toEqual([]);
      expect(store.getItem(poolStorageKey(other, "pendingDeposits"))).toBe(raw);
    }
    // another vault reads none, and can neither add to the list nor release from it: the list stays as it is
    expect(await r.read(sessionB, A)).toEqual([]);
    const change = vi.fn((l: { depositIndex: number }[]) => [...l, { depositIndex: 0 }]);
    expect(await r.update(sessionB, A, change)).toEqual({ list: [], saved: false, problem: "foreign" });
    expect(await r.update(sessionB, A, () => [])).toEqual({ list: [], saved: false, problem: "foreign" });
    expect(change).not.toHaveBeenCalled();
    expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(raw);
    expect(await r.read(sessionA, A)).toEqual([{ depositIndex: 1, txHash: DEPOSIT_TX }]); // still the owner's
    // changed or damaged: the same, so nothing is lost by a mistake (Forget, create and restore clear it)
    for (const bad of ["garbage", flip(raw, "ct"), flip(raw, "iv")]) {
      store.setItem(poolStorageKey(A, "pendingDeposits"), bad);
      expect(await r.read(sessionA, A)).toEqual([]);
      expect((await r.update(sessionA, A, (l) => [...l, { depositIndex: 2 }])).problem).toBe("foreign");
      expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(bad);
    }
  });

  it("are not touched by a session that is no longer the device's (Forget, or another vault in another tab): it reads and writes nothing", async () => {
    // the reviewer's case: vault Y holds index 0 for a deposit in flight; forgotten vault X's deposit then ends and
    // releases its own index with its guard saying "this vault is gone"
    const store = new MemoryStorage();
    const r = createReservations(() => store);
    await r.update(sessionB, A, (l) => [...l, { depositIndex: 0, txHash: DEPOSIT_TX }]);
    const held = store.getItem(poolStorageKey(A, "pendingDeposits"));
    const reads = vi.spyOn(store, "getItem");
    const change = vi.fn((l: { depositIndex: number }[]) => l.filter((d) => d.depositIndex !== 3));
    expect(await r.update(sessionA, A, change, () => false)).toEqual({ list: [], saved: false, problem: "stale" });
    expect(change).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
    expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(held);
    expect(await r.read(sessionB, A)).toEqual([{ depositIndex: 0, txHash: DEPOSIT_TX }]);
    // a stale session's unlock seals nothing either, not even another build's plaintext list
    store.setItem(poolStorageKey(C, "pendingDeposits"), serialize([{ depositIndex: 4 }]));
    expect(await r.sealPlaintext(sessionA, () => false)).toBe(0);
    expect(store.getItem(poolStorageKey(C, "pendingDeposits"))).toBe(serialize([{ depositIndex: 4 }]));
    expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(held);
    // a session that turns stale while it encrypts writes nothing
    let live = true;
    const pending = r.update(sessionB, A, (l) => {
      live = false;
      return [...l, { depositIndex: 1 }];
    }, () => live);
    expect(await pending).toEqual({ list: [{ depositIndex: 0, txHash: DEPOSIT_TX }, { depositIndex: 1 }], saved: false, problem: "stale" });
    expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(held);
  });

  it("read an older build's plaintext list (index and transaction only) and seal it in place on unlock", async () => {
    const legacy = serialize([
      { depositIndex: 0, precommitment: 42n, createdAt: 1_700_000_000_000, txHash: DEPOSIT_TX },
      { depositIndex: 1, precommitment: 43n, createdAt: 1_700_000_100_000 },
      { depositIndex: -1 },
      "junk",
    ]);
    const store = new MemoryStorage({
      [poolStorageKey(A, "pendingDeposits")]: legacy,
      [poolStorageKey(C, "pendingDeposits")]: "[]",
      "hylsia.pp.46630.nopool.pendingDeposits": '[{"depositIndex":0}]', // cannot be bound to a pool
      [poolStorageKey(A, "events")]: '{"events":[]}',
    });
    const r = createReservations(() => store);
    expect(await r.read(sessionA, A)).toEqual([{ depositIndex: 0, txHash: DEPOSIT_TX }, { depositIndex: 1 }]);
    expect(store.getItem(poolStorageKey(A, "pendingDeposits"))).toBe(legacy); // a read writes nothing
    expect(await r.sealPlaintext(sessionA)).toBe(2);
    const sealed = store.getItem(poolStorageKey(A, "pendingDeposits"))!;
    expect(JSON.parse(sealed).format).toBe("hylsia-pending-deposits");
    expect(sealed).not.toMatch(/precommitment|createdAt|depositIndex/);
    expect(leaks(sealed)).toEqual([]);
    expect(store.getItem(poolStorageKey(C, "pendingDeposits"))).toBeNull(); // an empty list leaves no key
    expect(store.getItem("hylsia.pp.46630.nopool.pendingDeposits")).toBeNull();
    expect(store.getItem(poolStorageKey(A, "events"))).toBe('{"events":[]}');
    expect(await r.read(sessionA, A)).toEqual([{ depositIndex: 0, txHash: DEPOSIT_TX }, { depositIndex: 1 }]);
    // idempotent
    const after = store.snapshot();
    expect(await r.sealPlaintext(sessionA)).toBe(0);
    expect(store.snapshot()).toEqual(after);
    // an update of a plaintext list seals it even when it changes nothing
    store.setItem(poolStorageKey(B, "pendingDeposits"), serialize([{ depositIndex: 7 }]));
    expect(await r.update(sessionA, B, (l) => l)).toEqual({ list: [{ depositIndex: 7 }], saved: true });
    expect(JSON.parse(store.getItem(poolStorageKey(B, "pendingDeposits"))!).format).toBe("hylsia-pending-deposits");
  });

  it("change one at a time per pool, so quick changes never lose one", async () => {
    const store = new MemoryStorage();
    const r = createReservations(() => store);
    const indexes = await Promise.all(
      Array.from({ length: 8 }, async () => {
        let mine = -1;
        await r.update(sessionA, A, (l) => {
          mine = nextReservedIndex(l);
          return [...l, { depositIndex: mine }];
        });
        return mine;
      }),
    );
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // every deposit got its own index
    expect((await r.read(sessionA, A)).map((d) => d.depositIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // releases interleaved with a new reservation
    await Promise.all([
      r.update(sessionA, A, (l) => l.filter((d) => d.depositIndex !== 2)),
      r.update(sessionA, A, (l) => [...l, { depositIndex: nextReservedIndex(l) }]),
      r.update(sessionA, A, (l) => l.filter((d) => d.depositIndex !== 5)),
    ]);
    expect((await r.read(sessionA, A)).map((d) => d.depositIndex)).toEqual([0, 1, 3, 4, 6, 7, 8]);
  });

  it("write nothing once the vault is forgotten (live false) or when storage is full", async () => {
    const store = new MemoryStorage();
    const r = createReservations(() => store);
    expect(await r.update(sessionA, A, () => [{ depositIndex: 0 }], () => false)).toEqual({ list: [], saved: false, problem: "stale" });
    expect(store.snapshot()).toEqual({});
    store.full = () => true;
    expect(await r.update(sessionA, A, () => [{ depositIndex: 0 }])).toEqual({ list: [{ depositIndex: 0 }], saved: false, problem: "storage" });
    expect(store.snapshot()).toEqual({});
    // no storage at all: the index is held in memory only (as before)
    const none = createReservations(() => null);
    expect(await none.update(sessionA, A, () => [{ depositIndex: 0 }])).toEqual({ list: [{ depositIndex: 0 }], saved: false, problem: "storage" });
    expect(await none.read(sessionA, A)).toEqual([]);
    expect(await none.sealPlaintext(sessionA)).toBe(0);
  });

  it("nextReservedIndex is the first index no reservation holds", () => {
    expect(nextReservedIndex([])).toBe(0);
    expect(nextReservedIndex([{ depositIndex: 4 }, { depositIndex: 1 }])).toBe(5);
  });
});

describe("Forget, create and restore remove every activity key", () => {
  async function deviceWithEverything() {
    const store = new MemoryStorage({ [DEVICE_KEYS.vault]: "{}", [DEVICE_KEYS.backupVerified]: "true" });
    await writeActivityLog(store, sessionA, LOG);
    store.setItem(DEVICE_KEYS.legacyActivity, serialize(LOG));
    store.setItem(DEVICE_KEYS.activityQuarantine, await seal(keyB, LOG_FORMAT, logAad(fpB), LOG));
    store.setItem("hylsia.pp.activity.v4", "a later version");
    const r = createReservations(() => store);
    await r.update(sessionA, A, () => [{ depositIndex: 0, txHash: DEPOSIT_TX }]);
    await r.update(sessionA, B, () => [{ depositIndex: 2 }]);
    store.setItem(poolStorageKey(C, "pendingDeposits"), serialize([{ depositIndex: 1 }])); // an older build's plaintext
    store.setItem("hylsia.pp.31337.0xe7f1725e7734ce288f8367e1bb143e90bb3f0512.activity", "[]"); // a legacy per-pool log
    store.setItem(poolStorageKey(A, "events"), '{"events":[]}');
    store.setItem(poolStorageKey(B, "events"), '{"events":[]}');
    store.setItem("hylsia.pools.wagmi.store", "{}");
    store.setItem("hylsia.pools.prefs.v3", "{}");
    store.setItem("hylsia.theme", "dark");
    return store;
  }
  const kept = [poolStorageKey(A, "events"), poolStorageKey(B, "events"), "hylsia.pools.wagmi.store", "hylsia.pools.prefs.v3", "hylsia.theme"].sort();

  it("Forget: v2, v3, the set-aside copy, any later activity key, every reservation and the vault keys; public caches stay", async () => {
    const store = await deviceWithEverything();
    expect(forgetDeviceStorage(store)).toBe(10);
    expect(Object.keys(store.snapshot()).sort()).toEqual(kept);
    expect(leaks(JSON.stringify(store.snapshot()))).toEqual([]);
  });

  it("create and restoring another vault: every activity log in any form (clearActivityStorage) and every reservation (clearPendingDeposits)", async () => {
    const store = await deviceWithEverything();
    expect(clearActivityStorage(store)).toBe(5); // v2, v3, quarantine, v4 and the single-network build's per-pool log
    expect(clearPendingDeposits(store)).toBe(3);
    expect(Object.keys(store.snapshot()).sort()).toEqual([...kept, DEVICE_KEYS.vault, DEVICE_KEYS.backupVerified].sort());
  });
});

describe("nothing about the activity is readable at rest", () => {
  it("after a log with a deposit and a relayed withdrawal and an unsettled deposit's reservation", async () => {
    const store = new MemoryStorage({ [DEVICE_KEYS.legacyActivity]: serialize(LOG) });
    const loaded = await loadActivityLog(store, sessionA);
    await writeActivityLog(store, sessionA, [entry({ id: "d2", createdAt: 3_000, status: "pending", txHash: DEPOSIT_TX }), ...loaded.entries]);
    await createReservations(() => store).update(sessionA, A, () => [{ depositIndex: 9, txHash: DEPOSIT_TX }]);
    const all = JSON.stringify(store.snapshot());
    expect(leaks(all)).toEqual([]);
    for (const value of Object.values(store.snapshot())) {
      const env = JSON.parse(value);
      expect(Object.keys(env).sort()).toEqual(["ct", "format", "iv", "version"]);
    }
    // while the same data, decrypted with the vault's key, holds them all
    const decrypted = await open(keyA, LOG_FORMAT, logAad(fpA), store.getItem(DEVICE_KEYS.activity)!);
    const back = JSON.stringify(decrypted, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(leaks(back).sort()).toEqual(["amount", "commitment", "deposit tx", "entry kind", "fee", "label", "recipient", "recipient (no 0x)", "relayer route", "withdrawal tx"].sort());
  });
});

describe("Phase 6 cross-tab coordination and allocation", () => {
  it("merges near-simultaneous independent tab snapshots and keeps newer updates", async () => {
    const store = new MemoryStorage();
    await Promise.all([
      writeActivityLog(store, sessionA, [entry({ id: "tab-a", createdAt: 1 })]),
      writeActivityLog(store, { key: keyA2, fingerprint: fpA }, [
        entry({ id: "tab-b", createdAt: 2 }),
      ]),
    ]);
    await writeActivityLog(store, sessionA, [
      entry({ id: "tab-a", createdAt: 1, updatedAt: 5, status: "pending" }),
    ]);
    await writeActivityLog(store, sessionA, [
      entry({ id: "tab-a", createdAt: 1, updatedAt: 3, status: "failed" }),
    ]);
    const entries = (await loadActivityLog(store, sessionA)).entries;
    expect(entries.map(e => e.id)).toEqual(["tab-b", "tab-a"]);
    expect(entries[1].status).toBe("pending");
    expect(leaks(JSON.stringify(store.snapshot()))).toEqual([]);
  });

  it("coordinates independent reservation instances, retaining unknown wallet submissions and settled allocation floors", async () => {
    const store = new MemoryStorage();
    const tabs = [
      createReservations(() => store),
      createReservations(() => store),
    ];
    const indexes = await Promise.all(
      tabs.map(async tab => {
        let allocated = -1;
        const result = await tab.update(sessionA, A, list => {
          allocated = nextReservedIndex(list); // both tabs have stale chain nextDepositIndex = 0
          return [...list, { depositIndex: allocated }];
        });
        expect(result.saved).toBe(true);
        return allocated;
      })
    );
    expect(indexes).toEqual([0, 1]);
    // Tab 0 closes while wallet has not answered: no hash does not authorize reuse.
    expect(await tabs[1].read(sessionA, A)).toEqual([
      { depositIndex: 0 },
      { depositIndex: 1 },
    ]);
    await tabs[1].update(sessionA, A, list =>
      retireReservations(list, r => r.depositIndex === 1)
    );
    // A stale/reloaded tab must allocate 2 even after index 1 settled and its pending metadata was removed.
    const reloaded = createReservations(() => store);
    expect(nextReservedIndex(await reloaded.read(sessionA, A))).toBe(2);
    await reloaded.update(sessionA, A, list =>
      retireReservations(list, () => true)
    );
    expect(await reloaded.read(sessionA, A)).toEqual([
      { depositIndex: 1, retired: true },
    ]);
    expect(nextReservedIndex(await reloaded.read(sessionA, A))).toBe(2);
  });

  it("never overwrites another vault's log with a stale writer", async () => {
    const store = new MemoryStorage();
    await writeActivityLog(store, sessionB, LOG);
    const previous = store.snapshot();
    expect(await writeActivityLog(store, sessionA, LOG)).toBe(false);
    expect(store.snapshot()).toEqual(previous);
  });

  it("uses origin-wide Web Locks and fails closed when a browser cannot coordinate", async () => {
    const locks: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          name: string,
          _options: unknown,
          job: () => Promise<unknown>
        ) => {
          locks.push(name);
          return job();
        },
      },
    });
    vi.stubGlobal("window", {});
    try {
      const store = new MemoryStorage();
      expect(await writeActivityLog(store, sessionA, LOG)).toBe(true);
      expect(
        (
          await createReservations(() => store).update(sessionA, A, () => [
            { depositIndex: 0 },
          ])
        ).saved
      ).toBe(true);
      expect(locks).toEqual([
        `hylsia:${DEVICE_KEYS.activity}`,
        `hylsia:${poolStorageKey(A, "pendingDeposits")}`,
      ]);
      vi.stubGlobal("navigator", {});
      expect(
        (
          await createReservations(() => store).update(sessionA, A, () => [
            { depositIndex: 1 },
          ])
        ).saved
      ).toBe(false);
      expect(await writeActivityLog(store, sessionA, [])).toBe(false);
      vi.stubGlobal("navigator", {
        locks: {
          request: async () => {
            throw new Error("lock unavailable");
          },
        },
      });
      expect(
        (
          await createReservations(() => store).update(sessionA, A, () => [
            { depositIndex: 1 },
          ])
        ).saved
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("seed-only recovery allocation bound", () => {
  it("allows index 9 after interrupted requests but prevents a gap of ten from hiding a deposit on restore", async () => {
    const { allocateDepositIndex } =
      await import("../../client/src/privacy/activityStore");
    expect(allocateDepositIndex(0, [{ depositIndex: 8, retired: true }])).toBe(
      9
    );
    expect(() =>
      allocateDepositIndex(0, [{ depositIndex: 9, retired: true }])
    ).toThrow("Too many deposit indexes");
    expect(allocateDepositIndex(10, [{ depositIndex: 9, retired: true }])).toBe(
      10
    );
  });
});

describe("recovery after interrupted deposit requests", () => {
  it("restores the highest permitted sparse index from only the seed and public deposit", async () => {
    const {
      deriveMasterKeys,
      deriveNoteSecrets,
      computePrecommitment,
      computeLabel,
      computeCommitment,
    } = await import("../../shared/privacy/notes");
    const { discoverNotes } = await import("../../shared/privacy/indexer");
    const { computeScope } = await import("../../shared/privacy/context");
    const keys = deriveMasterKeys(seedA),
      scope = computeScope(A.pool, A.chainId);
    const precommitment = computePrecommitment(
      deriveNoteSecrets(keys, scope, 9, 0)
    );
    const label = computeLabel(scope, 1n),
      value = 1000n;
    const event = {
      kind: "deposit" as const,
      depositor: RECIPIENT,
      value,
      precommitment,
      label,
      commitment: computeCommitment(value, label, precommitment),
      leafIndex: 0,
      blockNumber: 1n,
      txHash: DEPOSIT_TX,
      logIndex: 0,
    };
    const restored = discoverNotes(
      deriveMasterKeys(new Uint8Array(seedA)),
      scope,
      [event]
    );
    expect(restored.notes).toHaveLength(1);
    expect(restored.notes[0].depositIndex).toBe(9);
    expect(restored.nextDepositIndex).toBe(10);
  });
});
