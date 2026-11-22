/**
 * Chain → local state reconstruction.
 *
 * Everything here consumes only public data (events) plus — for note
 * discovery — the user's master keys. Used by the browser app, the server-side
 * association-set provider and the e2e prototype.
 */
import type { Address, PublicClient } from "viem";
import { PRIVACY_POOL_ABI } from "./abi";
import { TREE_DEPTH } from "./constants";
import { SNARK_SCALAR_FIELD } from "./constants";
import { PRIVACY_POOL_V2_ABI } from "./v2/abi";
import { isV2Protocol, protocolDefinition, type PrivacyProtocol } from "./protocols";
import { MerkleTree } from "./merkleTree";
import {
  computeCommitment,
  computeNullifierHash,
  computePrecommitment,
  deriveNoteSecrets,
  type MasterKeys,
  type Note,
} from "./notes";
import type { DepositedEvent, PoolEvent, RagequitEvent, WithdrawnEvent } from "./types";

const POOL_EVENTS = PRIVACY_POOL_ABI.filter(item => item.type === "event");

/** Chain order: block number, then log index. */
const byBlockAndLog = (a: PoolEvent, b: PoolEvent): number =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

export interface FetchOptions {
  protocol?: PrivacyProtocol;
  /** initial block span per eth_getLogs call; halves automatically on provider errors */
  chunkSize?: bigint;
  minChunkSize?: bigint;
  /**
   * eth_getLogs calls in flight at once (default 1: one after another). A cold scan of a fast chain is many chunks
   * (Robinhood Chain Testnet makes about 420,000 blocks a day); with a batching transport the calls of one round go
   * out as one HTTP request. Rounds stay in block order, and only a run of completed chunks counts as scanned.
   */
  concurrency?: number;
  /**
   * Called for each scanned chunk, in block order, with that chunk's events (unsorted): everything up to `toBlock` is
   * scanned. A caller can keep the progress, so an interrupted scan resumes instead of starting over.
   */
  onProgress?: (fromBlock: bigint, toBlock: bigint, events: readonly PoolEvent[]) => void;
}

function isRangeError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return /range|limit|too many|exceed|10000|block span|response size/.test(msg);
}

type PoolLog = Awaited<ReturnType<typeof getChunkLogs>>[number];

function getChunkLogs(client: PublicClient, pool: Address, fromBlock: bigint, toBlock: bigint, protocol?: PrivacyProtocol) {
  const events = isV2Protocol(protocol) ? PRIVACY_POOL_V2_ABI.filter(item => item.type === "event") : POOL_EVENTS;
  return client.getLogs({ address: pool, events, fromBlock, toBlock, strict: true });
}

function decodeLog(log: PoolLog, protocol?: PrivacyProtocol): PoolEvent | null {
  const base = { blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
  switch (log.eventName) {
    case "Deposited": {
      const nonce = "recoveryNonce" in log.args ? log.args.recoveryNonce : undefined;
      if (isV2Protocol(protocol) && (typeof nonce !== "bigint" || nonce <= 0n || nonce >= SNARK_SCALAR_FIELD)) {
        throw new Error("V2 deposit has an invalid recovery nonce");
      }
      return {
        kind: "deposit",
        depositor: log.args.depositor,
        commitment: log.args.commitment,
        label: log.args.label,
        value: log.args.value,
        precommitment: log.args.precommitment,
        ...(isV2Protocol(protocol) ? { recoveryNonce: nonce as bigint } : {}),
        leafIndex: log.args.leafIndex,
        ...base,
      };
    }
    case "Withdrawn":
      return {
        kind: "withdraw",
        recipient: log.args.recipient,
        relayer: log.args.relayer,
        value: log.args.value,
        fee: log.args.fee,
        spentNullifier: log.args.spentNullifier,
        newCommitment: log.args.newCommitment,
        leafIndex: log.args.leafIndex,
        ...base,
      };
    case "Ragequit":
      return {
        kind: "ragequit",
        ragequitter: log.args.ragequitter,
        commitment: log.args.commitment,
        label: log.args.label,
        value: log.args.value,
        ...base,
      };
    case "ASPRootUpdated":
      return { kind: "asproot", root: log.args.root, cid: log.args.cid, ...base };
    default:
      return null;
  }
}

/** Fetch and decode all pool events in [fromBlock, toBlock]. Ordered by (block, logIndex). */
export async function fetchPoolEvents(
  client: PublicClient,
  pool: Address,
  fromBlock: bigint,
  toBlock: bigint,
  opts: FetchOptions = {},
): Promise<PoolEvent[]> {
  if (opts.protocol !== undefined) protocolDefinition(opts.protocol);
  const minChunk = opts.minChunkSize ?? 500n;
  let chunk = opts.chunkSize ?? 20_000n;
  const parallel = Math.max(1, Math.floor(Number.isFinite(opts.concurrency) ? (opts.concurrency as number) : 1));
  const out: PoolEvent[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    // the next round: up to `parallel` consecutive chunks from the cursor
    const spans: { from: bigint; to: bigint }[] = [];
    for (let from = cursor; spans.length < parallel && from <= toBlock; ) {
      const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
      spans.push({ from, to });
      from = to + 1n;
    }
    const results = await Promise.allSettled(spans.map(s => getChunkLogs(client, pool, s.from, s.to, opts.protocol)));
    // Only the run of completed chunks from the cursor counts; a range error halves the chunk and the round starts
    // again at the first chunk that failed (a later chunk that completed is fetched again, never kept twice).
    for (let i = 0; i < spans.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        if (chunk > minChunk && isRangeError(r.reason)) {
          chunk = chunk / 2n < minChunk ? minChunk : chunk / 2n;
          break;
        }
        throw r.reason;
      }
      const events: PoolEvent[] = [];
      for (const log of r.value) {
        const e = decodeLog(log, opts.protocol);
        if (e) events.push(e);
      }
      out.push(...events);
      opts.onProgress?.(spans[i].from, spans[i].to, events);
      cursor = spans[i].to + 1n;
    }
  }
  out.sort(byBlockAndLog);
  return out;
}

/** eth_getLogs calls in flight at once during a scan, on the server and on the device (see FetchOptions.concurrency). */
export const SCAN_CONCURRENCY = 4;

/**
 * Drops cached events with blockNumber >= fromBlock, appends fresh, sorts by (blockNumber, logIndex).
 *
 * `fresh` is a complete scan of [fromBlock, head]. A reorg inside that range can move a transaction to another block
 * and give it another log index, so a cached event is never matched against a fresh one: everything from
 * `fromBlock` on is replaced. stateLeaves() still fails closed on a leaf gap if a scan was incomplete.
 */
export function mergePoolEvents(cached: readonly PoolEvent[], fresh: readonly PoolEvent[], fromBlock: bigint): PoolEvent[] {
  const out = cached.filter(e => e.blockNumber < fromBlock);
  out.push(...fresh);
  return out.sort(byBlockAndLog);
}

/**
 * The next block range to scan, or null to keep the cache as it is.
 *
 * null when head < lastBlock: the RPC is behind what was already scanned (a lagging node or a deep reorg), and
 * scanning would duplicate or drop events. Else from = max(deployBlock, lastBlock + 1 - reorgWindow), to = head, so
 * every sync scans the trailing `reorgWindow` blocks again; without a cache (lastBlock null) from = deployBlock.
 * `from` can exceed `to` when there is nothing new (reorgWindow 0 and head == lastBlock): fetchPoolEvents() then
 * makes no call and returns no event.
 */
export function nextScanRange(o: {
  deployBlock: bigint;
  lastBlock: bigint | null;
  head: bigint;
  reorgWindow: number;
}): { from: bigint; to: bigint } | null {
  if (o.lastBlock !== null && o.head < o.lastBlock) return null;
  const window = windowBlocks(o.reorgWindow);
  const resume = o.lastBlock === null ? o.deployBlock : o.lastBlock + 1n - window;
  return { from: resume > o.deployBlock ? resume : o.deployBlock, to: o.head };
}

const windowBlocks = (reorgWindow: number): bigint => BigInt(Math.max(0, Math.floor(Number.isFinite(reorgWindow) ? reorgWindow : 0)));

/**
 * What a sync does when the RPC's head is below the block a pool's cache was scanned to (nextScanRange gave null):
 *   - "keep": the head is inside the reorg window below that block, which is what a node a few blocks behind looks
 *     like. The cache stays as it is; the next sync whose head passes it re-scans the window as usual.
 *   - "rescan": the head fell further than the window, or fell at all on a chain without one (reorgWindow 0: a local
 *     chain that was restarted or reverted). The cache no longer describes the chain this RPC serves (a restart, a
 *     revert, a regenesis, or a node far behind), so it is dropped and the pool is scanned again from its deploy
 *     block. Keeping it would serve reverted events, and the head might never pass it again.
 */
export function headRegression(o: { lastBlock: bigint; head: bigint; reorgWindow: number;
}): "keep" | "rescan" {
  if (o.head >= o.lastBlock) return "keep";
  const window = windowBlocks(o.reorgWindow);
  return window > 0n && o.head + window >= o.lastBlock ? "keep" : "rescan";
}

/** Leaves of the state tree in insertion order (deposit commitments and withdrawal change commitments). */
export function stateLeaves(events: readonly PoolEvent[]): bigint[] {
  const leaves: { index: number; leaf: bigint }[] = [];
  for (const e of events) {
    if (e.kind === "deposit") leaves.push({ index: e.leafIndex, leaf: e.commitment });
    else if (e.kind === "withdraw") leaves.push({ index: e.leafIndex, leaf: e.newCommitment });
  }
  leaves.sort((a, b) => a.index - b.index);
  leaves.forEach((l, i) => {
    if (l.index !== i) throw new Error(`state tree gap: expected leaf ${i}, got ${l.index}`);
  });
  return leaves.map(l => l.leaf);
}

export function buildStateTree(events: readonly PoolEvent[]): MerkleTree {
  return new MerkleTree(TREE_DEPTH, stateLeaves(events));
}

export interface DiscoveryResult {
  notes: Note[];
  /** next unused deposit index for this seed */
  nextDepositIndex: number;
  /** deposit indices that were used more than once (same precommitment, several deposits) */
  conflicts: number[];
}

export const NOTE_DISCOVERY_GAP_LIMIT = 10;

/**
 * Walk the deterministic derivation tree and match it against chain events.
 * Stops after `gapLimit` consecutive unused deposit indices.
 */
export function discoverNotes(
  keys: MasterKeys,
  scope: bigint,
  events: readonly PoolEvent[],
  gapLimit: number = NOTE_DISCOVERY_GAP_LIMIT
): DiscoveryResult {
  const depositsByPre = new Map<bigint, DepositedEvent[]>();
  const withdrawByNullifier = new Map<bigint, WithdrawnEvent>();
  const ragequitByCommitment = new Map<bigint, RagequitEvent>();
  for (const e of events) {
    if (e.kind === "deposit") {
      const list = depositsByPre.get(e.precommitment) ?? [];
      list.push(e);
      depositsByPre.set(e.precommitment, list);
    } else if (e.kind === "withdraw") withdrawByNullifier.set(e.spentNullifier, e);
    else if (e.kind === "ragequit") ragequitByCommitment.set(e.commitment, e);
  }

  const notes: Note[] = [];
  const conflicts: number[] = [];
  let lastUsed = -1;
  let gap = 0;
  for (let i = 0; gap < gapLimit; i++) {
    const secrets0 = deriveNoteSecrets(keys, scope, i, 0);
    const deposits = depositsByPre.get(computePrecommitment(secrets0));
    if (!deposits || deposits.length === 0) {
      gap++;
      continue;
    }
    gap = 0;
    lastUsed = i;
    if (deposits.length > 1) conflicts.push(i);

    for (const dep of deposits) {
      let hop = 0;
      let value = dep.value;
      let secrets = secrets0;
      let commitment = dep.commitment;
      let leafIndex = dep.leafIndex;
      let blockNumber = dep.blockNumber;
      let txHash = dep.txHash;
      for (;;) {
        const nullifierHash = computeNullifierHash(secrets.nullifier);
        const note: Note = {
          depositIndex: i,
          hop,
          value,
          label: dep.label,
          nullifier: secrets.nullifier,
          secret: secrets.secret,
          precommitment: computePrecommitment(secrets),
          commitment,
          nullifierHash,
          leafIndex,
          blockNumber,
          txHash,
          spent: false,
        };
        const rq = ragequitByCommitment.get(commitment);
        if (rq) {
          note.spent = true;
          note.spentBy = { kind: "ragequit", txHash: rq.txHash, blockNumber: rq.blockNumber };
          notes.push(note);
          break;
        }
        const w = withdrawByNullifier.get(nullifierHash);
        if (!w) {
          notes.push(note);
          break;
        }
        note.spent = true;
        note.spentBy = { kind: "withdraw", txHash: w.txHash, blockNumber: w.blockNumber };
        notes.push(note);

        // follow the change note
        hop += 1;
        const nextSecrets = deriveNoteSecrets(keys, scope, i, hop);
        const remainder = value - w.value;
        const expected = computeCommitment(remainder, dep.label, computePrecommitment(nextSecrets));
        if (remainder < 0n || expected !== w.newCommitment) break; // not derived by us; stop here
        value = remainder;
        secrets = nextSecrets;
        commitment = w.newCommitment;
        leafIndex = w.leafIndex;
        blockNumber = w.blockNumber;
        txHash = w.txHash;
      }
    }
  }
  return { notes, nextDepositIndex: lastUsed + 1, conflicts };
}

export const spendableNotes = (notes: readonly Note[]): Note[] => notes.filter(n => !n.spent && n.value > 0n);
export const privateBalance = (notes: readonly Note[]): bigint => spendableNotes(notes).reduce((s, n) => s + n.value, 0n);
