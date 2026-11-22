import { ethereumMainnet, robinhoodMainnet } from "./chains";

export const MAINNET_TARGETS = Object.freeze({
  "ethereum-mainnet": Object.freeze({
    slug: "ethereum-mainnet",
    chainId: 1,
    chain: ethereumMainnet,
    verifierApi: "https://eth.blockscout.com/api/",
  }),
  "robinhood-mainnet": Object.freeze({
    slug: "robinhood-mainnet",
    chainId: 4663,
    chain: robinhoodMainnet,
    verifierApi: "https://robinhoodchain.blockscout.com/api/",
  }),
});
export type MainnetSlug = keyof typeof MAINNET_TARGETS;
export type MainnetChainId = 1 | 4663;
export const isMainnetChainId = (value: unknown): value is MainnetChainId =>
  value === 1 || value === 4663;
export function mainnetTarget(slug: string = "robinhood-mainnet") {
  if (!Object.hasOwn(MAINNET_TARGETS, slug))
    throw new Error("--network must be ethereum-mainnet or robinhood-mainnet");
  return MAINNET_TARGETS[slug as MainnetSlug];
}
