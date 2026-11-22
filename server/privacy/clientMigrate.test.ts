/**
 * client/src/privacy/migrate.ts: the one-time move from one network per build to one device vault for every network,
 * and the "Forget vault on this device" scan (final design §5 "Storage" and "Migration").
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { DEVICE_KEYS } from "../../client/src/privacy/config";
import { clearPendingDeposits, forgetDeviceStorage, migrateLegacyStorage, type StorageLike } from "../../client/src/privacy/migrate";
import { deserialize, serialize } from "../../client/src/privacy/storage";
import type { PoolId } from "../../shared/privacy/networks";
import { decryptSeed, encryptSeed, encryptSeedV2, parseBackup, seedFingerprint } from "../../shared/privacy/vault";

/** localStorage over a Map, in insertion order like the browser's. */
class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
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
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  snapshot() {
    return Object.fromEntries(this.m);
  }
}

const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const OLD_POOL = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const lower = (a: string) => a.toLowerCase();
const REGISTRY: PoolId[] = [
  { chainId: 46630, pool: POOL },
  { chainId: 31338, pool: POOL },
];
const set = (chainId: number, pool: string, suffix: string) => `hylsia.pp.${chainId}.${lower(pool)}.${suffix}`;

const PASSWORD = "correct horse battery";
const ITER = 1_000; // fast PBKDF2 for tests
const seedA = new Uint8Array(32).fill(7);
const seedB = new Uint8Array(32).fill(9);

let v1A46630: string; // seed A, made by a Robinhood Chain Testnet build
let v1A31337: string; // seed A again, made by a local build
let v1B31338: string; // another vault (seed B)

beforeAll(async () => {
  v1A46630 = serialize(await encryptSeed(seedA, PASSWORD, { chainId: 46630, pool: POOL }, ITER));
  v1A31337 = serialize(await encryptSeed(seedA, PASSWORD, { chainId: 31337, pool: OLD_POOL }, ITER));
  v1B31338 = serialize(await encryptSeed(seedB, PASSWORD, { chainId: 31338, pool: POOL }, ITER));
});

afterEach(() => vi.restoreAllMocks());

/** An activity log as the old provider stored it (saveJSON: bigints as {"$bigint": …}). */
const log = (...entries: { id: string; createdAt: number; amountWei?: bigint; chainId?: number; pool?: string }[]) =>
  serialize(entries.map((e) => ({ kind: "deposit", status: "confirmed", updatedAt: e.createdAt, amountWei: e.amountWei ?? 1n, ...e })));

/** The device log migrate.ts writes: the older plaintext key, which the first unlock encrypts (activityStore.ts). */
const deviceLog = (store: MemoryStorage) => deserialize<Record<string, unknown>[]>(store.getItem(DEVICE_KEYS.legacyActivity) ?? "[]");

describe("migrateLegacyStorage", () => {
  it("does nothing when a device vault exists, and counts the legacy vaults left for Forget", () => {
    const store = new MemoryStorage({
      [DEVICE_KEYS.vault]: "{}",
      [set(46630, POOL, "vault")]: v1A46630,
      [set(46630, POOL, "activity")]: log({ id: "a", createdAt: 1 }),
    });
    const before = store.snapshot();
    expect(migrateLegacyStorage(store, REGISTRY)).toEqual({ adopted: null, mergedLogs: 0, leftLegacyVaults: 1 });
    expect(store.snapshot()).toEqual(before);
  });

  it("adopts the legacy vault as it is, with its verified flag, and tags its log with its network", () => {
    const store = new MemoryStorage({
      [set(46630, POOL, "vault")]: v1A46630,
      [set(46630, POOL, "backupVerified")]: "true",
      [set(46630, POOL, "activity")]: log({ id: "old", createdAt: 100, amountWei: 5n * 10n ** 17n }, { id: "new", createdAt: 200 }),
      [set(46630, POOL, "events")]: '{"events":[],"lastBlock":{"$bigint":"9"}}',
      [set(46630, POOL, "pendingDeposits")]: "[]",
    });
    const res = migrateLegacyStorage(store, REGISTRY);
    expect(res).toEqual({ adopted: set(46630, POOL, "vault"), mergedLogs: 1, leftLegacyVaults: 0 });
    expect(store.getItem(DEVICE_KEYS.vault)).toBe(v1A46630); // a v1 blob until the next unlock
    expect(store.getItem(DEVICE_KEYS.backupVerified)).toBe("true");
    const entries = deviceLog(store);
    expect(entries.map((e) => e.id)).toEqual(["new", "old"]); // newest first
    expect(entries.every((e) => e.chainId === 46630 && e.pool === lower(POOL))).toBe(true);
    expect(entries[1].amountWei).toBe(5n * 10n ** 17n); // bigints survive in their stored form
    // the vault-bound legacy keys are gone; the per-pool keys keep their names (they need no move)
    for (const s of ["vault", "backupVerified", "activity"]) expect(store.getItem(set(46630, POOL, s))).toBeNull();
    expect(store.getItem(set(46630, POOL, "events"))).not.toBeNull();
    expect(store.getItem(set(46630, POOL, "pendingDeposits"))).toBe("[]");
  });

  it("prefers the registry's first pool, and leaves another vault's keys until Forget", () => {
    const store = new MemoryStorage({
      // inserted first, but Local chain B comes second in the registry
      [set(31338, POOL, "vault")]: v1B31338,
      [set(31338, POOL, "activity")]: log({ id: "b", createdAt: 5 }),
      [set(46630, POOL, "vault")]: v1A46630,
    });
    const res = migrateLegacyStorage(store, REGISTRY);
    expect(res).toEqual({ adopted: set(46630, POOL, "vault"), mergedLogs: 0, leftLegacyVaults: 1 });
    expect(store.getItem(DEVICE_KEYS.vault)).toBe(v1A46630);
    expect(store.getItem(DEVICE_KEYS.legacyActivity)).toBeNull(); // another vault's log is never merged
    expect(store.getItem(set(31338, POOL, "vault"))).toBe(v1B31338);
    expect(store.getItem(set(31338, POOL, "activity"))).not.toBeNull();
  });

  it("merges every legacy log of the same vault (same fingerprint), once per entry", () => {
    const store = new MemoryStorage({
      [set(31337, OLD_POOL, "vault")]: v1A31337,
      [set(31337, OLD_POOL, "activity")]: log({ id: "x", createdAt: 300 }, { id: "dup", createdAt: 50 }),
      [set(31337, OLD_POOL, "backupVerified")]: "false",
      [set(46630, POOL, "vault")]: v1A46630,
      [set(46630, POOL, "activity")]: log({ id: "y", createdAt: 100 }, { id: "dup", createdAt: 50 }),
    });
    const res = migrateLegacyStorage(store, REGISTRY);
    expect(res.adopted).toBe(set(46630, POOL, "vault"));
    expect(res.mergedLogs).toBe(2);
    expect(res.leftLegacyVaults).toBe(0);
    const entries = deviceLog(store);
    expect(entries.map((e) => e.id)).toEqual(["x", "y", "dup"]);
    expect(entries.find((e) => e.id === "x")).toMatchObject({ chainId: 31337, pool: lower(OLD_POOL) });
    expect(entries.find((e) => e.id === "y")).toMatchObject({ chainId: 46630, pool: lower(POOL) });
    // verified once for this seed is verified
    expect(store.getItem(DEVICE_KEYS.backupVerified)).toBe("false");
    expect(store.getItem(set(31337, OLD_POOL, "vault"))).toBeNull();
    expect(store.getItem(set(31337, OLD_POOL, "activity"))).toBeNull();
  });

  it("adopts a vault of a pool outside the registry when that is the only one (nothing is lost)", () => {
    const store = new MemoryStorage({ [set(31337, OLD_POOL, "vault")]: v1A31337 });
    expect(migrateLegacyStorage(store, REGISTRY).adopted).toBe(set(31337, OLD_POOL, "vault"));
    expect(store.getItem(DEVICE_KEYS.vault)).toBe(v1A31337);
  });

  it("deletes a legacy log that has no vault, and never adopts a blob that is not a backup", () => {
    const store = new MemoryStorage({
      [set(46630, POOL, "activity")]: log({ id: "orphan", createdAt: 1 }),
      [set(31338, POOL, "vault")]: "not json",
    });
    expect(migrateLegacyStorage(store, REGISTRY)).toEqual({ adopted: null, mergedLogs: 0, leftLegacyVaults: 1 });
    expect(store.getItem(set(46630, POOL, "activity"))).toBeNull();
    expect(store.getItem(set(31338, POOL, "vault"))).toBe("not json");
    expect(store.getItem(DEVICE_KEYS.vault)).toBeNull();
  });

  it("replaces a device log left without a device vault, and deletes an encrypted or set-aside one", () => {
    const store = new MemoryStorage({
      [DEVICE_KEYS.legacyActivity]: log({ id: "leftover", createdAt: 999, chainId: 46630, pool: POOL }),
      [DEVICE_KEYS.activity]: '{"format":"hylsia-activity","version":1,"iv":"AAAAAAAAAAAAAAAA","ct":"AAAAAAAAAAAAAAAAAAAAAA=="}',
      [DEVICE_KEYS.activityQuarantine]: "unreadable",
      [set(46630, POOL, "vault")]: v1A46630,
      [set(46630, POOL, "activity")]: log({ id: "mine", createdAt: 1 }),
    });
    migrateLegacyStorage(store, REGISTRY);
    expect(deviceLog(store).map((e) => e.id)).toEqual(["mine"]);
    // a leftover encrypted log is another (forgotten) vault's: it could never be read with the adopted vault's key
    expect(store.getItem(DEVICE_KEYS.activity)).toBeNull();
    expect(store.getItem(DEVICE_KEYS.activityQuarantine)).toBeNull();
  });

  it("leaves the encrypted log of an existing device vault alone (only the first unlock reads it)", () => {
    const store = new MemoryStorage({
      [DEVICE_KEYS.vault]: "{}",
      [DEVICE_KEYS.activity]: "sealed",
      [DEVICE_KEYS.legacyActivity]: log({ id: "older", createdAt: 1 }),
      [DEVICE_KEYS.activityQuarantine]: "set aside",
    });
    const before = store.snapshot();
    migrateLegacyStorage(store, REGISTRY);
    expect(store.snapshot()).toEqual(before);
  });

  it("changes nothing on an empty device, and a second run is a no-op", () => {
    const empty = new MemoryStorage({ "hylsia.pools.prefs.v3": "{}" });
    expect(migrateLegacyStorage(empty, REGISTRY)).toEqual({ adopted: null, mergedLogs: 0, leftLegacyVaults: 0 });
    expect(empty.snapshot()).toEqual({ "hylsia.pools.prefs.v3": "{}" });

    const store = new MemoryStorage({ [set(46630, POOL, "vault")]: v1A46630, [set(46630, POOL, "activity")]: log({ id: "a", createdAt: 1 }) });
    migrateLegacyStorage(store, REGISTRY);
    const after = store.snapshot();
    expect(migrateLegacyStorage(store, REGISTRY)).toEqual({ adopted: null, mergedLogs: 0, leftLegacyVaults: 0 });
    expect(store.snapshot()).toEqual(after);
  });

  it("writes nothing to the console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const store = new MemoryStorage({
      [set(46630, POOL, "vault")]: v1A46630,
      [set(31338, POOL, "vault")]: v1B31338,
      [set(31337, OLD_POOL, "vault")]: "broken",
      [set(1, OLD_POOL, "activity")]: "also broken",
    });
    migrateLegacyStorage(store, REGISTRY);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("the adopted v1 blob unlocks without a network context, and re-encrypts as v2 with the same fingerprint", async () => {
    const store = new MemoryStorage({ [set(31337, OLD_POOL, "vault")]: v1A31337 });
    migrateLegacyStorage(store, REGISTRY);
    const stored = parseBackup(store.getItem(DEVICE_KEYS.vault)!);
    expect(stored.version).toBe(1);
    const seed = await decryptSeed(stored, PASSWORD); // no expected chain or pool: any network's vault opens
    expect(seedFingerprint(seed)).toBe(stored.fingerprint);
    const v2 = await encryptSeedV2(seed, PASSWORD, ITER);
    expect(v2.version).toBe(2);
    expect(v2.fingerprint).toBe(stored.fingerprint);
    expect(JSON.stringify(v2)).not.toMatch(/chainId|pool|31337|46630/); // a v2 file names no network
    expect(await decryptSeed(v2, PASSWORD)).toEqual(seed);
  });
});

describe("forgetDeviceStorage", () => {
  it("removes every vault, activity and pending key under hylsia.pp., keeps public caches and other settings", () => {
    const store = new MemoryStorage({
      [DEVICE_KEYS.vault]: "{}",
      [DEVICE_KEYS.backupVerified]: "true",
      [DEVICE_KEYS.activity]: "{}", // encrypted (v3)
      [DEVICE_KEYS.legacyActivity]: "[]", // plaintext (v2), not moved yet
      [DEVICE_KEYS.activityQuarantine]: "{}", // set aside
      [set(46630, POOL, "pendingDeposits")]: "[]",
      [set(31338, POOL, "pendingDeposits")]: "[]",
      [set(31337, OLD_POOL, "vault")]: "{}",
      [set(31337, OLD_POOL, "backupVerified")]: "true",
      [set(31337, OLD_POOL, "activity")]: "[]",
      [set(31337, OLD_POOL, "pendingDeposits")]: "[]",
      "hylsia.pp.46630.nopool.activity": "[]",
      [set(46630, POOL, "events")]: "{}",
      [set(31338, POOL, "events")]: "{}",
      "hylsia.pools.wagmi.store": "{}",
      "hylsia.pools.prefs.v3": "{}",
      "hylsia.pools.sidebarCollapsed": "1",
      theme: "dark",
    });
    expect(forgetDeviceStorage(store)).toBe(12);
    expect(Object.keys(store.snapshot()).sort()).toEqual(
      [set(31338, POOL, "events"), set(46630, POOL, "events"), "hylsia.pools.prefs.v3", "hylsia.pools.sidebarCollapsed", "hylsia.pools.wagmi.store", "theme"].sort(),
    );
  });

  it("is safe on an empty device", () => {
    expect(forgetDeviceStorage(new MemoryStorage())).toBe(0);
  });
});

describe("clearPendingDeposits", () => {
  it("removes every pool's reservations and nothing else", () => {
    const store = new MemoryStorage({
      [set(46630, POOL, "pendingDeposits")]: "[]",
      [set(31337, OLD_POOL, "pendingDeposits")]: "[]",
      [DEVICE_KEYS.vault]: "{}",
      [set(46630, POOL, "events")]: "{}",
    });
    expect(clearPendingDeposits(store)).toBe(2);
    expect(Object.keys(store.snapshot()).sort()).toEqual([DEVICE_KEYS.vault, set(46630, POOL, "events")].sort());
  });
});
