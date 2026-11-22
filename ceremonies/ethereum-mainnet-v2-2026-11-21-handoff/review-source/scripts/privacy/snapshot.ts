import { isV2Protocol } from "../../shared/privacy/protocols";
/**
 * npm run zk:snapshot [-- --chain <id>] [--out <dir>] [--include-local]
 *
 * Writes a static snapshot of each served pool's state-tree events (shared/privacy/snapshot.ts) to
 * client/public/snapshots/<chainId>-<pool>.json, served with the site. A device without a copy of the pool starts from
 * it, checks it against the chain and scans the rest of the history in the background.
 *
 * It reads public chain data only, through the server's RPC for each network (PRIVACY_RPC_URL_<id>, else the network's
 * default), and needs no key. It stops a reorg window short of the head, and writes a file only when the tree it
 * builds matches the pool's root and leaf count at that checkpoint and its own checks (parseSnapshot) pass.
 * Local chains (31337/31338) are skipped unless --include-local.
 *
 * Run it after deployment and then from time to time (a scheduler, or before each site build): an older snapshot is
 * still valid, the device just scans more blocks after it.
 */
import "../../server/_core/loadEnv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { buildStateTree, fetchPoolEvents } from "../../shared/privacy/indexer";
import { resolveNetworks } from "../../shared/privacy/networks";
import { encodeSnapshot, parseSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, snapshotPath, treeEventsOf, verifySnapshotAgainstChain, type PoolSnapshot } from "../../shared/privacy/snapshot";
import { describeError } from "../../server/privacy/errors";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (isV2Protocol(process.env.PRIVACY_PROTOCOL?.trim())) {
    throw new Error("V2 recovery nonces are not authenticated by v1 snapshots. Use a complete v2 RPC history scan.");
  }
  const onlyChain = arg("--chain") ? Number(arg("--chain")) : null;
  const includeLocal = process.argv.includes("--include-local");
  const outDir = resolve(arg("--out") ?? join(process.cwd(), "client", "public"));
  const { networks } = resolveNetworks((n) => process.env[n], DEPLOYMENTS);
  let written = 0;
  let failed = 0;
  for (const r of networks) {
    const id = r.network.chainId;
    if (onlyChain !== null && id !== onlyChain) continue;
    if (r.network.kind === "local" && !includeLocal) continue;
    if (!r.pool || r.deployBlock === null || r.problems.length) {
      console.log(`- ${r.network.name}: no usable pool, skipped`);
      continue;
    }
    try {
      const client = createPublicClient({ chain: r.network.chain, transport: http(r.rpcUrl, { batch: true, retryCount: 3 }) }) as PublicClient;
      const chainId = await client.getChainId();
      if (chainId !== id) throw new Error(`the RPC serves chain ${chainId}`);
      const head = await client.getBlockNumber({ cacheTime: 0 });
      const margin = BigInt(Math.max(0, r.network.reorgWindow));
      const toBlock = head - margin >= r.deployBlock ? head - margin : r.deployBlock;
      const block = await client.getBlock({ blockNumber: toBlock });
      const events = await fetchPoolEvents(client, r.pool, r.deployBlock, toBlock, {
        chunkSize: r.network.logChunk,
        minChunkSize: r.network.minLogChunk,
        concurrency: 4,
      });
      const tree = buildStateTree(events);
      const snap: PoolSnapshot = {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        chainId: id,
        pool: r.pool,
        deployBlock: r.deployBlock,
        toBlock,
        toBlockHash: block.hash,
        leafCount: tree.leaves.length,
        stateRoot: tree.root,
        createdAt: Math.floor(Date.now() / 1000),
        events: treeEventsOf(events),
      };
      const text = encodeSnapshot(snap);
      const check = parseSnapshot(text, { chainId: id, pool: r.pool, deployBlock: r.deployBlock });
      if (!check.ok) throw new Error(`the written snapshot fails its own check: ${check.error}`);
      if (!await verifySnapshotAgainstChain(check.snapshot, client, head)) throw new Error("the snapshot does not match the on-chain checkpoint; nothing written");
      const file = join(outDir, snapshotPath(id, r.pool).replace(/^\//, ""));
      mkdirSync(join(outDir, "snapshots"), { recursive: true });
      writeFileSync(file, text + "\n");
      written++;
      console.log(`✓ ${r.network.name}: ${snap.events.length} tree events, ${snap.leafCount} leaves, blocks ${r.deployBlock}..${toBlock} -> ${file}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${r.network.name}: ${describeError(err)}`);
    }
  }
  console.log(`${written} snapshot(s) written${failed ? `, ${failed} failed` : ""}`);
  if (failed) process.exitCode = 1;
  if (!written && !failed) process.exitCode = 1;
}

void main();
