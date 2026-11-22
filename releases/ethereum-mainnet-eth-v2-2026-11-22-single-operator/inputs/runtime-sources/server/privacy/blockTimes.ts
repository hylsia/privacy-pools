/**
 * Block timestamps per chain, shared by the association-set publisher (the screening policy's inclusion delay counts
 * from a deposit's block time: server/privacy/asp.ts) and the pools explorer (server/privacy/pools.ts).
 *
 * Keyed `${chainId}:${block}`: a block number means something only on its own chain. Public data only. A pool whose
 * chain was reset (a local chain restarted, a regenesis: asp.ts forgetPoolState) drops its chain's times, since its
 * block numbers now name other blocks.
 */
import { getPublicClient } from "./chain";

const times = new Map<string, number>();
const timeKey = (chainId: number, block: bigint) => `${chainId}:${block}`;
/** reads in flight at once per call */
const CONCURRENCY = 8;

/** One block's timestamp (unix seconds), read once and then cached. */
export async function blockTimestamp(chainId: number, block: bigint): Promise<number> {
  const key = timeKey(chainId, block);
  const hit = times.get(key);
  if (hit !== undefined) return hit;
  const b = await getPublicClient(chainId).getBlock({ blockNumber: block });
  const ts = Number(b.timestamp);
  times.set(key, ts);
  return ts;
}

/** The timestamps of many blocks of one chain, with bounded concurrency; returns that chain's lookup. */
export async function blockTimestamps(chainId: number, blocks: readonly bigint[]): Promise<(block: bigint) => number | undefined> {
  const queue = [...new Set(blocks.map(String))].filter((b) => !times.has(timeKey(chainId, BigInt(b))));
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let b = queue.shift(); b !== undefined; b = queue.shift()) await blockTimestamp(chainId, BigInt(b));
  });
  await Promise.all(workers);
  return (block) => times.get(timeKey(chainId, block));
}

/** per chain: the last head block whose time was read for a snapshot (only one is kept: a busy chain makes a new head every few seconds) */
const heads = new Map<number, { block: bigint; time: number }>();

/**
 * The timestamp of a chain's head block (the screening snapshot's time). Not added to the shared cache, which would grow
 * by one entry per snapshot on a busy chain: only the last head per chain is kept.
 */
export async function headTimestamp(chainId: number, block: bigint): Promise<number> {
  const cached = times.get(timeKey(chainId, block));
  if (cached !== undefined) return cached;
  const last = heads.get(chainId);
  if (last && last.block === block) return last.time;
  const b = await getPublicClient(chainId).getBlock({ blockNumber: block });
  const time = Number(b.timestamp);
  heads.set(chainId, { block, time });
  return time;
}

/** A cached timestamp, without any read. */
export function cachedBlockTime(chainId: number, block: bigint): number | undefined {
  return times.get(timeKey(chainId, block));
}

/** Drops one chain's times (its chain was reset). */
export function forgetBlockTimes(chainId: number): void {
  const prefix = `${chainId}:`;
  for (const key of times.keys()) if (key.startsWith(prefix)) times.delete(key);
  heads.delete(chainId);
}

/** test hook */
export function resetBlockTimes(): void {
  times.clear();
  heads.clear();
}
