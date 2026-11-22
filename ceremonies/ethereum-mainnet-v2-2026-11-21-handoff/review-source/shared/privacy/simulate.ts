/**
 * Linkability estimate: a transparent HEURISTIC over public data, not a privacy guarantee.
 *
 * An observer sees one withdrawal of amount A at time T and asks: which public
 * deposits could have funded it? Because the pool supports partial
 * withdrawals, any admitted deposit with value >= A made before T is a
 * candidate. Observers then narrow the crowd with simple heuristics:
 *   - exact amount: a full withdrawal of an uncommon amount points at deposits
 *     of exactly that amount;
 *   - timing: deposits made shortly before the withdrawal are favoured;
 *   - behaviour: withdrawing to an address tied to the depositor, or paying gas
 *     from your own wallet, links the two directly.
 * An observer applies the tests together: for a full withdrawal the timing
 * window is searched for deposits of exactly that amount, so the timing crowd
 * is the combined one. The model reports each crowd and the smallest one as the
 * estimate.
 *
 * crowds() is the model itself. simulate() asks it about a deposit made now and
 * withdrawn after a wait (its tests pin the model's behaviour); the vault's
 * privacy check (guidance.ts) asks it about a real note, with the deposits made
 * since, and projects the wait from the pool's own pace.
 */

export interface SimDeposit {
  value: bigint;
  /** unix seconds */
  timestamp: number;
}

export interface SimInput {
  /** existing public deposits (other people's and earlier ones of yours) */
  deposits: SimDeposit[];
  /** observed or assumed deposits per day, used to project the wait */
  depositsPerDay: number;
  /** share of deposits whose amount is >= the withdrawal amount (0..1), for projection */
  shareAtLeast: number;
  /** share of deposits with exactly the user's deposit amount (0..1), for projection */
  shareExact: number;
  now: number;
  /** your deposit, made now */
  depositAmount: bigint;
  /** your withdrawal */
  withdrawAmount: bigint;
  waitSeconds: number;
  viaRelayer: boolean;
  freshRecipient: boolean;
}

export type SimVerdict = "linked" | "weak" | "moderate" | "strong";

export interface SimResult {
  /** deposits (including yours) that could have funded the withdrawal */
  amountCrowd: number;
  /** deposits with exactly your amount (only relevant for a full withdrawal) */
  exactCrowd: number | null;
  /** candidate deposits made within the timing window before the withdrawal */
  timingCrowd: number;
  /** the observer's best narrowing: min over the applicable crowds; 1 = linked */
  estimate: number;
  verdict: SimVerdict;
  reasons: { tone: "good" | "warn" | "bad"; text: string }[];
}

/** The waits the privacy check projects, 10 min to 30 d. The last step stands for "within 30 d" (14 d is the one before). */
export const WAIT_STEPS = [600, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400, 172_800, 259_200, 604_800, 1_209_600, 2_592_000];

/** From this many plausible deposits on, the estimate is "strong" (verdictOf). */
export const STRONG_CROWD = 50;
/** Below this many, it is "weak" (1 = linked). */
export const WEAK_CROWD = 10;
/** The shortest timing window an observer checks before a withdrawal. */
export const MIN_TIMING_WINDOW = 600;

export function verdictOf(k: number): SimVerdict {
  if (k <= 1) return "linked";
  if (k < WEAK_CROWD) return "weak";
  if (k < STRONG_CROWD) return "moderate";
  return "strong";
}

export function formatWait(s: number): string {
  if (s < 3_600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3_600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

export interface CrowdInput {
  /**
   * Other people's deposits an observer cannot rule out by policy (in the association set, not exited).
   * Your own deposit is not in this list: every crowd counts it once.
   */
  others: readonly SimDeposit[];
  amount: bigint;
  /** the deposit value an exact-amount observer looks for (a full withdrawal of the original deposit, so it equals `amount`), or null */
  exactValue: bigint | null;
  /** when your deposit was made and when the withdrawal happens (unix seconds); null leaves the timing heuristic out */
  timing: { depositTime: number; withdrawTime: number } | null;
  /** deposits expected to arrive before the withdrawal, and the shares of them at least `amount` / exactly `exactValue` */
  projected?: { count: number; shareAtLeast: number; shareExact: number };
}

export interface Crowds {
  /** deposits (yours included) that could have funded the withdrawal */
  amountCrowd: number;
  /** deposits (yours included) of exactly `exactValue`; null when not a full withdrawal */
  exactCrowd: number | null;
  /**
   * candidate deposits (yours included) in the window just before the withdrawal; for a full withdrawal only those
   * of exactly `exactValue`, since an observer applies both tests together; null without timing
   */
  timingCrowd: number | null;
  /** the smallest of the crowds that apply */
  estimate: number;
}

/** The crowds an observer is left with for one withdrawal (amount, exact amount, timing). Behaviour links are not part of it. */
export function crowds(i: CrowdInput): Crowds {
  const p = i.projected ?? { count: 0, shareAtLeast: 0, shareExact: 0 };
  const until = i.timing ? i.timing.withdrawTime : Infinity;
  const existing = i.others.filter((d) => d.timestamp <= until);
  const candidates = existing.filter((d) => d.value >= i.amount);
  const exact = i.exactValue === null ? null : existing.filter((d) => d.value === i.exactValue);
  const arrivals = Math.round(p.count * p.shareAtLeast);
  const exactArrivals = Math.round(p.count * p.shareExact);

  // existing candidates + projected arrivals + yours
  const amountCrowd = candidates.length + arrivals + 1;
  const exactCrowd = exact === null ? null : exact.length + exactArrivals + 1;

  let timingCrowd: number | null = null;
  if (i.timing) {
    // timing window: an observer looking 3x the gap back from the withdrawal still sees your deposit. Projected
    // arrivals all fall inside it. For a full withdrawal the observer looks there for the exact amount only.
    const gap = Math.max(0, i.timing.withdrawTime - i.timing.depositTime);
    const start = i.timing.withdrawTime - Math.max(3 * gap, MIN_TIMING_WINDOW);
    timingCrowd =
      exact === null
        ? candidates.filter((d) => d.timestamp >= start).length + arrivals + 1
        : exact.filter((d) => d.timestamp >= start).length + exactArrivals + 1;
  }

  return { amountCrowd, exactCrowd, timingCrowd, estimate: Math.min(amountCrowd, timingCrowd ?? Infinity, exactCrowd ?? Infinity) };
}

export function simulate(i: SimInput): SimResult {
  const full = i.withdrawAmount === i.depositAmount;
  const c = crowds({
    others: i.deposits.filter((d) => d.timestamp <= i.now),
    amount: i.withdrawAmount,
    exactValue: full ? i.depositAmount : null,
    timing: { depositTime: i.now, withdrawTime: i.now + i.waitSeconds },
    projected: { count: (i.depositsPerDay * i.waitSeconds) / 86_400, shareAtLeast: i.shareAtLeast, shareExact: i.shareExact },
  });
  const { amountCrowd, exactCrowd } = c;
  const timingCrowd = c.timingCrowd!;

  const reasons: SimResult["reasons"] = [];
  let estimate = c.estimate;

  if (!i.freshRecipient) {
    estimate = 1;
    reasons.push({ tone: "bad", text: "The recipient is tied to your depositing address, so the withdrawal links straight back to you." });
  }
  if (!i.viaRelayer) {
    estimate = 1;
    reasons.push({ tone: "bad", text: "You pay gas yourself: the paying wallet is public and must be funded from somewhere. Use the relayer." });
  }
  if (full && exactCrowd !== null && exactCrowd < amountCrowd) {
    reasons.push({
      tone: exactCrowd < WEAK_CROWD ? "bad" : "warn",
      text: `Withdrawing your exact deposit amount narrows the crowd to ${exactCrowd} deposit(s) of the same size. Withdraw a round part instead and keep the change in the pool.`,
    });
  }
  if (timingCrowd < Math.min(amountCrowd, exactCrowd ?? Infinity)) {
    reasons.push({
      tone: timingCrowd < WEAK_CROWD ? "bad" : "warn",
      text: `Only ${timingCrowd} candidate deposit(s) fall in the window just before your withdrawal. Waiting longer lets more deposits join the crowd.`,
    });
  }
  if (estimate >= STRONG_CROWD) reasons.push({ tone: "good", text: `By this estimate, an observer is left with about ${estimate} plausible deposits.` });
  if (reasons.length === 0) reasons.push({ tone: "warn", text: `An observer is left with ${estimate} plausible deposits.` });

  return { amountCrowd, exactCrowd, timingCrowd, estimate, verdict: verdictOf(estimate), reasons };
}
