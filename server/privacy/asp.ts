/**
 * Association-set publisher (ASP), screening policy v1, and the per-pool runtime the relayer and the pools explorer
 * share with it.
 *
 * The policy (shared/privacy/screening.ts, the same code the device checks every root with):
 *   - a deposit is considered once it has the network's `aspConfirmations` confirmations and its block time plus the
 *     network's inclusion delay (`aspInclusionDelaySeconds`; 3600 s on Robinhood Chain Testnet, 0 on local chains) is at
 *     or before the snapshot head's time; deposits are considered in state-tree leaf order, and the count considered
 *     (n) never decreases;
 *   - the considered deposits that the operator's exclusion list names (by label or depositing address,
 *     server/privacy/exclusions.ts) are excluded: their leaves (x) are listed in the root's record;
 *   - the members are the first n deposits minus x; the root is their Poseidon Merkle root; its cid is the recipe
 *     "hylsia-asp:v1;n=…;x=…;asOf=…;t=…;delay=…;conf=…", so anyone holding the public events rebuilds the list of every
 *     root without asking anyone. A removed member leaves with the next root; the last member's removal posts the
 *     empty tree's root.
 * It is a testnet policy, public and reproducible; it is not a legal clearance.
 *
 * The publisher:
 *   - builds each pool's snapshot from that chain's events and block times (public data only) and the exclusion list;
 *   - posts the snapshot's root when it differs from the root on-chain (`rootDue`), or once more when the root
 *     on-chain is the same but its record demonstrably does not match it (a repair, at most once per root value and
 *     process), or does not list an exclusion the snapshot adds (a record: the newest deposit, listed before it became
 *     eligible, changes no member, so only a record puts its exclusion on-chain; once per root, exclusions and process).
 *     It posts when it holds the postman key and the postman can pay for one publish: on a fixed schedule in
 *     the long-running server (server/privacy/autoPublish.ts; also right after the operator adds an exclusion), on one
 *     label-free, input-less request that a device sends before a private withdrawal whenever the operator's answer
 *     says a root is due (the same for every withdrawal, whichever deposit and network it spends), or via
 *     `npm run zk:asp:publish`;
 *   - pauses (policy_error, nothing sent) while the exclusion list is missing or invalid, when a root would exclude more
 *     deposits than its record can list, when the chain already holds a newer screening policy than this code knows,
 *     or when its own snapshot fails its own check;
 *   - answers privacy.asp.status with the screening block (the policy, the snapshot, the root on-chain as the server
 *     checks it, rootDue and the excluded deposits with their reason codes), the same for every visitor, and serves
 *     the current root's { root, cid } in privacy.asp.set for devices whose log RPC is behind.
 * It never serves the proof of one label: that request would tell the server which deposit is being spent. Devices
 * build their own proofs, against the current root only, after rebuilding its list from their own events.
 *
 * Every pool is keyed by its chain AND its address (`${chainId}:${pool}`): the same deployer gives the same pool
 * address on two networks. Per pool: one event cache and in-flight sync, one contract check, one snapshot memo, one
 * status memo, one publish single-flight and one pending-publish record. A network without a pool gets no RPC call.
 */
import { TRPCError } from "@trpc/server";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Address,
  type Hex,
} from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import type {
  ASPScreening,
  ASPStatusAnswer,
  ASPStatusEntry,
  AssociationSetsAnswer,
  PoolUnavailable,
  PoolUnavailableReason,
  PublicAssociationSetEntry,
  PublisherBlock,
  PublishResult,
  PublishStatus,
} from "../../shared/privacy/api";
import { fetchPoolEvents, headRegression, mergePoolEvents, nextScanRange, SCAN_CONCURRENCY } from "../../shared/privacy/indexer";
import { poolKey } from "../../shared/privacy/networks";
import {
  ASP_POLICY_VERSION,
  blocksNeedingTime,
  checkCurrentRoot,
  checkRoot,
  considerationFloor,
  depositOf,
  depositsInLeafOrder,
  exclusionMatcher,
  highestPolicyVersion,
  MAX_RECIPE_EXCLUSIONS,
  newlyListedLeaves,
  readmittedLeaves,
  rootDueFor,
  rootRecordOf,
  screenDeposits,
  verifySet,
  type RootCheck,
  type RootRecord,
  type ScreeningSnapshot,
  type VerifiedSet,
} from "../../shared/privacy/screening";
import type { ASPRootUpdatedEvent, PoolEvent } from "../../shared/privacy/types";
import { blockTimestamps, forgetBlockTimes, headTimestamp, resetBlockTimes } from "./blockTimes";
import { getPublicClient, makeWalletClient } from "./chain";
import { chainConfig, privacyConfig, type PrivacyChainConfig } from "./config";
import { isV2Protocol, V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import { PRIVACY_POOL_V2_ABI } from "../../shared/privacy/v2/abi";
import { describeError, isInsufficientFunds } from "./errors";
import { EXCLUSIONS_SETTLE_SECONDS, readExclusions, resetExclusionsCache, type ExclusionsState } from "./exclusions";
import { forgetFunding, publisherServices, readFunding, resetFundingCache } from "./funding";

export { describeError };

// ─── unavailable pools ────────────────────────────────────────────────────────

const UNAVAILABLE_TEXT: Record<PoolUnavailableReason, string> = {
  rpc_error: "its RPC node did not answer",
  config_error: "this server's configuration for it has a problem",
  contract_check_failed: "the contract at its address is not this pool",
  wrong_chain: "its RPC node serves another chain",
};

/** A served pool that cannot be used right now. Calls that cover every pool list it under `unavailable` instead. */
export class PoolUnavailableError extends TRPCError {
  readonly chainId: number;
  readonly pool: Address | null;
  readonly reason: PoolUnavailableReason;
  constructor(cfg: PrivacyChainConfig, reason: PoolUnavailableReason) {
    super({
      code: reason === "rpc_error" ? "INTERNAL_SERVER_ERROR" : "PRECONDITION_FAILED",
      message: `The privacy pool on ${cfg.network.name} (${cfg.chainId}) is unavailable right now: ${UNAVAILABLE_TEXT[reason]}`,
    });
    this.name = "PoolUnavailableError";
    this.chainId = cfg.chainId;
    this.pool = cfg.pool;
    this.reason = reason;
  }
}

/** A pool that did not answer within the deadline of a call that covers every pool: rpc_error. */
export class PoolDeadlineError extends PoolUnavailableError {
  constructor(cfg: PrivacyChainConfig, ms: number) {
    super(cfg, "rpc_error");
    this.name = "PoolDeadlineError";
    this.message = `The privacy pool on ${cfg.network.name} (${cfg.chainId}) is unavailable right now: its RPC node did not answer within ${Math.round(ms / 1000)} s`;
  }
}

const POOL_DEADLINE_MS = 8_000;
let poolDeadlineMs = POOL_DEADLINE_MS;

/** test hook: the per-pool deadline (null restores 8 s) */
export function setPoolDeadlineMs(ms: number | null): void {
  poolDeadlineMs = ms ?? POOL_DEADLINE_MS;
}

/**
 * `work`, or a PoolDeadlineError after 8 s. One RPC that accepts connections and never answers must not hold up a
 * call that covers every pool: on Vercel (30 s, vercel.json) that call would time out and lose the healthy network's
 * answer too. The work itself goes on in the background (an event scan keeps its progress, see scanEvents); only
 * this answer stops waiting for it.
 */
export function withPoolDeadline<T>(cfg: PrivacyChainConfig, work: Promise<T>): Promise<T> {
  const ms = poolDeadlineMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PoolDeadlineError(cfg, ms)), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The reason code a failure is listed with: its own for PoolUnavailableError, else rpc_error. */
export function unavailableReason(err: unknown): PoolUnavailableReason {
  return err instanceof PoolUnavailableError ? err.reason : "rpc_error";
}

const loggedAt = new Map<string, number>();

/** One warning per pool, operation and reason per minute: an RPC outage must not flood the log. */
export function logPoolFailure(cfg: PrivacyChainConfig, what: string, err: unknown): void {
  const reason = unavailableReason(err);
  const key = `${cfg.chainId}|${what}|${reason}`;
  const now = Date.now();
  if (now - (loggedAt.get(key) ?? -Infinity) < 60_000) return;
  loggedAt.set(key, now);
  console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}) ${what}: unavailable (${reason}): ${describeError(err)}`);
}

/**
 * Run `fn` for every served pool, in parallel and isolated (Promise.allSettled): a pool that fails, or does not answer
 * within its deadline (withPoolDeadline), is listed under `unavailable` and the others answer as usual. A network
 * without a pool is skipped (zero RPC calls); a pool with a configuration problem is listed as config_error without
 * any call.
 */
export async function settlePools<T>(
  what: string,
  fn: (cfg: PrivacyChainConfig) => Promise<T>,
): Promise<{ ok: T[]; unavailable: PoolUnavailable[] }> {
  const chains = privacyConfig().chains.filter((c) => c.pool !== null || c.problems.length > 0);
  const settled = await Promise.allSettled(
    chains.map((cfg) =>
      cfg.problems.length > 0
        ? Promise.reject(new PoolUnavailableError(cfg, "config_error"))
        : withPoolDeadline(
            cfg,
            Promise.resolve().then(() => fn(cfg)),
          ),
    ),
  );
  const ok: T[] = [];
  const unavailable: PoolUnavailable[] = [];
  settled.forEach((s, i) => {
    const cfg = chains[i];
    if (s.status === "fulfilled") {
      ok.push(s.value);
      return;
    }
    if (cfg.problems.length === 0) logPoolFailure(cfg, what, s.reason);
    unavailable.push({ chainId: cfg.chainId, pool: cfg.pool, reason: unavailableReason(s.reason) });
  });
  return { ok, unavailable };
}

// ─── the pool and its contract check ──────────────────────────────────────────

export interface UsablePool {
  cfg: PrivacyChainConfig;
  pool: Address;
  deployBlock: bigint;
  /** computeScope(pool, chainId) */
  scope: bigint;
}

/**
 * The chain's pool, without any RPC call. A network without a pool: PRECONDITION_FAILED; a pool with a
 * configuration problem: PoolUnavailableError (config_error). Omitted chainId: the only served chain.
 */
export function usablePool(chainId?: number): UsablePool {
  const cfg = chainConfig(chainId);
  if (cfg.problems.length > 0) throw new PoolUnavailableError(cfg, "config_error");
  if (!cfg.pool || cfg.deployBlock === null || cfg.scope === null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${cfg.network.name} (${cfg.chainId}) has no privacy pool yet` });
  }
  return { cfg, pool: cfg.pool, deployBlock: cfg.deployBlock, scope: cfg.scope };
}

export function requirePool(chainId?: number): Address {
  return usablePool(chainId).pool;
}

type CheckState = { passed: true } | { passed: false; reason: "wrong_chain" | "contract_check_failed"; at: number };
const checks = new Map<string, CheckState>();
const checking = new Map<string, Promise<void>>();
const CHECK_RETRY_MS = 60_000;

/** Single-flight per key: concurrent callers share one run; the entry is removed when it settles. */
function singleFlight<T>(map: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const running = map.get(key);
  if (running) return running;
  const tracked: Promise<T> = run().finally(() => {
    if (map.get(key) === tracked) map.delete(key);
  });
  map.set(key, tracked);
  return tracked;
}

/** A revert or an empty answer from the contract (never a transport failure). */
export function isContractLevelError(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    !!err.walk(
      (e) =>
        e instanceof ContractFunctionRevertedError ||
        e instanceof ContractFunctionZeroDataError ||
        e instanceof AbiDecodingZeroDataError ||
        e instanceof AbiDecodingDataSizeTooSmallError,
    )
  );
}

async function checkContract({ cfg, pool, scope }: UsablePool, key: string): Promise<void> {
  const client = getPublicClient(cfg.chainId);
  const [rpcChainId, code, onChainScope] = await Promise.all([
    client.getChainId(),
    client.getCode({ address: pool }),
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "SCOPE" }).catch((err: unknown) => {
      if (isContractLevelError(err)) return null; // no contract there, or not this one
      throw err; // the RPC itself failed: rpc_error, not remembered
    }),
  ]);
  const observedProtocol = isV2Protocol(cfg.protocol)
    ? await client.readContract({ address: pool, abi: PRIVACY_POOL_V2_ABI, functionName: "PROTOCOL_VERSION" }).catch((err: unknown) => {
        if (isContractLevelError(err)) return null;
        throw err;
      })
    : cfg.protocol;
  let failure: { reason: "wrong_chain" | "contract_check_failed"; detail: string } | null = null;
  if (rpcChainId !== cfg.chainId) failure = { reason: "wrong_chain", detail: `its RPC node answers chain id ${rpcChainId}` };
  else if (!code || code === "0x") failure = { reason: "contract_check_failed", detail: "there is no contract at the pool address" };
  else if (onChainScope === null || onChainScope !== scope) {
    failure = { reason: "contract_check_failed", detail: "SCOPE() is not this pool's scope on this chain" };
  } else if (cfg.recordScope !== null && onChainScope !== cfg.recordScope) {
    failure = { reason: "contract_check_failed", detail: "SCOPE() does not match the deployment record" };
  } else if (observedProtocol !== cfg.protocol) {
    failure = { reason: "contract_check_failed", detail: "the contract does not match the selected protocol" };
  }
  if (failure) {
    checks.set(key, { passed: false, reason: failure.reason, at: Date.now() });
    console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}): pool ${pool} failed its contract check: ${failure.detail}; retried in 60 s`);
    return;
  }
  checks.set(key, { passed: true });
}

/**
 * The pool contract check, on first use, once per process and pool:
 *   - the RPC's eth_chainId must be the chain id, else `wrong_chain`;
 *   - the pool must have code, and SCOPE() must equal computeScope(pool, chainId) and the deployment record's scope,
 *     else `contract_check_failed`.
 * A failed check is retried after 60 s; an RPC error is not remembered (the call fails with rpc_error). Nothing is
 * read from or written to a pool before it passes: on the real 46630 the anvil-default pool address holds someone
 * else's contract.
 */
export async function ensurePoolContract(chainId?: number): Promise<UsablePool> {
  const ready = usablePool(chainId);
  const key = poolKey(ready.cfg.chainId, ready.pool);
  const state = checks.get(key);
  if (state?.passed) return ready;
  if (state && !state.passed && Date.now() - state.at < CHECK_RETRY_MS) throw new PoolUnavailableError(ready.cfg, state.reason);
  await singleFlight(checking, key, () => checkContract(ready, key));
  const after = checks.get(key);
  if (after && !after.passed) throw new PoolUnavailableError(ready.cfg, after.reason);
  return ready;
}

/** Whether the pool failed its contract check less than a minute ago (no RPC call; the relayer quote uses it). */
export function contractCheckFailed(chainId?: number): boolean {
  const cfg = chainConfig(chainId);
  if (!cfg.pool) return false;
  const state = checks.get(poolKey(cfg.chainId, cfg.pool));
  return !!state && !state.passed && Date.now() - state.at < CHECK_RETRY_MS;
}


// ─── events ───────────────────────────────────────────────────────────────────

interface EventCache {
  events: PoolEvent[];
  lastBlock: bigint;
  /** 0 for the progress of a scan still running (or cut off): resumed from, never served */
  fetchedAt: number;
}

const caches = new Map<string, EventCache>();
/** the scan in flight per pool; `fresh`: it asked for the newest head (a forced sync joins only such a scan) */
const syncing = new Map<string, { promise: Promise<EventCache>; fresh: boolean }>();
const MIN_REFRESH_MS = 3_000;
/** pools this process just posted on: their next sync scans again, whatever the cache's age (the post's event) */
const staleEvents = new Set<string>();

/** Called when a pool's chain no longer matches what was read from it (pools.ts drops its memo). */
const resetListeners = new Set<(chainId: number, pool: Address) => void>();

/** Subscribe to pool resets (see forgetPoolState); returns the unsubscribe. */
export function onPoolReset(listener: (chainId: number, pool: Address) => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/**
 * Everything this process read from one pool's chain: its event cache, snapshot and status, its contract check, its
 * pending publish (a hash from the old chain would answer `pending` forever), its block times, plus what pools.ts keeps.
 */
function forgetPoolState(cfg: PrivacyChainConfig, pool: Address): void {
  const key = poolKey(cfg.chainId, pool);
  caches.delete(key);
  staleEvents.delete(key);
  screened.delete(key);
  statuses.delete(key);
  checks.delete(key);
  pendingPublishes.delete(key);
  for (const k of repaired) if (k.startsWith(`${key}|`)) repaired.delete(k);
  for (const k of recorded) if (k.startsWith(`${key}|`)) recorded.delete(k);
  forgetFunding(cfg.chainId);
  forgetBlockTimes(cfg.chainId);
  for (const listener of resetListeners) listener(cfg.chainId, pool);
}

/** The same events, in the same order (a scan that found nothing new): the cached array is kept, and so are the memos keyed by it. */
function sameEvents(a: readonly PoolEvent[], b: readonly PoolEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.txHash !== y.txHash || x.logIndex !== y.logIndex || x.blockNumber !== y.blockNumber) return false;
    if (x.kind === "deposit" && y.kind === "deposit" && (x.label !== y.label || x.leafIndex !== y.leafIndex)) return false;
    if (x.kind === "withdraw" && y.kind === "withdraw" && x.leafIndex !== y.leafIndex) return false;
    if (x.kind === "asproot" && y.kind === "asproot" && (x.root !== y.root || x.cid !== y.cid)) return false;
  }
  return true;
}

async function scanEvents({ cfg, pool, deployBlock }: UsablePool, key: string, fresh: boolean): Promise<EventCache> {
  const client = getPublicClient(cfg.chainId);
  // viem caches the head for a few seconds; the publisher asks for the newest
  const head = await client.getBlockNumber(fresh ? { cacheTime: 0 } : undefined);
  let prev = caches.get(key) ?? null;
  let range = nextScanRange({ deployBlock, lastBlock: prev?.lastBlock ?? null, head, reorgWindow: cfg.reorgWindow });
  if (range === null && prev) {
    if (headRegression({ lastBlock: prev.lastBlock, head, reorgWindow: cfg.reorgWindow }) === "keep") {
      // a node a few blocks behind what was scanned already: keep the cache as it is
      const kept: EventCache = { events: prev.events, lastBlock: prev.lastBlock, fetchedAt: Date.now() };
      caches.set(key, kept);
      return kept;
    }
    // The head fell further than the reorg window (or at all, on a local chain): this is not the chain the cache was
    // read from (a restart, a revert, a regenesis). Start again from the deploy block.
    console.warn(
      `[privacy] ${cfg.network.name} (${cfg.chainId}): the RPC's head ${head} is below block ${prev.lastBlock}, which the pool was scanned to; its cached state is dropped and it is scanned again from its deploy block`,
    );
    forgetPoolState(cfg, pool);
    prev = null;
    range = { from: deployBlock, to: head };
  }
  const { from, to } = range ?? { from: deployBlock, to: head };
  const before = prev ? prev.events.filter((e) => e.blockNumber < from) : [];
  const scanned: PoolEvent[] = [];
  const fetched =
    from <= to
      ? await fetchPoolEvents(client, pool, from, to, {
          protocol: cfg.protocol,
          chunkSize: cfg.logChunk,
          minChunkSize: cfg.minLogChunk,
          concurrency: SCAN_CONCURRENCY,
          // A long scan (a cold start on a fast chain) keeps its progress: if it is cut off, the next one resumes
          // there instead of starting over. Progress is never served (fetchedAt 0).
          onProgress: (_from, scannedTo, events) => {
            scanned.push(...events);
            if (scannedTo < to) caches.set(key, { events: mergePoolEvents(before, scanned, from), lastBlock: scannedTo, fetchedAt: 0 });
          },
        })
      : [];
  // the trailing reorg window is replaced, never matched: a re-included transaction can get a new log index
  const merged = mergePoolEvents(prev?.events ?? [], fetched, from);
  // Nothing new: the same array, so every memo keyed by it (screening.ts, the snapshot) still holds.
  const events = prev && prev.fetchedAt !== 0 && sameEvents(prev.events, merged) ? prev.events : merged;
  const next: EventCache = { events, lastBlock: to, fetchedAt: Date.now() };
  caches.set(key, next);
  staleEvents.delete(key);
  return next;
}

/**
 * Sync one pool's public events (shared by the ASP, the relayer and the pools explorer):
 *   1. range = nextScanRange(...); null (the RPC's head is below the cache) serves the cache;
 *   2. otherwise fetch [from, head] with that chain's log chunk and minimum chunk;
 *   3. events = mergePoolEvents(cached, fresh, from) and lastBlock = head (the cached array itself when nothing changed).
 * The pool must pass its contract check first. Omitted chainId: the only served chain. Treat the array as immutable.
 */
export async function syncEvents(opts: { chainId?: number; force?: boolean } = {}): Promise<{ events: PoolEvent[]; lastBlock: bigint }> {
  const ready = await ensurePoolContract(opts.chainId);
  const key = poolKey(ready.cfg.chainId, ready.pool);
  // right after this process posted on the pool: the newest head (viem's cached one can predate the post)
  const force = !!opts.force || staleEvents.has(key);
  const cached = caches.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < MIN_REFRESH_MS) return cached;
  let running = syncing.get(key);
  if (running && (running.fresh || !force)) return running.promise;
  // The publisher decides on the newest deposits: it never joins a scan that may have read an older cached head.
  if (running) await running.promise.catch(() => undefined);
  running = syncing.get(key);
  if (running && (running.fresh || !force)) return running.promise;
  const promise: Promise<EventCache> = scanEvents(ready, key, force).finally(() => {
    if (syncing.get(key)?.promise === promise) syncing.delete(key);
  });
  syncing.set(key, { promise, fresh: force });
  return promise;
}

// ─── the screened set (the publisher's snapshot) ──────────────────────────────

/** One pool's screening snapshot: what the publisher would post now, and the root on-chain as this server checks it. */
export interface ScreenedSet {
  chainId: number;
  pool: Address;
  /** the snapshot head: the block the events were synced to, and its block time (unix seconds) */
  head: { block: bigint; time: number };
  /** the events it was built from (never mutate) */
  events: readonly PoolEvent[];
  delaySeconds: number;
  confirmations: number;
  /** currentASPRoot when the snapshot was taken (0: nothing published yet) */
  currentRoot: bigint;
  /** the current root's newest ASPRootUpdated event in these events (null: root 0, or the events lack it) */
  currentRecord: RootRecord | null;
  /** the server's own check of the current root against its events (null for root 0) */
  current: RootCheck | null;
  /** the n the snapshot started from: the verified current root's, or a larger one an earlier root named (n never decreases) */
  previousConsidered: number;
  snapshot: ScreeningSnapshot;
  /**
   * the publisher posts the snapshot now (screening.ts rootDueFor; a root already repaired once, or a record already
   * posted once for the same exclusions, is not due again)
   */
  rootDue: boolean;
  /** the snapshot's root is the current root and its record does not match: re-posted once with the recipe */
  repair: boolean;
  /**
   * the snapshot's root is the current root, whose record is right but does not list an exclusion the snapshot adds
   * (a deposit listed before it was eligible, and the newest to become eligible): the same root is posted once more
   * with the snapshot's recipe, so the exclusion is on-chain
   */
  record: boolean;
  /** leaves the current root excludes that the snapshot admits again (an exclusion lifted) */
  readmitted: number[];
  /**
   * the list changed less than 30 s ago and the snapshot admits a deposit that the current root excludes, or that the
   * last settled list excluded: not due until the edit has settled (an entry removed and put back in two saves never
   * posts a root that admits the deposit)
   */
  settling: boolean;
  /** the exclusion list the snapshot applied (while invalid: the last good list) */
  exclusions: ExclusionsState;
  /** why nothing may be posted now (publishing paused: policy_error); null when posting is allowed */
  policyError: string | null;
}

/** the verified current root's member list, or null */
export function verifiedCurrent(s: Pick<ScreenedSet, "current">): VerifiedSet | null {
  return s.current?.status === "verified" ? s.current.set : null;
}

interface ScreenedMemo {
  promise: Promise<ScreenedSet>;
  /** null while in flight */
  settledAt: number | null;
  fresh: boolean;
  exclusionsVersion: number;
}

const screened = new Map<string, ScreenedMemo>();
/** a snapshot answers non-fresh callers for this long (the event cache's own refresh interval) */
const SCREENED_MEMO_MS = MIN_REFRESH_MS;
/** `${pool key}|${root}`: roots whose record this process has re-posted once (a repair is never repeated) */
const repaired = new Set<string>();
/** `${pool key}|${root}|${x}`: same-root records this process has posted once to list new exclusions (never repeated) */
const recorded = new Set<string>();
/** `${pool key}|${root}|${what}`: problems of a root logged once */
const loggedRoots = new Set<string>();

const shortRoot = (root: bigint) => `${root.toString().slice(0, 12)}…`;

/** The key of a same-root record post: the root and the exclusions it lists (one post per pair and process). */
const recordKey = (key: string, snapshot: Pick<ScreeningSnapshot, "root" | "recipe">) => `${key}|${snapshot.root}|${snapshot.recipe.excludedLeaves.join(",")}`;

function exclusionsNow(): ExclusionsState {
  return readExclusions(privacyConfig().aspExclusions);
}

function policyErrorOf(s: Omit<ScreenedSet, "policyError">): string | null {
  if (s.exclusions.status === "invalid") return `the exclusion list is invalid (${s.exclusions.error})`;
  if (s.snapshot.cid === null) {
    return `the snapshot excludes ${s.snapshot.recipe.excludedLeaves.length} deposits, more than the ${MAX_RECIPE_EXCLUSIONS} a root's record can list`;
  }
  const onChain = highestPolicyVersion(s.events);
  if (onChain > ASP_POLICY_VERSION) {
    return `the pool's roots follow screening policy version ${onChain}, newer than this server's version ${ASP_POLICY_VERSION}: update this server before it posts again`;
  }
  // the self-check (only when something would be posted): the root and record about to go out must verify here
  if (s.rootDue && verifySet(s.snapshot.root, s.snapshot.cid, s.events) === null) return "the snapshot did not pass the publisher's own check";
  return null;
}

function noteRootProblems(cfg: PrivacyChainConfig, key: string, s: Omit<ScreenedSet, "policyError">): void {
  const c = s.current;
  if (!c || c.status !== "mismatch") return;
  const id = `${key}|${s.currentRoot}|${c.problem}`;
  if (loggedRoots.has(id)) return;
  loggedRoots.add(id);
  const what =
    c.problem === "version_backwards"
      ? "was posted under the older open policy after screened roots (is an older publisher still running with this postman key? Run one publisher version per pool)"
      : `does not match its record (${c.problem})`;
  console.warn(
    `[privacy] ${cfg.network.name} (${cfg.chainId}): the current association-set root ${shortRoot(s.currentRoot)} ${what}; devices refuse to prove against it${s.rootDue ? ", and this publisher posts its own root" : ""}`,
  );
}

async function buildScreenedSet(cfg: PrivacyChainConfig, pool: Address, fresh: boolean, exclusions: ExclusionsState): Promise<ScreenedSet> {
  const key = poolKey(cfg.chainId, pool);
  const { events, lastBlock } = await syncEvents({ chainId: cfg.chainId, force: fresh });
  const client = getPublicClient(cfg.chainId);
  const [currentRoot, headTime] = await Promise.all([
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" }),
    headTimestamp(cfg.chainId, lastBlock),
  ]);
  const cur = checkCurrentRoot({ events, currentRoot });
  const current = cur?.check ?? null;
  const verified = current?.status === "verified" ? current.set : null;
  const previousConsidered = Math.max(verified ? verified.recipe.considered : 0, considerationFloor(events));
  const head = { block: lastBlock, time: headTime };
  // While the list cannot be read (after a restart: no last good list in this process), the leaves the verified
  // current root's own record lists stay excluded: the snapshot never re-admits a deposit the chain shows excluded,
  // so it announces no lift and counts no false joins. They are not announced either: no reason is known for them.
  const invalid = exclusions.status === "invalid";
  const keepExcluded = invalid && verified && verified.recipe.version === 1 ? new Set(verified.recipe.excludedLeaves) : null;
  const base = {
    deposits: events,
    head,
    confirmations: cfg.aspConfirmations,
    delaySeconds: cfg.aspInclusionDelaySeconds,
    exclude: exclusionMatcher(exclusions.entries, cfg.chainId),
    previousConsidered,
    keepExcluded,
  };
  const blocks = blocksNeedingTime(base);
  const blockTime = blocks.length > 0 ? await blockTimestamps(cfg.chainId, blocks) : () => undefined;
  const snapshot = screenDeposits({ ...base, blockTime });

  let rootDue = rootDueFor({ currentRoot, current, snapshot });
  const sameRoot = rootDue && snapshot.root === currentRoot;
  const repair = sameRoot && current?.status === "mismatch";
  const record = sameRoot && !repair;
  if (repair && repaired.has(`${key}|${currentRoot}`)) rootDue = false; // repaired once already: never again in this process
  if (record && recorded.has(recordKey(key, snapshot))) rootDue = false; // this record was posted once already
  // nothing is lifted while the list cannot be read (keepExcluded keeps the chain's exclusions in the snapshot anyway)
  const readmitted = invalid ? [] : readmittedLeaves(verified && verified.recipe.version === 1 ? verified.recipe : null, snapshot.recipe);
  // A list younger than 30 s may be half-saved (an entry removed, then put back): a root that admits a deposit the current
  // root excludes, or one the last settled list excluded, waits until it has settled. Removals never wait here.
  let settling = false;
  if (rootDue && Date.now() - exclusions.changedAt < EXCLUSIONS_SETTLE_SECONDS * 1000) {
    const before = exclusions.previousSettled ? exclusionMatcher(exclusions.previousSettled, cfg.chainId) : null;
    const admitsListed =
      before !== null &&
      snapshot.labels.some((label) => {
        if (verified?.has(label)) return false;
        const d = depositOf(events, label);
        return d !== null && before(d.deposit) !== null;
      });
    settling = readmitted.length > 0 || admitsListed;
  }
  if (settling) rootDue = false;

  const partial: Omit<ScreenedSet, "policyError"> = {
    chainId: cfg.chainId,
    pool,
    head,
    events,
    delaySeconds: cfg.aspInclusionDelaySeconds,
    confirmations: cfg.aspConfirmations,
    currentRoot,
    currentRecord: currentRoot !== 0n ? rootRecordOf(events, currentRoot) : null,
    current,
    previousConsidered,
    snapshot,
    rootDue,
    repair: repair && rootDue,
    record: record && rootDue,
    readmitted,
    settling,
    exclusions,
  };
  noteRootProblems(cfg, key, partial);
  return { ...partial, policyError: policyErrorOf(partial) };
}

/**
 * One pool's screening snapshot (public data only: events, block times, the root on-chain, the exclusion list). `fresh`
 * syncs to the newest head first (the publisher decides on the newest deposits); otherwise a snapshot of the last 3 s
 * answers, shared by every caller, unless the exclusion list changed since. Omitted chainId: the only served chain.
 */
export function getScreenedSet(opts: { chainId?: number; fresh?: boolean } = {}): Promise<ScreenedSet> {
  let ready: UsablePool;
  try {
    ready = usablePool(opts.chainId);
  } catch (err) {
    return Promise.reject(err);
  }
  const { cfg, pool } = ready;
  const key = poolKey(cfg.chainId, pool);
  const fresh = !!opts.fresh;
  const exclusions = exclusionsNow();
  const hit = screened.get(key);
  if (hit && hit.exclusionsVersion === exclusions.version) {
    if (hit.settledAt === null && (hit.fresh || !fresh)) return hit.promise;
    if (!fresh && hit.settledAt !== null && Date.now() - hit.settledAt < SCREENED_MEMO_MS) return hit.promise;
  }
  const memo: ScreenedMemo = { promise: buildScreenedSet(cfg, pool, fresh, exclusions), settledAt: null, fresh, exclusionsVersion: exclusions.version };
  screened.set(key, memo);
  memo.promise.then(
    () => {
      memo.settledAt = Date.now();
    },
    () => {
      if (screened.get(key) === memo) screened.delete(key); // a failure is not kept
    },
  );
  return memo.promise;
}

/**
 * The labels excluded now: every deposit of this pool that the exclusion list in force names (while the list is
 * invalid, the last good one), considered yet or not. A lifted exclusion is no longer one, even before the next root.
 */
export function excludedLabelsOf(s: Pick<ScreenedSet, "snapshot">): Set<bigint> {
  return new Set<bigint>(s.snapshot.excluded.map((e) => e.label));
}

/**
 * What one root's member list holds, from these events: "holds" (an excluded label), "clean", or "unverifiable" (no
 * cid of that root rebuilds to it here). The root value binds the list, so the first of its records (newest first)
 * that verifies decides.
 */
export function rootTaint(events: readonly PoolEvent[], root: bigint, excluded: ReadonlySet<bigint>): "holds" | "clean" | "unverifiable" {
  const records = events
    .filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot" && e.root === root)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1));
  for (const e of records) {
    const c = checkRoot({ root, cid: e.cid, events, at: { blockNumber: e.blockNumber, logIndex: e.logIndex } });
    if (c.status === "verified") return c.set.labels.some((l) => excluded.has(l)) ? "holds" : "clean";
  }
  return "unverifiable";
}

// ─── public answers ───────────────────────────────────────────────────────────

export interface PublicAssociationSet {
  pool: Address;
  /** every member label, in membership order (the current on-chain root's list when `onChain`; [] if it does not verify here) */
  labels: bigint[];
  memberCount: number;
  /** the current on-chain root (`onChain`), or the snapshot's root before the first one */
  root: bigint;
  head: bigint;
}

/**
 * One pool's public set, the same for every caller: the CURRENT on-chain root with its cid (`onChain: true`; its list
 * rebuilt from that cid and the server's events, [] when it does not verify here), or before the first root the
 * snapshot (`onChain: false`). A device whose events lack the current root's ASPRootUpdated event uses { root, cid }
 * only, and only when its own events rebuild that cid to the root on-chain.
 */
export async function getPublicAssociationSet(chainId?: number): Promise<PublicAssociationSetEntry> {
  const s = await getScreenedSet({ chainId });
  if (s.currentRoot !== 0n) {
    const verified = verifiedCurrent(s);
    return {
      chainId: s.chainId,
      pool: s.pool,
      labels: verified ? [...verified.labels] : [],
      memberCount: verified ? verified.memberCount : 0,
      root: s.currentRoot,
      head: s.head.block,
      cid: s.currentRecord?.cid ?? null,
      onChain: true,
    };
  }
  return {
    chainId: s.chainId,
    pool: s.pool,
    labels: [...s.snapshot.labels],
    memberCount: s.snapshot.memberCount,
    root: s.snapshot.root,
    head: s.head.block,
    cid: s.snapshot.cid,
    onChain: false,
  };
}

/** privacy.asp.set: every pool's current on-chain list; the device picks its own entry by chain and address. */
export async function getPublicAssociationSets(): Promise<AssociationSetsAnswer> {
  const { ok, unavailable } = await settlePools("asp.set", (cfg) => getPublicAssociationSet(cfg.chainId));
  return { sets: ok, unavailable };
}

export interface ASPStatus {
  pool: Address;
  /** members of the snapshot (the set the publisher would post now) */
  memberCount: number;
  /** the snapshot's root */
  localRoot: string;
  onChainRoot: string;
  /** the root on-chain is the snapshot's root (by value; screening.rootDue also covers a record that does not match) */
  onChainIsCurrent: boolean;
  /** the server can post a root on this pool now: publishing is not paused, and a postman key that is the pool's aspPostman can pay for one publish */
  canPublish: boolean;
  /** why not; null when canPublish (a balance that could not be read counts as funded) */
  publishBlock: PublisherBlock | null;
  head: string;
}

/** chainId → the periodic publisher's interval, for the chains it runs for in this process (autoPublish.ts sets it) */
const autoPublishing = new Map<number, number>();

/** autoPublish.ts: the periodic publisher now runs (seconds) for these chains, or no longer runs (null). */
export function setAutoPublishRunning(chainIds: readonly number[], seconds: number | null): void {
  for (const id of chainIds) {
    if (seconds === null) autoPublishing.delete(id);
    else autoPublishing.set(id, seconds);
  }
  statuses.clear();
}

/** The periodic publisher as it actually runs in this process for one chain (false off, on serverless hosting, in a CLI). */
export function autoPublishState(chainId: number): { running: boolean; seconds: number } {
  const seconds = autoPublishing.get(chainId);
  return seconds !== undefined ? { running: true, seconds } : { running: false, seconds: privacyConfig().autoPublishSeconds };
}

/** The screening block of privacy.asp.status: every field filled (devices ignore a partial block), public data only. */
export function screeningOf(s: ScreenedSet): ASPScreening {
  const config = chainConfig(s.chainId);
  const verified = verifiedCurrent(s);
  const invalid = s.exclusions.status === "invalid";
  return {
    walletPublishable: s.policyError === null && !s.settling,
    publicationMode: config.chainId === 1 && config.protocol === V2_ETH_PROTOCOL && config.aspPostmanPrivateKey === null ? "wallet" : "server",
    policyVersion: ASP_POLICY_VERSION,
    delaySeconds: s.delaySeconds,
    confirmations: s.confirmations,
    autoPublish: autoPublishState(s.chainId),
    exclusions: s.exclusions.status,
    snapshot: {
      asOfBlock: s.head.block.toString(),
      asOfTime: s.head.time,
      considered: s.snapshot.recipe.considered,
      memberCount: s.snapshot.memberCount,
      waiting: s.snapshot.waiting,
      root: s.snapshot.root.toString(),
      cid: s.snapshot.cid,
    },
    current:
      s.currentRoot === 0n || s.current === null
        ? null
        : {
            root: s.currentRoot.toString(),
            cid: s.currentRecord?.cid ?? null,
            status: s.current.status,
            considered: verified ? verified.recipe.considered : null,
            memberCount: verified ? verified.memberCount : null,
          },
    rootDue: s.rootDue,
    readmitted: s.readmitted.length,
    // the deposits the list names (label, leaf, reason code): never a note, a date (the list's, or when this server
    // first matched an entry) or an address that never deposited
    excluded: s.snapshot.excluded.map((e) => ({
      leafIndex: e.leafIndex,
      label: e.label.toString(),
      reason: e.reason,
      considered: e.considered,
    })),
    settling: s.settling,
    // nothing about the next root while the list cannot be read: it depends on a list this server does not have
    next: verified && !invalid ? nextChange(verified, s.snapshot.labels) : null,
  };
}

/** What the snapshot changes against the verified current root: deposits it adds and members it removes, apart. */
function nextChange(current: VerifiedSet, next: readonly bigint[]): { joins: number; removals: number } {
  const kept = new Set(next);
  return { joins: next.filter((l) => !current.has(l)).length, removals: current.labels.filter((l) => !kept.has(l)).length };
}

interface StatusMemo {
  promise: Promise<ASPStatusEntry>;
  settledAt: number | null;
  exclusionsVersion: number;
}
const statuses = new Map<string, StatusMemo>();
/** privacy.asp.status answers from one computation per pool for this long (every privacy-area visitor polls it) */
const STATUS_MEMO_MS = 15_000;

async function buildStatus(cfg: PrivacyChainConfig, pool: Address, fresh: boolean): Promise<ASPStatusEntry> {
  const s = await getScreenedSet({ chainId: cfg.chainId, fresh });
  const client = getPublicClient(cfg.chainId);
  const [postman, funding] = await Promise.all([
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "aspPostman" }),
    readFunding(cfg.chainId),
  ]);
  const { aspPublishBlock } = publisherServices(cfg, postman, funding);
  const block: PublisherBlock | null = s.policyError ? "policy_error" : aspPublishBlock;
  return {
    chainId: cfg.chainId,
    pool,
    confirmations: cfg.aspConfirmations,
    memberCount: s.snapshot.memberCount,
    localRoot: s.snapshot.root.toString(),
    onChainRoot: s.currentRoot.toString(),
    onChainIsCurrent: s.currentRoot === s.snapshot.root,
    canPublish: block === null,
    publishBlock: block,
    head: s.head.block.toString(),
    screening: screeningOf(s),
  };
}

/**
 * One pool's association-set status with its screening block. One computation per pool every 15 s answers every caller
 * (a publish from this process, or an exclusion list change, starts a new one); `fresh` computes it anew, on events
 * synced to the newest head.
 */
export function getASPStatus(chainId?: number, o: { fresh?: boolean } = {}): Promise<ASPStatusEntry> {
  let ready: UsablePool;
  try {
    ready = usablePool(chainId);
  } catch (err) {
    return Promise.reject(err);
  }
  const { cfg, pool } = ready;
  const key = poolKey(cfg.chainId, pool);
  const exclusions = exclusionsNow();
  const hit = statuses.get(key);
  if (!o.fresh && hit && hit.exclusionsVersion === exclusions.version && (hit.settledAt === null || Date.now() - hit.settledAt < STATUS_MEMO_MS)) {
    return hit.promise;
  }
  const memo: StatusMemo = { promise: buildStatus(cfg, pool, !!o.fresh), settledAt: null, exclusionsVersion: exclusions.version };
  statuses.set(key, memo);
  memo.promise.then(
    () => {
      memo.settledAt = Date.now();
    },
    () => {
      if (statuses.get(key) === memo) statuses.delete(key);
    },
  );
  return memo.promise;
}

/** privacy.asp.status: every pool's status. */
export async function getASPStatuses(): Promise<ASPStatusAnswer> {
  const { ok, unavailable } = await settlePools("asp.status", (cfg) => getASPStatus(cfg.chainId));
  return { pools: ok, unavailable };
}

/** A pool's root changed (or may have): its events are read again, and its snapshot and status computed anew, on the next call. */
function invalidateAnswers(key: string): void {
  staleEvents.add(key);
  screened.delete(key);
  statuses.delete(key);
}

// ─── publishing ───────────────────────────────────────────────────────────────

interface PendingPublish {
  root: bigint;
  /** null while the send has not answered yet: the root is treated as posted, so it is never sent twice */
  txHash: Hex | null;
  sentAt: number;
}

const publishing = new Map<string, Promise<PublishResult>>();
/** the decision and the send, single-flight per pool on their own: they outlive a caller's deadline */
const sending = new Map<string, Promise<Sent>>();
/**
 * The answers of an attempt that sent a new transaction. A `published` or `pending` answer can also describe an earlier
 * post (still in flight, or sent before a restart): only these are new posts. Server-side only, never part of an answer.
 */
const sentNow = new WeakSet<PublishResult>();
/** Whether this publish answer comes from an attempt that sent a new transaction (the periodic publisher logs only those). */
export function sentNewTransaction(result: PublishResult): boolean {
  return sentNow.has(result);
}
/** why a `policy_error` answer paused publishing (server-side only: the periodic publisher and the CLI log it) */
const pausedBecause = new WeakMap<PublishResult, string>();
export function policyErrorReason(result: PublishResult): string | null {
  return pausedBecause.get(result) ?? null;
}
const pendingPublishes = new Map<string, PendingPublish>();
/** a post of the same root younger than this answers `pending` (or `published`) instead of posting it again */
const PENDING_PUBLISH_MS = 10 * 60_000;

type Sent = { result: PublishResult } | { root: bigint; txHash: Hex };

function publishResult(cfg: PrivacyChainConfig, pool: Address, status: PublishStatus, root: bigint | null, txHash?: Hex | null): PublishResult {
  return { chainId: cfg.chainId, pool, status, root: root === null ? null : root.toString(), ...(txHash ? { txHash } : {}) };
}

/** Another post landed after `minedAt` (the current root's newest event is later): our post was replaced on-chain. */
function replacedAfter(s: ScreenedSet, minedAt: bigint): boolean {
  return !!s.currentRecord?.at && s.currentRecord.at.blockNumber > minedAt;
}

/** One line per post about what it changes (counts and leaves only, never a label or a reason's note). */
function logPost(cfg: PrivacyChainConfig, s: ScreenedSet): void {
  const name = `${cfg.network.name} (${cfg.chainId})`;
  const verified = verifiedCurrent(s);
  const removed = verified ? s.snapshot.excluded.filter((e) => e.considered && verified.has(e.label)).length : 0;
  if (s.repair) {
    console.log(`[privacy] ${name}: posting the current association-set root once more with its screening record (its record did not match it)`);
  }
  if (s.record) {
    const added = newlyListedLeaves(s.current, s.snapshot.recipe).length;
    console.log(
      `[privacy] ${name}: posting the current association-set root once more with a record that lists ${added} newly excluded deposit(s) (listed before they joined; the members do not change)`,
    );
  }
  if (removed > 0) {
    console.log(`[privacy] ${name}: the new association-set root removes ${removed} deposit(s) that the exclusion list names${s.snapshot.memberCount === 0 ? " (no member is left: the empty set's root)" : ""}`);
  }
  if (s.readmitted.length > 0) {
    console.log(`[privacy] ${name}: the new association-set root admits again ${s.readmitted.length} deposit(s) that the current root excludes (leaves ${s.readmitted.join(", ")}): an exclusion was lifted`);
  }
}

/** Steps 1–4a of a publish: decide on fresh events, then simulate and send. No receipt wait. */
async function decideAndSend(cfg: PrivacyChainConfig, pool: Address): Promise<Sent> {
  const result = (status: PublishStatus, root: bigint | null, txHash?: Hex | null): Sent => ({ result: publishResult(cfg, pool, status, root, txHash) });
  try {
    await ensurePoolContract(cfg.chainId); // a pool with a problem or a failed check gets no write
  } catch (err) {
    if (err instanceof PoolUnavailableError) return result("unavailable", null);
    throw err;
  }

  // 1. A device asks right before it proves, often seconds after a deposit: decide on fresh events, not the cache,
  //    or the answer would be "current" while a root is due.
  const s = await getScreenedSet({ chainId: cfg.chainId, fresh: true });
  const root = s.snapshot.root;
  if (!s.rootDue) return result(s.currentRoot === 0n && s.snapshot.memberCount === 0 ? "empty" : "current", root);

  // 2. Paused: posting now could re-admit an excluded deposit, or post a record devices cannot read.
  if (s.policyError !== null || s.snapshot.cid === null) {
    const paused = publishResult(cfg, pool, "policy_error", root);
    pausedBecause.set(paused, s.policyError ?? "the snapshot has no record");
    return { result: paused };
  }
  const cid = s.snapshot.cid;

  // 3. The key, and whether it is this pool's postman.
  if (!cfg.aspPostmanPrivateKey) return result("no_key", root);
  const client = getPublicClient(cfg.chainId);
  const wallet = makeWalletClient(cfg.aspPostmanPrivateKey, cfg.chainId);
  const postman = await client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "aspPostman" });
  if (postman.toLowerCase() !== wallet.account!.address.toLowerCase()) return result("not_postman", root);

  // 4. A post of this root answers for it: the contract accepts a duplicate root, which would use up a slot of its
  //    root history, so a root is not posted twice. Mined: published (unless it is the one-off repair of its record, or
  //    another post replaced it on-chain more than 10 minutes after it was sent: then it goes out again, never more
  //    often than the schedule); reverted: posted anew; not mined yet: pending while young (older, step 6 asks the node
  //    whether it is still in flight).
  const key = poolKey(cfg.chainId, pool);
  const prior = pendingPublishes.get(key);
  if (prior && prior.root === root) {
    const young = Date.now() - prior.sentAt < PENDING_PUBLISH_MS;
    if (!prior.txHash) {
      if (young) return result("pending", root); // its send has not answered yet
    } else {
      const receipt = await client.getTransactionReceipt({ hash: prior.txHash }).catch(() => null);
      if (receipt?.status === "success") {
        if (!s.repair && !s.record && (young || !replacedAfter(s, receipt.blockNumber))) return result("published", root, prior.txHash);
      } else if (receipt) pendingPublishes.delete(key); // it reverted: the root was never posted
      else if (young) return result("pending", root, prior.txHash);
    }
  }

  // 5. The postman can pay for one publish: a fresh read, so a key funded a moment ago is used at once, and a send
  //    the node would refuse for its balance is never tried.
  const funding = await readFunding(cfg.chainId, { fresh: true });
  if (funding?.postman && !funding.postman.funded) return result("unfunded", root);

  // 6. Unless this process knows that the postman's transaction in flight carries another root (then this newer root
  //    goes out behind it, as ever): the postman has no transaction in flight. A post sent before a restart, or one
  //    not mined after 10 minutes, may still land, and a second post behind it could post the same root twice. A node
  //    that cannot say is no guard.
  const live = pendingPublishes.get(key);
  if (!(live && live.root !== root && live.txHash)) {
    const me = wallet.account!.address;
    const inFlight = await Promise.all([
      client.getTransactionCount({ address: me, blockTag: "latest" }),
      client.getTransactionCount({ address: me, blockTag: "pending" }),
    ]).then(
      ([mined, sent]) => sent > mined,
      () => false,
    );
    if (inFlight) return result("pending", root, live && live.root === root ? live.txHash : null);
  }

  // 7. Simulate, then write, with this chain's bundle: the snapshot's root with its recipe as the cid. The post is
  //    recorded before the send answers, so a request that comes while the send hangs (after a caller's deadline)
  //    answers `pending` instead of posting it again.
  const { request } = await client.simulateContract({
    address: pool,
    abi: PRIVACY_POOL_ABI,
    functionName: "updateASPRoot",
    args: [root, cid],
    account: wallet.account!,
  });
  const record: PendingPublish = { root, txHash: null, sentAt: Date.now() };
  pendingPublishes.set(key, record);
  logPost(cfg, s);
  let txHash: Hex;
  try {
    txHash = await wallet.writeContract(request);
    if (s.repair) repaired.add(`${key}|${root}`); // a repair goes out once per root value and process, whatever its outcome
    if (s.record) recorded.add(recordKey(key, s.snapshot)); // and a record of new exclusions once per root, exclusions and process
  } catch (err) {
    if (pendingPublishes.get(key) === record) pendingPublishes.delete(key); // the send failed: nothing was posted
    if (isInsufficientFunds(err)) {
      forgetFunding(cfg.chainId); // the balance changed since the read: the next answers read it again
      return result("unfunded", root);
    }
    throw err;
  } finally {
    invalidateAnswers(key);
  }
  record.txHash = txHash;
  return { root, txHash };
}

async function publishOnce(cfg: PrivacyChainConfig, pool: Address): Promise<PublishResult> {
  // 1–4a within the pool deadline: a hung RPC answers `unavailable` (via the caller) instead of holding every network's
  // answer. The work goes on alone, single-flight, so a later request never sends a second post meanwhile.
  const sent = await withPoolDeadline(cfg, singleFlight(sending, poolKey(cfg.chainId, pool), () => decideAndSend(cfg, pool)));
  if ("result" in sent) return sent.result;

  // 4b. Wait a bounded time for the receipt (the device waits for a pending post on its own RPC).
  const { root, txHash } = sent;
  const key = poolKey(cfg.chainId, pool);
  const client = getPublicClient(cfg.chainId);
  const fresh = (status: PublishStatus): PublishResult => {
    const r = publishResult(cfg, pool, status, root, txHash);
    sentNow.add(r);
    return r;
  };
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: Math.max(1, cfg.receiptWaitMs) });
  } catch {
    return fresh("pending"); // not in yet (or the RPC is slow): the record answers repeats
  } finally {
    invalidateAnswers(key);
  }
  if (receipt.status !== "success") {
    if (pendingPublishes.get(key)?.txHash === txHash) pendingPublishes.delete(key);
    return fresh("unavailable");
  }
  return fresh("published");
}

/**
 * Publish one pool's snapshot root when a root is due and the postman key is configured. Concurrent requests for the
 * same pool share one attempt, and a pending post is never repeated (see publishOnce). A network without a pool answers
 * `unavailable` with pool null and no RPC call. Omitted chainId: the only served chain.
 */
export function publishASPRoot(chainId?: number): Promise<PublishResult> {
  let cfg: PrivacyChainConfig;
  try {
    cfg = chainConfig(chainId);
  } catch (err) {
    return Promise.reject(err);
  }
  const pool = cfg.pool;
  if (!pool) return Promise.resolve({ chainId: cfg.chainId, pool: null, status: "unavailable", root: null });
  return singleFlight(publishing, poolKey(cfg.chainId, pool), () => publishOnce(cfg, pool));
}

/**
 * The input-less privacy.asp.publish: every served pool in parallel, each as publishASPRoot. The request is the same
 * whichever deposit and network a withdrawal spends; a pool with no root due answers `current`, a paused one
 * `policy_error`, and a failing pool `unavailable` without failing the others.
 */
export async function publishBehindRoots(): Promise<{ results: PublishResult[] }> {
  const { chains } = privacyConfig();
  const settled = await Promise.allSettled(chains.map((c) => publishASPRoot(c.chainId)));
  return {
    results: settled.map((s, i): PublishResult => {
      if (s.status === "fulfilled") return s.value;
      logPoolFailure(chains[i], "asp.publish", s.reason);
      return { chainId: chains[i].chainId, pool: chains[i].pool, status: "unavailable", root: null };
    }),
  };
}

// ─── the relayer's check of older roots ───────────────────────────────────────

/**
 * The labels of the deposits the verified current root's own record lists as excluded (on-chain, the same for everyone;
 * empty when the current root does not verify here).
 */
function onChainExcluded(s: Pick<ScreenedSet, "current" | "events">): bigint[] {
  const verified = verifiedCurrent(s);
  if (!verified || verified.recipe.excludedLeaves.length === 0) return [];
  const byLeaf = new Map(depositsInLeafOrder(s.events).map((d) => [d.leafIndex, d.label]));
  return verified.recipe.excludedLeaves.map((leaf) => byLeaf.get(leaf)).filter((l): l is bigint => l !== undefined);
}

/**
 * Whether the relayer refuses a proof made against `root` (critique M4 of the Phase 4 design: the window an older root
 * leaves open after a removal closes for relayed withdrawals the moment the removal root is posted, at no gas cost):
 *   - the current root is never refused;
 *   - with a readable list that names nothing on this network, nothing is refused (and no RPC call is made);
 *   - otherwise a root whose member list holds an excluded deposit, or whose list this server cannot rebuild, is.
 *     "Excluded" is what the list in force names (while it is invalid, the last good list read in this process, which
 *     after a restart may be empty) and what the current root's own record lists on-chain; with an invalid list and a
 *     current root this server cannot check, every older root is refused (fail closed, as publishing pauses).
 * The answer depends on the root alone (a public signal of the proof), so it is the same for every proof against it and
 * says nothing about which deposit is spent.
 */
export async function refusedASPRoot(chainId: number, root: bigint): Promise<boolean> {
  const { cfg, pool } = usablePool(chainId);
  const list = exclusionsNow();
  if (list.status !== "invalid" && !list.entries.some((e) => e.chainId === null || e.chainId === cfg.chainId)) return false;
  const client = getPublicClient(cfg.chainId);
  const currentRoot = await client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" });
  if (root === currentRoot) return false;
  let s = await getScreenedSet({ chainId: cfg.chainId });
  // a snapshot from before the newest root (it answers for 3 s): read the chain again
  if (s.currentRoot !== currentRoot) s = await getScreenedSet({ chainId: cfg.chainId, fresh: true });
  if (list.status === "invalid" && verifiedCurrent(s) === null) return true;
  const excluded = excludedLabelsOf(s);
  for (const label of onChainExcluded(s)) excluded.add(label);
  if (excluded.size === 0) return false;
  return rootTaint(s.events, root, excluded) !== "clean";
}

/** test hook: clears every per-pool cache, check, snapshot, status and publish record, the exclusion list read, and the keys' funding reads */
export function resetASPCache() {
  caches.clear();
  syncing.clear();
  staleEvents.clear();
  screened.clear();
  statuses.clear();
  repaired.clear();
  recorded.clear();
  loggedRoots.clear();
  checks.clear();
  checking.clear();
  publishing.clear();
  sending.clear();
  pendingPublishes.clear();
  loggedAt.clear();
  resetExclusionsCache();
  resetBlockTimes();
  resetFundingCache();
}
