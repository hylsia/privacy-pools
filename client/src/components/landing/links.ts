/**
 * Network URLs and app paths used across the landing page.
 *
 * Network facts come from the network registry (shared/privacy/networks.ts), the same source the app and the server
 * read, so the landing and the app always name the same RPC, explorer and faucet. Nothing here is a deployment
 * address: the pool's address is only ever read from the server's answer (usePoolStatus), so no link here points at
 * a pool.
 */
import { networkById, type NetworkInfo } from "@shared/privacy/networks";

function registryNetwork(chainId: number): NetworkInfo {
  const network = networkById(chainId);
  if (!network) throw new Error(`network ${chainId} is not in the registry`);
  return network;
}

/** A registry fact the landing links to; Robinhood Chain Testnet's entry has every one of them. */
function required(value: string | null | undefined, what: string): string {
  if (!value) throw new Error(`the registry has no ${what} for Robinhood Chain Testnet`);
  return value;
}

/** Robinhood Chain Testnet (46630): the network Hylsia is built for, as the registry describes it. */
export const ROBINHOOD_NETWORK: NetworkInfo = registryNetwork(46630);

/** Robinhood Chain Testnet chain id (46630). */
export const CHAIN_ID = ROBINHOOD_NETWORK.chainId;
/** Public JSON-RPC endpoint of Robinhood Chain Testnet (the one the app reads by default). */
export const RPC_URL = ROBINHOOD_NETWORK.defaultRpcUrl;
/** Block explorer of Robinhood Chain Testnet. */
export const EXPLORER_URL = required(ROBINHOOD_NETWORK.explorer?.url, "explorer");
/** Testnet ETH faucet. External: open with target="_blank" rel="noopener noreferrer". */
export const FAUCET_URL = required(ROBINHOOD_NETWORK.faucet?.url, "faucet");
/** "Add the network to your wallet" guide. External. */
export const WALLET_DOCS_URL = required(ROBINHOOD_NETWORK.walletDocsUrl, "wallet guide");

/** Hylsia on X. The single source for every X link (landing footer and the dashboard sidebar). External. */
export const X_URL = "https://x.com/hylsiapools";

/**
 * My vault: create or unlock a vault, deposit, withdraw. The primary CTA points here only once usePoolStatus()
 * reports "live"; before that the page explains how the vault works and that the pool is not deployed yet.
 */
export const POOL_PATH = "/pools/vault";
/** The pools explorer, the app's front page (and the primary CTA until the pool is live). */
export const POOLS_PATH = "/pools";
/** My notes: notes, private balance and history, rebuilt on the device. */
export const NOTES_PATH = "/pools/portfolio";

/**
 * The vault, opened on one network's pool: `/pools/vault#network=<slug>`, for builds that serve several networks
 * (development only). The network travels only in the hash, an input from in-app links that the vault reads once and
 * strips; it is never sent, stored or put in a query string.
 */
export function vaultPathFor(network: Pick<NetworkInfo, "slug">): string {
  return `${POOL_PATH}#network=${network.slug}`;
}

/** A URL without its scheme, for display: host("https://a.b/c") === "a.b/c". */
export function host(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
