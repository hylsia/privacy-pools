/**
 * The periodic association-set publisher (long-running server only).
 *
 * Every PRIVACY_ASP_AUTO_PUBLISH_SECONDS (default 600; 0 turns it off), for each served pool, it does what one
 * label-free privacy.asp.publish request does: post the pool's screened root when one is due (deposits that passed the
 * inclusion delay, or a removal the operator's exclusion list asks for). With one network, a pool's first root comes
 * only from here or from `npm run zk:asp:publish`: no withdrawal can ask for it, since the app holds every note back
 * until a root holds it (with several, the one publish request a withdrawal on another network's pool sends covers it
 * too). A withdrawal usually finds its root current. The schedule depends on the clock and on the operator's own edits
 * of the exclusion list, never on a visitor or a request: it reveals nothing about anyone.
 *
 * Per pool and tick:
 *   - nothing without a usable pool or a postman key, and nothing while the postman cannot pay for one publish (read
 *     before any event scan; it resumes on its own once the key is funded);
 *   - else publishASPRoot: an empty pool or a current root sends nothing, and the same root goes out again only to
 *     repair a record that does not match it, or with a record that lists a newly excluded newest deposit (each at most
 *     once per process; server/privacy/asp.ts); while a post is still in flight (or one sent before a restart) the tick sends nothing
 *     and waits, and the log says so once; while publishing is paused (policy_error: an invalid exclusion list, say)
 *     it sends nothing, and the log says why once;
 *   - an error makes the next try wait twice as long, up to an hour, and is logged once until the pool works again.
 * The log has one line per new post (a transaction the tick sent) and one per change of state, nothing else.
 *
 * The exclusion list's file (PRIVACY_ASP_EXCLUSIONS_FILE) is checked every 15 s. A change that has then stayed the same
 * for 30 s and lists a member of a pool's current root runs that pool's tick at once, so a removal root goes out within
 * about a minute of the operator's edit instead of up to one interval later. A lifted exclusion waits for the normal
 * tick, and so does a list that is still changing: a half-saved edit never triggers a post.
 *
 * server/_core/index.ts starts it for the long-running server (`npm run dev`, `npm start`). A serverless deployment never
 * starts it (Vercel runs api/index.js, which does not), and it refuses to start where VERCEL is set: a function instance
 * lives for its requests only, so a schedule there would neither keep time nor stop. A serverless deployment runs
 * `npm run zk:asp:publish` from a scheduler instead.
 */
import { formatEther } from "viem";
import { getScreenedSet, policyErrorReason, publishASPRoot, sentNewTransaction, setAutoPublishRunning, verifiedCurrent } from "./asp";
import { chainConfig, privacyConfig, type PrivacyChainConfig } from "./config";
import { describeError } from "./errors";
import { EXCLUSIONS_SETTLE_SECONDS, readExclusions } from "./exclusions";
import { readFunding } from "./funding";

/** the longest wait after repeated errors */
const MAX_BACKOFF_SECONDS = 3_600;
/** the first tick comes after one interval, or after a minute when the interval is longer */
const FIRST_TICK_MAX_SECONDS = 60;
/** how often the exclusion list's file is checked for a change */
export const EXCLUSIONS_CHECK_SECONDS = 15;
/** how long a changed list must stay the same before it triggers a tick (a half-saved edit never does) */
export { EXCLUSIONS_SETTLE_SECONDS };

/**
 * What one tick did for one pool:
 *   - no_pool: not deployed, or a configuration problem; no_key: no postman key;
 *   - unfunded: the postman cannot pay for one publish (nothing was read beyond its balance and the gas price);
 *   - posted: this tick sent a new transaction with the root (published, or pending with its transaction);
 *   - waiting: a post of the postman's is still in flight (an earlier tick's or request's, or one sent before a
 *     restart), so this tick sent nothing;
 *   - idle: nothing to post (no deposit admitted yet, or the root is current);
 *   - policy_error: publishing is paused (an invalid exclusion list, more exclusions than a root's record can list, a
 *     newer screening policy on-chain, or a snapshot that failed the publisher's own check); nothing was sent;
 *   - failed: not the pool's postman, the pool unavailable, or an error.
 */
export type AutoPublishOutcome = "no_pool" | "no_key" | "unfunded" | "posted" | "waiting" | "idle" | "policy_error" | "failed";

export interface AutoPublishTick {
  outcome: AutoPublishOutcome;
  /** for the log: the publish status, the funding or the error (an RPC's host only, never its URL) */
  detail: string;
  txHash?: `0x${string}`;
}

function unfundedDetail(cfg: PrivacyChainConfig, balance: bigint, required: bigint, address: string): string {
  return `the publisher ${address} holds ${formatEther(balance)} ETH on ${cfg.network.name}; one publish needs about ${formatEther(required)} ETH. It resumes once the key is funded`;
}

/** One tick for one pool. Never throws. */
export async function autoPublishTick(chainId: number): Promise<AutoPublishTick> {
  try {
    const cfg = chainConfig(chainId);
    if (!cfg.pool || cfg.problems.length > 0) return { outcome: "no_pool", detail: "no usable pool" };
    if (!cfg.aspPostmanPrivateKey) return { outcome: "no_key", detail: "no postman key" };
    // the postman's balance first: an unfunded postman costs no event scan
    const funding = await readFunding(chainId, { fresh: true });
    if (funding?.postman && !funding.postman.funded) {
      const { balance, required, address } = funding.postman;
      return { outcome: "unfunded", detail: unfundedDetail(cfg, balance, required, address) };
    }
    const r = await publishASPRoot(chainId);
    switch (r.status) {
      case "published":
      case "pending":
        // a post only when this attempt sent the transaction; an answer about an earlier post sends nothing new
        if (sentNewTransaction(r)) return { outcome: "posted", detail: r.status, ...(r.txHash ? { txHash: r.txHash } : {}) };
        if (r.status === "published") return { outcome: "idle", detail: "current" };
        return {
          outcome: "waiting",
          detail: r.txHash
            ? `its post in transaction ${r.txHash} is not mined yet; nothing new was sent`
            : "the publisher has a transaction in flight; nothing new was sent",
        };
      case "current":
      case "empty":
        return { outcome: "idle", detail: r.status };
      case "policy_error":
        return { outcome: "policy_error", detail: policyErrorReason(r) ?? "publishing is paused" };
      case "unfunded":
        return { outcome: "unfunded", detail: `the publisher cannot pay for one publish on ${cfg.network.name}. It resumes once the key is funded` };
      case "no_key":
        return { outcome: "no_key", detail: "no postman key" };
      default:
        return { outcome: "failed", detail: r.status === "not_postman" ? "the postman key is not this pool's aspPostman" : r.status };
    }
  } catch (err) {
    return { outcome: "failed", detail: describeError(err) };
  }
}

export interface AutoPublisher {
  /** the pools it runs for */
  chainIds: number[];
  intervalSeconds: number;
  /** whether it watches the exclusion list's file (PRIVACY_ASP_EXCLUSIONS_FILE) */
  watchesExclusions: boolean;
  stop(): void;
}

/**
 * Whether the exclusion list now names a member of the pool's current root (the change adds a removal), from the
 * snapshot every caller shares. A current root this server cannot check counts as yes: the tick decides on fresh events.
 */
async function listsCurrentMember(chainId: number): Promise<boolean> {
  try {
    const s = await getScreenedSet({ chainId });
    if (s.currentRoot === 0n) return false;
    const members = verifiedCurrent(s);
    if (!members) return true;
    return s.snapshot.excluded.some((e) => members.has(e.label));
  } catch {
    return false; // the next scheduled tick reports the failure
  }
}

/**
 * Starts one schedule per served pool with a postman key, and the exclusion list's watcher when the list is a file.
 * Returns null when it is off (PRIVACY_ASP_AUTO_PUBLISH_SECONDS is 0, VERCEL is set, no pool has a postman key, or the
 * configuration has an error); the reason is logged.
 */
export function startAutoPublisher(
  o: {
    log?: (line: string) => void;
    env?: Readonly<Record<string, string | undefined>>;
    firstTickSeconds?: number;
    /** test hooks: the watcher's check interval and settle time (default 15 s and 30 s) */
    exclusionsCheckSeconds?: number;
    exclusionsSettleSeconds?: number;
  } = {},
): AutoPublisher | null {
  const log = o.log ?? ((line: string) => console.log(line));
  const env = o.env ?? process.env;
  let cfg;
  try {
    cfg = privacyConfig();
  } catch (err) {
    log(`[privacy] association-set auto-publish: off (configuration error: ${describeError(err)})`);
    return null;
  }
  const interval = cfg.autoPublishSeconds;
  if (interval === 0) {
    log("[privacy] association-set auto-publish: off (PRIVACY_ASP_AUTO_PUBLISH_SECONDS=0)");
    return null;
  }
  if (env.VERCEL) {
    log("[privacy] association-set auto-publish: off on Vercel (serverless); run npm run zk:asp:publish from a scheduler instead");
    return null;
  }
  const chains = cfg.chains.filter((c) => c.pool !== null && c.problems.length === 0 && c.aspPostmanPrivateKey !== null);
  for (const c of cfg.chains) {
    if (chains.includes(c)) continue;
    const why = !c.pool && c.problems.length === 0 ? "no pool yet" : c.problems.length > 0 ? "its pool is unavailable (configuration)" : "no postman key";
    log(`[privacy] ${c.network.name} (${c.chainId}): association-set auto-publish skipped: ${why}`);
  }
  if (chains.length === 0) return null;
  log(
    `[privacy] association-set auto-publish: every ${interval} s on ${chains.map((c) => `${c.network.name} (${c.chainId})`).join(", ")} (a root only when one is due, never while the publisher cannot pay)`,
  );
  const chainIds = chains.map((c) => c.chainId);
  setAutoPublishRunning(chainIds, interval);

  let stopped = false;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** per pool: run its tick now (a tick in flight runs once more right after it) */
  const runNow = new Map<number, () => void>();
  for (const c of chains) {
    const name = `${c.network.name} (${c.chainId})`;
    let failures = 0;
    let last: string | null = null;
    let busy = false;
    let again = false;
    const schedule = (seconds: number) => {
      if (stopped) return;
      const timer = setTimeout(() => void run(), seconds * 1000);
      (timer as { unref?: () => void }).unref?.();
      timers.set(c.chainId, timer);
    };
    const run = async () => {
      if (stopped) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      const pending = timers.get(c.chainId);
      if (pending) clearTimeout(pending);
      timers.delete(c.chainId);
      let tick: AutoPublishTick;
      try {
        tick = await autoPublishTick(c.chainId);
      } finally {
        busy = false;
      }
      if (stopped) return;
      // quiet: every new post (each one a transaction this tick sent), and one line per change of state
      const state = tick.outcome === "policy_error" ? `policy_error|${tick.detail}` : tick.outcome;
      if (tick.outcome === "posted") {
        log(`[privacy] ${name}: auto-publish posted the association-set root (${tick.detail}${tick.txHash ? `, transaction ${tick.txHash}` : ""})`);
      } else if (state !== last) {
        if (tick.outcome === "unfunded") log(`[privacy] ${name}: auto-publish paused: ${tick.detail}`);
        else if (tick.outcome === "policy_error") log(`[privacy] ${name}: auto-publish paused: ${tick.detail}; nothing is posted until it is fixed`);
        else if (tick.outcome === "waiting") log(`[privacy] ${name}: auto-publish waiting: ${tick.detail}`);
        else if (tick.outcome === "failed") log(`[privacy] ${name}: auto-publish failed (${tick.detail}); it backs off and tries again`);
        else if (tick.outcome === "no_pool" || tick.outcome === "no_key") log(`[privacy] ${name}: auto-publish has nothing to do (${tick.detail})`);
        else if (last === "unfunded" || last === "failed" || last?.startsWith("policy_error|")) log(`[privacy] ${name}: auto-publish running again`);
      }
      last = state;
      failures = tick.outcome === "failed" ? failures + 1 : 0;
      if (again) {
        again = false;
        void run();
        return;
      }
      schedule(Math.min(interval * 2 ** failures, Math.max(interval, MAX_BACKOFF_SECONDS)));
    };
    runNow.set(c.chainId, () => void run());
    schedule(o.firstTickSeconds ?? Math.min(interval, FIRST_TICK_MAX_SECONDS));
  }

  // The exclusion list's file, checked on its own clock: a settled change that removes a member runs that pool's tick.
  const source = cfg.aspExclusions;
  let watcher: ReturnType<typeof setTimeout> | null = null;
  if (source.kind === "file") {
    const checkMs = (o.exclusionsCheckSeconds ?? EXCLUSIONS_CHECK_SECONDS) * 1000;
    const settleMs = (o.exclusionsSettleSeconds ?? EXCLUSIONS_SETTLE_SECONDS) * 1000;
    // the list at start counts as seen: the first scheduled ticks post whatever it asks for
    let applied = readExclusions(source).version;
    const check = async () => {
      if (stopped) return;
      const list = readExclusions(source);
      if (list.version !== applied && Date.now() - list.changedAt >= settleMs) {
        applied = list.version;
        if (list.status === "ok") {
          for (const c of chains) {
            if (stopped) return;
            if (await listsCurrentMember(c.chainId)) {
              log(`[privacy] ${c.network.name} (${c.chainId}): the exclusion list changed and names a member of the current root: publishing now`);
              runNow.get(c.chainId)?.();
            }
          }
        }
      }
      if (stopped) return;
      watcher = setTimeout(() => void check(), checkMs);
      (watcher as { unref?: () => void }).unref?.();
    };
    watcher = setTimeout(() => void check(), checkMs);
    (watcher as { unref?: () => void }).unref?.();
  }

  return {
    chainIds,
    intervalSeconds: interval,
    watchesExclusions: source.kind === "file",
    stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (watcher) clearTimeout(watcher);
      watcher = null;
      setAutoPublishRunning(chainIds, null);
    },
  };
}
