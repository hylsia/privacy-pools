import type { PoolsAnswer } from "@shared/privacy/api";
import type { PoolId } from "@shared/privacy/networks";

/** A response may serve both protocols; amounts and crowds must stay in this application's offered pools. */
export function poolsForProfile(
  answer: PoolsAnswer,
  offered: readonly { network: { chainId: number }; pool: PoolId | null }[]
): PoolsAnswer {
  const ids = new Set(offered.map(entry => entry.network.chainId));
  const allowed = (entry: PoolId) =>
    offered.some(
      item =>
        item.pool?.chainId === entry.chainId &&
        item.pool.pool.toLowerCase() === entry.pool.toLowerCase()
    );
  return {
    ...answer,
    networks: answer.networks.filter(entry => ids.has(entry.chainId)),
    pools: answer.pools.filter(allowed),
    unavailable: answer.unavailable.filter(entry => ids.has(entry.chainId)),
  };
}
