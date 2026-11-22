import { PRIVACY_POOLS } from "./config";

export const IS_ETHEREUM_MAINNET = PRIVACY_POOLS.some(
  pool => pool.chainId === 1
);
export const ETH_ASSET_LABEL = IS_ETHEREUM_MAINNET
  ? "native ETH"
  : "testnet ETH";
export const ENVIRONMENT_NOTICE = IS_ETHEREUM_MAINNET
  ? "Ethereum Mainnet · single-operator trusted setup · not independently audited."
  : "Testnet only. Not audited. Development trusted setup. Do not use real funds.";
