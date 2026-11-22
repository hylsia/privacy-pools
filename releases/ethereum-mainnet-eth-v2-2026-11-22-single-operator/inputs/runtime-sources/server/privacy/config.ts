/**
 * Server-side Privacy Pool configuration (relayer + association-set provider), one entry per served network.
 * Nothing here ever touches user secrets: the server only sees proofs and public inputs.
 *
 * The networks come from the registry and the environment through resolveNetworks() (shared/privacy/networks.ts),
 * the same pure parser the client runs on its VITE_ variables:
 *   - PRIVACY_CHAIN_IDS=46630 selects multi mode (also the default when no chain variable is set: Robinhood Chain
 *     Testnet); a list such as 31337,31338 serves the two local chains side by side;
 *   - PRIVACY_CHAIN_ID=<id> without PRIVACY_CHAIN_IDS is legacy single mode (the tests, asp-publish);
 *   - per network, with a `_<chainId>` suffix: PRIVACY_RPC_URL, PRIVACY_POOL_ADDRESS, PRIVACY_POOL_DEPLOY_BLOCK.
 *     They never fall back across networks; in multi mode their unsuffixed forms are ignored with a warning.
 * Server-only values, per network with the same suffix:
 *   - PRIVACY_RELAYER_PRIVATE_KEY, PRIVACY_RELAYER_FEE_BPS, PRIVACY_RELAYER_MIN_FEE_WEI, PRIVACY_QUOTE_TTL_SECONDS and
 *     PRIVACY_ASP_POSTMAN_PRIVATE_KEY fall back to their unsuffixed value (one key may serve every network);
 *   - PRIVACY_ASP_CONFIRMATIONS, PRIVACY_ASP_INCLUSION_DELAY_SECONDS, PRIVACY_REORG_WINDOW, PRIVACY_LOG_CHUNK and
 *     PRIVACY_ASP_RECEIPT_WAIT_MS fall back to the network's default (their unsuffixed form counts only in legacy mode).
 * One value for the whole server:
 *   - PRIVACY_ASP_AUTO_PUBLISH_SECONDS, the periodic publisher's interval (default 600; 0 turns it off;
 *     server/privacy/autoPublish.ts, started by the long-running server only);
 *   - the operator's exclusion list (server/privacy/exclusions.ts): PRIVACY_ASP_EXCLUSIONS_FILE, a JSON file (a relative
 *     path is resolved against the repository root), or PRIVACY_ASP_EXCLUSIONS_JSON, the same JSON inline (serverless
 *     hosting; notes refused). Neither: no exclusions. Both: a configuration error that pauses publishing.
 * Messages name variables, never their values, and print an RPC's host only (a URL path can hold an API key).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeScope } from "../../shared/privacy/context";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import type { PrivacyProtocol } from "../../shared/privacy/protocols";
import {
  networkEnv,
  resolveNetworks,
  urlHost,
  type EnvReader,
  type NetworkInfo,
  type NetworkProblem,
  type ResolvedNetwork,
} from "../../shared/privacy/networks";
import { formatDelay, MAX_INCLUSION_DELAY_SECONDS } from "../../shared/privacy/screening";
import { readExclusions, type ExclusionSource } from "./exclusions";

export interface PrivacyChainConfig {
  protocol: PrivacyProtocol;
  chainId: number;
  network: NetworkInfo;
  rpcUrl: string;
  rpcSource: ResolvedNetwork["rpcSource"];
  /** null: not deployed yet, or the configured address is invalid (then `problems` says so) */
  pool: Address | null;
  poolSource: ResolvedNetwork["poolSource"];
  /** null without a usable pool (not deployed yet, or the problem missing_deploy_block) */
  deployBlock: bigint | null;
  deployBlockSource: ResolvedNetwork["deployBlockSource"];
  /** computeScope(pool, chainId); null without a pool */
  scope: bigint | null;
  /** the deployment record's scope, when the record describes this pool */
  recordScope: bigint | null;
  /** a pool with a problem is unavailable and gets no RPC call */
  problems: NetworkProblem[];
  warnings: string[];
  relayerPrivateKey: Hex | null;
  relayerFeeBps: number;
  relayerMinFeeWei: bigint;
  quoteTtlSeconds: number;
  aspPostmanPrivateKey: Hex | null;
  /** blocks a deposit needs (its own included) before the screening policy considers it */
  aspConfirmations: number;
  /**
   * the screening policy's inclusion delay in seconds: a confirmed deposit is considered once its block time plus this
   * is at or before the snapshot head's time (0: at once). PRIVACY_ASP_INCLUSION_DELAY_SECONDS_<chainId>, else the
   * registry's default (3600 on Robinhood Chain Testnet, 0 on the local chains); 0 to 604800.
   */
  aspInclusionDelaySeconds: number;
  /** trailing blocks every event sync scans again */
  reorgWindow: number;
  logChunk: bigint;
  minLogChunk: bigint;
  /** how long a publish waits for its receipt before it answers `pending` */
  receiptWaitMs: number;
}

export interface PrivacyConfig {
  protocol: PrivacyProtocol;
  mode: "multi" | "legacy";
  /** the served networks, in registry order */
  chains: readonly PrivacyChainConfig[];
  byChainId: ReadonlyMap<number, PrivacyChainConfig>;
  /** the periodic publisher's interval in seconds (PRIVACY_ASP_AUTO_PUBLISH_SECONDS); 0: off */
  autoPublishSeconds: number;
  /** where the operator's exclusion list comes from (PRIVACY_ASP_EXCLUSIONS_FILE / PRIVACY_ASP_EXCLUSIONS_JSON) */
  aspExclusions: ExclusionSource;
  /** resolveNetworks' own warnings; each chain keeps its own in `warnings` */
  warnings: readonly string[];
}

/** The periodic publisher's interval when PRIVACY_ASP_AUTO_PUBLISH_SECONDS is unset: 10 minutes. */
export const DEFAULT_AUTO_PUBLISH_SECONDS = 600;
const MIN_AUTO_PUBLISH_SECONDS = 10;
const MAX_AUTO_PUBLISH_SECONDS = 86_400;

const DEFAULT_RELAYER_FEE_BPS = 50;
const DEFAULT_QUOTE_TTL_SECONDS = 900;
/** under Vercel's 30 s function limit (vercel.json), with room for the event sync and the send */
const DEFAULT_RECEIPT_WAIT_MS = 20_000;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/** The per-network reader for one chain: `<name>_<chainId>` first, then the fallback rule; messages name variables. */
function chainEnv(read: EnvReader, chainId: number, mode: PrivacyConfig["mode"], warnings: string[]) {
  const isSet = (name: string) => {
    const v = read(name);
    return typeof v === "string" && v.trim() !== "";
  };
  return {
    get: (name: string, fallback: "always" | "legacy") => networkEnv(read, name, chainId, { mode, fallback }),
    /** the variable that supplied the value, for messages */
    source: (name: string) => (isSet(`${name}_${chainId}`) ? `${name}_${chainId}` : name),
    warn: (message: string) => warnings.push(message),
  };
}
type ChainEnv = ReturnType<typeof chainEnv>;

function privateKey(env: ChainEnv, name: string): Hex | null {
  const v = env.get(name, "always");
  if (v === undefined) return null;
  if (!PRIVATE_KEY.test(v)) {
    env.warn(`${env.source(name)} is not a 32-byte hex private key; it is ignored`);
    return null;
  }
  try {
    privateKeyToAccount(v as Hex);
  } catch {
    env.warn(`${env.source(name)} is not a valid private key; it is ignored`);
    return null;
  }
  return v as Hex;
}

function wholeNumber(env: ChainEnv, name: string, fallback: "always" | "legacy", def: number, min: number, max: number): number {
  const v = env.get(name, fallback);
  if (v === undefined) return def;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    env.warn(`${env.source(name)} is not a whole number from ${min} to ${max}; the default ${def} is used`);
    return def;
  }
  return n;
}

function bigNumber(env: ChainEnv, name: string, fallback: "always" | "legacy", def: bigint, min: bigint): bigint {
  const v = env.get(name, fallback);
  if (v === undefined) return def;
  const n = /^\d+$/.test(v) ? BigInt(v) : null;
  if (n === null || n < min) {
    env.warn(`${env.source(name)} is not a whole number of at least ${min}; the default ${def} is used`);
    return def;
  }
  return n;
}

function recordScopeOf(chainId: number, pool: Address | null): bigint | null {
  const record = DEPLOYMENTS[chainId];
  if (!record || !pool || typeof record.pool !== "string" || record.pool.toLowerCase() !== pool.toLowerCase()) return null;
  try {
    return BigInt(record.scope);
  } catch {
    return null;
  }
}

function chainFrom(r: ResolvedNetwork, read: EnvReader, mode: PrivacyConfig["mode"]): PrivacyChainConfig {
  const network = r.network;
  const chainId = network.chainId;
  const warnings = [...r.warnings];
  const env = chainEnv(read, chainId, mode, warnings);
  const logChunk = bigNumber(env, "PRIVACY_LOG_CHUNK", "legacy", network.logChunk, 1n);
  return {
    chainId,
    protocol: r.protocol,
    network,
    rpcUrl: r.rpcUrl,
    rpcSource: r.rpcSource,
    pool: r.pool,
    poolSource: r.poolSource,
    deployBlock: r.deployBlock,
    deployBlockSource: r.deployBlockSource,
    scope: r.pool ? computeScope(r.pool, chainId) : null,
    recordScope: recordScopeOf(chainId, r.pool),
    problems: [...r.problems],
    warnings,
    relayerPrivateKey: privateKey(env, "PRIVACY_RELAYER_PRIVATE_KEY"),
    relayerFeeBps: wholeNumber(env, "PRIVACY_RELAYER_FEE_BPS", "always", DEFAULT_RELAYER_FEE_BPS, 0, 10_000),
    relayerMinFeeWei: bigNumber(env, "PRIVACY_RELAYER_MIN_FEE_WEI", "always", 0n, 0n),
    quoteTtlSeconds: wholeNumber(env, "PRIVACY_QUOTE_TTL_SECONDS", "always", DEFAULT_QUOTE_TTL_SECONDS, 1, 86_400),
    aspPostmanPrivateKey: privateKey(env, "PRIVACY_ASP_POSTMAN_PRIVATE_KEY"),
    aspConfirmations: wholeNumber(env, "PRIVACY_ASP_CONFIRMATIONS", "legacy", network.aspConfirmations, 1, 100_000),
    aspInclusionDelaySeconds: wholeNumber(env, "PRIVACY_ASP_INCLUSION_DELAY_SECONDS", "legacy", network.aspInclusionDelaySeconds, 0, MAX_INCLUSION_DELAY_SECONDS),
    reorgWindow: wholeNumber(env, "PRIVACY_REORG_WINDOW", "legacy", network.reorgWindow, 0, 100_000),
    logChunk,
    minLogChunk: network.minLogChunk < logChunk ? network.minLogChunk : logChunk,
    receiptWaitMs: wholeNumber(env, "PRIVACY_ASP_RECEIPT_WAIT_MS", "legacy", DEFAULT_RECEIPT_WAIT_MS, 0, 600_000),
  };
}

/** Settings whose unsuffixed form counts only in legacy mode (a network's own value never applies to another). */
const NETWORK_ONLY_SETTINGS = [
  "PRIVACY_ASP_CONFIRMATIONS",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS",
  "PRIVACY_REORG_WINDOW",
  "PRIVACY_LOG_CHUNK",
  "PRIVACY_ASP_RECEIPT_WAIT_MS",
] as const;

/** PRIVACY_ASP_AUTO_PUBLISH_SECONDS: 0 (off), or a whole number of seconds from 10 to 86400; else the default. */
function autoPublishSeconds(read: EnvReader, warnings: string[]): number {
  const raw = read("PRIVACY_ASP_AUTO_PUBLISH_SECONDS");
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "") return DEFAULT_AUTO_PUBLISH_SECONDS;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (n === 0) return 0;
  if (!Number.isSafeInteger(n) || n < MIN_AUTO_PUBLISH_SECONDS || n > MAX_AUTO_PUBLISH_SECONDS) {
    warnings.push(
      `PRIVACY_ASP_AUTO_PUBLISH_SECONDS is neither 0 (off) nor a whole number from ${MIN_AUTO_PUBLISH_SECONDS} to ${MAX_AUTO_PUBLISH_SECONDS}; the default ${DEFAULT_AUTO_PUBLISH_SECONDS} is used`,
    );
    return DEFAULT_AUTO_PUBLISH_SECONDS;
  }
  return n;
}

let rootDir: string | null = null;

/**
 * The repository root: the nearest folder above this module that holds package.json (server/privacy under tsx, dist/
 * in the built server, the function folder on serverless hosting); the working directory if none does. A relative
 * PRIVACY_ASP_EXCLUSIONS_FILE is resolved against it, so the same value finds the same file under `npm run dev`,
 * `npm start` and a container, whatever folder the process was started from.
 */
export function repoRoot(): string {
  if (rootDir !== null) return rootDir;
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return (rootDir = process.cwd()); // a bundle without a file URL: the working directory
  }
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return (rootDir = dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return (rootDir = process.cwd());
}

/** PRIVACY_ASP_EXCLUSIONS_FILE or PRIVACY_ASP_EXCLUSIONS_JSON (never both). */
function exclusionSource(read: EnvReader): ExclusionSource {
  const value = (name: string) => {
    const v = read(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const file = value("PRIVACY_ASP_EXCLUSIONS_FILE");
  const json = value("PRIVACY_ASP_EXCLUSIONS_JSON");
  if (file && json) {
    return { kind: "error", error: "both PRIVACY_ASP_EXCLUSIONS_FILE and PRIVACY_ASP_EXCLUSIONS_JSON are set; set only one" };
  }
  if (json) return { kind: "inline", text: json };
  if (file) return { kind: "file", path: path.isAbsolute(file) ? path.normalize(file) : path.resolve(repoRoot(), file), display: file };
  return { kind: "none" };
}

/** Parse the environment (pure apart from the default reader). Throws for an unknown or malformed chain id. */
export function loadPrivacyConfig(read: EnvReader = (name) => process.env[name]): PrivacyConfig {
  const resolved = resolveNetworks(read, DEPLOYMENTS);
  const chains = resolved.networks.map((r) => chainFrom(r, read, resolved.mode));
  const warnings = [...resolved.warnings];
  if (resolved.mode === "multi") {
    for (const name of NETWORK_ONLY_SETTINGS) {
      const v = read(name);
      if (typeof v === "string" && v.trim() !== "") {
        warnings.push(`${name} has no network suffix and is ignored; set ${chains.map((c) => `${name}_${c.chainId}`).join(" or ")}`);
      }
    }
  }
  return {
    mode: resolved.mode,
    protocol: resolved.protocol,
    chains,
    byChainId: new Map(chains.map((c) => [c.chainId, c])),
    autoPublishSeconds: autoPublishSeconds(read, warnings),
    aspExclusions: exclusionSource(read),
    warnings,
  };
}

let cached: PrivacyConfig | null = null;
export function privacyConfig(): PrivacyConfig {
  if (!cached) cached = loadPrivacyConfig();
  return cached;
}

/** test hook */
export function resetPrivacyConfig() {
  cached = null;
}

/**
 * One served network. Without `chainId`: the only served network, else (several served, e.g. the two local chains)
 * BAD_REQUEST "chainId is required: this server serves 2 networks". A network this server does not serve:
 * BAD_REQUEST "Hylsia is not built for network <id>".
 */
export function chainConfig(chainId?: number): PrivacyChainConfig {
  const cfg = privacyConfig();
  if (chainId === undefined) {
    if (cfg.chains.length === 1) return cfg.chains[0];
    throw new TRPCError({ code: "BAD_REQUEST", message: `chainId is required: this server serves ${cfg.chains.length} networks` });
  }
  const chain = cfg.byChainId.get(chainId);
  if (!chain) throw new TRPCError({ code: "BAD_REQUEST", message: `Hylsia is not built for network ${chainId}` });
  return chain;
}

/** The address of a configured key (never the key itself). */
export function keyAddress(key: Hex | null): Address | null {
  if (!key) return null;
  try {
    return privateKeyToAccount(key).address;
  } catch {
    return null;
  }
}

function summaryLine(c: PrivacyChainConfig): string {
  const parts: string[] = [];
  if (c.pool) {
    parts.push(`pool ${c.pool} (${c.poolSource})`);
    parts.push(c.deployBlock !== null ? `deploy block ${c.deployBlock} (${c.deployBlockSource})` : "no deploy block");
  } else {
    parts.push(c.problems.length > 0 ? `pool unusable (${c.poolSource})` : "no pool yet (not deployed)");
  }
  parts.push(`RPC ${c.rpcSource} ${urlHost(c.rpcUrl)}`);
  parts.push(`relayer ${keyAddress(c.relayerPrivateKey) ?? "none"} (fee ${c.relayerFeeBps} bps, min ${c.relayerMinFeeWei} wei)`);
  parts.push(`postman ${keyAddress(c.aspPostmanPrivateKey) ?? "none"}`);
  parts.push(`confirmations ${c.aspConfirmations}`);
  parts.push(`inclusion delay ${c.aspInclusionDelaySeconds} s (${formatDelay(c.aspInclusionDelaySeconds)})`);
  if (c.problems.length > 0) parts.push(`problems: ${c.problems.join(", ")} (shown as unavailable, no RPC call)`);
  return `[privacy] ${c.network.name} (${c.chainId}): ${parts.join("; ")}`;
}

/**
 * The boot summary, one line per served network: its name, the pool and deploy-block sources, the RPC source and
 * host, the relayer and postman addresses derived from their keys (never the keys), confirmations, the inclusion delay,
 * problems and warnings; then the exclusion list's state (where it comes from and how many entries, or why it is
 * invalid: never an entry's value or note). Never throws: a configuration error is logged and the server keeps running.
 */
export function logPrivacyConfigSummary(log: (line: string) => void = (line) => console.log(line)): void {
  try {
    const cfg = privacyConfig();
    // "serving Robinhood Chain Testnet": the networks themselves, never a mode name that reads as several of them;
    // only the old single-variable configuration (PRIVACY_CHAIN_ID) is named, as legacy mode
    const names = cfg.chains.map((c) => c.network.name).join(", ");
    log(`[privacy] ${cfg.mode === "legacy" ? "legacy mode (PRIVACY_CHAIN_ID): " : ""}serving ${names} (testnet ETH only, not audited)`);
    for (const c of cfg.chains) {
      log(summaryLine(c));
      for (const w of c.warnings) log(`[privacy] ${c.network.name} (${c.chainId}) warning: ${w}`);
    }
    for (const w of cfg.warnings) log(`[privacy] warning: ${w}`);
    // the operator's exclusion list, read now (its file path as configured, and the folder it resolved to)
    const source = cfg.aspExclusions;
    if (source.kind === "file" && source.display !== source.path) log(`[privacy] PRIVACY_ASP_EXCLUSIONS_FILE resolves to ${source.path}`);
    readExclusions(source, { log });
  } catch (err) {
    log(`[privacy] configuration error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
