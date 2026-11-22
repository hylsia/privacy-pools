/**
 * Merge the pool deployment records into shared/privacy/deployments.ts, so the app and the server pick up the pools.
 *
 * - Reads only the top level of contracts/deployments/, never deployments/local/ (where Deploy.s.sol puts records made
 *   on anvil for a public chain id). Local chains (31337, 31338) are included only with --include-local, which
 *   `npm run zk:deploy:local` passes.
 * - Validates every record (scripts/privacy/deploymentRecords.ts): the file name is its chainId, every field is
 *   present, addresses are checksummed, scope === computeScope(pool, chainId), and a public network's record names no
 *   anvil default account.
 * - Merges libraries, txHashes and the pool's receipt block (status 0x1) from
 *   contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json.
 * - Pins vkeySha256 from client/public/zk/manifest.json, and refuses when a pool synced before meets other keys now.
 * - --check-onchain [--chain <id>]: eth_chainId, the pool's code, SCOPE(), and each verifier's code hash against the
 *   compiled bytecode, read from PRIVACY_RPC_URL_<id> or the network's default RPC (read-only calls; only the RPC host
 *   is printed). A mismatch refuses: "the served proving keys no longer match the deployed verifiers".
 * One bad record stops the sync, and nothing is written. The file is rewritten only when its content changes.
 *
 * Usage: tsx scripts/privacy/sync-deployments.ts [--include-local] [--check-onchain [--chain <id>]]
 *          [--deployments-dir <dir>] [--broadcast-dir <dir>] [--out <file>]
 *   npm run zk:deployments:sync     (= --check-onchain)
 */
import "../../server/_core/loadEnv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, type Hex } from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import { PRIVACY_POOL_V2_ABI } from "../../shared/privacy/v2/abi";
import { V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import { hashFile } from "./v2/ceremony-policy";
import { verifyReleaseDirectory } from "./v2/release-files";
import type { PoolDeployment } from "../../shared/privacy/deploymentTypes";
import { networkById, urlHost } from "../../shared/privacy/networks";
import {
  checkOnchainFacts,
  checkRecord,
  mergeBroadcast,
  pinRecord,
  renderDeployments,
  vkeyPinFromManifest,
} from "./deploymentRecords";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(ROOT, "contracts");
const rel = (p: string) => path.relative(ROOT, p) || ".";
const nameOf = (chainId: number) =>
  `${networkById(chainId)?.name ?? "chain"} (${chainId})`;
const shortError = (err: unknown) =>
  String(
    (err as { shortMessage?: string; message?: string })?.shortMessage ??
      (err as Error)?.message ??
      err
  ).split("\n")[0];

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--include-local" || a === "--check-onchain") flags.add(a);
    else if (
      a === "--chain" ||
      a === "--deployments-dir" ||
      a === "--broadcast-dir" ||
      a === "--out" ||
      a === "--v2-release" ||
      a === "--v2-release-1" ||
      a === "--v2-release-4663"
    ) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--"))
        throw new Error(`${a} needs a value`);
      values[a] = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  return { flags, values };
}

/** The records in the current generated file, to compare pins with. */
async function loadPrevious(
  file: string
): Promise<Readonly<Record<number, PoolDeployment>>> {
  if (!fs.existsSync(file)) return {};
  try {
    const mod = (await import(pathToFileURL(file).href)) as {
      DEPLOYMENTS?: Record<number, PoolDeployment>;
    };
    return mod.DEPLOYMENTS ?? {};
  } catch (err) {
    console.warn(
      `could not read the current ${rel(file)} (${shortError(err)}); no earlier pins are compared`
    );
    return {};
  }
}

function deployedBytecode(contract: string, project = CONTRACTS): Hex {
  const file = path.join(project, "out", `${contract}.sol`, `${contract}.json`);
  const obj = JSON.parse(fs.readFileSync(file, "utf8"))?.deployedBytecode
    ?.object;
  if (typeof obj !== "string" || !/^0x[0-9a-fA-F]+$/.test(obj))
    throw new Error(`${rel(file)} has no deployedBytecode`);
  return obj as Hex;
}

/** --check-onchain for one record; returns its problems and records the verifier code hashes when they match. */
async function checkOnchain(
  record: PoolDeployment,
  compiled: { withdraw: Hex; commitment: Hex }
): Promise<string[]> {
  const rpc =
    process.env[`PRIVACY_RPC_URL_${record.chainId}`]?.trim() ||
    networkById(record.chainId)!.defaultRpcUrl;
  const host = urlHost(rpc);
  const client = createPublicClient({
    transport: http(rpc, { retryCount: 2, timeout: 20_000 }),
  });
  try {
    const rpcChainId = await client.getChainId();
    const facts = {
      rpcHost: host,
      rpcChainId,
      poolCode: undefined as Hex | undefined,
      scope: null as bigint | null,
      verifierCode: {
        withdraw: undefined as Hex | undefined,
        commitment: undefined as Hex | undefined,
      },
      compiled,
    };
    if (rpcChainId === record.chainId) {
      facts.poolCode = await client.getCode({ address: record.pool });
      if (facts.poolCode && facts.poolCode !== "0x") {
        if (
          record.protocol === V2_ETH_PROTOCOL &&
          (await client.readContract({
            address: record.pool,
            abi: PRIVACY_POOL_V2_ABI,
            functionName: "PROTOCOL_VERSION",
          })) !== V2_ETH_PROTOCOL
        )
          return [
            `${nameOf(record.chainId)}: contract protocol differs from native ETH v2`,
          ];
        facts.scope = await client
          .readContract({
            address: record.pool,
            abi: PRIVACY_POOL_ABI,
            functionName: "SCOPE",
          })
          .catch(() => null);
        facts.verifierCode.withdraw = await client.getCode({
          address: record.withdrawVerifier,
        });
        facts.verifierCode.commitment = await client.getCode({
          address: record.commitmentVerifier,
        });
      }
    }
    const res = checkOnchainFacts(record, facts);
    if (res.verifierCodeHash) {
      record.verifierCodeHash = res.verifierCodeHash;
      console.log(
        `${nameOf(record.chainId)}: on-chain check passed at ${host}`
      );
    }
    return res.problems;
  } catch (err) {
    return [
      `${nameOf(record.chainId)}: could not check the pool on-chain at ${host} (${shortError(err)})`,
    ];
  }
}

async function main(): Promise<number> {
  const { flags, values } = parseArgs(process.argv.slice(2));
  const includeLocal = flags.has("--include-local");
  const onchain = flags.has("--check-onchain");
  const only =
    values["--chain"] !== undefined ? Number(values["--chain"]) : null;
  if (only !== null && !networkById(only))
    throw new Error(
      `--chain: Hylsia is not built for network ${values["--chain"]}`
    );
  if (only !== null && !onchain)
    throw new Error(
      "--chain selects the network --check-onchain checks; pass --check-onchain too"
    );
  const dir = path.resolve(
    values["--deployments-dir"] ?? path.join(CONTRACTS, "deployments")
  );
  const broadcastDir = path.resolve(
    values["--broadcast-dir"] ?? path.join(CONTRACTS, "broadcast")
  );
  const out = path.resolve(
    values["--out"] ?? path.join(ROOT, "shared", "privacy", "deployments.ts")
  );

  // 1. records: the top level only
  const problems: string[] = [];
  const records: PoolDeployment[] = [];
  const entries = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === "local")
        console.log(
          `not read: ${rel(path.join(dir, e.name))}/ (records made on anvil are never served)`
        );
      continue;
    }
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8"));
    } catch (err) {
      problems.push(`${e.name}: not valid JSON (${shortError(err)})`);
      continue;
    }
    const check = checkRecord(e.name, raw, { includeLocal });
    if (check.kind === "skipped") console.log(`skipped ${check.reason}`);
    else if (check.kind === "invalid") problems.push(...check.problems);
    else records.push(check.record);
  }

  // 2. the broadcast logs
  const merged = records.map(r => {
    if (r.protocol === V2_ETH_PROTOCOL) return r; // v2's dedicated CLI writes only after checking actual receipts
    const log = path.join(
      broadcastDir,
      "Deploy.s.sol",
      String(r.chainId),
      "run-latest.json"
    );
    if (!fs.existsSync(log)) {
      console.log(
        `${nameOf(r.chainId)}: no broadcast log at ${rel(log)}; libraries, txHashes and poolReceiptBlock are not merged`
      );
      return r;
    }
    try {
      const m = mergeBroadcast(r, JSON.parse(fs.readFileSync(log, "utf8")));
      problems.push(...m.problems);
      return m.record;
    } catch (err) {
      problems.push(
        `${nameOf(r.chainId)}: cannot read ${rel(log)} (${shortError(err)})`
      );
      return r;
    }
  });

  // 3. the served verifying keys
  const pin = vkeyPinFromManifest(
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "client", "public", "zk", "manifest.json"),
        "utf8"
      )
    )
  );
  const previous = await loadPrevious(out);
  const v2Packages = new Map<
    number,
    { dir: string; release: Awaited<ReturnType<typeof verifyReleaseDirectory>> }
  >();
  for (const record of merged.filter(r => r.protocol === V2_ETH_PROTOCOL)) {
    const selected =
      values[`--v2-release-${record.chainId}`] ?? values["--v2-release"];
    if (selected) {
      const dir = path.resolve(selected);
      v2Packages.set(record.chainId, {
        dir,
        release: await verifyReleaseDirectory(dir),
      });
    }
  }
  const pinned = [] as PoolDeployment[];
  for (const r of merged) {
    let selectedPin = pin;
    if (r.protocol === V2_ETH_PROTOCOL) {
      const v2Release = v2Packages.get(r.chainId)?.release;
      if (
        !v2Release ||
        v2Release.identity.targetChainId !== r.chainId ||
        v2Release.releaseId !== r.releaseId ||
        v2Release.artifactManifestSha256 !== r.artifactManifestSha256
      ) {
        problems.push(
          `${nameOf(r.chainId)}: --v2-release must identify this exact verified native ETH package`
        );
        pinned.push(r);
        continue;
      }
      const manifest = path.join(
        ROOT,
        "client/public/zk-v2-eth",
        r.releaseId!,
        "manifest.json"
      );
      if (
        !fs.existsSync(manifest) ||
        (await hashFile(manifest)) !== r.artifactManifestSha256
      ) {
        problems.push(
          `${nameOf(r.chainId)}: published native ETH artifact manifest differs from its deployment pin`
        );
        pinned.push(r);
        continue;
      }
      selectedPin = vkeyPinFromManifest(
        JSON.parse(fs.readFileSync(manifest, "utf8"))
      );
      if (
        r.vkeySha256?.withdraw !== selectedPin.withdraw ||
        r.vkeySha256?.commitment !== selectedPin.commitment
      )
        problems.push(
          `${nameOf(r.chainId)}: native ETH verifying keys differ from the recorded release`
        );
    }
    const p = pinRecord(r, selectedPin, previous[r.chainId]);
    problems.push(...p.problems);
    pinned.push(p.record);
  }

  // 4. on-chain (read-only), only when every record passed so far
  if (onchain) {
    const targets = pinned.filter(r => only === null || r.chainId === only);
    if (only !== null && targets.length === 0 && problems.length === 0)
      problems.push(`--chain ${only}: no record for ${nameOf(only)}`);
    if (targets.length > 0 && problems.length === 0) {
      execFileSync("forge", ["build", "--root", CONTRACTS], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      const compiled = {
        withdraw: deployedBytecode("WithdrawVerifier"),
        commitment: deployedBytecode("CommitmentVerifier"),
      };
      for (const r of targets) {
        if (r.protocol === V2_ETH_PROTOCOL) {
          const project = path.join(v2Packages.get(r.chainId)!.dir, "solidity");
          execFileSync("forge", ["build", "--root", project], {
            stdio: ["ignore", "ignore", "inherit"],
          });
          problems.push(
            ...(await checkOnchain(r, {
              withdraw: deployedBytecode("WithdrawVerifierV2ETH", project),
              commitment: deployedBytecode("CommitmentVerifierV2ETH", project),
            }))
          );
        } else problems.push(...(await checkOnchain(r, compiled)));
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\nsync-deployments: nothing written to ${rel(out)}:`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }

  const text = renderDeployments(pinned);
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
  if (current === text)
    console.log(`${rel(out)} is up to date (${pinned.length} deployment(s))`);
  else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`wrote ${rel(out)} with ${pinned.length} deployment(s)`);
  }
  for (const r of pinned)
    console.log(
      `  ${nameOf(r.chainId)}: pool ${r.pool}, deploy block ${r.deployBlock}`
    );
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(`sync-deployments: ${shortError(err)}`);
    process.exit(1);
  });
