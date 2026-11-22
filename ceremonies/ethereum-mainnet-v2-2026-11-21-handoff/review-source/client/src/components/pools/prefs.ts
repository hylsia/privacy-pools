/**
 * Persisted view settings of the /pools table (interval, sort, visible columns, network), per browser.
 *
 * There is no currency setting: testnet ETH has no market value, so every dashboard page shows ETH.
 * (The old "hylsia.pools.currency" entry is simply no longer read.)
 *
 * `network` is the Pools table's view filter, "all" or one network this build offers. It is a view preference of the
 * public table only: the vault's active network is never stored.
 */
import { PRIVACY_NETWORKS } from "@/privacy/config";
import { COLUMNS, INTERVALS, SORTS, type ColumnKey, type Interval, type SortDir, type SortKey } from "./types";

const KEY = "hylsia.pools.prefs.v3";
/** v2 used the liquidity-style column names; read once and translated, so a reader keeps their view. */
const V2_KEY = "hylsia.pools.prefs.v2";
const V2_NAMES: Record<string, string> = { chart: "trend", tvl: "balance", volume: "activity", netflow: "net" };

/** "all", or the chain id of one network this build offers. */
export type NetworkFilterValue = "all" | number;

export interface PoolsPrefs {
  interval: Interval;
  sort: SortKey;
  dir: SortDir;
  columns: ColumnKey[];
  network: NetworkFilterValue;
}

/** Withdrawals and the relayer fee already show as chips under the pool name, so their columns start hidden. */
const DEFAULT_COLUMNS: ColumnKey[] = ["anonymity", "trend", "balance", "activity", "net", "age", "status"];
export const DEFAULT_PREFS: PoolsPrefs = { interval: "24h", sort: "anonymity", dir: "desc", columns: DEFAULT_COLUMNS, network: "all" };

/**
 * A stored network filter, kept only when it names a network this build offers and there is more than one to choose
 * from (with one network the filter is not shown). Anything else, an unknown or a local chain from another build
 * included, reads as "all".
 */
export function sanitizeNetworkFilter(v: unknown, offered: readonly number[] = PRIVACY_NETWORKS.map((n) => n.network.chainId)): NetworkFilterValue {
  return offered.length > 1 && typeof v === "number" && offered.includes(v) ? v : "all";
}

/** Anything stored (old, edited or corrupted) becomes valid settings; unknown values fall back to the defaults. */
function sanitize(stored: unknown, rename: (key: unknown) => unknown = (k) => k): PoolsPrefs {
  if (!stored || typeof stored !== "object") return DEFAULT_PREFS;
  const p = stored as Record<string, unknown>;
  const sort = rename(p.sort);
  const columns = Array.isArray(p.columns) ? new Set(p.columns.map(rename)) : null;
  return {
    interval: INTERVALS.includes(p.interval as Interval) ? (p.interval as Interval) : DEFAULT_PREFS.interval,
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : DEFAULT_PREFS.sort,
    dir: p.dir === "asc" ? "asc" : "desc",
    // canonical order, no duplicates
    columns: columns ? COLUMNS.map((c) => c.key).filter((k) => columns.has(k)) : DEFAULT_PREFS.columns,
    network: sanitizeNetworkFilter(p.network),
  };
}

export function loadPrefs(): PoolsPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return sanitize(JSON.parse(raw));
    const v2 = localStorage.getItem(V2_KEY);
    if (v2 !== null) return sanitize(JSON.parse(v2), (k) => (typeof k === "string" ? (V2_NAMES[k] ?? k) : k));
  } catch {
    /* blocked storage or unreadable JSON */
  }
  return DEFAULT_PREFS;
}

export function savePrefs(p: PoolsPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
