import { defineChain, type Chain } from "viem";
import { mainnet } from "viem/chains";
import {
  ANVIL_CHAIN,
  ANVIL_CHAIN_B,
  ROBINHOOD_MAINNET,
  ROBINHOOD_TESTNET,
} from "./constants";

/*
 * viem chain objects for Robinhood Chain Testnet, mainnet migration preparation and the two local development
 * chains. They are module constants and are never mutated: an RPC override from the environment goes into transports
 * and public clients only, because wagmi's add-chain fallback sends `rpcUrls.default` into the user's wallet.
 */
export const robinhoodTestnet = defineChain({ ...ROBINHOOD_TESTNET });
export const robinhoodMainnet = defineChain({ ...ROBINHOOD_MAINNET });
export const ethereumMainnet = defineChain({
  ...mainnet,
  rpcUrls: { default: { http: ["https://ethereum-rpc.publicnode.com"] } },
});
export const anvil = defineChain({ ...ANVIL_CHAIN });
export const anvilB = defineChain({ ...ANVIL_CHAIN_B });

/** Registry order: testnet, opt-in mainnet, then the two local chains. */
const ORDERED: readonly Chain[] = [
  robinhoodTestnet,
  robinhoodMainnet,
  ethereumMainnet,
  anvil,
  anvilB,
];

export const PRIVACY_CHAINS: Readonly<Record<number, Chain>> =
  Object.fromEntries(ORDERED.map(c => [c.id, c]));

/** The supported chain ids in registry order, as error messages list them. */
export const SUPPORTED_CHAIN_IDS: readonly number[] = ORDERED.map(c => c.id);

export function getPrivacyChain(chainId: number): Chain {
  const chain = PRIVACY_CHAINS[chainId];
  if (!chain)
    throw new Error(
      `Unsupported privacy chain id ${chainId} (supported: ${SUPPORTED_CHAIN_IDS.join(", ")})`
    );
  return chain;
}
