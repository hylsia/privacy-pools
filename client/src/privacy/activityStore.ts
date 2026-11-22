/**
 * The device activity log and each pool's deposit-index reservations, encrypted at rest with a key from the vault seed.
 * Pure: every function takes a Storage-like object and uses WebCrypto from globalThis, so it is tested from
 * server/privacy/activityStore.test.ts. Nothing here writes to the console or sends anything anywhere.
 *
 * Key. HKDF-SHA256 over the 32-byte seed, with a fixed salt and the info "hylsia-activity-log:v1", to a
 * non-extractable AES-256-GCM CryptoKey (deriveActivityKey). The backup encrypts the seed with a key from the password
 * (PBKDF2, shared/privacy/vault.ts) and the note secrets come from keccak(seed || "nullifier" / "secret")
 * (shared/privacy/notes.ts), so this key is separate from both. PrivacyProvider holds it in memory while the vault is
 * unlocked and drops it on lock and on Forget. The seed is never stored here.
 *
 * Envelope. {"format":"hylsia-activity","version":1,"iv":"<base64, 12 bytes>","ct":"<base64>"}, with a fresh random
 * IV on every write. The additional data binds the format, the version and the vault fingerprint
 * ("hylsia-activity:1:<fingerprint>"), so another vault's log, or a changed one, does not decrypt. A pool's
 * reservations use the same key and the same envelope with the format "hylsia-pending-deposits"; their additional data
 * also binds the pool ("hylsia-pending-deposits:1:<fingerprint>:<chainId>:<pool, lowercase>").
 *
 * Storage, all under `hylsia.pp.`, which "Forget vault on this device" scans (client/src/privacy/migrate.ts):
 *   - hylsia.pp.activity.v3          the log's envelope and nothing else
 *   - hylsia.pp.activity.v2          the older plaintext log: read on unlock only, moved into v3, then deleted
 *   - hylsia.pp.<chainId>.<pool>.activity  a single-network build's plaintext log: moved into v3 on unlock the same
 *                                    way when it is this vault's (or has no vault); another vault's stays until Forget
 *   - hylsia.pp.activity.quarantine  a v3 log that did not decrypt (changed, damaged or another vault's), set aside
 *                                    unread
 *   - hylsia.pp.<chainId>.<pool>.pendingDeposits  that pool's reservations as an envelope (an older build's plaintext
 *                                    list is sealed in place on unlock; one that does not decrypt is left untouched)
 * The encryption protects these at rest on the device. Anyone using the unlocked vault can read them, and the keys'
 * names and sizes stay visible.
 *
 * Every write takes a `live` guard, asked right before storage is touched: false once the vault was locked, forgotten
 * or replaced (in this tab or another), so a session that is no longer the device's never changes what is stored.
 */
import type { Address, Hex } from "viem";
import type { PoolId } from "@shared/privacy/networks";
import { parseBackup } from "@shared/privacy/vault";
import { DEVICE_KEYS, poolStorageKey, PRIVACY_PROTOCOL } from "./config";
import { isV2Protocol } from "@shared/privacy/protocols";
import type { StorageLike } from "./migrate";
import { deserialize, serialize } from "./storage";
import { withDeviceLock } from "./deviceLock";
import { NOTE_DISCOVERY_GAP_LIMIT } from "@shared/privacy/indexer";

// ─────────────────────────────── key ───────────────────────────────

/** HKDF info: names this key's one use. */
export const ACTIVITY_KEY_INFO = "hylsia-activity-log:v1";
/** HKDF salt: fixed and public (the seed is already uniformly random); it only separates this derivation. */
export const ACTIVITY_KEY_SALT = "hylsia.pp:activity-log:salt:v1";

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this environment");
  return c.subtle;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * The key for this vault's activity log and reservations: HKDF-SHA256(seed, salt, info) to a non-extractable
 * AES-256-GCM key. The same seed always gives the same key, so the log opens again after a reload or on another
 * unlock; the key itself can never be read back out (exportKey refuses it).
 */
export async function deriveActivityKey(seed: Uint8Array): Promise<CryptoKey> {
  if (!seed || seed.length !== 32) throw new Error("seed must be 32 bytes");
  const base = await subtle().importKey("raw", seed as BufferSource, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: utf8(ACTIVITY_KEY_SALT) as BufferSource,
      info: utf8(isV2Protocol(PRIVACY_PROTOCOL) ? `${ACTIVITY_KEY_INFO}:${PRIVACY_PROTOCOL}` : ACTIVITY_KEY_INFO) as BufferSource },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** One unlocked vault's view of its log: the key and the vault fingerprint the additional data binds. */
export interface LogSession {
  key: CryptoKey;
  /** the vault's fingerprint (decimal), as in its backup */
  fingerprint: string;
}

// ───────────────────────────── envelope ─────────────────────────────

export const LOG_FORMAT = "hylsia-activity";
export const RESERVATIONS_FORMAT = "hylsia-pending-deposits";
export const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
/** AES-GCM's tag: a shorter ciphertext cannot be one of ours */
const TAG_BYTES = 16;

export type EnvelopeFormat = typeof LOG_FORMAT | typeof RESERVATIONS_FORMAT;

/** Why an envelope did not open: not an envelope of this kind, did not decrypt (wrong key, wrong vault, changed), or decrypted to something else. */
export class EnvelopeError extends Error {
  constructor(
    public readonly code: "FORMAT" | "DECRYPT" | "CONTENT",
    message: string,
  ) {
    super(message);
    this.name = "EnvelopeError";
  }
}

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

/** The log's additional data: format, version and the vault fingerprint. */
export const logAad = (fingerprint: string): string => `${LOG_FORMAT}:${ENVELOPE_VERSION}:${fingerprint}`;

/** A pool's reservations: the same, plus the pool's chain and address. */
export const reservationsAad = (fingerprint: string, pool: PoolId): string =>
  `${RESERVATIONS_FORMAT}:${ENVELOPE_VERSION}:${fingerprint}:${pool.chainId}:${pool.pool.toLowerCase()}`;

/** Encrypts `value` (bigint-safe JSON) into an envelope string, with a fresh random IV. */
export async function seal(key: CryptoKey, format: EnvelopeFormat, aad: string, value: unknown): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(aad) as BufferSource },
      key,
      utf8(serialize(value)) as BufferSource,
    ),
  );
  return JSON.stringify({ format, version: ENVELOPE_VERSION, iv: b64.encode(iv), ct: b64.encode(ct) });
}

/** The IV and ciphertext of an envelope of this format and version; anything else throws FORMAT. */
function readEnvelope(text: string, format: EnvelopeFormat): { iv: Uint8Array; ct: Uint8Array } {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new EnvelopeError("FORMAT", "not an envelope");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new EnvelopeError("FORMAT", "not an envelope");
  const e = obj as Record<string, unknown>;
  if (e.format !== format || e.version !== ENVELOPE_VERSION || typeof e.iv !== "string" || typeof e.ct !== "string") {
    throw new EnvelopeError("FORMAT", "not an envelope of this kind or version");
  }
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = b64.decode(e.iv);
    ct = b64.decode(e.ct);
  } catch {
    throw new EnvelopeError("FORMAT", "the envelope's fields are not base64");
  }
  if (iv.length !== IV_BYTES || ct.length < TAG_BYTES) throw new EnvelopeError("FORMAT", "the envelope's fields have the wrong length");
  return { iv, ct };
}

/** Decrypts an envelope with this key and additional data. Throws EnvelopeError; never returns partial data. */
export async function open(key: CryptoKey, format: EnvelopeFormat, aad: string, text: string): Promise<unknown> {
  const { iv, ct } = readEnvelope(text, format);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(aad) as BufferSource }, key, ct as BufferSource);
  } catch {
    throw new EnvelopeError("DECRYPT", "the envelope does not decrypt with this key and additional data");
  }
  try {
    return deserialize<unknown>(new TextDecoder().decode(plain));
  } catch {
    throw new EnvelopeError("CONTENT", "the envelope decrypted to something unreadable");
  }
}

// ──────────────────────────── the log ────────────────────────────

/** A log entry as stored: a string id and kind, the rest as written (bigints in their stored form). */
export type LogEntry = Record<string, unknown> & { id: string; kind: string };

/** The usable entries of a stored log, or null when it is not a list. */
export function logEntries(value: unknown): LogEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (e): e is LogEntry => !!e && typeof e === "object" && !Array.isArray(e) && typeof (e as LogEntry).id === "string" && typeof (e as LogEntry).kind === "string",
  );
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * One entry per id, newest first (createdAt; ties keep their order). For an id in both lists the entry updated later
 * wins, and on a tie the first list's: the encrypted log's copy is the one the app kept updating.
 */
export function mergeLogs(first: readonly LogEntry[], second: readonly LogEntry[]): LogEntry[] {
  const byId = new Map<string, LogEntry>();
  for (const e of first) if (!byId.has(e.id)) byId.set(e.id, e);
  for (const e of second) {
    const have = byId.get(e.id);
    if (!have || num(e.updatedAt) > num(have.updatedAt)) byId.set(e.id, e);
  }
  return [...byId.values()]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => num(b.e.createdAt) - num(a.e.createdAt) || a.i - b.i)
    .map(({ e }) => e);
}

const always = () => true;

/**
 * Merges and seals the log under an origin-wide Web Lock; a truly empty stored+incoming log leaves no key. `live` is asked right before storage is
 * touched (after the encryption): false means the vault was forgotten or replaced meanwhile, and nothing is written.
 * True when the log is stored. Never throws.
 */
export async function writeActivityLog(
  store: StorageLike,
  session: LogSession,
  entries: readonly unknown[],
  live: () => boolean = always,
): Promise<boolean> {
  try {
    return await withDeviceLock(DEVICE_KEYS.activity, () =>
      writeActivityLogNow(store, session, entries, live)
    );
  } catch {
    return false;
  }
}

async function writeActivityLogNow(
  store: StorageLike,
  session: LogSession,
  entries: readonly unknown[],
  live: () => boolean
): Promise<boolean> {
  try {
    if (!live()) return false;
    const raw = store.getItem(DEVICE_KEYS.activity);
    const previous =
      raw === null
        ? []
        : logEntries(
            await open(
              session.key,
              LOG_FORMAT,
              logAad(session.fingerprint),
              raw
            )
          );
    if (!previous) return false; // foreign/damaged logs are never overwritten by a writer
    const merged = mergeLogs(logEntries([...entries]) ?? [], previous);
    if (merged.length === 0) {
      if (!live()) return false;
      store.removeItem(DEVICE_KEYS.activity);
      return true;
    }
    const text = await seal(session.key, LOG_FORMAT, logAad(session.fingerprint),
      merged
    );
    if (!live()) return false;
    store.setItem(DEVICE_KEYS.activity, text);
    return true;
  } catch {
    return false; // storage full or blocked: the caller keeps what it has
  }
}

/** Moves an unreadable v3 log to the quarantine key (unread, as it was) and removes it from v3. */
function setAsideLog(store: StorageLike, raw: string) {
  try {
    store.setItem(DEVICE_KEYS.activityQuarantine, raw);
  } catch {
    // no room for a second copy: free the first, then try again
    store.removeItem(DEVICE_KEYS.activity);
    try {
      store.setItem(DEVICE_KEYS.activityQuarantine, raw);
    } catch {
      /* it cannot be kept; it was unreadable to this vault anyway */
    }
  }
  store.removeItem(DEVICE_KEYS.activity);
}

/** The plaintext log of an older build, or null when it cannot be parsed. */
function readPlainLog(raw: string): LogEntry[] | null {
  try {
    return logEntries(deserialize<unknown>(raw));
  } catch {
    return null;
  }
}

/** A single-network build's per-pool log, `hylsia.pp.<chainId>.<pool>.activity`; its vault was `<the same prefix>.vault`. */
const LEGACY_LOG_KEY = /^(hylsia\.pp\.(\d+)\.(0x[0-9a-fA-F]{40}))\.activity$/;

/**
 * The per-pool plaintext logs of a single-network build that are this vault's: their key set's own vault key holds
 * this vault (same fingerprint), or the set has no vault key (migrate.ts moved that vault to the device key, and an
 * older tab may still write its log). A set whose vault key holds another vault, or no backup, keeps its log until
 * Forget (local test setups only).
 */
function legacyLogsOf(store: StorageLike, fingerprint: string): { key: string; chainId: number; pool: string }[] {
  if (isV2Protocol(PRIVACY_PROTOCOL)) return [];
  const out: { key: string; chainId: number; pool: string }[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    const m = key === null ? null : LEGACY_LOG_KEY.exec(key);
    if (!key || !m) continue;
    const vault = store.getItem(`${m[1]}.vault`);
    if (vault !== null) {
      let owner: string | null = null;
      try {
        owner = parseBackup(vault).fingerprint;
      } catch {
        owner = null;
      }
      if (owner !== fingerprint) continue;
    }
    out.push({ key, chainId: Number(m[2]), pool: m[3].toLowerCase() });
  }
  return out;
}

export interface LoadedLog {
  /** the vault's log, newest first */
  entries: LogEntry[];
  /** the stored log did not decrypt with this vault's key, and was set aside unread just now */
  setAsideNow: boolean;
  /** a set-aside log is on this device (from now or an earlier unlock); Forget deletes it */
  setAside: boolean;
  /**
   * Older plaintext logs (hylsia.pp.activity.v2, and a single-network build's per-pool logs of this vault): none;
   * moved into the encrypted log and deleted; or merged but kept because the encrypted write failed (`left`).
   */
  plaintext: "none" | "moved" | "kept";
  /** a plaintext log that could not be parsed was found, and deleted unread */
  unreadableRemoved: boolean;
  /** the plaintext keys merged in but still stored (the encrypted write failed): delete them after the next one succeeds */
  left: string[];
}

/**
 * Opens this vault's log, on unlock (never before: the provider neither reads nor shows any activity while locked).
 *   1. hylsia.pp.activity.v3 is decrypted. If it does not open (changed, damaged, another vault's, an unknown version),
 *      it is moved to hylsia.pp.activity.quarantine unread and the log starts empty, so the next unlock does not fail
 *      on it again.
 *   2. Every plaintext log (hylsia.pp.activity.v2: an older build's, or what migrate.ts moved there from per-pool keys
 *      at startup; and a single-network build's per-pool logs of this vault, each entry tagged with its pool) is merged
 *      by entry id, the merged log is written encrypted, and only then are the plaintext keys deleted. If that write
 *      fails, they stay: running this again gives the same result (idempotent). A plaintext log that cannot be parsed
 *      is deleted unread.
 * `live` guards every write (see writeActivityLog). Throws only when storage itself cannot be read.
 */
export async function loadActivityLog(store: StorageLike, session: LogSession, live: () => boolean = always): Promise<LoadedLog> {
  return withDeviceLock(DEVICE_KEYS.activity, () =>
    loadActivityLogNow(store, session, live)
  );
}

async function loadActivityLogNow(
  store: StorageLike,
  session: LogSession,
  live: () => boolean
): Promise<LoadedLog> {
  let entries: LogEntry[] = [];
  let setAsideNow = false;
  const sealed = store.getItem(DEVICE_KEYS.activity);
  if (sealed !== null) {
    try {
      const list = logEntries(await open(session.key, LOG_FORMAT, logAad(session.fingerprint), sealed));
      if (!list) throw new EnvelopeError("CONTENT", "the log is not a list");
      entries = list;
    } catch {
      if (live()) {
        setAsideLog(store, sealed);
        setAsideNow = true;
      }
    }
  }

  let unreadableRemoved = false;
  /** plaintext keys whose entries are now in `entries` */
  const merged: string[] = [];
  let found = 0;
  const take = (key: string, tag?: { chainId: number; pool: string }) => {
    const raw = store.getItem(key);
    if (raw === null) return;
    const old = readPlainLog(raw);
    if (old === null) {
      store.removeItem(key);
      unreadableRemoved = true;
      return;
    }
    // an entry from before the multi-network move names no network: it ran on its key's pool
    const tagged = tag ? old.map(e => ({ ...e, chainId: typeof e.chainId === "number" ? e.chainId : tag.chainId, pool: typeof e.pool === "string" ? e.pool : tag.pool })) : old;
    entries = mergeLogs(entries, tagged);
    merged.push(key);
    found += old.length;
  };
  if (live()) {
    take(DEVICE_KEYS.legacyActivity);
    for (const legacy of legacyLogsOf(store, session.fingerprint)) take(legacy.key, legacy);
  }

  let plaintext: LoadedLog["plaintext"] = "none";
  let left: string[] = [];
  if (merged.length > 0) {
    // the plaintext goes only once the encrypted log holds its entries
    if (found === 0 || (await writeActivityLogNow(store, session, entries, live))) {
      if (live()) for (const key of merged) store.removeItem(key);
      plaintext = "moved";
    } else {
      plaintext = "kept";
      left = merged;
    }
  }
  return { entries, setAsideNow, setAside: store.getItem(DEVICE_KEYS.activityQuarantine) !== null, plaintext, unreadableRemoved, left };
}

// ───────────────────────────── writes ─────────────────────────────

export interface SerialWriter {
  /**
   * Runs `write` after the write in flight, if any. A write still waiting when a newer one is scheduled is replaced by
   * it: the newer one carries the latest state, so the last state always wins and none is lost. Resolves with the
   * result of the write that covered this one.
   */
  schedule(write: () => Promise<boolean>): Promise<boolean>;
  /** Resolves once nothing is in flight or waiting. */
  flush(): Promise<void>;
  /** Drops the waiting write (resolved false). One already running is stopped by its own `live` guard. */
  cancel(): void;
}

/** Async encryption, one write at a time: an older state can never land after a newer one. */
export function createSerialWriter(): SerialWriter {
  let waiting: { write: () => Promise<boolean>; done: ((ok: boolean) => void)[];
  } | null = null;
  let running: Promise<void> | null = null;
  const drain = async () => {
    while (waiting) {
      const job = waiting;
      waiting = null;
      let ok = false;
      try {
        ok = await job.write();
      } catch {
        ok = false;
      }
      for (const d of job.done) d(ok);
    }
    running = null;
  };
  return {
    schedule(write) {
      return new Promise<boolean>(resolve => {
        if (waiting) {
          waiting.write = write;
          waiting.done.push(resolve);
        } else {
          waiting = { write, done: [resolve] };
        }
        if (!running) running = drain();
      });
    },
    async flush() {
      while (running) await running;
    },
    cancel() {
      const job = waiting;
      waiting = null;
      if (job) for (const d of job.done) d(false);
    },
  };
}

// ──────────────────────── deposit reservations ────────────────────────

/** A deposit index held for a deposit until its transaction is settled; txHash once the wallet sent it. */
export interface Reservation {
  depositIndex: number;
  txHash?: Hex;
  /** Encrypted allocation watermark: even a stale tab must not reuse a settled index. */
  retired?: true;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const RESERVATION_KEY = /^hylsia\.pp\.(\d+)\.(0x[0-9a-fA-F]{40})\.pendingDeposits$/;

/**
 * The usable reservations of a stored list, or null when it is not a list. Only the index and the transaction are
 * kept: an older build's precommitment follows from the seed and the index, and its createdAt was never read.
 */
export function reservationList(value: unknown): Reservation[] | null {
  if (!Array.isArray(value)) return null;
  const out: Reservation[] = [];
  for (const d of value) {
    if (!d || typeof d !== "object") continue;
    const i = (d as { depositIndex?: unknown }).depositIndex;
    if (typeof i !== "number" || !Number.isSafeInteger(i) || i < 0) continue;
    const h = (d as { txHash?: unknown }).txHash;
    out.push(
      (d as Reservation).retired === true
        ? { depositIndex: i, retired: true }
        : typeof h === "string" && TX_HASH.test(h) ? { depositIndex: i, txHash: h as Hex } : { depositIndex: i });
  }
  return out;
}

/** The first deposit index no reservation holds. */
export const nextReservedIndex = (list: readonly Reservation[]): number => list.reduce((m, d) => Math.max(m, d.depositIndex + 1), 0);

/** Keep seed-only recovery within the indexer's existing gap bound, even after interrupted wallet requests. */
export function allocateDepositIndex(
  chainNext: number,
  list: readonly Reservation[]
): number {
  const index = Math.max(chainNext, nextReservedIndex(list));
  if (index >= chainNext + NOTE_DISCOVERY_GAP_LIMIT)
    throw new Error(
      "Too many deposit indexes are awaiting chain discovery. Sync and settle pending wallet transactions before depositing again. Nothing was sent."
    );
  return index;
}

const sameList = (a: readonly Reservation[], b: readonly Reservation[]) => JSON.stringify(a) === JSON.stringify(b);

/** Release pending metadata, retaining just the highest settled allocation (encrypted). */
export function retireReservations(
  list: Reservation[],
  settled: (r: Reservation) => boolean
): Reservation[] {
  const retired = list.filter(r => r.retired || settled(r));
  const pending = list.filter(r => !r.retired && !settled(r));
  return retired.length
    ? [
        ...pending,
        {
          depositIndex: Math.max(...retired.map(r => r.depositIndex)),
          retired: true,
        },
      ]
    : pending;
}

/**
 * What an update did. `saved`: the change is stored. Otherwise `problem` says why, and storage was left as it was:
 *   - "stale": `live` was false (the vault was locked, forgotten or replaced, here or in another tab): nothing was
 *     read or written, and `change` was not called;
 *   - "foreign": the stored list does not decrypt with this vault's key (another vault's, changed or damaged): it is
 *     left exactly as it is (never deleted or overwritten: it may hold another vault's index holds), and `change` was
 *     not called;
 *   - "storage": storage is full, blocked or missing (`list` is the changed list, held nowhere).
 */
export interface ReservationUpdate {
  list: Reservation[];
  saved: boolean;
  problem?: "stale" | "foreign" | "storage";
}

export interface Reservations {
  /** That pool's reservations (none for a list that does not decrypt with this vault's key; it is left as it is). */
  read(session: LogSession, pool: PoolId): Promise<Reservation[]>;
  /**
   * Reads, changes and writes under a cross-tab Web Lock. An encrypted retired-index watermark may remain
   * after pending metadata is released, so the key name can reveal prior pool usage. `live` is asked before
   * anything is read and again right before the write. Throws only what `change` throws.
   */
  update(session: LogSession, pool: PoolId, change: (list: Reservation[]) => Reservation[], live?: () => boolean): Promise<ReservationUpdate>;
  /** On unlock: every plaintext list an older build left (any pool) is sealed in place. Returns how many. */
  sealPlaintext(session: LogSession, live?: () => boolean): Promise<number>;
}

/** Encrypted reservations over `storage` (read when needed, so a blocked storage only disables them). */
export function createReservations(storage: () => StorageLike | null): Reservations {
  const queue = withDeviceLock;

  /**
   * The list, whether it was stored in plaintext, and whether it is another vault's (or changed, or damaged). Reads
   * only: a list that does not decrypt is never removed here, since it may hold another vault's index holds (a vault
   * open in another tab), and a deposit that reused one of them could never be spent.
   */
  async function readNow(store: StorageLike, session: LogSession, pool: PoolId): Promise<{ list: Reservation[]; plain: boolean; foreign: boolean }> {
    const raw = store.getItem(poolStorageKey(pool, "pendingDeposits"));
    if (raw === null) return { list: [], plain: false, foreign: false };
    let parsed: unknown = null;
    try {
      parsed = deserialize<unknown>(raw);
    } catch {
      parsed = null;
    }
    const plain = reservationList(parsed);
    if (plain) return { list: plain, plain: true, foreign: false };
    try {
      const list = reservationList(await open(session.key, RESERVATIONS_FORMAT, reservationsAad(session.fingerprint, pool), raw));
      if (list) return { list, plain: false, foreign: false };
    } catch {
      /* changed, damaged or another vault's */
    }
    return { list: [], plain: false, foreign: true };
  }

  async function writeNow(store: StorageLike, session: LogSession, pool: PoolId, list: Reservation[], live: () => boolean): Promise<"ok" | "stale" | "storage"> {
    const key = poolStorageKey(pool, "pendingDeposits");
    try {
      if (list.length === 0) {
        if (!live()) return "stale";
        store.removeItem(key);
        return "ok";
      }
      const text = await seal(session.key, RESERVATIONS_FORMAT, reservationsAad(session.fingerprint, pool), list);
      if (!live()) return "stale";
      store.setItem(key, text);
      return "ok";
    } catch {
      return "storage";
    }
  }

  return {
    read(session, pool) {
      return queue(poolStorageKey(pool, "pendingDeposits"), async () => {
        const store = storage();
        if (!store) return [];
        try {
          return (await readNow(store, session, pool)).list;
        } catch {
          return [];
        }
      });
    },
    update(session, pool, change, live = always) {
      let entered = false;
      return queue(poolStorageKey(pool, "pendingDeposits"), async (): Promise<ReservationUpdate> => {
          entered = true;
          // a session that is no longer the device's reads nothing and writes nothing
        if (!live()) return { list: [], saved: false, problem: "stale" };
        const store = storage();
        if (!store) return { list: change([]), saved: false, problem: "storage" };
        let before: { list: Reservation[]; plain: boolean; foreign: boolean };
        try {
          before = await readNow(store, session, pool);
        } catch {
          return { list: change([]), saved: false, problem: "storage" }; // storage cannot be read: nothing is written
        }
        if (before.foreign) return { list: [], saved: false, problem: "foreign" };
          if (!live()) return { list: [], saved: false, problem: "stale" };
          const list = change(before.list);
        // unchanged and already sealed: nothing to write
        if (!before.plain && sameList(before.list, list)) return { list, saved: true };
        const wrote = await writeNow(store, session, pool, list, live);
        return wrote === "ok" ? { list, saved: true } : { list, saved: false, problem: wrote };
        }
      ).catch(err => {
        if (entered) throw err; // preserve a caller's allocation error; never turn it into a successful reservation
        return { list: [], saved: false, problem: "storage" as const };
      });
    },
    async sealPlaintext(session, live = always) {
      const store = storage();
      if (!store) return 0;
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && k.startsWith("hylsia.pp.") && k.endsWith(".pendingDeposits")) keys.push(k);
      }
      let sealed = 0;
      for (const key of keys) {
        if (!live()) break;
        const m = RESERVATION_KEY.exec(key);
        if (!m) {
          // not one pool's key, so it cannot be bound to a pool: a plaintext list there is dropped
          const raw = store.getItem(key);
          let isList = false;
          try {
            isList = raw !== null && Array.isArray(JSON.parse(raw));
          } catch {
            isList = false;
          }
          if (isList && live()) store.removeItem(key);
          continue;
        }
        const pool: PoolId = { chainId: Number(m[1]), pool: m[2] as Address };
        await queue(key, async () => {
          if (!live()) return;
          // only a plaintext list is sealed; an envelope (this vault's, or one that does not decrypt) stays as it is
          const { list, plain } = await readNow(store, session, pool);
          if (plain && (await writeNow(store, session, pool, list, live)) === "ok") sealed++;
        }).catch(() => undefined);
      }
      return sealed;
    },
  };
}
