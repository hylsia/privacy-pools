/**
 * Privacy Pools — shared protocol constants.
 *
 * Everything here must stay byte-for-byte consistent with:
 *   - contracts/src/PrivacyPool.sol (Solidity)
 *   - circuits/*.circom (Circom)
 * Changing any value here is a protocol change and requires new circuits,
 * new verifiers and a new pool deployment.
 */
import { keccak256, toBytes } from "viem";

/** BN254 scalar field modulus (the field used by Groth16 + Poseidon). */
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Fixed depth of the on-chain state tree and the off-chain ASP tree. */
export const TREE_DEPTH = 20;

/** Number of historical state roots the pool keeps (see MerkleTreeWithHistory). */
export const ROOT_HISTORY_SIZE = 100;

/** Number of historical ASP roots the pool keeps. */
export const ASP_ROOT_HISTORY_SIZE = 16;

/** Values are range-checked to 128 bits in the circuit. */
export const MAX_VALUE = (1n << 128n) - 1n;

/**
 * Zero leaf used by both trees.
 * Solidity: uint256(keccak256("hylsia.privacy-pool.v1.zero")) % SNARK_SCALAR_FIELD
 */
export const ZERO_VALUE =
  BigInt(keccak256(toBytes("hylsia.privacy-pool.v1.zero"))) % SNARK_SCALAR_FIELD;

/** Sentinel address used as the "asset" of the native-ETH pool. */
export const NATIVE_ASSET = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

/** Protocol / artifact version. Bump when circuits or note format change. */
export const PROTOCOL_VERSION = "hylsia-pp-v1";

/*
 * Chain parameters. The network registry (shared/privacy/networks.ts) builds on these.
 * `rpcUrls.default` is what a wallet receives when the app asks it to add the chain (wagmi's add-chain fallback),
 * so it is always a public endpoint chosen here. An RPC set in the environment goes only into transports and
 * public clients, never into these objects.
 */

/** Mainnet network parameters from https://docs.robinhood.com/chain/add-network-to-wallet/ (2026-11-21). */
export const ROBINHOOD_MAINNET = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
  testnet: false,
} as const;

/** Robinhood Chain Testnet parameters (verified against the public RPC on 2026-11-13). */
export const ROBINHOOD_TESTNET = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Testnet Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
} as const;

/** Local anvil chain used for the end-to-end prototype. */
export const ANVIL_CHAIN = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
} as const;

/** A second local anvil chain (`anvil --chain-id 31338 --port 8546`), for two-network development and tests. */
export const ANVIL_CHAIN_B = {
  id: 31338,
  name: "Anvil B",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true,
} as const;
