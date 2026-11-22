/** Public, read-only readiness. Never publishes a root and never returns RPC URLs or secret values. */
import { getASPStatuses } from "./asp";
import type { ASPStatusAnswer } from "../../shared/privacy/api";

const dueSince = new Map<string, number>();
export function assessHealth(answer: ASPStatusAnswer, now = Date.now()) {
  const pools = answer.pools.map(p => {
    const key = `${p.chainId}:${p.pool.toLowerCase()}`;
    const due = p.screening?.rootDue === true;
    const walletPublication = p.screening?.publicationMode === "wallet" && p.screening.walletPublishable === true;
    if (!due) dueSince.delete(key);
    else if (!dueSince.has(key)) dueSince.set(key, now);
    const intervalMs = (p.screening?.autoPublish.seconds ?? 600) * 1000;
    const dueMs = due ? now - dueSince.get(key)! : 0;
    const problems: string[] = [];
    if (!p.screening || p.screening.exclusions === "invalid")
      problems.push("screening_unavailable");
    if (due && !p.canPublish && !walletPublication) problems.push("publisher_unavailable");
    if (due && !p.screening?.autoPublish.running && !walletPublication)
      problems.push("publisher_schedule_off");
    if (due && dueMs > Math.max(60_000, intervalMs * 2) && !walletPublication)
      problems.push("eligible_root_overdue");
    return {
      chainId: p.chainId,
      pool: p.pool,
      rootDue: due,
      dueForSeconds: Math.floor(dueMs / 1000),
      walletPublicationDue: due && walletPublication,
      problems,
    };
  });
  const unavailable = answer.unavailable.map(p => ({
    chainId: p.chainId,
    problem: "rpc_or_pool_unavailable",
  }));
  return {
    ok:
      pools.length > 0 &&
      unavailable.length === 0 &&
      pools.every(p => p.problems.length === 0),
    pools,
    unavailable,
  };
}
let cached: { until: number; result: ReturnType<typeof assessHealth> } | null =
  null;
let reading: Promise<ReturnType<typeof assessHealth>> | null = null;
export async function privacyHealth() {
  if (cached && Date.now() < cached.until) return cached.result;
  if (reading) return reading;
  reading = getASPStatuses()
    .then(answer => {
      const result = assessHealth(answer);
      cached = { until: Date.now() + 15_000, result };
      return result;
    })
    .finally(() => {
      reading = null;
    });
  return reading;
}
