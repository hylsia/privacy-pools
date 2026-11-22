/**
 * Prepare the pool on Robinhood Chain Testnet (46630) or mainnet (4663). Mainnet broadcast is release-blocked. A dry
 * run unless --broadcast. After a broadcast it runs `sync-deployments --check-onchain --chain <id>`, which checks the
 * new pool on-chain and writes shared/privacy/deployments.ts.
 *
 * The live pool (0xbBc4362133e4d50157206Cc907909d0C0211913f, contracts/deployments/46630.json) is already deployed:
 * this script refuses to deploy another one there without --replace.
 *
 * Usage:
 *   tsx scripts/privacy/deploy.ts --network robinhood-testnet [--broadcast]
 *     [--account <name> --sender <0x…> | --ledger --sender <0x…> | --sender <0x…>] [--no-verify] [--rpc-url <url>]
 *     [--replace] [--gas-estimate-multiplier <percent>]
 *   npm run zk:deploy:robinhood -- --sender 0x…                                         (dry run: no key needed)
 *   npm run zk:deploy:robinhood -- --broadcast --account hylsia-deployer --sender 0x…
 *
 * Signer: a forge keystore (`cast wallet import hylsia-deployer --interactive`) with --account and --sender, a Ledger
 * with --ledger and --sender, or PRIVACY_DEPLOYER_PRIVATE_KEY. A dry run only simulates, so --sender alone (the
 * deployer's address, no key, no funds) is enough for it. Owner, postman and minimum deposit come from
 * PRIVACY_POOL_OWNER, PRIVACY_ASP_POSTMAN and PRIVACY_MIN_DEPOSIT_WEI (contracts/script/Deploy.s.sol).
 * RPC: --rpc-url, else PRIVACY_DEPLOY_RPC_URL_<id>, else the network's public RPC. Only its host is ever printed.
 *
 * Refuses before forge runs: a loopback RPC (local chains use `npm run zk:deploy:local` or `npm run zk:e2e`), an RPC
 * that answers another chain id, an existing record without --replace, and verifying-key drift against another
 * public network's pool, if the registry ever holds one (every network from one build; never run zk:build between
 * deployments).
 * Forge runs with --rpc-url, --chain <id> and --slow, without the env variables that would redirect it.
 * Verification: on the network's Blockscout explorer (<explorer>/api/, no key needed). --no-verify skips it. Forge
 * does not know chain 46630: if a transaction there runs out of gas, retry with --gas-estimate-multiplier 200.
 *
 * When a broadcast fails: Deploy.s.sol writes its record while the script runs, before forge sends anything. So this
 * script then asks the chain whether the pool exists. No pool: the record it wrote is removed (or the previous one
 * restored). A pool: forge failed after the deployment (usually the explorer verification), so the sync still runs.
 */
import "./loadDeploymentEnv";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createPublicClient, getAddress, http, isAddress, type PublicClient } from "viem";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { mainnetReleaseRefusal } from "../../shared/privacy/mainnetRelease";
import { networkBySlug, PUBLIC_NETWORKS, urlHost, type NetworkInfo } from "../../shared/privacy/networks";
import {
  deployRefusal,
  failedBroadcastAction,
  forgeChildEnv,
  isLoopbackAddress,
  isLoopbackHostname,
  recordPool,
  vkeyPinFromManifest,
} from "./deploymentRecords";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(ROOT, "contracts");
/** public network slugs for --network; mainnet is simulation-only */
const NETWORK_SLUGS = PUBLIC_NETWORKS.map((n) => n.slug).join("|");

/** The network's Blockscout API (https://explorer.testnet.chain.robinhood.com/api/ on Robinhood Chain Testnet). */
const blockscoutApi = (network: NetworkInfo): string | null => (network.explorer ? `${network.explorer.url.replace(/\/+$/, "")}/api/` : null);

const shortError = (err: unknown) => String((err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? err).split("\n")[0];

/** A problem with the arguments: printed in full, followed by the usage line (shortError keeps only a first line). */
class UsageError extends Error {}

interface Args {
  network: NetworkInfo;
  broadcast: boolean;
  account: string | null;
  ledger: boolean;
  sender: string | null;
  verify: boolean;
  rpcUrl: string | null;
  replace: boolean;
  gasMultiplier: string | null;
}

const USAGE = `usage: deploy.ts --network ${NETWORK_SLUGS} [--broadcast] [--account <name> --sender <0x…> | --ledger --sender <0x…> | --sender <0x…> (dry run only)] [--no-verify] [--rpc-url <url>] [--replace] [--gas-estimate-multiplier <percent>]`;
const SIGNER_HELP =
  "--account <keystore> --sender <0x…> (create it with: cast wallet import <name> --interactive), --ledger --sender <0x…>, or PRIVACY_DEPLOYER_PRIVATE_KEY";

/** deploy.ts --help (or -h): what the script does and how to call it. Nothing is read or sent. */
const HELP = [
  "Prepares deployments on Robinhood Chain Testnet (46630) or Robinhood Chain mainnet (4663).",
  "Mainnet is simulation-only while H-01, the development trusted setup and release validation remain unresolved.",
  "A dry run unless --broadcast: it checks the RPC and the chain id, then simulates the deployment from the deployer's",
  "address (no key, no funds, nothing sent).",
  "",
  USAGE,
  "",
  `  --network <slug>        the network: ${NETWORK_SLUGS.replace(/\|/g, " or ")}`,
  "  --broadcast             send the transactions, signed by a wallet:",
  `                          ${SIGNER_HELP}`,
  "  --sender <0x…>          the deployer's address (alone: a dry run only)",
  "  --no-verify             skip the verification on the network's Blockscout explorer",
  "  --rpc-url <url>         else PRIVACY_DEPLOY_RPC_URL_<id>, else the network's public RPC (only its host is printed)",
  "  --replace               deploy although contracts/deployments/<id>.json exists (the live pool does)",
  "  --gas-estimate-multiplier <percent>   100 to 1000 (forge does not know chain 46630; retry with 200 if out of gas)",
  "",
  "Examples:",
  "  npm run zk:deploy:robinhood -- --sender 0x…                                        (dry run)",
  "  npm run zk:deploy:robinhood -- --broadcast --account hylsia-deployer --sender 0x…",
  "Owner, postman and minimum deposit: PRIVACY_POOL_OWNER, PRIVACY_ASP_POSTMAN, PRIVACY_MIN_DEPOSIT_WEI. See docs/privacy-pools/README.md.",
].join("\n");

/** null: --help was asked for (print HELP, exit 0). */
function parseArgs(argv: string[]): Args | null {
  if (argv.includes("--help") || argv.includes("-h")) return null;
  let network: NetworkInfo | null = null;
  const a: Omit<Args, "network"> = { broadcast: false, account: null, ledger: false, sender: null, verify: true, rpcUrl: null, replace: false, gasMultiplier: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--network": {
        const n = networkBySlug(value());
        if (!n || n.kind === "local") throw new UsageError(`--network is ${NETWORK_SLUGS.replace(/\|/g, " or ")} (local chains: npm run zk:deploy:local)`);
        network = n;
        break;
      }
      case "--broadcast":
        a.broadcast = true;
        break;
      case "--account":
        a.account = value();
        break;
      case "--ledger":
        a.ledger = true;
        break;
      case "--sender":
        a.sender = value();
        break;
      case "--no-verify":
        a.verify = false;
        break;
      case "--rpc-url":
        a.rpcUrl = value();
        break;
      case "--replace":
        a.replace = true;
        break;
      case "--gas-estimate-multiplier":
        a.gasMultiplier = value();
        if (!/^\d+$/.test(a.gasMultiplier) || Number(a.gasMultiplier) < 100 || Number(a.gasMultiplier) > 1000) {
          throw new UsageError("--gas-estimate-multiplier is a percentage from 100 to 1000");
        }
        break;
      default:
        throw new UsageError(`unknown argument ${flag}`);
    }
  }
  if (!network) throw new UsageError("--network is required");
  // Public address and external-signer defaults only; keystores are not opened during argument parsing.
  a.sender ??= process.env.PRIVACY_DEPLOYER_ADDRESS?.trim() || null;
  if (!a.account && !a.ledger) {
    a.account = process.env.PRIVACY_DEPLOY_ACCOUNT?.trim() || null;
    const hardware = process.env.PRIVACY_DEPLOY_HARDWARE?.trim();
    if (hardware && hardware !== "ledger") throw new UsageError("PRIVACY_DEPLOY_HARDWARE must be ledger");
    a.ledger = hardware === "ledger";
  }
  if (a.account && a.ledger) throw new UsageError("choose one signer: --account or --ledger");
  if ((a.account || a.ledger) && !a.sender) throw new UsageError("--account and --ledger need --sender <address>");
  if (a.sender && !isAddress(a.sender, { strict: false })) throw new UsageError("--sender is not an address");
  if (a.sender && !(a.account || a.ledger) && a.broadcast) {
    throw new UsageError(`--sender alone only simulates; --broadcast needs a wallet: ${SIGNER_HELP}`);
  }
  return { network, ...a };
}

const readText = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/**
 * forge failed during a broadcast. Returns null when the sync should still run (the pool is on-chain), else the exit
 * code. Never deletes a record whose pool it could not check.
 */
async function afterFailedBroadcast(o: { client: PublicClient; network: NetworkInfo; recordFile: string; recordBefore: string | null }): Promise<number | null> {
  const recordAfter = readText(o.recordFile);
  const pool = recordPool(recordAfter);
  let onchain: "code" | "empty" | "unreachable" = "unreachable";
  if (recordAfter !== null && recordAfter !== o.recordBefore && pool) {
    try {
      const code = await o.client.getCode({ address: pool });
      onchain = code && code !== "0x" ? "code" : "empty";
    } catch {
      onchain = "unreachable";
    }
  }
  const action = failedBroadcastAction(o.recordBefore, recordAfter, onchain);
  const rel = path.relative(ROOT, o.recordFile);
  switch (action.kind) {
    case "nothing_written":
      console.error("deploy: forge script failed; see its output above. No deployment record was written.");
      return 1;
    case "phantom":
      if (action.restore === "remove") fs.rmSync(o.recordFile, { force: true });
      else fs.writeFileSync(o.recordFile, o.recordBefore!);
      console.error(
        `deploy: forge failed before the pool reached ${o.network.name}: there is no contract at ${pool}. The record the script wrote was ${action.restore === "remove" ? "removed" : "replaced by the previous one"} (${rel}).`,
      );
      console.error(
        "  Transactions that did go through (libraries, verifiers) moved the deployer's nonce, so a retry deploys the pool at another address than this run showed.",
      );
      return 1;
    case "unknown":
      console.error(
        `deploy: forge failed, and ${o.network.name}'s RPC could not say whether the pool at ${pool ?? "?"} exists. ${rel} is kept: run npm run zk:deployments:sync once the RPC answers (it accepts the record only if the pool is on-chain).`,
      );
      return 1;
    case "deployed":
      console.warn(
        `deploy: forge reported an error, but the pool is on-chain at ${pool}: most likely the explorer verification failed (retry it as docs/privacy-pools/README.md shows). Checking the pool and updating the app's list now.`,
      );
      return null;
  }
}

/** True when the RPC host is this machine: a localhost name, a loopback address, or a name that resolves to one. */
async function rpcIsLoopback(url: URL): Promise<boolean> {
  if (isLoopbackHostname(url.hostname)) return true;
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return isLoopbackAddress(bare);
  try {
    return (await dns.lookup(bare, { all: true })).some((r) => isLoopbackAddress(r.address));
  } catch {
    return false; // unresolvable: eth_chainId fails next
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(HELP);
    return 0;
  }
  const { network } = args;
  const mainnetRefusal = mainnetReleaseRefusal(network.chain);
  if (args.broadcast && mainnetRefusal) {
    console.error(`deploy: ${mainnetRefusal}`);
    return 1; // before RPC, signer access or any forge invocation
  }
  const id = network.chainId;
  const rpc = args.rpcUrl ?? (process.env[`PRIVACY_DEPLOY_RPC_URL_${id}`]?.trim() || network.defaultRpcUrl);
  let url: URL;
  try {
    url = new URL(rpc);
  } catch {
    throw new Error("the RPC is not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("the RPC must be an http(s) URL");
  const host = urlHost(rpc);

  // 1. refusals, before forge runs
  const loopback = await rpcIsLoopback(url);
  const client = createPublicClient({ transport: http(rpc, { retryCount: 1, timeout: 20_000 }) }) as PublicClient;
  let rpcChainId: number | null = null;
  if (!loopback) {
    try {
      rpcChainId = await client.getChainId();
    } catch (err) {
      console.error(`deploy: could not read eth_chainId from ${host} (${shortError(err)})`);
      return 1;
    }
  }
  const recordFile = path.join(CONTRACTS, "deployments", `${id}.json`);
  const recordBefore = readText(recordFile);
  const served = vkeyPinFromManifest(JSON.parse(fs.readFileSync(path.join(ROOT, "client", "public", "zk", "manifest.json"), "utf8")));
  const refusal = deployRefusal({
    network,
    rpcHost: host,
    rpcIsLoopback: loopback,
    rpcChainId,
    recordExists: recordBefore !== null,
    replace: args.replace,
    served,
    deployments: DEPLOYMENTS,
  });
  if (refusal) {
    console.error(`deploy: ${refusal}`);
    return 1;
  }

  // 2. signer and verification
  const envKey = !!process.env.PRIVACY_DEPLOYER_PRIVATE_KEY?.trim();
  const senderOnly = !!args.sender && !args.account && !args.ledger;
  if (senderOnly && envKey) {
    console.error("deploy: choose one signer: PRIVACY_DEPLOYER_PRIVATE_KEY is set, so drop --sender (or unset the key for a dry run as --sender)");
    return 1;
  }
  const signer = args.account
    ? ["--account", args.account, "--sender", getAddress(args.sender!)]
    : args.ledger
      ? ["--ledger", "--sender", getAddress(args.sender!)]
      : senderOnly
        ? ["--sender", getAddress(args.sender!)]
        : [];
  if (signer.length === 0 && !envKey) {
    console.error(
      args.broadcast
        ? `deploy: no signer. Use ${SIGNER_HELP}.`
        : `deploy: no signer. A dry run needs at least --sender <0x…> (the deployer's address; no key, no funds); a deployment needs ${SIGNER_HELP}.`,
    );
    return 1;
  }
  const verify: string[] = [];
  if (args.broadcast && args.verify) {
    const api = blockscoutApi(network);
    if (!api) {
      console.error(`deploy: ${network.name} has no explorer to verify on; pass --no-verify`);
      return 1;
    }
    verify.push("--verify", "--verifier", "blockscout", "--verifier-url", api);
  }

  // 3. forge, in an env that cannot redirect it or change what it builds (no FOUNDRY_* / DAPP_* override: one build,
  //    its own Poseidon libraries)
  const env: NodeJS.ProcessEnv = forgeChildEnv(process.env);
  const forgeArgs = [
    "script",
    "--root",
    CONTRACTS,
    `${path.join(CONTRACTS, "script", "Deploy.s.sol")}:Deploy`,
    "--rpc-url",
    rpc,
    "--chain",
    String(id),
    "--slow",
    ...signer,
    ...(args.gasMultiplier ? ["--gas-estimate-multiplier", args.gasMultiplier] : []),
    ...(args.broadcast ? ["--broadcast", ...verify] : []),
  ];
  const who = args.account
    ? `keystore ${args.account}`
    : args.ledger
      ? "Ledger"
      : senderOnly
        ? `${getAddress(args.sender!)} (simulation only, no key)`
        : "PRIVACY_DEPLOYER_PRIVATE_KEY";
  console.log(
    `${args.broadcast ? "Deploying" : "Dry run"} on ${network.name} (${id}) via ${host}; signer: ${who}; verification: ${args.broadcast && verify.length ? verify[2] : "none"}`,
  );
  let forgeFailed = false;
  try {
    // cwd contracts/: forge also reads a .env in its working directory (without overriding the env it is given), and
    // the repository's .env must not bring back a FOUNDRY_* / DAPP_* override forgeChildEnv dropped. Everything the
    // deploy needs from that .env is already in `env` (loadEnv above).
    execFileSync("forge", forgeArgs, { stdio: "inherit", env, cwd: CONTRACTS });
  } catch {
    forgeFailed = true;
  }
  if (!args.broadcast) {
    if (forgeFailed) {
      console.error("deploy: forge script failed; see its output above. Nothing was sent: this was a dry run.");
      return 1;
    }
    console.log("\nDry run only: nothing was sent and no deployment record was written. Add --broadcast (with a wallet) to deploy.");
    return 0;
  }
  if (forgeFailed) {
    const code = await afterFailedBroadcast({ client, network, recordFile, recordBefore });
    if (code !== null) return code;
  }

  // 4. check the new pool on-chain and update the app's list
  try {
    execFileSync("npx", ["tsx", path.join(ROOT, "scripts", "privacy", "sync-deployments.ts"), "--check-onchain", "--chain", String(id)], {
      stdio: "inherit",
      env: { ...env, [`PRIVACY_RPC_URL_${id}`]: rpc },
      cwd: ROOT,
    });
  } catch {
    console.error(`deploy: the pool was sent, but sync-deployments refused it; fix the problem above, then run npm run zk:deployments:sync`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UsageError) console.error(`deploy: ${err.message}\n${USAGE}\n(deploy.ts --help explains each option)`);
    else console.error(`deploy: ${shortError(err)}`);
    process.exit(1);
  });
