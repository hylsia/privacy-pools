/**
 * Hylsia's wallet config, the only one in the app: the landing ("/" and every path the privacy area does not claim) and
 * the privacy area (/pools, /pools/*, /privacy), as client/src/areas.ts divides them. A wallet that already trusts the
 * site reconnects on the landing as well, so the landing must hold to everything below too.
 *
 *   - chains: only the networks this build offers, in registry order (Robinhood Chain Testnet; the local chains only
 *     in builds that list them). No mainnet and no trading chain, so RainbowKit makes no ENS lookup and nothing here
 *     reads a mainnet RPC.
 *   - transports: the RPC the app reads each network through (the person's own, set in this browser, else VITE_PRIVACY_RPC_URL_<id>, else the network's
 *     default), for every offered network, behind walletGuard.ts: a network without a pool gets no request at all,
 *     and a read that carries the wallet's address (its balance, for one) goes to the active network's RPC only,
 *     whichever component asks (RainbowKit's account window reads the balance on the wallet's own network). Outside
 *     the vault's pages (the landing) there is no active network, so no read carries the address at all.
 *   - connectors: explicit injected MetaMask and Rabby entries only, bound to their own providers (evmWallets.ts).
 *     Unrestricted EIP-6963 connector discovery is off: Phantom cannot join or reconnect. No WalletConnect relay,
 *     MetaMask SDK analytics beacon or network request before the person picks a wallet.
 *   - storage: `hylsia.pools.wagmi`, outside the `hylsia.pp.` namespace that "Forget vault" scans: forgetting a vault
 *     does not disconnect the wallet. The stored connection never names a network (walletGuard.ts withoutWalletChain):
 *     every chain id in it is the first offered network's, the same on every device.
 *
 * The chain objects keep their rpcUrls.default (wagmi's add-chain fallback sends it into the wallet, which is how a
 * deposit adds Robinhood Chain Testnet to a wallet that does not have it yet). RainbowKit shows its stock icon for a
 * chain id it knows; an empty iconUrl makes it write the network's name instead, so every network is named in words
 * there and no other chain's logo can appear.
 */
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { createConfig, createStorage, serialize, type Config } from "wagmi";
import type { Chain, Transport } from "viem";
import { metaMaskInjectedWallet, rabbyInjectedWallet } from "./evmWallets";
import { PRIVACY_NETWORKS, rpcTransport } from "./config";
import { guardTransport, withoutWalletChain } from "./walletGuard";

/** The wallet connection's storage key prefix (wagmi stores `<key>.store`, `<key>.recentConnectorId`, …). */
export const PRIVACY_WAGMI_STORAGE_KEY = "hylsia.pools.wagmi";

function browserStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : undefined;
  } catch {
    return undefined; // storage blocked: wagmi keeps the connection in memory only
  }
}

const chains = PRIVACY_NETWORKS.map(({ network }) => ({ ...network.chain, iconUrl: "" })) as Chain[];
if (chains.length === 0) throw new Error("This build offers no privacy network"); // resolveNetworks never returns none

const transports: Record<number, Transport> = Object.fromEntries(
  PRIVACY_NETWORKS.map(({ network, pool }) => [
    network.chainId,
    // rpcTransport: the person's own RPC when this browser has one (rpcOverride.ts), else the build's
    guardTransport({ chainId: network.chainId, name: network.name, hasPool: pool !== null }, rpcTransport(network.chainId)),
  ]),
);

/** Every stored chain id becomes this one: the first offered network, the same for every visitor. */
const NEUTRAL_CHAIN_ID = PRIVACY_NETWORKS[0].network.chainId;

const connectors = connectorsForWallets([{ groupName: "EVM wallets", wallets: [metaMaskInjectedWallet, rabbyInjectedWallet] }], {
  appName: "Hylsia",
  // only satisfies the wallet list's constructor: nothing in this config uses WalletConnect
  projectId: "YOUR_PROJECT_ID",
});

export const privacyWagmiConfig: Config = createConfig({
  chains: chains as [Chain, ...Chain[]],
  connectors,
  multiInjectedProviderDiscovery: false,
  transports,
  storage: createStorage({
    key: PRIVACY_WAGMI_STORAGE_KEY,
    storage: browserStorage(),
    serialize: (value) => serialize(withoutWalletChain(value, NEUTRAL_CHAIN_ID)),
  }),
});
