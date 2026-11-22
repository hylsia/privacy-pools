/**
 * One bundle per served chain: its public client and the wallets of its relayer and postman keys, each bound to that
 * chain's viem chain object and RPC. The contract is always read and written through the same chain's bundle.
 *
 * Pool addresses can be equal on two chains (same deployer, same nonce; the two local chains do so on purpose), so a
 * simulation on one chain and a write on the other would send a real transaction to the wrong pool: every caller
 * passes the chain id of the operation, and a wallet signs for its own chain id only (EIP-155, from its chain object).
 */
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainConfig } from "./config";

/**
 * A read gives up after 5 s and is tried twice at most. viem's default (10 s, four tries) let one hung RPC hold a call
 * that covers every pool for over 40 s, past Vercel's 30 s limit (vercel.json), so the healthy network's answer was
 * lost too. Calls that cover every pool also give each pool a deadline of its own (asp.ts withPoolDeadline).
 */
const RPC_TIMEOUT_MS = 5_000;
const RPC_RETRIES = 1;

/** keyed `${chainId}|${rpcUrl}`, so a changed configuration never reuses a client for another endpoint */
const publicClients = new Map<string, PublicClient>();
/** keyed `${chainId}|${rpcUrl}|${address}` */
const walletClients = new Map<string, WalletClient>();

/** The chain's public client (creating it sends nothing). Omitted chainId: the only served chain. */
export function getPublicClient(chainId?: number): PublicClient {
  const cfg = chainConfig(chainId);
  const key = `${cfg.chainId}|${cfg.rpcUrl}`;
  let client = publicClients.get(key);
  if (!client) {
    client = createPublicClient({
      chain: cfg.network.chain,
      transport: http(cfg.rpcUrl, { batch: true, retryCount: RPC_RETRIES, timeout: RPC_TIMEOUT_MS }),
    }) as PublicClient;
    publicClients.set(key, client);
  }
  return client;
}

/** A wallet for `privateKey` on the chain (the relayer's or the postman's). Omitted chainId: the only served chain. */
export function makeWalletClient(privateKey: Hex, chainId?: number): WalletClient {
  const cfg = chainConfig(chainId);
  const account = privateKeyToAccount(privateKey);
  const key = `${cfg.chainId}|${cfg.rpcUrl}|${account.address}`;
  let wallet = walletClients.get(key);
  if (!wallet) {
    wallet = createWalletClient({ account, chain: cfg.network.chain, transport: http(cfg.rpcUrl) });
    walletClients.set(key, wallet);
  }
  return wallet;
}

/** test hook */
export function resetClients() {
  publicClients.clear();
  walletClients.clear();
}
