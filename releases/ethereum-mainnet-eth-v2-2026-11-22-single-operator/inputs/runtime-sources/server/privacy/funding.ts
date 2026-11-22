/**
 * Whether the server's relayer and association-set publisher (postman) can pay for their next transaction, per served
 * pool: each key's balance against the cost of one withdrawal (relayer) or one publish (postman) at the network's
 * current gas price, with a margin.
 *
 * The read (eth_gasPrice and the keys' balances: one batched HTTP call) is made for every served pool alike, at most
 * once every 30 s, and shared by every caller: privacy.relayer.quote, privacy.networks, privacy.pools and
 * privacy.asp.status answer the same for every visitor, and no read depends on a visitor. The relayer and the
 * publisher read again right before they send (`fresh`), so a key funded a moment ago is used at once and one that ran
 * dry fails early, before anything is sent. A network without a usable pool is never read. A read that fails, or does
 * not answer within 4 s, is unknown: it is never reported as unfunded.
 */
import type { Address } from "viem";
import type { PoolServices, PublisherBlock, RelayerBlock } from "../../shared/privacy/api";
import { poolKey } from "../../shared/privacy/networks";
import { getPublicClient } from "./chain";
import { chainConfig, keyAddress, type PrivacyChainConfig } from "./config";
import { describeError } from "./errors";

/** Gas of one relayed withdrawal with its change note (~1.13 M measured on anvil; the pool's code is the same everywhere). */
export const WITHDRAW_GAS = 1_200_000n;
/** Gas of one updateASPRoot (~71 k measured; the cid text varies). */
export const PUBLISH_GAS = 100_000n;
/** The gas price can rise before the send, and the node asks for gas limit x max fee (viem's max fee: 1.2 x base fee). */
export const GAS_PRICE_MARGIN = 2n;

export interface KeyFunding {
  address: Address;
  balance: bigint;
  /** one transaction's cost at the current gas price, with the margin */
  required: bigint;
  funded: boolean;
}

export interface Funding {
  chainId: number;
  gasPrice: bigint;
  /** null without a relayer key */
  relayer: KeyFunding | null;
  /** null without a postman key */
  postman: KeyFunding | null;
  /** Date.now() of the read */
  at: number;
}

const FUNDING_TTL_MS = 30_000;
const FUNDING_DEADLINE_MS = 4_000;
/** after a failed read, the last good one still answers for this long (a short RPC hiccup does not flip anything) */
const LAST_GOOD_MS = 10 * 60_000;
const LOG_EVERY_MS = 5 * 60_000;

const cache = new Map<string, Funding>();
const reading = new Map<string, Promise<Funding | null>>();
const loggedAt = new Map<number, number>();

/** The cost of one transaction of `gas` at `gasPrice`, with the margin. */
export function oneTransactionCost(gasPrice: bigint, gas: bigint): bigint {
  return gasPrice * gas * GAS_PRICE_MARGIN;
}

function keyFunding(address: Address, balance: bigint, gasPrice: bigint, gas: bigint): KeyFunding {
  const required = oneTransactionCost(gasPrice, gas);
  return { address, balance, required, funded: balance >= required };
}

/** keyed by pool, RPC and both keys, so a changed configuration never answers with another key's balance */
function cacheKey(cfg: PrivacyChainConfig, relayer: Address | null, postman: Address | null): string {
  return `${poolKey(cfg.chainId, cfg.pool!)}|${cfg.rpcUrl}|${relayer ?? "-"}|${postman ?? "-"}`;
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)} s`)), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function readOnce(cfg: PrivacyChainConfig, relayer: Address | null, postman: Address | null): Promise<Funding> {
  const client = getPublicClient(cfg.chainId);
  const [gasPrice, relayerBalance, postmanBalance] = await Promise.all([
    client.getGasPrice(),
    relayer ? client.getBalance({ address: relayer }) : null,
    postman ? client.getBalance({ address: postman }) : null,
  ]);
  return {
    chainId: cfg.chainId,
    gasPrice,
    relayer: relayer && relayerBalance !== null ? keyFunding(relayer, relayerBalance, gasPrice, WITHDRAW_GAS) : null,
    postman: postman && postmanBalance !== null ? keyFunding(postman, postmanBalance, gasPrice, PUBLISH_GAS) : null,
    at: Date.now(),
  };
}

/**
 * The pool's relayer and postman funding: the read of the last 30 s, else a new one (`fresh`: always a new one, or
 * the one in flight). Null when unknown: no usable pool, no key, or the read failed and no good read of the last
 * 10 minutes is at hand. Never throws for a served network. Omitted chainId: the only served chain.
 */
export async function readFunding(chainId?: number, o: { fresh?: boolean } = {}): Promise<Funding | null> {
  const cfg = chainConfig(chainId);
  if (!cfg.pool || cfg.problems.length > 0) return null; // a network without a usable pool is never read
  const relayer = keyAddress(cfg.relayerPrivateKey);
  const postman = keyAddress(cfg.aspPostmanPrivateKey);
  if (!relayer && !postman) return null;
  const key = cacheKey(cfg, relayer, postman);
  const hit = cache.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < FUNDING_TTL_MS) return hit;
  const running = reading.get(key);
  if (running) return running; // a read in flight is as fresh as a new one
  const tracked: Promise<Funding | null> = withDeadline(readOnce(cfg, relayer, postman), FUNDING_DEADLINE_MS)
    .then(
      (funding) => {
        cache.set(key, funding);
        return funding;
      },
      (err: unknown) => {
        const now = Date.now();
        if (now - (loggedAt.get(cfg.chainId) ?? -Infinity) >= LOG_EVERY_MS) {
          loggedAt.set(cfg.chainId, now);
          console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}): could not read the relayer's and publisher's balances: ${describeError(err)}`);
        }
        const last = cache.get(key);
        return last && now - last.at < LAST_GOOD_MS ? last : null;
      },
    )
    .finally(() => {
      if (reading.get(key) === tracked) reading.delete(key);
    });
  reading.set(key, tracked);
  return tracked;
}

/** Drops what was read for one network (its keys' balances changed, or its chain was reset). */
export function forgetFunding(chainId: number): void {
  for (const key of cache.keys()) if (key.startsWith(`${chainId}:`)) cache.delete(key);
}

/** The relayer's side of PoolServices: no key, or a balance below one withdrawal (unknown counts as funded). */
export function relayerServices(cfg: PrivacyChainConfig, funding: Funding | null): Pick<PoolServices, "relayerAvailable" | "relayerBlock"> {
  const block: RelayerBlock | null = !cfg.relayerPrivateKey ? "no_relayer_key" : funding?.relayer && !funding.relayer.funded ? "relayer_unfunded" : null;
  return { relayerAvailable: block === null, relayerBlock: block };
}

/**
 * The publisher's side of PoolServices: no key, a key that is not the pool's `aspPostman` (read from the pool), or a
 * balance below one publish (unknown counts as funded).
 */
export function publisherServices(
  cfg: PrivacyChainConfig,
  onChainPostman: Address,
  funding: Funding | null,
): Pick<PoolServices, "aspCanPublish" | "aspPublishBlock"> {
  const me = keyAddress(cfg.aspPostmanPrivateKey);
  const block: PublisherBlock | null = !me
    ? "no_key"
    : onChainPostman.toLowerCase() !== me.toLowerCase()
      ? "not_postman"
      : funding?.postman && !funding.postman.funded
        ? "publisher_unfunded"
        : null;
  return { aspCanPublish: block === null, aspPublishBlock: block };
}

/** test hook */
export function resetFundingCache(): void {
  cache.clear();
  reading.clear();
  loggedAt.clear();
}
