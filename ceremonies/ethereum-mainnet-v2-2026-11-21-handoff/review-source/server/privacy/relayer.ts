/**
 * Relayer: submits proof-authorised withdrawals so the recipient address never
 * has to pay gas (which would link it to a funded account).
 *
 * The relayer cannot redirect funds: recipient, relayer address, fee and
 * deadline are bound into the proof's `context`, and the context binds the pool's
 * SCOPE, which binds its chain. It can only refuse or delay.
 *
 * Each served network has its own relayer settings (key, fee bps, minimum fee, quote TTL; one key may serve every
 * network) and its own bundle: a withdrawal is simulated and sent on the chain it names, never another. A relayer
 * whose balance is below the cost of one withdrawal is reported unavailable (`relayer_unfunded`) and refuses before
 * anything is sent (server/privacy/funding.ts).
 *
 * Screening (Phase 4): a proof made against an association-set root other than the current one is refused when that
 * root's member list holds a deposit the operator's exclusion list names, or cannot be rebuilt on this server
 * (asp.ts refusedASPRoot). The contract accepts any of its last 16 roots, so without this an excluded deposit could
 * still leave privately through the relayer against an older root after its removal. The answer depends on the root
 * alone, a public signal of the proof: it is the same for every proof against that root and names no deposit. The
 * current root is never refused.
 */
import { SubmissionQueue } from "./submissionQueue";
import { keccak256, toBytes } from "viem";
import { TRPCError } from "@trpc/server";
import { BaseError, ContractFunctionRevertedError,
  TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import type { RelayerQuote, RelayerQuotesAnswer } from "../../shared/privacy/api";
import { computeContext, type WithdrawalRequest } from "../../shared/privacy/context";
import { WITHDRAW_PUBLIC_SIGNALS } from "../../shared/privacy/types";
import type { Groth16ProofCalldata } from "../../shared/privacy/types";
import { contractCheckFailed, describeError, ensurePoolContract, isContractLevelError, PoolUnavailableError, refusedASPRoot } from "./asp";
import { getPublicClient, makeWalletClient } from "./chain";
import { chainConfig, keyAddress, privacyConfig } from "./config";
import { isInsufficientFunds } from "./errors";
import { forgetFunding, readFunding } from "./funding";

const queues = new WeakMap<object, SubmissionQueue>();

/** The chain's relayer address (derived from its key; null without one). Omitted chainId: the only served chain. */
export function relayerAddress(chainId?: number): Address | null {
  return keyAddress(chainConfig(chainId).relayerPrivateKey);
}

/** The fee the relayer requires on that chain: max(bps of the withdrawn value, minimum fee). */
export function computeFee(withdrawnValue: bigint, chainId?: number): bigint {
  const { relayerFeeBps, relayerMinFeeWei } = chainConfig(chainId);
  const pct = (withdrawnValue * BigInt(relayerFeeBps)) / 10_000n;
  return pct > relayerMinFeeWei ? pct : relayerMinFeeWei;
}

/**
 * One chain's quote. Never throws for a served chain: a missing pool, a pool that is unavailable (a configuration
 * problem, or a contract check that failed less than a minute ago), a missing key or a relayer whose balance is below
 * one withdrawal (`relayer_unfunded`) gives `available: false` with the reason. The only RPC read is the relayer's
 * funding (cached 30 s, the same for every visitor, at most 4 s; unknown counts as funded), and only for a usable pool
 * with a relayer key.
 */
export async function getQuote(chainId?: number): Promise<RelayerQuote> {
  const cfg = chainConfig(chainId);
  const relayer = keyAddress(cfg.relayerPrivateKey);
  let reason: RelayerQuote["reason"] =
    !cfg.pool && cfg.problems.length === 0
      ? "no_pool"
      : cfg.problems.length > 0 || contractCheckFailed(cfg.chainId)
        ? "pool_unavailable"
        : !relayer
          ? "no_relayer_key"
          : null;
  if (reason === null) {
    const funding = await readFunding(cfg.chainId);
    if (funding?.relayer && !funding.relayer.funded) reason = "relayer_unfunded";
  }
  return {
    chainId: cfg.chainId,
    pool: cfg.pool,
    available: reason === null,
    reason,
    relayer,
    feeBps: cfg.relayerFeeBps,
    minFeeWei: cfg.relayerMinFeeWei.toString(),
    expiresAt: Math.floor(Date.now() / 1000) + cfg.quoteTtlSeconds,
  };
}

/** privacy.relayer.quote: one quote per served network, the same for every visitor. */
export async function getQuotes(): Promise<RelayerQuotesAnswer> {
  return { quotes: await Promise.all(privacyConfig().chains.map(c => getQuote(c.chainId))) };
}

/**
 * A proof against an older association-set root that holds an excluded deposit (or cannot be rebuilt here): refused
 * before anything is sent. The device makes a new proof against the current root.
 */
export const ASP_ROOT_REFUSED = "The association-set root this proof used is no longer accepted. Nothing was sent; make a new proof.";

/** The relayer cannot pay for a withdrawal on this network: refused before anything is sent. */
function relayerUnfunded(networkName: string): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `The relayer for ${networkName} has too little testnet ETH to send a withdrawal right now. Nothing was sent.`,
  });
}

export interface RelayRequest {
  withdrawal: WithdrawalRequest;
  proof: Groth16ProofCalldata;
  pubSignals: bigint[];
}

function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk(
      e => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return revert.data.errorName;
  }
  return describeError(err);
}

/**
 * Relay one withdrawal on the chain it names. No gas is spent before the last step, and the first three make no
 * RPC call, so a proof for another network's pool (equal address, other scope) costs nothing:
 *   1. the chain is served and its pool has no problem;
 *   2. the proof's context is computeContext(computeScope(pool, chainId), withdrawal), else
 *      BAD_REQUEST "This proof is for a different pool than the one on <name>";
 *   3. relayer address, fee and deadline follow that chain's settings;
 *   4. the pool passed its contract check, and the relayer can pay for one withdrawal (a fresh read), else
 *      PRECONDITION_FAILED "The relayer for <name> has too little testnet ETH to send a withdrawal right now. …";
 *   5. the proof's association-set root is the current one, or an older one that holds no excluded deposit, else
 *      BAD_REQUEST ASP_ROOT_REFUSED (no RPC call while a readable exclusion list names nothing on this network; a
 *      broken list falls back on the current root's own record, or refuses every older root);
 *   6. simulate, then write, with that chain's bundle (a node that refuses the send for its balance: the same error).
 * Omitted chainId: the only served chain.
 */
export async function relayWithdrawal(req: RelayRequest & { chainId?: number }): Promise<{ chainId: number; txHash: Hex }> {
  // 1. the chain and its pool, from the configuration only
  const cfg = chainConfig(req.chainId);
  const name = cfg.network.name;
  if (cfg.problems.length > 0) throw new PoolUnavailableError(cfg, "config_error");
  const pool = cfg.pool;
  if (!pool || cfg.scope === null) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${name} has no privacy pool yet` });
  if (req.pubSignals.length !== 6) throw new TRPCError({ code: "BAD_REQUEST", message: "Expected 6 public signals" });

  // 2. the context binds this pool's scope, so a proof for another pool or chain stops here
  const { withdrawal } = req;
  let context: bigint;
  try {
    context = computeContext(cfg.scope, withdrawal);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Malformed withdrawal parameters" });
  }
  if (context !== req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.context]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This proof is for a different pool than the one on ${name}` });
  }

  // 3. this chain's relayer, fee and deadline rules
  const me = keyAddress(cfg.relayerPrivateKey);
  if (!me || !cfg.relayerPrivateKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The relayer for ${name} is not configured` });
  if (withdrawal.relayer.toLowerCase() !== me.toLowerCase()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Proof is bound to a different relayer address" });
  }
  const withdrawnValue = req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.withdrawnValue];
  const requiredFee = computeFee(withdrawnValue, cfg.chainId);
  if (withdrawal.fee < requiredFee) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Fee too low on ${name}: required ${requiredFee} wei, got ${withdrawal.fee}` });
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (withdrawal.deadline !== 0n && withdrawal.deadline < now + 30n) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Withdrawal deadline already expired or too close" });
  }
  if (withdrawal.deadline === 0n || withdrawal.deadline > now + BigInt(cfg.quoteTtlSeconds) + 60n) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Withdrawal must carry a deadline within the quote window" });
  }

  // 4. the contract check (its first run reads the chain; nothing is written before it passes)
  try {
    await ensurePoolContract(cfg.chainId);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
  }
  // and the relayer can pay for it: a fresh read, so a key funded a moment ago is used at once (unknown: go on)
  const funding = await readFunding(cfg.chainId, { fresh: true });
  if (funding?.relayer && !funding.relayer.funded) throw relayerUnfunded(name);

  // 5. an older association-set root that holds an excluded deposit is not relayed (the same answer for every proof
  //    against that root: it says nothing about which deposit is spent)
  let refused: boolean;
  try {
    refused = await refusedASPRoot(cfg.chainId, req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.ASPRoot]);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
  }
  if (refused) throw new TRPCError({ code: "BAD_REQUEST", message: ASP_ROOT_REFUSED });

  // 6. simulate, then write, with this chain's public client and relayer wallet
  const publicClient = getPublicClient(cfg.chainId);
  const wallet = makeWalletClient(cfg.relayerPrivateKey, cfg.chainId);
  const args = [
    { recipient: withdrawal.recipient, relayer: withdrawal.relayer, fee: withdrawal.fee, deadline: withdrawal.deadline },
    { pA: req.proof.pA, pB: req.proof.pB, pC: req.proof.pC },
    req.pubSignals as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint],
  ] as const;

  let queue = queues.get(cfg);
  if (!queue) {
    queue = new SubmissionQueue();
    queues.set(cfg, queue);
  }
  // Only public calldata, never note secrets. Identical retries share one result, even before a hash is returned.
  const id = keccak256(
    toBytes(
      JSON.stringify(args, (_k, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    )
  );
  try {
    const txHash = await queue.run(
      req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.existingNullifierHash].toString(),
      async broadcasting => {
        // Simulate first so the relayer never pays gas for a proof the pool rejects.
  let request;
  try {
    ({ request } = await publicClient.simulateContract({
      address: pool,
      abi: PRIVACY_POOL_ABI,
      functionName: "withdraw",
      args,
      account: wallet.account!,
    }));
  } catch (err) {
    if (!isContractLevelError(err)) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: `The pool on ${name} rejected the withdrawal: ${revertReason(err)}` });
  }
  try {
          broadcasting();
          return await wallet.writeContract(request);
  } catch (err) {
    if (isInsufficientFunds(err)) {
            broadcasting(false); // an explicit balance refusal is a known rejection, not an ambiguous transport result
            forgetFunding(cfg.chainId); // the balance changed since the read: the next quote reads it again
      throw relayerUnfunded(name);
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}`,
          });
        }
      },
      id
    );
    return { chainId: cfg.chainId, txHash };
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        err instanceof Error ? err.message : "Relayer submission unavailable",
    });
  }
}

/** A relayed transaction's receipt, read on the chain it was sent on. A network without a usable pool is not asked. */
export async function getRelayStatus(txHash: Hex, chainId?: number): Promise<{ status: "pending" | "success" | "reverted"; blockNumber?: string;
}> {
  const cfg = chainConfig(chainId);
  if (!cfg.pool || cfg.problems.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${cfg.network.name} has no usable privacy pool` });
  }
  const receipt = await getPublicClient(cfg.chainId).getTransactionReceipt({ hash: txHash }).catch((err: unknown) => {
      if (err instanceof TransactionReceiptNotFoundError) return null;
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Receipt status is unavailable on ${cfg.network.name}; check the RPC before retrying.`,
      });
    });
  if (!receipt) return { status: "pending" };
  return { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber.toString() };
}
