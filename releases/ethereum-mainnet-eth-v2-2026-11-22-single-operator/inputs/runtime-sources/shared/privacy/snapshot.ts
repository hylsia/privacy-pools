/**
 * Static snapshots of a pool's state-tree events (Phase 5, resilience).
 *
 * A snapshot is a file served with the site (client/public/snapshots/<chainId>-<pool>.json, written by
 * `npm run zk:snapshot`). A device without a copy of the pool starts from it instead of scanning every block since the
 * pool's deployment, so the vault shows its notes quickly even when the public RPC is slow or limits old log ranges.
 * Every visitor fetches the same file with no input, so it says nothing about anyone.
 *
 * What a snapshot may hold, and how a device checks it:
 *   - Only the events that make the state tree: Deposited and Withdrawn, up to block `toBlock`. Ragequits and
 *     association-set roots are never taken from a snapshot.
 *   - Each deposit's commitment is recomputed from its value, label and precommitment, so those fields are bound to it.
 *   - The tree the snapshot builds has the stated leaf count and root.
 *   - The device checks the chain id, `toBlockHash`, SCOPE, root and leaf count at the exact checkpoint, adds the
 *     events after `toBlock` from its RPC, and the full tree must give a root the pool knows (the existing sync check).
 *     A forged or stale leaf cannot pass that.
 *   - The rest of the history (ragequits, roots, and the fields the tree does not bind) comes from a full scan the
 *     device runs right after, in the background. Until it ends the pool's history counts as unverified, and the app
 *     holds private withdrawals back.
 */
import type { Address, Hex, PublicClient } from "viem";
import { MerkleTree } from "./merkleTree";
import { MAX_VALUE, SNARK_SCALAR_FIELD, TREE_DEPTH } from "./constants";
import { PRIVACY_POOL_ABI } from "./abi";
import { computeScope } from "./context";
import { stateLeaves } from "./indexer";
import { computeCommitment } from "./notes";
import type { DepositedEvent, PoolEvent, WithdrawnEvent } from "./types";

export const SNAPSHOT_FORMAT = "hylsia-pool-snapshot";
export const SNAPSHOT_VERSION = 1;
/** Served at this path, next to the page: the same file for every visitor. */
export const snapshotPath = (chainId: number, pool: Address): string => `/snapshots/${chainId}-${pool.toLowerCase()}.json`;

export type TreeEvent = DepositedEvent | WithdrawnEvent;

export interface PoolSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  chainId: number;
  pool: Address;
  deployBlock: bigint;
  toBlock: bigint;
  toBlockHash: Hex;
  leafCount: number;
  stateRoot: bigint;
  /** unix seconds when it was written (informational) */
  createdAt: number;
  events: TreeEvent[];
}

const BIG = "$bigint";

/** JSON with bigints as {"$bigint": "…"} (the device cache's encoding, client/src/privacy/storage.ts). */
export function encodeSnapshot(s: PoolSnapshot): string {
  return JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? { [BIG]: v.toString() } : v));
}

function decode(text: string): unknown {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && BIG in v && typeof v[BIG] === "string" && /^\d+$/.test(v[BIG]) ? BigInt(v[BIG]) : v));
}

const isBig = (v: unknown): v is bigint => typeof v === "bigint" && v >= 0n;
const isField = (v: unknown): v is bigint => isBig(v) && v < SNARK_SCALAR_FIELD;
const isValue = (v: unknown): v is bigint => isBig(v) && v <= MAX_VALUE;
const isAddr = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHash = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function treeEvent(e: unknown, from: bigint, to: bigint): TreeEvent | null {
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  if (!isBig(x.blockNumber) || x.blockNumber < from || x.blockNumber > to || !isHash(x.txHash) || !isIndex(x.logIndex) || !isIndex(x.leafIndex) || x.leafIndex >= 2 ** TREE_DEPTH) return null;
  if (x.kind === "deposit") {
    if (!isAddr(x.depositor) || !isField(x.commitment) || !isField(x.label) || !isValue(x.value) || !isField(x.precommitment)) return null;
    return {
      kind: "deposit",
      depositor: x.depositor,
      commitment: x.commitment,
      label: x.label,
      value: x.value,
      precommitment: x.precommitment,
      leafIndex: x.leafIndex,
      blockNumber: x.blockNumber,
      txHash: x.txHash,
      logIndex: x.logIndex,
    };
  }
  if (x.kind === "withdraw") {
    if (!isAddr(x.recipient) || !isAddr(x.relayer) || !isValue(x.value) || !isValue(x.fee) || x.fee > x.value || !isField(x.spentNullifier) || !isField(x.newCommitment)) return null;
    return {
      kind: "withdraw",
      recipient: x.recipient,
      relayer: x.relayer,
      value: x.value,
      fee: x.fee,
      spentNullifier: x.spentNullifier,
      newCommitment: x.newCommitment,
      leafIndex: x.leafIndex,
      blockNumber: x.blockNumber,
      txHash: x.txHash,
      logIndex: x.logIndex,
    };
  }
  return null; // ragequits and roots never come from a snapshot
}

/**
 * Parse and check a snapshot for one pool, with no network access: the right pool, only tree events in its range,
 * every deposit's commitment recomputed, and a tree with the stated leaf count and root. Returns why not, if not.
 */
export function parseSnapshot(
  text: string,
  expect: { chainId: number; pool: Address; deployBlock: bigint },
): { ok: true; snapshot: PoolSnapshot; tree: MerkleTree } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = decode(text);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  const s = raw as Record<string, unknown>;
  if (!s || s.format !== SNAPSHOT_FORMAT) return { ok: false, error: "not a pool snapshot" };
  if (s.version !== SNAPSHOT_VERSION) return { ok: false, error: `snapshot version ${String(s.version)} is not supported` };
  if (s.chainId !== expect.chainId || !isAddr(s.pool) || s.pool.toLowerCase() !== expect.pool.toLowerCase()) return { ok: false, error: "another pool's snapshot" };
  if (s.deployBlock !== expect.deployBlock) return { ok: false, error: "the deploy block does not match this app's pool record" };
  if (!isBig(s.toBlock) || s.toBlock < expect.deployBlock || !isHash(s.toBlockHash) || !isIndex(s.leafCount) || s.leafCount > 2 ** TREE_DEPTH || !isField(s.stateRoot) || !Array.isArray(s.events) || s.events.length > 2 ** TREE_DEPTH) {
    return { ok: false, error: "malformed snapshot" };
  }
  const events: TreeEvent[] = [];
  for (const e of s.events) {
    const t = treeEvent(e, expect.deployBlock, s.toBlock);
    if (!t) return { ok: false, error: "the snapshot holds an event it may not" };
    if (t.kind === "deposit" && computeCommitment(t.value, t.label, t.precommitment) !== t.commitment) {
      return { ok: false, error: "a deposit's commitment does not match its fields" };
    }
    events.push(t);
  }
  let tree: MerkleTree;
  try {
    tree = new MerkleTree(TREE_DEPTH, stateLeaves(events as PoolEvent[]));
  } catch {
    return { ok: false, error: "the snapshot's tree has a gap" };
  }
  if (tree.leaves.length !== s.leafCount || tree.root !== s.stateRoot) return { ok: false, error: "the snapshot's tree does not match its stated root" };
  return {
    ok: true,
    snapshot: {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      chainId: expect.chainId,
      pool: s.pool,
      deployBlock: expect.deployBlock,
      toBlock: s.toBlock,
      toBlockHash: s.toBlockHash,
      leafCount: s.leafCount,
      stateRoot: s.stateRoot,
      createdAt: typeof s.createdAt === "number" ? s.createdAt : 0,
      events,
    },
    tree,
  };
}

/** The tree events of a scan, for writing a snapshot. */
export const treeEventsOf = (events: readonly PoolEvent[]): TreeEvent[] => events.filter((e): e is TreeEvent => e.kind === "deposit" || e.kind === "withdraw");

/**
 * Bind the parsed tree to this chain's exact checkpoint, including the empty tree. A formerly known root is not
 * enough: it could omit deposits made before toBlock. Historical calls unavailable, a reorg, or any mismatch means
 * the caller uses the ordinary full scan. No visitor or note data enters these calls.
 */
export async function verifySnapshotAgainstChain(s: PoolSnapshot, client: PublicClient, head: bigint): Promise<boolean> {
  if (s.toBlock > head) return false;
  try {
    const address = s.pool;
    const blockNumber = s.toBlock;
    const [chainId, block, root, count, scope] = await Promise.all([
      client.getChainId(),
      client.getBlock({ blockNumber }),
      client.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "getLastRoot", blockNumber }),
      client.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "nextIndex", blockNumber }),
      client.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "SCOPE", blockNumber }),
    ]);
    return chainId === s.chainId && block.hash?.toLowerCase() === s.toBlockHash.toLowerCase()
      && root === s.stateRoot && Number(count) === s.leafCount && scope === computeScope(s.pool, s.chainId);
  } catch {
    return false;
  }
}
