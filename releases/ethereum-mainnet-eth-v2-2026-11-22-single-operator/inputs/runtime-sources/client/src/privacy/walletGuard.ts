/**
 * Two rules the privacy area's wallet config (wagmi.ts) enforces below every component, RainbowKit's included.
 *
 * 1. Reads that carry the wallet's address go to the active network's RPC only (final design §1 "Never leak" 2, C2),
 *    and a network without a pool gets no request at all. RainbowKit's account window (the avatar in the header) reads
 *    the wallet's balance on whatever network the wallet is on; without this guard, opening it sent the address and IP
 *    to the other network's RPC operator, or to a network that has no pool yet. The guard sits in the transports, so
 *    it holds for any component: the read is refused here and nothing is sent.
 *
 * 2. The stored wallet connection never names a network. wagmi persists the wallet's chain with the connection, and the
 *    app switches the wallet for deposits, exits and pay-your-own-gas withdrawals, so a stored chain would show, on a
 *    locked or forgotten device, the network of the last operation the wallet signed. The connector and account are
 *    kept (the wallet reconnects on the next visit); wagmi reads the live chain from the wallet when it reconnects.
 *
 * Pure apart from the module's active-network slot (memory only, set by PrivacyProvider): tested from
 * server/privacy/walletGuard.test.ts.
 */
import type { Transport } from "viem";

/** JSON-RPC reads whose parameters carry an account address: a wallet's balance, nonce, code or storage. */
export const ACCOUNT_READS: ReadonlySet<string> = new Set([
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getProof",
]);

let activeChainId: number | null = null;

/** The network the vault acts on (PrivacyProvider's active pool), or null before there is one. Memory only. */
export function setWalletReadChain(chainId: number | null): void {
  activeChainId = typeof chainId === "number" ? chainId : null;
}

export function walletReadChain(): number | null {
  return activeChainId;
}

/** A request the privacy area's transports refuse before anything is sent. */
export class WalletReadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletReadRefusedError";
  }
}

/** Why a request through one network's transport is refused, or null when it may go out. */
export function transportRefusal(o: {
  chainId: number;
  name: string;
  /** the build has a usable pool on this network */
  hasPool: boolean;
  method: string;
  /** the active network; null: none yet */
  activeChainId: number | null;
}): string | null {
  if (!o.hasPool) return `Nothing is read from ${o.name}: this build has no pool there.`;
  if (ACCOUNT_READS.has(o.method) && o.chainId !== o.activeChainId) {
    return `The wallet's address is read only on the network the vault acts on, not on ${o.name}.`;
  }
  return null;
}

/** `inner` (an http transport) behind transportRefusal: a refused request throws before it reaches the RPC. */
export function guardTransport(o: { chainId: number; name: string; hasPool: boolean }, inner: Transport): Transport {
  const guarded = ((params: Parameters<Transport>[0]) => {
    const t = inner(params);
    const request = (async (args: { method: string }, options?: unknown) => {
      const refusal = transportRefusal({ ...o, method: args.method, activeChainId });
      if (refusal) throw new WalletReadRefusedError(refusal);
      return (t.request as (a: unknown, b?: unknown) => Promise<unknown>)(args, options);
    }) as typeof t.request;
    return { ...t, request };
  }) as Transport;
  return guarded;
}

/** Whether an error (or one in its `cause` chain) is a request the guard refused. */
export function isWalletReadRefusal(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && !seen.has(e) && depth < 12; depth++) {
    seen.add(e);
    if ((e as { name?: unknown }).name === "WalletReadRefusedError") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * wagmi's persisted store (`{ state: { connections: { __type: "Map", value: [[uid, connection], …] }, chainId, current },
 * version }`) with every chain id replaced by `neutralChainId`, the same for every device (the first offered network).
 * Anything else passes through unchanged.
 */
export function withoutWalletChain(value: unknown, neutralChainId: number): unknown {
  if (!value || typeof value !== "object") return value;
  const outer = value as { state?: unknown };
  const state = outer.state;
  if (!state || typeof state !== "object") return value;
  const s = state as { chainId?: unknown; connections?: unknown };
  const next: Record<string, unknown> = { ...s };
  if ("chainId" in s) next.chainId = neutralChainId;
  const connections = s.connections as { __type?: unknown; value?: unknown } | undefined;
  if (connections && typeof connections === "object" && connections.__type === "Map" && Array.isArray(connections.value)) {
    next.connections = {
      ...connections,
      value: connections.value.map((entry: unknown) =>
        Array.isArray(entry) && entry.length === 2 && entry[1] && typeof entry[1] === "object" && "chainId" in entry[1]
          ? [entry[0], { ...(entry[1] as object), chainId: neutralChainId }]
          : entry,
      ),
    };
  }
  return { ...outer, state: next };
}
