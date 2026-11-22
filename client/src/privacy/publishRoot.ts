/** Wallet-only ASP publication. No server signer, secret, relayer or automatic send. */
import {
  getAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { PRIVACY_POOL_ABI } from "@shared/privacy/abi";
import {
  ASP_POLICY_VERSION,
  highestPolicyVersion,
  verifySet,
} from "@shared/privacy/screening";
import type { ASPScreening } from "@shared/privacy/api";
import type { PoolEvent } from "@shared/privacy/types";
import type { PoolRef } from "./config";

export async function publishWalletRoot(options: {
  ref: PoolRef;
  events: readonly PoolEvent[];
  screening: ASPScreening;
  client: PublicClient;
  getWallet: () => Promise<WalletClient>;
}): Promise<Hex | null> {
  const { ref, events, screening, client } = options;
  if (
    screening.walletPublishable !== true ||
    screening.policyVersion !== ASP_POLICY_VERSION ||
    highestPolicyVersion(events) > ASP_POLICY_VERSION ||
    screening.exclusions === "invalid" ||
    screening.settling
  )
    throw new Error(
      "Publishing is paused until the screening policy is ready."
    );
  if (!screening.rootDue) return null;
  const { root: text, cid } = screening.snapshot;
  const root = BigInt(text);
  if (!cid || !verifySet(root, cid, events))
    throw new Error(
      "The proposed root does not match this device's verified pool history. Sync and try again."
    );
  const [chainId, publisher, currentRoot] = await Promise.all([
    client.getChainId(),
    client.readContract({
      address: ref.pool,
      abi: PRIVACY_POOL_ABI,
      functionName: "aspPostman",
    }),
    client.readContract({
      address: ref.pool,
      abi: PRIVACY_POOL_ABI,
      functionName: "currentASPRoot",
    }),
  ]);
  if (chainId !== ref.chainId)
    throw new Error("The RPC is on a different network.");
  let postedCid: string | null = null;
  for (const event of events)
    if (event.kind === "asproot" && event.root === currentRoot)
      postedCid = event.cid;
  if (currentRoot === root && postedCid === cid) return null;
  const wallet = await options.getWallet();
  if (
    !wallet.account ||
    getAddress(wallet.account.address) !== getAddress(publisher)
  )
    throw new Error(
      "Connect the pool's ASP publisher wallet to publish this root."
    );
  if ((await wallet.getChainId()) !== ref.chainId)
    throw new Error("Switch the publisher wallet to the pool's network.");
  const [nonce, pending] = await Promise.all([
    client.getTransactionCount({ address: wallet.account.address }),
    client.getTransactionCount({
      address: wallet.account.address,
      blockTag: "pending",
    }),
  ]);
  if (nonce !== pending)
    throw new Error(
      "The publisher wallet has a pending transaction. Wait for its confirmation."
    );
  const { request } = await client.simulateContract({
    address: ref.pool,
    abi: PRIVACY_POOL_ABI,
    functionName: "updateASPRoot",
    args: [root, cid],
    account: wallet.account,
    chain: ref.network.chain,
  });
  return wallet.writeContract({
    ...request,
    chain: ref.network.chain,
    account: wallet.account,
  });
}
