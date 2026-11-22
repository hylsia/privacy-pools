/**
 * The eviction burst: an opt-in operator command that closes the window an excluded deposit keeps after its removal.
 *
 * Why there is a window: the pool contract keeps the last 16 association-set roots (ASP_ROOT_HISTORY_SIZE) and accepts
 * a proof against any of them. After a removal root, the older roots that still hold the excluded deposit stay valid
 * until enough newer roots are posted to overwrite their slots: each post writes slot (currentASPRootIndex + 1) % 16,
 * so a root at ring distance d (0 = current) is overwritten by the (16 - d)th post after now. The official app only
 * proves against the current root and the relayer refuses older roots that hold an excluded deposit
 * (asp.ts refusedASPRoot), so the window left is a modified client paying its own gas. updateASPRoot accepts a duplicate
 * root, so re-posting the current root (with its own record, unchanged for devices) pushes the older roots out.
 *
 * planEviction reads the ring from the contract (currentASPRootIndex and aspRoots(0..15): never from events, which can
 * lag), maps each root value to its member list with the server's events (screening.ts checkRoot: a root binds its
 * list, so any of its records that rebuilds to it decides), and counts the posts needed: 16 - the smallest distance of
 * an older slot whose list holds an excluded deposit or cannot be rebuilt here. It sends nothing.
 *
 * evictExcludedRoots sends those posts only with `send` (the CLI's --evict --yes --chain <id>; never from a request or
 * a tick): it refuses unless the current root is clean (no excluded deposit, its record verifies), publishing is not
 * paused and the postman can pay for every post up front. The same postman key may post from another process at the
 * same time (the periodic publisher, a withdrawal's publish request), so before each post it:
 *   - waits while the postman has a transaction in flight (pending nonce above the mined one): a post sent before it
 *     but not mined yet is invisible to a state read, and a re-post queued behind it would make an older root current
 *     again over a newer one (or over a record that lists a new exclusion);
 *   - reads a fresh snapshot: the current root AND its newest record. Another process may have posted a new root, or
 *     the same root with a new record: that one is re-posted instead, when its record verifies here and it holds no
 *     excluded deposit; any other stops the burst. While the server's events lack the new root's event (logs behind
 *     state) it waits and reads again;
 *   - sends with the nonce it read, so a post another process sends meanwhile takes that nonce and this one fails with
 *     a nonce clash ("nonce too low" once that post is mined, "replacement transaction underpriced" while it is pending
 *     at the same fee: both price from the same RPC's estimate) instead of queueing behind it; a clash goes back to the
 *     first step. One exception: a node whose mempool replaces a pending transaction by fee (anvil, geth) takes ours
 *     in place of a post of that nonce still pending at a clearly lower fee. That post's newer root is then never
 *     mined: the server answers "pending" for it until PENDING_PUBLISH_MS (10 minutes), then posts it again.
 * Each wait is 2 s: at most 15 waits (for a transaction in flight or a lagging event) and 3 nonce clashes per burst,
 * then it stops, which is safe. It stops early once the offending roots are unknown to the contract. A post of its own
 * not mined within 120 s stops it too (that post may still land). So, but for that fee exception, it never re-posts an
 * older root, or an older record, over a newer one.
 *
 * Side effects: proofs made against the evicted roots stop verifying (a relayer refusal already, for the app; a proof
 * made against the current root, which the app always uses, stays valid); the ring then holds copies of the current
 * root; each post costs one publish's gas (measured on anvil: about 55 k on a slot never written, 38 k on a filled one).
 */
import { BaseError, formatEther, NonceTooLowError, WaitForTransactionReceiptTimeoutError, type Address, type Hex } from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import { rootRecordOf } from "../../shared/privacy/screening";
import { ensurePoolContract, excludedLabelsOf, getScreenedSet, rootTaint, verifiedCurrent, type ScreenedSet } from "./asp";
import { getPublicClient, makeWalletClient } from "./chain";
import { chainConfig, keyAddress } from "./config";
import { oneTransactionCost, PUBLISH_GAS, readFunding } from "./funding";

export type RootTaint = "holds" | "clean" | "unverifiable";

export interface RingEntry {
  /** the contract's slot (0..15) */
  slot: number;
  root: bigint;
  /** 0: the current root; d: overwritten by the (16 - d)th post from now */
  distance: number;
  /** what its member list holds, from the server's events */
  taint: RootTaint;
}

export interface EvictionPlan {
  chainId: number;
  pool: Address;
  /** ASP_ROOT_HISTORY_SIZE (16) */
  ringSize: number;
  /** currentASPRootIndex() */
  currentIndex: number;
  currentRoot: bigint;
  /** the cid every re-post carries: the current root's newest record; null when the server's events lack it */
  currentCid: string | null;
  /** the ring, newest first; slots never written (root 0) are left out */
  ring: RingEntry[];
  /** deposits the exclusion list names in this pool */
  excludedDeposits: number;
  /** older slots whose root holds an excluded deposit or cannot be rebuilt here, nearest first */
  offending: { slot: number; root: bigint; distance: number; taint: Exclude<RootTaint, "clean"> }[];
  /** 16 - the smallest distance of an offending slot; 0 when none */
  postsNeeded: number;
  gasPrice: bigint | null;
  /** what the postman must hold for every post: postsNeeded x one publish's cost at the gas price, with the margin */
  costWei: bigint;
  /** the postman's balance; null without a key or when it could not be read */
  balance: bigint | null;
  /** why sending would be refused now (empty: it may send) */
  blockers: string[];
}

export type Post = { txHash: Hex; gasUsed: bigint; block: bigint };

export interface EvictionResult {
  plan: EvictionPlan;
  postsNeeded: number;
  posts: Post[];
  /** no offending root is known to the contract any more */
  evicted: boolean;
  ms: number;
}

const read = <T>(chainId: number, pool: Address, functionName: string, args?: readonly unknown[]) =>
  getPublicClient(chainId).readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;

/** The contract's ring, read from its own state: the slot index of the newest post and every slot's root. */
async function readRing(chainId: number, pool: Address): Promise<{ size: number; index: number; slots: bigint[] }> {
  const size = Number(await read<number>(chainId, pool, "ASP_ROOT_HISTORY_SIZE"));
  const [index, ...slots] = await Promise.all([
    read<number>(chainId, pool, "currentASPRootIndex"),
    ...Array.from({ length: size }, (_, i) => read<bigint>(chainId, pool, "aspRoots", [BigInt(i)])),
  ]);
  return { size, index: Number(index), slots };
}

function planFrom(s: ScreenedSet, ring: { size: number; index: number; slots: bigint[] }): Omit<EvictionPlan, "gasPrice" | "costWei" | "balance" | "blockers"> {
  const excluded = excludedLabelsOf(s);
  const taints = new Map<bigint, RootTaint>();
  const taintOf = (root: bigint) => {
    let t = taints.get(root);
    if (t === undefined) {
      t = excluded.size === 0 ? "clean" : rootTaint(s.events, root, excluded);
      taints.set(root, t);
    }
    return t;
  };
  const currentRoot = ring.slots[ring.index] ?? 0n;
  const entries: RingEntry[] = [];
  ring.slots.forEach((root, slot) => {
    if (root === 0n) return; // never written: never known
    entries.push({ slot, root, distance: (ring.index - slot + ring.size) % ring.size, taint: taintOf(root) });
  });
  entries.sort((a, b) => a.distance - b.distance);
  const offending = entries
    .filter((e): e is RingEntry & { taint: Exclude<RootTaint, "clean"> } => e.distance > 0 && e.root !== currentRoot && e.taint !== "clean")
    .map(({ slot, root, distance, taint }) => ({ slot, root, distance, taint }));
  return {
    chainId: s.chainId,
    pool: s.pool,
    ringSize: ring.size,
    currentIndex: ring.index,
    currentRoot,
    currentCid: currentRoot !== 0n ? (rootRecordOf(s.events, currentRoot)?.cid ?? null) : null,
    ring: entries,
    excludedDeposits: excluded.size,
    offending,
    postsNeeded: offending.length === 0 ? 0 : ring.size - Math.min(...offending.map((o) => o.distance)),
  };
}

/** The burst's plan for one pool (fresh events, the ring from the contract, the postman's balance). Sends nothing. */
export async function planEviction(chainId: number): Promise<EvictionPlan> {
  const { cfg, pool } = await ensurePoolContract(chainId);
  const s = await getScreenedSet({ chainId, fresh: true });
  const base = planFrom(s, await readRing(chainId, pool));
  const blockers: string[] = [];
  const current = base.ring.find((e) => e.distance === 0) ?? null;
  // every re-post carries the current root's newest record, the one devices read: it must rebuild to the root here
  const newestVerifies = s.currentRoot === base.currentRoot && verifiedCurrent(s) !== null;
  if (base.currentRoot === 0n) blockers.push("no association-set root is posted yet");
  else if (current?.taint === "holds") blockers.push("the current root still holds an excluded deposit: publish its removal first (npm run zk:asp:publish)");
  else if (current?.taint === "unverifiable" || base.currentCid === null || !newestVerifies) {
    blockers.push("the current root's record does not rebuild to it from this server's events: publish first (npm run zk:asp:publish), or sync and try again");
  }
  if (s.exclusions.status === "invalid") blockers.push(`the exclusion list is invalid (${s.exclusions.error}): fix it first`);
  if (s.policyError !== null && s.exclusions.status !== "invalid") blockers.push(`publishing is paused: ${s.policyError}`);
  const me = keyAddress(cfg.aspPostmanPrivateKey);
  let gasPrice: bigint | null = null;
  let balance: bigint | null = null;
  let costWei = 0n;
  if (!me) blockers.push("no postman key (PRIVACY_ASP_POSTMAN_PRIVATE_KEY)");
  else {
    const postman = await read<Address>(chainId, pool, "aspPostman");
    if (postman.toLowerCase() !== me.toLowerCase()) blockers.push("the postman key is not this pool's aspPostman");
    const funding = await readFunding(chainId, { fresh: true });
    if (funding?.postman) {
      gasPrice = funding.gasPrice;
      balance = funding.postman.balance;
      costWei = BigInt(base.postsNeeded) * oneTransactionCost(gasPrice, PUBLISH_GAS);
      if (base.postsNeeded > 0 && balance < costWei) {
        blockers.push(`the publisher holds ${formatEther(balance)} ETH; ${base.postsNeeded} posts need about ${formatEther(costWei)} ETH (with the margin)`);
      }
    } else if (base.postsNeeded > 0) blockers.push("the publisher's balance could not be read");
  }
  return { ...base, gasPrice, costWei, balance, blockers };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** what a node says when another transaction of the same account took the nonce (viem's NonceTooLowError covers most) */
const NONCE_CLASH_TEXT = /nonce too low|nonce has already been used|replacement transaction underpriced|already known|nonce.*expired|lower than the current nonce/i;
/** retries after a nonce clash, for the whole burst */
const MAX_CLASHES = 3;
/** waits for another postman transaction in flight, or for the event of a root another process posted, for the whole burst */
const MAX_WAITS = 15;
/** how long the burst waits for each of its own posts to be mined */
const RECEIPT_TIMEOUT_MS = 120_000;

/**
 * Another transaction of the postman took the nonce: viem's NonceTooLowError anywhere in the error's chain, or a node
 * message that says so (viem's short message alone does not: "Nonce provided for the transaction is lower than ...").
 */
export function isNonceClash(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof NonceTooLowError)) return true;
  const text = err instanceof BaseError ? `${err.shortMessage} ${err.details ?? ""} ${err.message}` : err instanceof Error ? err.message : String(err);
  return NONCE_CLASH_TEXT.test(text);
}

/**
 * The burst (see the top of this file). Without `send` it only plans. With it, it refuses (throws) on any blocker,
 * then re-posts the current root until no offending root is known, at most postsNeeded times. Before every post it
 * waits until the postman has no transaction in flight, then reads the current root and its newest record from a
 * fresh snapshot, and sends with the nonce it read; a nonce clash means another post took that nonce (the
 * auto-publisher, or a withdrawal's publish request), which may be a new removal root, so the burst goes back to that
 * check instead of re-sending what it had: it never posts an older root, or an older record, over a newer one (except
 * on a node that replaces a pending post of a clearly lower fee by ours: see the top of this file). A post of its own
 * that is not mined within RECEIPT_TIMEOUT_MS stops the burst with a message that says so.
 */
export async function evictExcludedRoots(
  chainId: number,
  o: { send: boolean; onPost?: (k: number, post: Post) => void | Promise<void>; retryDelayMs?: number },
): Promise<EvictionResult> {
  const started = Date.now();
  const plan = await planEviction(chainId);
  const done = (posts: Post[], evicted: boolean): EvictionResult => ({ plan, postsNeeded: plan.postsNeeded, posts, evicted, ms: Date.now() - started });
  if (plan.postsNeeded === 0) return done([], true);
  if (!o.send) return done([], false);
  if (plan.blockers.length > 0) throw new Error(`eviction refused: ${plan.blockers.join("; ")}`);

  const cfg = chainConfig(chainId);
  const pool = plan.pool;
  const client = getPublicClient(chainId);
  const wallet = makeWalletClient(cfg.aspPostmanPrivateKey!, chainId);
  const offendingRoots = [...new Set(plan.offending.map((x) => x.root))];
  const anyKnown = async () => (await Promise.all(offendingRoots.map((r) => read<boolean>(chainId, pool, "isKnownASPRoot", [r])))).some(Boolean);

  // the plan's offending roots must still be known now (another post may have pushed them out already)
  if (!(await anyKnown())) return done([], true);

  const me = wallet.account!.address;
  let root = plan.currentRoot;
  let cid = plan.currentCid!;
  const posts: Post[] = [];
  let clashes = 0;
  let waits = 0;
  const wait = async (why: string) => {
    if (waits >= MAX_WAITS) throw new Error(`${why}; stopped after ${posts.length} post(s)`);
    waits++;
    await sleep(o.retryDelayMs ?? 2_000);
  };
  for (let k = 1; k <= plan.postsNeeded; ) {
    // 1. no postman transaction in flight: one sent by another process but not mined yet is invisible to the read below,
    //    and a post of ours queued behind it would land on top of it
    const [mined, pending] = await Promise.all([
      client.getTransactionCount({ address: me, blockTag: "latest" }),
      client.getTransactionCount({ address: me, blockTag: "pending" }),
    ]);
    if (pending > mined) {
      await wait("another postman transaction stayed in flight during the burst");
      continue;
    }
    // 2. the current root and its newest record, fresh: another process may have posted a new root, or the same root
    //    with a new record; re-post that instead, when its record verifies here and it holds no excluded deposit
    const s = await getScreenedSet({ chainId, fresh: true });
    const rec = s.currentRoot !== 0n ? rootRecordOf(s.events, s.currentRoot) : null;
    if (s.currentRoot !== root || !rec || rec.cid !== cid) {
      if (!rec) {
        await wait("the current root's event did not reach this server's events during the burst"); // logs behind state
        continue;
      }
      const verified = verifiedCurrent(s);
      const excluded = excludedLabelsOf(s);
      if (!verified || rec.cid === null || verified.labels.some((l) => excluded.has(l))) {
        throw new Error(`another root or record was posted during the burst that holds an excluded deposit or does not rebuild here; stopped after ${posts.length} post(s)`);
      }
      root = s.currentRoot;
      cid = rec.cid;
    }
    if (!(await anyKnown())) break; // evicted already
    // 3. send with the nonce read in step 1: a post another process sends meanwhile takes it, and ours clashes
    let post: Post;
    let txHash: Hex | null = null;
    try {
      const { request } = await client.simulateContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "updateASPRoot", args: [root, cid], account: wallet.account! });
      txHash = await wallet.writeContract({ ...request, nonce: mined });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
      if (receipt.status !== "success") throw new Error(`post ${k} reverted (transaction ${txHash})`);
      post = { txHash, gasUsed: receipt.gasUsed, block: receipt.blockNumber };
    } catch (err) {
      if (err instanceof WaitForTransactionReceiptTimeoutError) {
        // our own post is in flight: it may still land, so the burst stops here and says what it knows
        throw new Error(
          `post ${k} (transaction ${txHash}) was not mined within ${RECEIPT_TIMEOUT_MS / 1000} s and may still land; stopped after ${posts.length} post(s). The publisher answers "pending" while it is in flight: run the plan again once it is mined or dropped`,
        );
      }
      if (clashes >= MAX_CLASHES || !isNonceClash(err)) throw err;
      clashes++;
      await sleep(o.retryDelayMs ?? 2_000);
      continue; // back to the top: in flight, the current root and record again, and whether an offending root is known
    }
    posts.push(post);
    await o.onPost?.(k, post);
    k++;
  }
  return done(posts, !(await anyKnown()));
}
