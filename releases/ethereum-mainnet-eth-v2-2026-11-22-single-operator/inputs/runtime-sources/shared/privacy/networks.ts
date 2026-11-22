/**
 * The network registry: the one source of network facts for the app, the server, the landing and the scripts.
 *
 * Hylsia is built for Robinhood Chain Testnet (46630): one pool and its anonymity set, testnet ETH only. Two local
 * anvil chains (31337, 31338) exist for development and tests, and are offered only by a build whose environment lists
 * them; together they keep the code honest about several networks (two pools at one address on two chains). Robinhood
 * Chain mainnet (4663) is opt-in for migration preparation; pool operations remain release-blocked.
 *
 * `resolveNetworks` turns an environment into the served networks. It is pure: the server passes
 * `name => process.env[name]`, the client `name => import.meta.env["VITE_" + name]` (every VITE_ value is public in
 * the bundle, so a VITE_ RPC URL must never carry a secret key). Its warnings name variables without the VITE_
 * prefix and print an RPC's host only, never the full URL.
 */
import { getAddress, isAddress, zeroAddress, type Address, type Chain } from "viem";
import { anvil, anvilB, ethereumMainnet, robinhoodMainnet, robinhoodTestnet, SUPPORTED_CHAIN_IDS } from "./chains";
import { computeScope } from "./context";
import { mainnetReleaseRefusal } from "./mainnetRelease";
import { PROTOCOL_VERSION } from "./constants";
import { readPrivacyProtocol, V2_PROTOCOL, V2_ETH_PROTOCOL, type PrivacyProtocol } from "./protocols";
import type { PoolDeployment } from "./deploymentTypes";

// ─── registry ─────────────────────────────────────────────────────────────────

export type NetworkSlug = "robinhood-testnet" | "robinhood-mainnet" | "ethereum-mainnet" | "local-a" | "local-b";

export interface NetworkInfo {
  chainId: number;
  /** URL segment: /pools/<slug>/<address>, #network=<slug> */
  slug: NetworkSlug;
  /** for copy: "Robinhood Chain Testnet", "Local chain A" */
  name: string;
  /** for tight spots: "Robinhood Chain Testnet" (always written in full: Robinhood Chain mainnet exists), "Local A" */
  shortName: string;
  /** "l1": none today; kept for the generic code */
  kind: "l1" | "l2" | "local";
  /** the viem chain object (shared/privacy/chains.ts); its rpcUrls.default is never overridden */
  chain: Chain;
  defaultRpcUrl: string;
  explorer: { url: string; name: string } | null;
  /** `display` replaces the URL where it would not fit; `hint` says what the link holds */
  faucet: { url: string; display: string; hint: string | null } | null;
  walletDocsUrl: string | null;
  walletHint: string | null;
  /** "robinhood": the official feather (compact spaces) or plate; "monogram": a neutral initial, never another logo */
  mark: "robinhood" | "monogram";
  /** confirmations before the association-set screening policy considers a deposit */
  aspConfirmations: number;
  /**
   * the screening policy's inclusion delay, in seconds: a confirmed deposit is considered once its block time plus this
   * is at or before the head's time (0: at once). The default; PRIVACY_ASP_INCLUSION_DELAY_SECONDS_<chainId> overrides it.
   */
  aspInclusionDelaySeconds: number;
  /** trailing blocks every event sync scans again, for reorgs */
  reorgWindow: number;
  /** eth_getLogs span per call, and the smallest span it halves to on provider errors */
  logChunk: bigint;
  minLogChunk: bigint;
}

const network = (n: NetworkInfo): NetworkInfo => Object.freeze(n);

/** Registry order: testnet 46630, opt-in mainnet 4663, then local chains 31337 and 31338. */
export const NETWORKS: readonly NetworkInfo[] = Object.freeze([
  network({
    chainId: 46630,
    slug: "robinhood-testnet",
    name: "Robinhood Chain Testnet",
    shortName: "Robinhood Chain Testnet",
    kind: "l2",
    chain: robinhoodTestnet,
    defaultRpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: { url: "https://explorer.testnet.chain.robinhood.com", name: "Robinhood Chain Testnet Explorer" },
    faucet: { url: "https://faucet.testnet.chain.robinhood.com", display: "faucet.testnet.chain.robinhood.com", hint: null },
    walletDocsUrl: "https://docs.robinhood.com/chain/add-network-to-wallet",
    walletHint: null,
    mark: "robinhood",
    aspConfirmations: 1,
    // one hour, so that a deposit can be checked against the exclusion list before it can leave privately
    aspInclusionDelaySeconds: 3_600,
    reorgWindow: 20,
    // about 420,000 blocks a day; the public RPC answers eth_getLogs for 100,000 blocks at most ("only 100000 are
    // allowed for this request", measured 2026-11-17), so a cold scan of a month-old pool is ~130 calls, not ~630
    logChunk: 100_000n,
    minLogChunk: 500n,
  }),
  network({
    chainId: 4663,
    slug: "robinhood-mainnet",
    name: "Robinhood Chain",
    shortName: "Robinhood Chain",
    kind: "l2",
    chain: robinhoodMainnet,
    defaultRpcUrl: robinhoodMainnet.rpcUrls.default.http[0],
    explorer: { url: "https://robinhoodchain.blockscout.com", name: "Robinhood Chain Explorer" },
    faucet: null,
    walletDocsUrl: "https://docs.robinhood.com/chain/add-network-to-wallet/",
    walletHint: "Mainnet migration in preparation; no pool is deployed by this build.",
    mark: "robinhood",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 3_600,
    reorgWindow: 20,
    // Conservative initial scan span; provider limits are not assumed equal to testnet's.
    logChunk: 10_000n,
    minLogChunk: 500n,
  }),
  network({
    chainId: 1,
    slug: "ethereum-mainnet",
    name: "Ethereum",
    shortName: "Ethereum",
    kind: "l1",
    chain: ethereumMainnet,
    defaultRpcUrl: ethereumMainnet.rpcUrls.default.http[0],
    explorer: { url: "https://etherscan.io", name: "Etherscan" },
    faucet: null,
    walletDocsUrl: "https://ethereum.org/wallets/",
    walletHint: "Mainnet preparation; no native ETH pool is recorded by this build.",
    mark: "monogram",
    aspConfirmations: 12,
    aspInclusionDelaySeconds: 3_600,
    reorgWindow: 64,
    logChunk: 1_000n,
    minLogChunk: 100n,
  }),
  network({
    chainId: 31337,
    slug: "local-a",
    name: "Local chain A",
    shortName: "Local A",
    kind: "local",
    chain: anvil,
    defaultRpcUrl: "http://127.0.0.1:8545",
    explorer: null,
    faucet: null,
    walletDocsUrl: null,
    walletHint: null,
    mark: "monogram",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 0,
    reorgWindow: 0,
    logChunk: 20_000n,
    minLogChunk: 500n,
  }),
  network({
    chainId: 31338,
    slug: "local-b",
    name: "Local chain B",
    shortName: "Local B",
    kind: "local",
    chain: anvilB,
    defaultRpcUrl: "http://127.0.0.1:8546",
    explorer: null,
    faucet: null,
    walletDocsUrl: null,
    walletHint: null,
    mark: "monogram",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 0,
    reorgWindow: 0,
    logChunk: 20_000n,
    minLogChunk: 500n,
  }),
]);

/** Public networks in registry order: Robinhood Chain Testnet, then mainnet (preparation only). */
export const PUBLIC_NETWORKS: readonly NetworkInfo[] = Object.freeze(NETWORKS.filter((n) => n.kind !== "local"));

/**
 * The networks served when the environment names none: Robinhood Chain Testnet. Named here, not derived: a network
 * in the registry (including mainnet) is served only once explicitly selected.
 */
export const DEFAULT_CHAIN_IDS: readonly number[] = Object.freeze([46630]);

export function networkById(chainId: number): NetworkInfo | null {
  return NETWORKS.find((n) => n.chainId === chainId) ?? null;
}

export function networkBySlug(slug: string): NetworkInfo | null {
  const s = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  return NETWORKS.find((n) => n.slug === s) ?? null;
}

/**
 * anvil's ten default accounts (mnemonic "test test … junk"). A deployment record for a public network that names one
 * of them as deployer, owner or postman was made on a local chain and must never be served as a real pool.
 */
export const ANVIL_DEFAULT_ACCOUNTS: readonly Address[] = Object.freeze([
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
] as const);

const ANVIL_ACCOUNT_SET = new Set(ANVIL_DEFAULT_ACCOUNTS.map((a) => a.toLowerCase()));

export function isAnvilDefaultAccount(address: string | null | undefined): boolean {
  return typeof address === "string" && ANVIL_ACCOUNT_SET.has(address.toLowerCase());
}

// ─── pool identity ────────────────────────────────────────────────────────────

/**
 * A pool is identified by its chain AND its address: the same deployer at the same nonce gives the same pool address
 * on every chain (the two local chains do so on purpose), so an address alone can name two different pools.
 */
export type PoolKey = `${number}:0x${string}`;
export interface PoolId {
  chainId: number;
  pool: Address;
}

/** `${chainId}:${pool.toLowerCase()}` */
export function poolKey(chainId: number, pool: Address): PoolKey {
  return `${chainId}:${pool.toLowerCase()}` as PoolKey;
}

/** The pool a key names, or null for anything that is not `<chainId>:<address>`. Says nothing about the registry. */
export function parsePoolKey(key: string): PoolId | null {
  const m = typeof key === "string" ? /^(\d+):(0x[0-9a-fA-F]{40})$/.exec(key.trim()) : null;
  if (!m) return null;
  const chainId = Number(m[1]);
  if (!Number.isSafeInteger(chainId)) return null;
  return { chainId, pool: m[2].toLowerCase() as Address };
}

/** Same chainId AND same address (case-insensitive). */
export function samePool(a: PoolId, b: PoolId): boolean {
  return (
    a.chainId === b.chainId &&
    typeof a.pool === "string" &&
    typeof b.pool === "string" &&
    a.pool.toLowerCase() === b.pool.toLowerCase()
  );
}

/** The entry for one pool (chain and address), or null. An entry for the same address on another chain never matches. */
export function pickPoolEntry<T extends PoolId>(list: readonly T[] | undefined, ref: PoolId | null): T | null {
  if (!list || !ref) return null;
  return list.find((entry) => !!entry && samePool(entry, ref)) ?? null;
}

// ─── environment ──────────────────────────────────────────────────────────────

/**
 * Why a configured pool cannot be used. A pool with a problem shows as unavailable (never "not deployed") and gets
 * no RPC call.
 */
export type NetworkProblem = "invalid_address" | "missing_deploy_block" | "anvil_account_record" | "scope_mismatch_record" | "protocol_mismatch_record" | "candidate_protocol_public" | "mainnet_release_blocked" | "missing_release_binding";

export interface ResolvedNetwork {
  protocol: PrivacyProtocol;
  network: NetworkInfo;
  rpcUrl: string;
  rpcSource: "env" | "default";
  /** after PRIVACY_EXPLORER_URL_<id> ("none" gives null) */
  explorer: { url: string; name: string } | null;
  pool: Address | null;
  poolSource: "env" | "deployment" | "none";
  deployBlock: bigint | null;
  deployBlockSource: "env" | "deployment" | "local" | "none";
  problems: NetworkProblem[];
  warnings: string[];
}

export type EnvReader = (name: string) => string | undefined;

/** The per-network variables resolveNetworks reads (each with a `_<chainId>` suffix). */
export const NETWORK_ENV_VARS = ["PRIVACY_RPC_URL", "PRIVACY_POOL_ADDRESS", "PRIVACY_POOL_DEPLOY_BLOCK", "PRIVACY_EXPLORER_URL"] as const;

/** Trimmed value, or undefined when unset or blank. */
function reader(read: EnvReader): EnvReader {
  return (name) => {
    const v = read(name);
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? undefined : t;
  };
}

/**
 * One per-network value, read the way resolveNetworks reads its own: `<name>_<chainId>` first, then `<name>`:
 *   - fallback "always": values one deployment may share between networks (relayer and postman keys, fee bps,
 *     minimum fee, quote TTL);
 *   - fallback "legacy": per-network values (confirmations, reorg window, log chunk, receipt wait; RPC, pool, deploy
 *     block, explorer), where a global value must never apply to another network, so `<name>` counts only in legacy
 *     single-network mode.
 * Blank values count as unset.
 */
export function networkEnv(
  read: EnvReader,
  name: string,
  chainId: number,
  o: { mode: "multi" | "legacy"; fallback: "always" | "legacy" },
): string | undefined {
  const get = reader(read);
  return get(`${name}_${chainId}`) ?? (o.fallback === "always" || o.mode === "legacy" ? get(name) : undefined);
}

function parseChainId(text: string, variable: string): number {
  if (!/^\d+$/.test(text)) throw new Error(`${variable}: "${text}" is not a chain id`);
  const id = Number(text);
  if (!networkById(id)) throw new Error(`${variable}: Hylsia is not built for network ${id} (supported: ${SUPPORTED_CHAIN_IDS.join(", ")})`);
  return id;
}

function parseChainIdList(text: string): number[] {
  const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) throw new Error("PRIVACY_CHAIN_IDS lists no network");
  return [...new Set(parts.map((p) => parseChainId(p, "PRIVACY_CHAIN_IDS")))];
}

/** host[:port] of a URL, never its path, query or credentials (an RPC URL may carry an API key). */
export function urlHost(url: string): string {
  try {
    return new URL(url).host || "(no host)";
  } catch {
    return "(not a URL)";
  }
}

const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host !== "";
  } catch {
    return false;
  }
};

const isLoopback = (url: string): boolean => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "::1" || h === "[::1]" || /^127(\.\d{1,3}){3}$/.test(h);
  } catch {
    return false;
  }
};

/** A usable pool address (checksummed), or null: invalid, wrong checksum, or the zero address. */
function asPoolAddress(v: unknown): Address | null {
  if (typeof v !== "string" || !isAddress(v) || v.toLowerCase() === zeroAddress) return null;
  return getAddress(v);
}

function asBlockNumber(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^(\d+|0x[0-9a-fA-F]+)$/.test(v.trim())) return null;
  return BigInt(v.trim());
}

function scopeMatches(record: PoolDeployment, pool: Address, chainId: number): boolean {
  try {
    return BigInt(record.scope) === computeScope(pool, chainId);
  } catch {
    return false;
  }
}

function resolveOne(
  network: NetworkInfo,
  get: EnvReader,
  mode: "multi" | "legacy",
  record: PoolDeployment | undefined,
  protocol: PrivacyProtocol,
): ResolvedNetwork {
  const id = network.chainId;
  const own = (name: string) => get(`${name}_${id}`) ?? (mode === "legacy" ? get(name) : undefined);
  /** the variable that supplied `own(name)`, for messages */
  const source = (name: string) => (get(`${name}_${id}`) !== undefined ? `${name}_${id}` : name);
  const problems: NetworkProblem[] = [];
  const warnings: string[] = [];

  // RPC: the env value, else the network's public default. Never written into the chain object.
  const rpcEnv = own("PRIVACY_RPC_URL");
  const rpcUrl = rpcEnv ?? network.defaultRpcUrl;
  if (rpcEnv !== undefined && !isHttpUrl(rpcEnv)) warnings.push(`${source("PRIVACY_RPC_URL")} is not an http(s) URL`);
  if (network.kind === "local" && !isLoopback(rpcUrl)) {
    warnings.push(`${network.name}: RPC host ${urlHost(rpcUrl)} is not a loopback address (local networks are anvil chains on this machine)`);
  }

  // explorer: "none" disables links (for an anvil that reuses a public chain id)
  let explorer = network.explorer;
  const explorerEnv = own("PRIVACY_EXPLORER_URL");
  if (explorerEnv !== undefined) {
    if (explorerEnv.toLowerCase() === "none") explorer = null;
    else if (isHttpUrl(explorerEnv)) {
      const url = explorerEnv.replace(/\/+$/, "");
      explorer = network.explorer?.url === url ? network.explorer : { url, name: urlHost(url) };
    } else warnings.push(`${source("PRIVACY_EXPLORER_URL")} is neither "none" nor an http(s) URL; the default explorer is used`);
  }

  // pool: the env value, else the deployment record
  let pool: Address | null = null;
  let poolSource: ResolvedNetwork["poolSource"] = "none";
  const poolEnv = own("PRIVACY_POOL_ADDRESS");
  if (poolEnv !== undefined) {
    poolSource = "env";
    pool = asPoolAddress(poolEnv);
    if (!pool) problems.push("invalid_address");
  } else if (record) {
    poolSource = "deployment";
    pool = asPoolAddress(record.pool);
    if (!pool) problems.push("invalid_address");
  }
  // The record describes the resolved pool only when it names the same address.
  const recordInUse = !!record && !!pool && typeof record.pool === "string" && record.pool.toLowerCase() === pool.toLowerCase();
  if (record && pool && !recordInUse) {
    warnings.push(`${source("PRIVACY_POOL_ADDRESS")} names another pool than the deployment record for ${network.name}; the record is not used`);
  }

  // deploy block: the env value; else the record's, only for the record's own pool; else 0 on local networks;
  // else a problem (nothing scans a public chain from genesis)
  let deployBlock: bigint | null = null;
  let deployBlockSource: ResolvedNetwork["deployBlockSource"] = "none";
  const blockEnv = own("PRIVACY_POOL_DEPLOY_BLOCK");
  let envBlock = blockEnv !== undefined ? asBlockNumber(blockEnv) : null;
  if (blockEnv !== undefined && envBlock === null) warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is not a block number; it is ignored`);
  // 0 would scan a public chain from genesis (over 1,500 eth_getLogs calls on Robinhood Chain Testnet): refused like
  // a record's 0, so the record's block, or the problem missing_deploy_block, applies instead. An anvil on this machine
  // that runs a public chain id (the two-network e2e) starts at block 0, so a loopback RPC keeps it.
  if (envBlock === 0n && network.kind !== "local" && !isLoopback(rpcUrl)) {
    warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is 0 on ${network.name}; a public pool is never scanned from genesis, so it is ignored`);
    envBlock = null;
  }
  let recordBlock = recordInUse ? asBlockNumber(record!.deployBlock) : null;
  if (recordBlock === 0n && network.kind !== "local") {
    warnings.push(`the deployment record for ${network.name} gives deploy block 0; it is ignored`);
    recordBlock = null;
  }
  if (pool) {
    if (envBlock !== null) {
      deployBlock = envBlock;
      deployBlockSource = "env";
    } else if (recordBlock !== null) {
      deployBlock = recordBlock;
      deployBlockSource = "deployment";
    } else if (network.kind === "local") {
      deployBlock = 0n;
      deployBlockSource = "local";
    } else {
      problems.push("missing_deploy_block");
    }
  } else if (blockEnv !== undefined && poolSource === "none") {
    warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is set, but ${network.name} has no pool`);
  }

  // the record itself: made on a local chain, or for another pool or chain
  if (recordInUse) {
    if (network.kind !== "local" && [record!.deployer, record!.owner, record!.aspPostman].some(isAnvilDefaultAccount)) {
      problems.push("anvil_account_record");
    }
    if (!scopeMatches(record!, pool!, id)) problems.push("scope_mismatch_record");
    // This app/runtime still implements v1. Never infer v2 support from a compatible-looking address or ABI.
    if ((record!.protocol ?? PROTOCOL_VERSION) !== protocol) {
      problems.push("protocol_mismatch_record");
      warnings.push(`${network.name}: deployment protocol ${record!.protocol} does not match this runtime's ${protocol}`);
    }
  }

  if (pool && protocol === V2_PROTOCOL && (network.kind !== "local" || !isLoopback(rpcUrl))) {
    problems.push("candidate_protocol_public");
    warnings.push("The v2 development protocol is available on local loopback chains only");
  }
  if (pool && protocol === V2_ETH_PROTOCOL && (!recordInUse || !/^[0-9a-f]{64}$/.test(record?.releaseId ?? "")
    || !/^[0-9a-f]{64}$/.test(record?.artifactManifestSha256 ?? "")
    || !/^[0-9a-f]{64}$/.test(record?.vkeySha256?.withdraw ?? "") || !/^[0-9a-f]{64}$/.test(record?.vkeySha256?.commitment ?? ""))) {
    problems.push("missing_release_binding");
    warnings.push("Native ETH v2 requires a recorded release, manifest digest and both verification-key pins");
  }

  // A valid-looking address or an env override cannot turn the development protocol into a mainnet release.
  if (pool && mainnetReleaseRefusal(network.chain, { protocol, ...(recordInUse ? { releaseId: record?.releaseId, artifactManifestSha256: record?.artifactManifestSha256 } : {}) })) {
    problems.push("mainnet_release_blocked");
    warnings.push(mainnetReleaseRefusal(network.chain, { protocol, ...(recordInUse ? { releaseId: record?.releaseId, artifactManifestSha256: record?.artifactManifestSha256 } : {}) })!);
  }

  return {
    protocol,
    network,
    rpcUrl,
    rpcSource: rpcEnv !== undefined ? "env" : "default",
    explorer,
    pool,
    poolSource,
    deployBlock,
    deployBlockSource,
    problems,
    warnings,
  };
}

/**
 * The networks an environment serves, in registry order.
 *
 * Mode:
 *   - `PRIVACY_CHAIN_IDS` (comma list): multi mode;
 *   - unset, with `PRIVACY_CHAIN_ID`: legacy single mode (the tests, `asp-publish.ts`);
 *   - neither: multi mode on DEFAULT_CHAIN_IDS (46630).
 * Unknown ids throw, naming the supported ones (a stale id from an older configuration fails here, loudly).
 *
 * Per network, with a `_<chainId>` suffix (legacy mode also reads the unsuffixed form; multi mode ignores it, with a
 * warning that names the suffixed form):
 *   - `PRIVACY_RPC_URL`: else the network's default;
 *   - `PRIVACY_POOL_ADDRESS`: else `deployments[id].pool`;
 *   - `PRIVACY_POOL_DEPLOY_BLOCK`: else the record's deploy block, only when the record's pool is the resolved pool;
 *     else 0 on local networks; else the problem `missing_deploy_block`. A 0 from the env or a record is ignored, with
 *     a warning, on a public network: nothing scans a public chain from genesis;
 *   - `PRIVACY_EXPLORER_URL`: else the network's default; `none` disables links.
 * Problems: `invalid_address`; `missing_deploy_block`; `anvil_account_record` (a public network's record whose
 * deployer, owner or postman is an anvil default account); `scope_mismatch_record` (the record's scope is not
 * computeScope(pool, chainId)).
 */
export function resolveNetworks(
  read: (name: string) => string | undefined,
  deployments: Readonly<Record<number, PoolDeployment>>,
): { protocol: PrivacyProtocol; mode: "multi" | "legacy"; networks: ResolvedNetwork[]; warnings: string[] } {
  const get = reader(read);
  const protocol = readPrivacyProtocol(get("PRIVACY_PROTOCOL"));
  const warnings: string[] = [];
  const list = get("PRIVACY_CHAIN_IDS");
  const single = get("PRIVACY_CHAIN_ID");

  let mode: "multi" | "legacy";
  let ids: readonly number[];
  if (list !== undefined) {
    mode = "multi";
    ids = parseChainIdList(list);
    if (single !== undefined) warnings.push("PRIVACY_CHAIN_ID is ignored because PRIVACY_CHAIN_IDS is set");
  } else if (single !== undefined) {
    mode = "legacy";
    ids = [parseChainId(single, "PRIVACY_CHAIN_ID")];
  } else {
    mode = "multi";
    ids = DEFAULT_CHAIN_IDS;
  }

  const served = NETWORKS.filter((n) => ids.includes(n.chainId));
  if (mode === "multi") {
    for (const name of NETWORK_ENV_VARS) {
      if (get(name) !== undefined) {
        warnings.push(`${name} has no network suffix and is ignored; set ${served.map((n) => `${name}_${n.chainId}`).join(" or ")}`);
      }
    }
  }
  for (const n of NETWORKS) {
    if (served.includes(n)) continue;
    const set = NETWORK_ENV_VARS.map((name) => `${name}_${n.chainId}`).filter((name) => get(name) !== undefined);
    if (set.length > 0) warnings.push(`${set.join(", ")} ${set.length === 1 ? "is" : "are"} ignored: ${n.name} (${n.chainId}) is not served`);
  }

  const networks = served.map((n) => resolveOne(n, get, mode, deployments[n.chainId], protocol));
  return { protocol, mode, networks, warnings };
}

/**
 * The browser build's networks: resolveNetworks on the VITE_ variables (`VITE_PRIVACY_CHAIN_IDS`, …), with messages
 * that name those variables, so a stale `VITE_PRIVACY_CHAIN_IDS` says which variable to fix. Throws like
 * resolveNetworks. vite.config.ts runs it when Vite starts (dev server and build), client/src/privacy/config.ts at
 * import.
 */
export function resolveViteNetworks(
  env: Readonly<Record<string, string | undefined>>,
  deployments: Readonly<Record<number, PoolDeployment>>,
): ReturnType<typeof resolveNetworks> {
  const named = (message: string) => message.replace(/\bPRIVACY_/g, "VITE_PRIVACY_");
  let r: ReturnType<typeof resolveNetworks>;
  try {
    r = resolveNetworks((name) => env[`VITE_${name}`], deployments);
  } catch (err) {
    throw new Error(named(err instanceof Error ? err.message : String(err)));
  }
  return {
    protocol: r.protocol,
    mode: r.mode,
    networks: r.networks.map((n) => ({ ...n, warnings: n.warnings.map(named) })),
    warnings: r.warnings.map(named),
  };
}
