/**
 * Pools explorer data: per-pool statistics computed from public chain data only
 * (events + block timestamps + balances). No user secrets are involved. Each pool also says whether the server's
 * relayer and association-set publisher can act on it now (server/privacy/funding.ts), the same for every visitor.
 *
 * Every served pool is read on its own chain, with its own block times and head time (`now`), and every answer
 * that covers all pools lists each pool separately: figures are never summed or merged across networks. A pool
 * whose chain fails is listed under `unavailable` and the others answer; a network without a pool makes no RPC call.
 */
import { TRPCError } from "@trpc/server";
import { zeroAddress, type Address } from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import type { NetworksAnswer, NetworkStatus, PoolActivityAnswer, PoolServices, PoolsAnswer } from "../../shared/privacy/api";
import { associationSetLabels, buildAssociationSet, prefixSizes } from "../../shared/privacy/associationSet";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import { isStandardAmount } from "../../shared/privacy/guidance";
import { poolKey } from "../../shared/privacy/networks";
import { isScreenedCid, parseRecipe, recipeMemberCount } from "../../shared/privacy/screening";
import type { ASPRootUpdatedEvent, PoolEvent } from "../../shared/privacy/types";
import {
  ensurePoolContract,
  getScreenedSet,
  logPoolFailure,
  onPoolReset,
  PoolUnavailableError,
  settlePools,
  unavailableReason,
  usablePool,
  verifiedCurrent,
  withPoolDeadline,
} from "./asp";
import { blockTimestamps, resetBlockTimes } from "./blockTimes";
import { readExclusions } from "./exclusions";
import { getPublicClient } from "./chain";
import { chainConfig, privacyConfig, type PrivacyChainConfig } from "./config";
import { publisherServices, readFunding, relayerServices } from "./funding";
import { relayerAddress } from "./relayer";

export const POOL_INTERVALS = { "1h": 3_600, "4h": 14_400, "12h": 43_200, "24h": 86_400, "7d": 604_800, "30d": 2_592_000 } as const;
export type PoolInterval = keyof typeof POOL_INTERVALS;

const SPARK_BUCKETS = 24;
const DETAIL_BUCKETS = 60;
const ACTIVITY_CAP = 1_000;
/** one `load()` per pool at most every 5 s, shared by every caller (pools, poolActivity, poolDetail) */
const LOAD_MEMO_MS = 5_000;
/** privacy.networks is the landing's request: one answer per process every 10 s */
const NETWORKS_CACHE_MS = 10_000;

export interface PoolActivity {
  kind: "deposit" | "withdraw" | "ragequit";
  value: bigint;
  fee: bigint;
  /** depositor for deposits/ragequits, recipient for withdrawals (all public on-chain) */
  account: Address;
  relayer: Address | null;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: number;
}

/**
 * One pool's public statistics. With PoolServices: whether the server's relayer and publisher can act on it now (the
 * same for every visitor; a balance that could not be read counts as funded).
 */
export interface PoolSummary extends PoolServices {
  chainId: number;
  pool: Address;
  asset: "ETH";
  scope: bigint;
  owner: Address;
  aspPostman: Address;
  deployBlock: bigint;
  deployedAt: number | null;
  dead: boolean;
  minDeposit: bigint;
  tvl: bigint;
  leafCount: number;
  deposits: number;
  withdrawals: number;
  ragequits: number;
  uniqueDepositors: number;
  /**
   * The anonymity set: the members of the pool's current association-set root, the only root private withdrawals are
   * proved in (the list rebuilt from the root's recipe and the public deposits, and checked against the root; 0 before
   * the first root, or while the current root does not verify).
   */
  aspRootMembers: number;
  /**
   * The members of the screening policy's snapshot: the root the publisher would post now. It can be above
   * aspRootMembers (newer deposits that passed the inclusion delay wait for the next root) or below it (a removal
   * waits for the next root): never show the difference as "newer deposits" when it is negative.
   */
  aspMembers: number;
  aspRootPublished: boolean;
  depositedTotal: bigint;
  withdrawnTotal: bigint;
  feesPaid: bigint;
  interval: PoolInterval;
  intervalDeposits: bigint;
  intervalWithdrawals: bigint;
  intervalCount: number;
  /** SPARK_BUCKETS buckets of (deposits - exits) value over the interval, oldest first */
  netFlow: string[];
  /** TVL at the end of each bucket, oldest first */
  tvlSeries: string[];
  relayer: Address | null;
  relayerFeeBps: number;
  /** the relayer's minimum fee in wei (0: none); a withdrawal pays the larger of the two */
  relayerMinFeeWei: bigint;
  recent: PoolActivity[];
}

export interface SeriesPoint {
  /** bucket end (unix seconds) */
  t: number;
  tvl: bigint;
  deposited: bigint;
  exited: bigint;
  /** the anonymity set at bucket end: the members of the newest association-set root posted by then (its recipe's count) */
  members: number;
  count: number;
}

export interface PrivacyHealth {
  /** deposits whose exact amount was used by no other deposit (easier to correlate) */
  uniqueAmountDeposits: number;
  /** withdrawals whose exact amount equals some earlier deposit amount */
  exactMatchWithdrawals: number;
  /** withdrawals sent to an address that also deposited */
  recipientIsDepositor: number;
  /** withdrawals not submitted through a relayer (fee 0, relayer unset) */
  selfRelayed: number;
  /** share of deposits and withdrawals in a standard amount (the vault forms' ladder, STANDARD_AMOUNTS); 1 when there are none */
  standardAmountShare: number;
}

export interface PoolDetail {
  now: number;
  pool: PoolSummary;
  series: SeriesPoint[];
  activity: PoolActivity[];
  activityTruncated: boolean;
  aspUpdates: { root: bigint; cid: string; timestamp: number; txHash: `0x${string}` }[];
  health: PrivacyHealth;
}

function activityOf(e: PoolEvent, ts: number): PoolActivity | null {
  const base = { txHash: e.txHash, blockNumber: e.blockNumber, timestamp: ts };
  switch (e.kind) {
    case "deposit":
      return { kind: "deposit", value: e.value, fee: 0n, account: e.depositor, relayer: null, ...base };
    case "withdraw":
      return {
        kind: "withdraw",
        value: e.value,
        fee: e.fee,
        account: e.recipient,
        relayer: e.relayer === "0x0000000000000000000000000000000000000000" ? null : e.relayer,
        ...base,
      };
    case "ragequit":
      return { kind: "ragequit", value: e.value, fee: 0n, account: e.ragequitter, relayer: null, ...base };
    default:
      return null;
  }
}

const signed = (a: PoolActivity) => (a.kind === "deposit" ? a.value : -a.value);

/** The anonymity set from a point in time on: it changes only when a root is published. */
interface CrowdStep {
  timestamp: number;
  members: number;
}

/** the open policy's prefix sizes of one events array (root → size), built once: only for pools with legacy roots */
const legacySizes = new WeakMap<readonly PoolEvent[], Map<bigint, number>>();

function legacyPrefixSizes(events: readonly PoolEvent[]): Map<bigint, number> {
  let sizes = legacySizes.get(events);
  if (!sizes) {
    sizes = prefixSizes(buildAssociationSet(associationSetLabels(events)));
    legacySizes.set(events, sizes);
  }
  return sizes;
}

/**
 * The crowd after each root update, oldest first: a screened root's recipe count (n minus its exclusions: the
 * operator's claim, which devices check before they prove; the headline aspRootMembers is the checked size); an
 * open-policy root's prefix size; 0 for an open-policy root posted after a screened one (devices refuse it) or a root
 * that is neither.
 */
function crowdSteps(events: readonly PoolEvent[], timeOf: (block: bigint) => number | undefined, now: number): CrowdStep[] {
  const updates = events
    .filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot" && e.root !== 0n)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  let screenedBefore = false;
  return updates.map((u) => {
    let members = 0;
    if (isScreenedCid(u.cid)) {
      const r = parseRecipe(u.cid);
      members = r && r.version === 1 ? recipeMemberCount(r) : 0;
      screenedBefore = true;
    } else if (!screenedBefore) {
      members = legacyPrefixSizes(events).get(u.root) ?? 0;
    }
    return { timestamp: timeOf(u.blockNumber) ?? now, members };
  });
}

interface Loaded {
  chainId: number;
  pool: Address;
  /** that chain's head time (unix seconds) */
  now: number;
  events: readonly PoolEvent[];
  activity: PoolActivity[];
  /** oldest first */
  crowd: CrowdStep[];
  /** that chain's block times */
  timeOf: (block: bigint) => number | undefined;
  summaryBase: Omit<
    PoolSummary,
    "interval" | "intervalDeposits" | "intervalWithdrawals" | "intervalCount" | "netFlow" | "tvlSeries" | "recent"
  >;
}

/** Server clock in unix seconds: the "now" of the pending state, which needs no chain read. */
const serverNow = () => Math.floor(Date.now() / 1000);

async function load(cfg: PrivacyChainConfig): Promise<Loaded> {
  // the contract check first: nothing is read from a contract that is not this pool on this chain
  const { pool, deployBlock } = await ensurePoolContract(cfg.chainId);
  const chainId = cfg.chainId;
  const client = getPublicClient(chainId);
  const head = await client.getBlock();
  const now = Number(head.timestamp);
  const read = <T>(functionName: string) =>
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: functionName as never }) as Promise<T>;

  // the events come with the screening snapshot (one sync shared with the publisher's view of this pool)
  const [screened, scope, owner, aspPostman, dead, minDeposit, nextIndex, aspRoot, tvl, funding] = await Promise.all([
    getScreenedSet({ chainId }),
    read<bigint>("SCOPE"),
    read<Address>("owner"),
    read<Address>("aspPostman"),
    read<boolean>("dead"),
    read<bigint>("minDeposit"),
    read<number>("nextIndex"),
    read<bigint>("currentASPRoot"),
    client.getBalance({ address: pool }),
    // the relayer's and publisher's balances (cached 30 s, the same for every visitor; unknown when the read fails)
    readFunding(chainId),
  ]);

  const events = screened.events;
  const timeOf = await blockTimestamps(chainId, [...events.map((e) => e.blockNumber), ...(deployBlock > 0n ? [deployBlock] : [])]);
  const activity = events
    .map((e) => activityOf(e, timeOf(e.blockNumber) ?? now))
    .filter((a): a is PoolActivity => a !== null);
  const deposits = activity.filter((a) => a.kind === "deposit");
  const exits = activity.filter((a) => a.kind !== "deposit");
  const deployedAt = deployBlock > 0n ? (timeOf(deployBlock) ?? null) : (activity[0]?.timestamp ?? null);

  // The anonymity set is the crowd of the current association-set root, the only root a private withdrawal is proved
  // in (shared/privacy/associationSet.ts), not the snapshot's count: the root on-chain can lag behind the snapshot,
  // or still hold a deposit whose removal waits for the next root. The headline is checked here the way a device
  // checks it (the list rebuilt from the root's recipe and the public deposits); the series reads each root's recipe.
  const crowd = crowdSteps(events, timeOf, now);
  const current = verifiedCurrent(screened);

  return {
    chainId,
    pool,
    now,
    events,
    activity,
    crowd,
    timeOf,
    summaryBase: {
      chainId,
      pool,
      asset: "ETH",
      scope,
      owner,
      aspPostman,
      deployBlock,
      deployedAt,
      dead,
      minDeposit,
      tvl,
      leafCount: Number(nextIndex),
      deposits: deposits.length,
      withdrawals: activity.filter((a) => a.kind === "withdraw").length,
      ragequits: activity.filter((a) => a.kind === "ragequit").length,
      uniqueDepositors: new Set(deposits.map((a) => a.account.toLowerCase())).size,
      aspRootMembers: screened.currentRoot !== 0n && current ? current.memberCount : 0,
      aspMembers: screened.snapshot.memberCount,
      aspRootPublished: aspRoot !== 0n,
      depositedTotal: deposits.reduce((s, a) => s + a.value, 0n),
      withdrawnTotal: exits.reduce((s, a) => s + a.value, 0n),
      feesPaid: exits.reduce((s, a) => s + a.fee, 0n),
      relayer: relayerAddress(chainId),
      relayerFeeBps: cfg.relayerFeeBps,
      relayerMinFeeWei: cfg.relayerMinFeeWei,
      ...relayerServices(cfg, funding),
      // publishing paused (an invalid exclusion list, say) is reported like a publisher that cannot post
      ...(screened.policyError !== null ? PAUSED : publisherServices(cfg, aspPostman, funding)),
    },
  };
}

/** The publisher's side of PoolServices while publishing is paused (asp.ts policy_error): nothing is posted. */
const PAUSED: Pick<PoolServices, "aspCanPublish" | "aspPublishBlock"> = Object.freeze({ aspCanPublish: false, aspPublishBlock: "policy_error" });

interface LoadMemo {
  promise: Promise<Loaded>;
  /** null while in flight */
  settledAt: number | null;
}
const loads = new Map<string, LoadMemo>();

/** load(), single-flight per pool and memoized for 5 s after it settles (a failure too: a down RPC is not hammered). */
function loadPool(cfg: PrivacyChainConfig): Promise<Loaded> {
  const key = poolKey(cfg.chainId, usablePool(cfg.chainId).pool);
  const hit = loads.get(key);
  if (hit && (hit.settledAt === null || Date.now() - hit.settledAt < LOAD_MEMO_MS)) return hit.promise;
  const memo: LoadMemo = { promise: load(cfg), settledAt: null };
  const settle = () => {
    memo.settledAt = Date.now();
  };
  memo.promise.then(settle, settle);
  loads.set(key, memo);
  return memo.promise;
}

interface Bucketed {
  intervalDeposits: bigint;
  intervalWithdrawals: bigint;
  intervalCount: number;
  points: SeriesPoint[];
}

function bucketize(activity: PoolActivity[], crowd: CrowdStep[], now: number, span: number, buckets: number): Bucketed {
  const start = now - span;
  const size = span / buckets;
  const points: SeriesPoint[] = Array.from({ length: buckets }, (_, i) => ({
    t: Math.round(start + size * (i + 1)),
    tvl: 0n,
    deposited: 0n,
    exited: 0n,
    members: 0,
    count: 0,
  }));
  let tvlBefore = 0n;
  let intervalDeposits = 0n;
  let intervalWithdrawals = 0n;
  let intervalCount = 0;
  for (const a of activity) {
    if (a.timestamp < start) {
      tvlBefore += signed(a);
      continue;
    }
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((a.timestamp - start) / size)));
    const p = points[idx];
    p.count++;
    intervalCount++;
    if (a.kind === "deposit") {
      p.deposited += a.value;
      intervalDeposits += a.value;
    } else {
      p.exited += a.value;
      intervalWithdrawals += a.value;
    }
  }
  let tvl = tvlBefore;
  let step = 0; // crowd steps in force by the end of the current bucket
  for (const p of points) {
    tvl += p.deposited - p.exited;
    p.tvl = tvl;
    while (step < crowd.length && crowd[step].timestamp <= p.t) step++;
    p.members = step > 0 ? crowd[step - 1].members : 0;
  }
  return { intervalDeposits, intervalWithdrawals, intervalCount, points };
}

function summarize(l: Loaded, interval: PoolInterval): PoolSummary {
  const b = bucketize(l.activity, l.crowd, l.now, POOL_INTERVALS[interval], SPARK_BUCKETS);
  return {
    ...l.summaryBase,
    interval,
    intervalDeposits: b.intervalDeposits,
    intervalWithdrawals: b.intervalWithdrawals,
    intervalCount: b.intervalCount,
    netFlow: b.points.map((p) => (p.deposited - p.exited).toString()),
    tvlSeries: b.points.map((p) => p.tvl.toString()),
    recent: l.activity.slice(-25).reverse(),
  };
}

/** The pool page's privacy-health heuristics, from public activity only. */
export function privacyHealth(activity: readonly PoolActivity[]): PrivacyHealth {
  const deposits = activity.filter((a) => a.kind === "deposit");
  const withdrawals = activity.filter((a) => a.kind === "withdraw");
  const amountCount = new Map<string, number>();
  for (const d of deposits) amountCount.set(d.value.toString(), (amountCount.get(d.value.toString()) ?? 0) + 1);
  const depositors = new Set(deposits.map((d) => d.account.toLowerCase()));
  let exactMatch = 0;
  for (const w of withdrawals) {
    if (deposits.some((d) => d.timestamp <= w.timestamp && d.value === w.value)) exactMatch++;
  }
  const all = [...deposits, ...withdrawals];
  return {
    uniqueAmountDeposits: deposits.filter((d) => amountCount.get(d.value.toString()) === 1).length,
    exactMatchWithdrawals: exactMatch,
    recipientIsDepositor: withdrawals.filter((w) => depositors.has(w.account.toLowerCase())).length,
    selfRelayed: withdrawals.filter((w) => w.relayer === null).length,
    standardAmountShare: all.length ? all.filter((a) => isStandardAmount(a.value)).length / all.length : 1,
  };
}

/**
 * privacy.pools: one summary per served pool, each with its own chain's head time; `networks` lists every served
 * network (pool null: not deployed yet). Sizes are each pool's own and never summed.
 */
export async function listPools(interval: PoolInterval): Promise<PoolsAnswer> {
  const { chains } = privacyConfig();
  const { ok, unavailable } = await settlePools("pools", loadPool);
  return {
    now: serverNow(),
    networks: chains.map((c) => ({ chainId: c.chainId, pool: c.pool })),
    pools: ok.map((l) => ({ ...summarize(l, interval), now: l.now })),
    unavailable,
  };
}

/**
 * One pool, by chain AND address: time series, full public activity, ASP root history, privacy-health heuristics.
 * A pair this server does not serve: NOT_FOUND "No privacy pool at <addr> on <name> (<id>)", without an RPC call.
 */
export async function getPoolDetail(chainId: number, address: Address, interval: PoolInterval): Promise<PoolDetail> {
  const cfg = chainConfig(chainId);
  if (!cfg.pool || cfg.pool.toLowerCase() !== address.toLowerCase()) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No privacy pool at ${address} on ${cfg.network.name} (${cfg.chainId})` });
  }
  let l: Loaded;
  try {
    // the deadline keeps a hung RPC from holding the page past the host's limit; a cold scan keeps its progress
    l = await withPoolDeadline(cfg, loadPool(cfg));
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    logPoolFailure(cfg, "poolDetail", err);
    throw new PoolUnavailableError(cfg, "rpc_error");
  }
  const span = POOL_INTERVALS[interval];
  const b = bucketize(l.activity, l.crowd, l.now, span, DETAIL_BUCKETS);
  const aspUpdates = l.events
    .filter((e): e is Extract<PoolEvent, { kind: "asproot" }> => e.kind === "asproot")
    .map((e) => ({ root: e.root, cid: e.cid, timestamp: l.timeOf(e.blockNumber) ?? l.now, txHash: e.txHash }))
    .reverse();
  const activity = [...l.activity].reverse();
  return {
    now: l.now,
    pool: summarize(l, interval),
    series: b.points,
    activity: activity.slice(0, ACTIVITY_CAP),
    activityTruncated: activity.length > ACTIVITY_CAP,
    aspUpdates,
    health: privacyHealth(l.activity),
  };
}

/**
 * Public activity only: deposits and exits with amounts and times, one list per served pool with that chain's head
 * time. The vault fetches it for every visitor alike (no parameters) and dates the deposits of its privacy check
 * with the entry of its active pool only (chain AND address); My notes dates its history.
 */
export async function getPoolActivity(): Promise<PoolActivityAnswer> {
  const { ok, unavailable } = await settlePools("poolActivity", loadPool);
  return {
    now: serverNow(),
    pools: ok.map((l) => ({ chainId: l.chainId, pool: l.pool, now: l.now, activity: l.activity })),
    unavailable,
  };
}

async function networkStatus(cfg: PrivacyChainConfig): Promise<NetworkStatus> {
  const chainId = cfg.chainId;
  if (!cfg.pool && cfg.problems.length === 0) return { chainId, configured: false };
  // an invalid configured address has no pool to name: the zero address stands in (problems never read as "not deployed")
  const pool = cfg.pool ?? zeroAddress;
  if (cfg.problems.length > 0) return { chainId, configured: true, available: false, pool, reason: "config_error" };
  try {
    // within the pool deadline: one hung RPC must not hold the landing's answer for every network
    const { deployBlock, scope, lastRoot, aspRoot, nextIndex, dead, minDeposit, poolBalance, aspPostman, funding } = await withPoolDeadline(
      cfg,
      (async () => {
        const { deployBlock } = await ensurePoolContract(chainId);
        const client = getPublicClient(chainId);
        const read = <T>(functionName: string) =>
          client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: functionName as never }) as Promise<T>;
        const [scope, lastRoot, aspRoot, nextIndex, dead, minDeposit, poolBalance, aspPostman, funding] = await Promise.all([
          read<bigint>("SCOPE"),
          read<bigint>("getLastRoot"),
          read<bigint>("currentASPRoot"),
          read<number>("nextIndex"),
          read<boolean>("dead"),
          read<bigint>("minDeposit"),
          client.getBalance({ address: pool }),
          read<Address>("aspPostman"),
          // the relayer's and publisher's balances (cached 30 s, the same for every visitor; unknown when the read fails)
          readFunding(chainId),
        ]);
        return { deployBlock, scope, lastRoot, aspRoot, nextIndex, dead, minDeposit, poolBalance, aspPostman, funding };
      })(),
    );
    return {
      chainId,
      configured: true,
      available: true,
      pool,
      deployBlock,
      scope,
      lastRoot,
      aspRoot,
      leafCount: BigInt(nextIndex),
      dead,
      minDeposit,
      poolBalance,
      relayer: relayerAddress(chainId),
      relayerFeeBps: cfg.relayerFeeBps,
      ...relayerServices(cfg, funding),
      // the landing's answer reads no events: an invalid exclusion list is the pause it can see (privacy.pools and
      // privacy.asp.status report every cause)
      ...(readExclusions(privacyConfig().aspExclusions).status === "invalid" ? PAUSED : publisherServices(cfg, aspPostman, funding)),
    };
  } catch (err) {
    logPoolFailure(cfg, "networks", err);
    return { chainId, configured: true, available: false, pool, reason: unavailableReason(err) };
  }
}

let networksMemo: { promise: Promise<NetworksAnswer>; settledAt: number | null } | null = null;

/** privacy.networks: one status per served network, in registry order, cached for 10 s (the landing's request). */
export function getNetworks(): Promise<NetworksAnswer> {
  const hit = networksMemo;
  if (hit && (hit.settledAt === null || Date.now() - hit.settledAt < NETWORKS_CACHE_MS)) return hit.promise;
  const memo: { promise: Promise<NetworksAnswer>; settledAt: number | null } = {
    promise: Promise.resolve().then(async () => ({
      protocol: privacyConfig().protocol,
      networks: await Promise.all(privacyConfig().chains.map(networkStatus)),
    })),
    settledAt: null,
  };
  const settle = () => {
    memo.settledAt = Date.now();
  };
  memo.promise.then(settle, () => {
    if (networksMemo === memo) networksMemo = null; // a configuration error is not cached
  });
  networksMemo = memo;
  return memo.promise;
}

// A pool whose chain no longer matches what was read from it (a local chain restarted or reverted, a regenesis): its
// block numbers now name other blocks, so its memoized answers go with the rest (asp.ts drops its block times).
onPoolReset((chainId, pool) => {
  loads.delete(poolKey(chainId, pool));
  networksMemo = null;
});

/** test hook: block times (server/privacy/blockTimes.ts), the load memo and the networks cache */
export function resetPoolCaches() {
  resetBlockTimes();
  loads.clear();
  networksMemo = null;
}
