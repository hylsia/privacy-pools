/**
 * Browser-side Privacy Pools configuration: the networks this build offers and their pools.
 *
 * Built once, from the build's VITE_ environment and shared/privacy/deployments.ts, through the same parser as the
 * server (resolveNetworks in shared/privacy/networks.ts). With no VITE_PRIVACY_* variable the build offers the
 * registry's default network, Robinhood Chain Testnet, with the pool recorded for it. Every VITE_ value is public in
 * the bundle, so a VITE_PRIVACY_RPC_URL_<id> must never carry a secret key.
 *
 * Hylsia is built for Robinhood Chain. The code keeps several networks apart (local development chains, and Robinhood
 * Chain mainnet later): MULTI_NETWORK says whether this build offers more than one, and only then does the UI show
 * network filters, switchers, per-network groupings or breakdowns.
 *
 * - Lookups (findPool, poolBySlug, poolRefByKey) search only this built-in registry: neither a URL nor a server
 *   answer can choose where a deposit goes.
 * - An RPC from the environment goes only into transports and public clients, never into a chain's
 *   rpcUrls.default (wagmi's add-chain fallback sends that URL into the user's wallet).
 * - A network with a problem (shared/privacy/networks.ts) has no pool here: it is unavailable, never "not deployed",
 *   and gets no RPC call.
 */
import { createPublicClient, http, type Address, type PublicClient, type Transport } from "viem";
import { rpcOverride } from "./rpcOverride";
import { computeScope } from "@shared/privacy/context";
import { DEPLOYMENTS } from "@shared/privacy/deployments";
import { PROTOCOL_VERSION } from "@shared/privacy/constants";
import { V2_PROTOCOL, V2_ETH_PROTOCOL, type PrivacyProtocol } from "@shared/privacy/protocols";
import { V2_DEV_KEY_PINS } from "@shared/privacy/v2/devKeyPins";
import type { ArtifactBinding } from "./artifacts";
import {
  networkById,
  parsePoolKey,
  poolKey,
  resolveViteNetworks,
  samePool,
  type NetworkInfo,
  type NetworkProblem,
  type PoolId,
  type PoolKey,
  type ResolvedNetwork,
} from "@shared/privacy/networks";

const env = import.meta.env as Record<string, string | undefined>;

// Messages name the VITE_ variables (VITE_PRIVACY_CHAIN_IDS). vite.config.ts runs the same check when Vite starts, so a
// stale value stops the dev server or the build there, instead of shipping a page that throws here at import.
const RESOLVED = resolveViteNetworks(env, DEPLOYMENTS);
export const PRIVACY_PROTOCOL = RESOLVED.protocol;
export const DEVICE_STORAGE_PREFIX = PRIVACY_PROTOCOL === PROTOCOL_VERSION ? "hylsia.pp." : PRIVACY_PROTOCOL === V2_ETH_PROTOCOL ? "hylsia.pp.protocol-v2-eth." : "hylsia.pp.protocol-v2.";
export const activeProtocolStorageKey = (key: string) => key.startsWith(DEVICE_STORAGE_PREFIX)
  && (PRIVACY_PROTOCOL !== PROTOCOL_VERSION || !key.startsWith("hylsia.pp.protocol-"));

/** One usable pool of this build. */
export interface PoolRef extends PoolId {
  protocol: PrivacyProtocol;
  key: PoolKey;
  network: NetworkInfo;
  deployBlock: bigint;
  /** computeScope(pool, chainId): the contract's SCOPE must equal it */
  scope: bigint;
  rpcUrl: string;
  explorer: { url: string; name: string } | null;
  /** This runtime is v1; the key pin belongs to this exact pool's deployment. */
  artifacts: ArtifactBinding;
}

/** "multi" (VITE_PRIVACY_CHAIN_IDS, or the registry's default network) or "legacy" (VITE_PRIVACY_CHAIN_ID alone). */
export const PRIVACY_CONFIG_MODE: "multi" | "legacy" = RESOLVED.mode;

const BY_CHAIN = new Map<number, ResolvedNetwork>(RESOLVED.networks.map((r) => [r.network.chainId, r]));

function toPoolRef(r: ResolvedNetwork): PoolRef | null {
  if (r.problems.length > 0 || !r.pool || r.deployBlock === null) return null;
  const recorded = DEPLOYMENTS[r.network.chainId];
  const pin = recorded?.pool.toLowerCase() === r.pool.toLowerCase() ? recorded.vkeySha256 : undefined;
  return Object.freeze({
    chainId: r.network.chainId,
    protocol: r.protocol,
    pool: r.pool,
    key: poolKey(r.network.chainId, r.pool),
    network: r.network,
    deployBlock: r.deployBlock,
    scope: computeScope(r.pool, r.network.chainId),
    rpcUrl: r.rpcUrl,
    explorer: r.explorer,
    artifacts: Object.freeze({ protocol: r.protocol, ...(r.protocol === V2_ETH_PROTOCOL ? { releaseId: recorded?.releaseId, manifestSha256: recorded?.artifactManifestSha256 } : {}), ...(r.protocol === V2_PROTOCOL ? { vkeySha256: V2_DEV_KEY_PINS } : pin ? { vkeySha256: Object.freeze({ ...pin }) } : {}) }),
  });
}

/**
 * Every network this build offers, in registry order (Robinhood Chain Testnet first). `pool` null with `problem`
 * null: not deployed yet; with a problem: unavailable.
 */
export const PRIVACY_NETWORKS: readonly { network: NetworkInfo; pool: PoolRef | null; problem: NetworkProblem | null }[] = Object.freeze(
  RESOLVED.networks.map((r) => Object.freeze({ network: r.network, pool: toPoolRef(r), problem: r.problems[0] ?? null })),
);

/** The networks with a usable pool, in registry order. */
export const PRIVACY_POOLS: readonly PoolRef[] = Object.freeze(PRIVACY_NETWORKS.flatMap((n) => (n.pool ? [n.pool] : [])));

/**
 * The build offers more than one network (local development chains; Robinhood Chain mainnet later). False in the
 * normal build, which serves Robinhood Chain Testnet alone: then no network filter, switcher, chip, per-network
 * grouping or breakdown is shown, and the network is named only where it informs.
 */
export const MULTI_NETWORK: boolean = PRIVACY_NETWORKS.length > 1;

/** The one network of a single-network build ("Robinhood Chain Testnet"), else null. */
export const ONLY_NETWORK: NetworkInfo | null = PRIVACY_NETWORKS.length === 1 ? PRIVACY_NETWORKS[0].network : null;

/** The registry pool at this chain and address, or null. Registry only. */
export function findPool(chainId: number, pool: Address): PoolRef | null {
  return PRIVACY_POOLS.find((r) => samePool(r, { chainId, pool })) ?? null;
}

/** The registry pool on the network with this slug ("robinhood-testnet", "local-a", …), or null. Registry only. */
export function poolBySlug(slug: string): PoolRef | null {
  const s = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  return PRIVACY_POOLS.find((r) => r.network.slug === s) ?? null;
}

/** The registry pool with this key (`<chainId>:<address>`, any case), or null. Registry only. */
export function poolRefByKey(key: string): PoolRef | null {
  const id = parsePoolKey(key);
  return id ? findPool(id.chainId, id.pool) : null;
}

/** The RPC this build reads a network through: the VITE_ override, else the network's public default. */
export function rpcUrlFor(chainId: number): string {
  const r = BY_CHAIN.get(chainId);
  if (!r) throw new Error(`Hylsia is not built for network ${chainId} in this build`);
  return r.rpcUrl;
}

/**
 * The RPC this browser reads a network through right now: the person's own (rpcOverride.ts, kept in this browser
 * only), else the build's.
 */
export function effectiveRpcUrl(chainId: number): string {
  return rpcOverride(chainId) ?? rpcUrlFor(chainId);
}

/**
 * A transport that reads the network through effectiveRpcUrl at each request, so a changed setting applies at once
 * to every client built on it (one batching http transport per URL). Creating it sends nothing.
 */
export function rpcTransport(chainId: number): Transport {
  rpcUrlFor(chainId); // throws for a network this build does not offer
  return (opts) => {
    const made = new Map<string, ReturnType<Transport>>();
    const at = (url: string) => {
      let t = made.get(url);
      if (!t) {
        t = http(url, {
          batch: true,
          retryCount: 3,
          fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" },
        })(opts);
        made.set(url, t);
      }
      return t;
    };
    const base = at(rpcUrlFor(chainId));
    return {
      ...base,
      config: { ...base.config, key: "hylsiaRpc", name: "Hylsia RPC" },
      request: ((args: Parameters<typeof base.request>[0]) => at(effectiveRpcUrl(chainId)).request(args)) as typeof base.request,
    };
  };
}

const clients = new Map<number, PublicClient>();

/**
 * Read-only client for one offered network (memoized; creating it sends nothing). Works without a wallet, which
 * recovery needs. It reads through effectiveRpcUrl, so a person's own RPC applies without a reload. Throws for a
 * network this build does not offer.
 */
export function publicClientFor(chainId: number): PublicClient {
  let client = clients.get(chainId);
  if (!client) {
    const r = BY_CHAIN.get(chainId);
    if (!r) throw new Error(`Hylsia is not built for network ${chainId} in this build`);
    client = createPublicClient({ chain: r.network.chain, transport: rpcTransport(chainId) }) as PublicClient;
    clients.set(chainId, client);
  }
  return client;
}

/** The explorer for a network: this build's (VITE_PRIVACY_EXPLORER_URL_<id>; "none" disables it), else the registry's. */
function explorerFor(chainId: number): { url: string; name: string } | null {
  const r = BY_CHAIN.get(chainId);
  return r ? r.explorer : (networkById(chainId)?.explorer ?? null);
}

export function explorerTxUrl(chainId: number, hash: string): string | null {
  const e = explorerFor(chainId);
  return e ? `${e.url}/tx/${hash}` : null;
}

export function explorerAddressUrl(chainId: number, addr: string): string | null {
  const e = explorerFor(chainId);
  return e ? `${e.url}/address/${addr}` : null;
}

/** Per-pool storage: `hylsia.pp.<chainId>.<pool lowercase>.<suffix>` (today's format, so event caches survive). */
export function poolStorageKey(ref: PoolId, suffix: "events" | "pendingDeposits"): string {
  return `${DEVICE_STORAGE_PREFIX}${ref.chainId}.${ref.pool.toLowerCase()}.${suffix}`;
}

/**
 * Device-wide storage: one vault (v2) for every network. All under `hylsia.pp.`, which Forget scans. The active
 * network is never stored.
 *   - activity: the device activity log, encrypted with a key from the vault seed (client/src/privacy/activityStore.ts)
 *   - legacyActivity: the older plaintext log, read on unlock only to move it into `activity`, then deleted
 *   - activityQuarantine: a stored log that did not decrypt with the vault's key, set aside unread
 */
export const DEVICE_KEYS = Object.freeze({
  vault: `${DEVICE_STORAGE_PREFIX}vault.v2`,
  backupVerified: `${DEVICE_STORAGE_PREFIX}backupVerified.v2`,
  activity: `${DEVICE_STORAGE_PREFIX}activity.v3`,
  legacyActivity: `${DEVICE_STORAGE_PREFIX}activity.v2`,
  activityQuarantine: `${DEVICE_STORAGE_PREFIX}activity.quarantine`,
});
