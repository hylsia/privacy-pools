/**
 * Storage moves for the two-network layout (final design §5 "Storage" and "Migration"). Pure: every function takes
 * a Storage-like object, so they are tested from server/privacy/clientMigrate.test.ts. None writes to the console
 * (no fingerprint, key or address is ever logged).
 *
 * Before, one network per build kept everything under `hylsia.pp.<chainId>.<pool>.<suffix>`: vault,
 * backupVerified, activity, events, pendingDeposits. Now:
 *   - device-wide: `hylsia.pp.vault.v2` (an encrypted seed for every network; a v1 blob until the next unlock),
 *     `hylsia.pp.backupVerified.v2`, and the activity log `hylsia.pp.activity.v3`, encrypted with a key from the
 *     vault seed (client/src/privacy/activityStore.ts; a log that does not decrypt is set aside as
 *     `hylsia.pp.activity.quarantine`);
 *   - per pool, unchanged names: `hylsia.pp.<chainId>.<pool>.events` (public) and `.pendingDeposits` (encrypted
 *     like the log since the activity log was encrypted).
 * This file runs at startup, before any seed exists, so it cannot encrypt: the legacy per-pool logs it merges go to
 * the older plaintext key `hylsia.pp.activity.v2`, which the first unlock moves into the encrypted log and deletes.
 * A per-pool log found later next to the device vault (written by an older tab, or left with no vault key) is moved
 * into the encrypted log on unlock too (activityStore.ts); another legacy vault's log stays until Forget.
 * Everything a vault leaves on the device sits under `hylsia.pp.`, which Forget scans. The active network is never
 * stored, and the wallet connection lives under `hylsia.pools.wagmi`, outside the scan.
 */
import type { PoolId } from "@shared/privacy/networks";
import { parseBackup } from "@shared/privacy/vault";
import { DEVICE_KEYS, PRIVACY_PROTOCOL, activeProtocolStorageKey, DEVICE_STORAGE_PREFIX } from "./config";
import { isV2Protocol } from "@shared/privacy/protocols";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** A single-network build's vault-bound keys. */
const LEGACY_KEY = /^(hylsia\.pp\.(\d+)\.(0x[0-9a-fA-F]{40}))\.(vault|backupVerified|activity)$/;

/**
 * Every key a vault leaves behind, in any layout (events caches are public and stay): a legacy per-pool vault,
 * backupVerified or activity key, any pool's pendingDeposits, and every device activity key (`hylsia.pp.activity.`
 * followed by anything: the plaintext v2 log, the encrypted v3 log, a set-aside copy).
 */
const VAULT_BOUND = /^hylsia\.pp\.(?:.+\.(?:vault|backupVerified|activity|pendingDeposits)|activity\..+)$/;
const PENDING = /^hylsia\.pp\..+\.pendingDeposits$/;
/**
 * An activity log in any form: the device log (plaintext v2, encrypted v3, a set-aside copy, or a later version) and
 * a single-network build's per-pool plaintext log (`hylsia.pp.<chainId>.<pool>.activity`).
 */
const ACTIVITY = /^hylsia\.pp\.(?:activity\..+|.+\.activity)$/;

/** The keys first, then the changes: removing while walking by index would skip keys. */
function keysOf(store: StorageLike): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}

interface LegacySet {
  prefix: string;
  chainId: number;
  /** lowercase, as the key holds it */
  pool: string;
  vaultKey: string | null;
  backupVerifiedKey: string | null;
  activityKey: string | null;
  /** the vault blob and its fingerprint, when it reads as a backup */
  vault: { raw: string; fingerprint: string } | null;
}

/** A stored activity log: a JSON array of entries with a string id (bigints stay in their stored form). */
type StoredEntry = Record<string, unknown> & { id: string };

function parseLog(raw: string | null): StoredEntry[] | null {
  if (raw === null) return null;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    return list.filter((e): e is StoredEntry => !!e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string");
  } catch {
    return null;
  }
}

const createdAt = (e: StoredEntry) => (typeof e.createdAt === "number" && Number.isFinite(e.createdAt) ? e.createdAt : 0);

/**
 * Runs once, before the provider reads storage:
 *   1. a device vault (`hylsia.pp.vault.v2`) already exists: nothing changes;
 *   2. otherwise a legacy `hylsia.pp.<id>.<pool>.vault` is adopted as it is (a v1 blob, re-encrypted as v2 at the next
 *      unlock), preferring the registry's pools in order, with its backup-verified flag;
 *   3. every legacy key set of that same vault (same fingerprint) has its activity log merged into the plaintext
 *      device log (`hylsia.pp.activity.v2`; the first unlock encrypts it), each entry tagged with that set's chain and
 *      pool; then its vault, backupVerified and activity keys go. Device logs found without a device vault are
 *      leftovers: they are replaced (v2) or deleted (an encrypted v3 log, a set-aside copy);
 *   4. key sets of another vault (local testers only; nothing is deployed) stay until Forget;
 *   5. a legacy log without a vault is deleted, as before.
 * Pending deposits and event caches keep their per-pool keys, so they need no move.
 * `adopted` is the legacy vault key that became the device vault.
 */
export function migrateLegacyStorage(
  store: StorageLike,
  registry: readonly PoolId[],
): { adopted: string | null; mergedLogs: number; leftLegacyVaults: number } {
  if (isV2Protocol(PRIVACY_PROTOCOL)) return { adopted: null, mergedLogs: 0, leftLegacyVaults: 0 };
  const sets = new Map<string, LegacySet>();
  for (const key of keysOf(store)) {
    const m = LEGACY_KEY.exec(key);
    if (!m) continue;
    const [, prefix, chainId, pool, suffix] = m;
    let set = sets.get(prefix);
    if (!set) {
      set = { prefix, chainId: Number(chainId), pool: pool.toLowerCase(), vaultKey: null, backupVerifiedKey: null, activityKey: null, vault: null };
      sets.set(prefix, set);
    }
    if (suffix === "vault") set.vaultKey = key;
    else if (suffix === "backupVerified") set.backupVerifiedKey = key;
    else set.activityKey = key;
  }

  const withVault = [...sets.values()].filter((s) => s.vaultKey !== null);
  for (const s of withVault) {
    const raw = store.getItem(s.vaultKey!);
    try {
      if (raw !== null) s.vault = { raw, fingerprint: parseBackup(raw).fingerprint };
    } catch {
      s.vault = null; // not a backup: never adopted, left until Forget
    }
  }

  if (store.getItem(DEVICE_KEYS.vault) !== null) return { adopted: null, mergedLogs: 0, leftLegacyVaults: withVault.length };

  const order = registry.map((r) => `hylsia.pp.${r.chainId}.${r.pool.toLowerCase()}`);
  const rank = (s: LegacySet) => {
    const i = order.indexOf(s.prefix.toLowerCase());
    return i === -1 ? order.length : i;
  };
  const candidates = withVault
    .filter((s) => s.vault !== null)
    .sort((a, b) => rank(a) - rank(b) || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  const pick = candidates[0] ?? null;

  let mergedLogs = 0;
  const moved = new Set<LegacySet>();
  if (pick) {
    const same = candidates.filter((s) => s.vault!.fingerprint === pick.vault!.fingerprint);
    // verified once for this seed is verified: the check compares the seed's fingerprint
    const flags = same.map((s) => (s.backupVerifiedKey ? store.getItem(s.backupVerifiedKey) : null)).filter((v): v is string => v !== null);

    const merged: StoredEntry[] = [];
    for (const s of same) {
      const entries = s.activityKey ? parseLog(store.getItem(s.activityKey)) : null;
      if (!entries) continue;
      mergedLogs++;
      for (const e of entries) {
        merged.push({ ...e, chainId: typeof e.chainId === "number" ? e.chainId : s.chainId, pool: typeof e.pool === "string" ? e.pool : s.pool });
      }
    }
    // newest first, one entry per id; a device log found without a device vault was a leftover, so it is replaced
    const seen = new Set<string>();
    const log = merged
      .map((e, i) => ({ e, i }))
      .sort((a, b) => createdAt(b.e) - createdAt(a.e) || a.i - b.i)
      .map(({ e }) => e)
      .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));

    // The new keys first: if storage refuses a write, the legacy keys are all still there and the next load retries.
    // No seed exists yet, so the merged log stays in the plaintext key until the first unlock encrypts it.
    if (log.length > 0) store.setItem(DEVICE_KEYS.legacyActivity, JSON.stringify(log));
    else store.removeItem(DEVICE_KEYS.legacyActivity);
    store.removeItem(DEVICE_KEYS.activity);
    store.removeItem(DEVICE_KEYS.activityQuarantine);
    if (flags.length > 0) store.setItem(DEVICE_KEYS.backupVerified, flags.includes("true") ? "true" : "false");
    store.setItem(DEVICE_KEYS.vault, pick.vault!.raw);

    for (const s of same) {
      if (s.activityKey) store.removeItem(s.activityKey);
      if (s.backupVerifiedKey) store.removeItem(s.backupVerifiedKey);
      store.removeItem(s.vaultKey!);
      moved.add(s);
    }
  }

  // a legacy log without a vault still pairs deposits with withdrawal recipients: delete it
  for (const s of sets.values()) if (s.vaultKey === null && s.activityKey !== null) store.removeItem(s.activityKey);

  return { adopted: pick ? pick.vaultKey : null, mergedLogs, leftLegacyVaults: withVault.filter((s) => !moved.has(s)).length };
}

/** Removes every pool's pending-deposit reservations, registry or not (a new or restored vault starts clean). */
export function clearPendingDeposits(store: StorageLike): number {
  const keys = keysOf(store).filter((k) => activeProtocolStorageKey(k) && PENDING.test(k));
  for (const k of keys) store.removeItem(k);
  return keys.length;
}

/**
 * Removes every activity log on this device, in every form: the plaintext v2 log, the encrypted v3 log, a set-aside
 * copy (any `hylsia.pp.activity.*` key) and a single-network build's per-pool plaintext logs (any
 * `hylsia.pp.<chainId>.<pool>.activity`, whichever vault wrote it). Used when a vault is created, when another vault is
 * restored and, through forgetDeviceStorage, by Forget. Nothing is read. Returns how many keys went.
 */
export function clearActivityStorage(store: StorageLike): number {
  const keys = keysOf(store).filter((k) => activeProtocolStorageKey(k) && (ACTIVITY.test(k) || k.startsWith(`${DEVICE_STORAGE_PREFIX}activity.`)));
  for (const k of keys) store.removeItem(k);
  return keys.length;
}

/**
 * "Forget vault on this device": the device keys, every device activity key (v2, v3, a set-aside copy), every pool's
 * pending deposits and every legacy vault, backupVerified, activity and pendingDeposits key, found by a scan of
 * `hylsia.pp.`. Public event caches stay. Returns how many keys went.
 */
export function forgetDeviceStorage(store: StorageLike): number {
  const device = new Set<string>(Object.values(DEVICE_KEYS));
  const keys = keysOf(store).filter((k) => activeProtocolStorageKey(k) && (device.has(k) || VAULT_BOUND.test(k)));
  for (const k of keys) store.removeItem(k);
  return keys.length;
}
