/**
 * Privacy guidance for the vault's Deposit and Withdraw forms. The whitepaper asks that "Hylsia's interface
 * will recommend standard amounts and waiting periods" and, for small anonymity sets, "standard amounts,
 * interface warnings, pool-size shown before each action":
 *   - standardAmounts / depositAdvice: the ladder of standard amounts, how many other deposits used each one, and a
 *     caution for an amount few deposits share (a standard amount protects only once others use it);
 *   - activityStatus: whether the public activity list can date the privacy check (this pool's list, holding the
 *     note's deposit);
 *   - withdrawCheck / waitLine: the privacy check before a private withdrawal of one note, with a recommended wait.
 * The pool size itself comes from the public pool summary (privacy.pools), not from here.
 *
 * Pure and deterministic; amounts are bigint wei, times unix seconds. It runs on the device from public data
 * the device already holds: the pool's events and the public activity list (block times) that every vault
 * visitor fetches alike. Nothing here depends on a request about one note. The crowd model is the one in
 * simulate.ts (crowds()). It is an estimate from public data, not a guarantee: IP addresses, behaviour across
 * apps and off-chain data can narrow a crowd further.
 */
import { formatEther } from "viem";
import { crowds, formatWait, STRONG_CROWD, verdictOf, WAIT_STEPS, WEAK_CROWD, type SimVerdict } from "./simulate";
import type { DepositedEvent, PoolEvent } from "./types";

const DAY = 86_400;
const MILLI = 10n ** 15n;
const ETHER = 10n ** 18n;

/** "0.1", "1.25": an ETH amount for the guidance texts, at full precision. */
export const eth = (wei: bigint): string => formatEther(wei);

/** "under a minute", "12 min", "3 h", "2 d" */
export const formatAge = (seconds: number): string => (seconds < 60 ? "under a minute" : formatWait(seconds));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── deposits as the guidance reads them ──────────────────────────────────────

export interface PublicDeposit {
  value: bigint;
  /** unix seconds; null when this device has no time for it yet (it is newer than the device's copy of the public activity) */
  timestamp: number | null;
  /** made by the person acting (this vault's notes, or the same depositing address): an observer who links one links them all, so it is never counted as cover */
  own?: boolean;
  /** exited publicly (ragequit): it can no longer fund a withdrawal */
  exited?: boolean;
}

/** What the deposit-side guidance needs of a deposit (no time). */
export type AmountDeposit = Pick<PublicDeposit, "value" | "own" | "exited">;

/** A deposit that hides others: not your own, still in the pool. */
const covers = (d: AmountDeposit) => !d.own && !d.exited;

export interface PoolDepositRow extends PublicDeposit {
  label: bigint;
  /** lowercase */
  depositor: string;
}

export interface BlockTime {
  blockNumber: bigint;
  /** unix seconds */
  timestamp: number;
}

/**
 * The pool's deposits in association-set order (state-tree leaf order, oldest first), from the device's own
 * public events, dated with the block times of the public activity list. A block the list does not name gets
 * the time of the next block it does (the deposit was made no later); a block after the list's last one stays
 * null: the deposit is newer than the device's copy of the list. Own deposits are marked from `own` (this
 * vault's labels, the depositing addresses that matter); ragequit labels mark deposits as exited.
 */
export function poolDeposits(
  events: readonly PoolEvent[],
  times: readonly BlockTime[] | null,
  own: { labels?: ReadonlySet<bigint>; addresses?: ReadonlySet<string> } = {},
): PoolDepositRow[] {
  const exited = new Set<bigint>();
  for (const e of events) if (e.kind === "ragequit") exited.add(e.label);
  const timeOf = blockClock(times);
  return events
    .filter((e): e is DepositedEvent => e.kind === "deposit")
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((e) => {
      const depositor = e.depositor.toLowerCase();
      return {
        value: e.value,
        timestamp: timeOf(e.blockNumber),
        label: e.label,
        depositor,
        own: (own.labels?.has(e.label) ?? false) || (own.addresses?.has(depositor) ?? false),
        exited: exited.has(e.label),
      };
    });
}

function blockClock(times: readonly BlockTime[] | null): (block: bigint) => number | null {
  if (!times || times.length === 0) return () => null;
  const map = new Map<bigint, number>();
  for (const t of times) map.set(t.blockNumber, t.timestamp);
  const blocks = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (block) => {
    const hit = map.get(block);
    if (hit !== undefined) return hit;
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid] > block) hi = mid;
      else lo = mid + 1;
    }
    return lo < blocks.length ? map.get(blocks[lo])! : null;
  };
}

// ─── the public activity list: is it this pool's, and does it date the note? ──

export interface ActivityList {
  /** the chain the list was read from (absent in older answers) */
  chainId?: number;
  /** the pool the list belongs to; null when the server has none configured */
  pool: string | null;
  activity: readonly { kind: string; txHash: string; blockNumber: bigint }[];
}

/**
 * Whether a public activity list can date the privacy check of one note:
 *   - "ready": it is this pool's list (same pool address, same chain when the list names one) and it holds the
 *     note's own deposit (its transaction);
 *   - "behind": this pool's list, but older than the note's deposit (the next fetch will hold it);
 *   - "foreign": another pool's list, no pool, or a list that covers the deposit's block without its transaction.
 * Only "ready" dates anything: otherwise the check runs without times. The note's deposit comes from the device's
 * own events; this compares two lists the device already holds and sends nothing.
 */
export function activityStatus(
  list: ActivityList,
  expected: { chainId: number; pool: string },
  deposit: { txHash: string; blockNumber: bigint },
): "ready" | "behind" | "foreign" {
  if (!list.pool || list.pool.toLowerCase() !== expected.pool.toLowerCase()) return "foreign";
  if (list.chainId !== undefined && list.chainId !== expected.chainId) return "foreign";
  const tx = deposit.txHash.toLowerCase();
  if (list.activity.some((a) => a.kind === "deposit" && a.txHash.toLowerCase() === tx)) return "ready";
  const newest = list.activity.reduce<bigint | null>((m, a) => (m === null || a.blockNumber > m ? a.blockNumber : m), null);
  return newest === null || newest < deposit.blockNumber ? "behind" : "foreign";
}

// ─── deposit: standard amounts ────────────────────────────────────────────────

/**
 * The standard amounts the interface recommends: 1 and 5 times powers of ten (as with banknotes), from 0.01 to
 * 5 ETH. Few rungs keep deposits on shared amounts, so each amount gathers its own crowd, and the range covers
 * testnet faucet amounts up to larger test deposits. The forms and the pool page's Privacy health use this one list.
 */
export const STANDARD_AMOUNTS: readonly bigint[] = [10n * MILLI, 50n * MILLI, 100n * MILLI, 500n * MILLI, ETHER, 5n * ETHER];

/** "0.01 · 0.05 · 0.1 · 0.5 · 1 · 5 ETH" */
export const STANDARD_LADDER = `${STANDARD_AMOUNTS.map(eth).join(" · ")} ETH`;

export const isStandardAmount = (wei: bigint): boolean => STANDARD_AMOUNTS.includes(wei);

/** An amount fewer other deposits than this share is easy to pick out (the "weak" crowd size). */
export const UNUSUAL_BELOW = WEAK_CROWD;

function countExactly(deposits: readonly AmountDeposit[], value: bigint, keep: (d: AmountDeposit) => boolean): number {
  let n = 0;
  for (const d of deposits) if (d.value === value && keep(d)) n++;
  return n;
}

export interface StandardAmount {
  value: bigint;
  /** other people's deposits still in the pool that used exactly this amount */
  count: number;
  /** your own deposits (this vault's, the connected wallet's) of exactly this amount still in the pool: no cover, shown apart */
  own: number;
}

/** The ladder, from the pool's minimum deposit up, each amount with how many other deposits used exactly it. */
export function standardAmounts(deposits: readonly AmountDeposit[], minDeposit: bigint = 0n): StandardAmount[] {
  return STANDARD_AMOUNTS.filter((v) => v >= minDeposit).map((value) => ({
    value,
    count: countExactly(deposits, value, covers),
    own: countExactly(deposits, value, (d) => !!d.own && !d.exited),
  }));
}

export interface DepositAdvice {
  amount: bigint;
  /** on the ladder of standard amounts */
  standard: boolean;
  /** other deposits still in the pool with exactly this amount (your own are not counted) */
  sameAmount: number;
  /**
   * "unusual": not a standard amount, and fewer than UNUSUAL_BELOW other deposits share it (the rose caution);
   * "few": a standard amount fewer than UNUSUAL_BELOW other deposits used so far (a softer note: it protects only
   * once others use it); null: nothing to say
   */
  kind: "unusual" | "few" | null;
  /** for an unusual amount: a standard amount more other deposits used (suggestAmount); null otherwise */
  suggestion: bigint | null;
  /** the text for `kind`; null when there is nothing to say */
  caution: string | null;
}

const nearest = (a: bigint, b: bigint, to: bigint) => {
  const da = a > to ? a - to : to - a;
  const db = b > to ? b - to : to - b;
  return da <= db;
};

/**
 * The standard amount to suggest instead of `amount`: never one that fewer (or as few) other deposits used as
 * `amount` itself. The most-used one at or below `amount`, otherwise the most-used one the pool accepts; ties go
 * to the one nearest `amount`. null when no standard amount is shared by more.
 */
export function suggestAmount(ladder: readonly StandardAmount[], amount: bigint, sameAmount: number): bigint | null {
  const better = ladder.filter((s) => s.count > sameAmount);
  const best = (list: readonly StandardAmount[]) =>
    list.reduce<StandardAmount | null>((m, s) => (!m || s.count > m.count || (s.count === m.count && nearest(s.value, m.value, amount)) ? s : m), null);
  return (best(better.filter((s) => s.value <= amount)) ?? best(better))?.value ?? null;
}

const LATER = "later, or more than other deposits hold, can point at this deposit";

export function depositAdvice(amount: bigint, deposits: readonly AmountDeposit[], minDeposit: bigint = 0n): DepositAdvice {
  const standard = isStandardAmount(amount);
  const sameAmount = countExactly(deposits, amount, covers);
  const none = { amount, standard, sameAmount, kind: null, suggestion: null, caution: null } as const;
  if (amount <= 0n || sameAmount >= UNUSUAL_BELOW) return none;
  const x = `${eth(amount)} ETH`;

  if (standard) {
    const used = sameAmount === 0 ? `No other deposit used ${x} yet.` : `Only ${plural(sameAmount, "other deposit")} used ${x} so far.`;
    return { ...none, kind: "few", caution: `${used} Withdrawing exactly ${x} ${LATER}; plan to withdraw a part.` };
  }

  const suggestion = suggestAmount(standardAmounts(deposits, minDeposit), amount, sameAmount);
  const shared = sameAmount === 0 ? `no other deposit used exactly ${x}` : `only ${plural(sameAmount, "other deposit")} used exactly ${x}`;
  return {
    ...none,
    kind: "unusual",
    suggestion,
    caution: `Unusual amount: ${shared}. Withdrawing exactly this amount ${LATER}; ${
      suggestion !== null ? `more deposits share ${eth(suggestion)} ETH` : "plan to withdraw a part"
    }.`,
  };
}

// ─── withdraw: the privacy check ──────────────────────────────────────────────

/** The pace is measured over the last week (or since the first other deposit, if that is more recent). */
export const PACE_WINDOW = 7 * DAY;
/** Below one other deposit a week the pool is too quiet to project a wait. */
export const QUIET_PACE = 1 / 7;
/** The longest wait the check projects; a wait that needs this step is shown as "within" it. */
export const LONGEST_WAIT = WAIT_STEPS[WAIT_STEPS.length - 1];

/** Deposits per day: over the last PACE_WINDOW, or since the first of them if that is more recent, never over less than a day. */
export function depositPace(times: readonly number[], now: number): number {
  if (times.length === 0) return 0;
  const first = times.reduce((m, t) => Math.min(m, t), Infinity);
  const span = Math.max(DAY, Math.min(PACE_WINDOW, now - first));
  const recent = times.filter((t) => t >= now - span).length;
  return (recent * DAY) / span;
}

export type WaitAdvice =
  /** the estimate is already strong */
  | { kind: "none" }
  /** the smallest WAIT_STEPS value at which the projected estimate is strong, at the pool's pace */
  | { kind: "wait"; seconds: number }
  /** not within the longest step at the pool's pace */
  | { kind: "beyond"; seconds: number }
  /**
   * no wait helps: the crowd that limits the estimate cannot grow, because no other deposit so far has this exact
   * amount ("exact", a whole deposit) or is this large ("amount"); `use` is the amount to withdraw instead, if any
   */
  | { kind: "never"; by: "exact" | "amount"; use: bigint | null }
  /** fewer than one other deposit a week: too quiet to project */
  | { kind: "quiet" }
  /** no public times on this device: no wait is projected */
  | { kind: "unknown" };

export type ReasonTopic = "recipient" | "route" | "amount" | "exact" | "timing" | "set" | "own" | "change" | "summary";

export interface Reason {
  tone: "good" | "warn" | "bad";
  /** what it is about, so a form can attach an action or leave out what it already says */
  topic: ReasonTopic;
  /** advice only: the figures are the form's rows */
  text: string;
  /** an amount the advice suggests ("Use 0.5 ETH") */
  use?: bigint;
}

export interface WithdrawCheckInput {
  /** the pool's public deposits in association-set order, oldest first (poolDeposits) */
  deposits: readonly PublicDeposit[];
  /** position in `deposits` of the note's own deposit */
  deposit: number;
  /**
   * deposits in the association set the withdrawal is proved in, as a prefix: the first `setSize` of `deposits` (the
   * open policy); it must hold the note's deposit. Ignored when `members` is given; one of the two is needed.
   */
  setSize?: number;
  /**
   * positions in `deposits` of the association set's members: a screened set is no prefix (an excluded deposit is no
   * cover, a later member is). previewAssociationSet's `members` or `nextMembers`. It must hold `deposit`.
   */
  members?: ReadonlySet<number>;
  /** the network's inclusion delay (seconds): a future deposit joins the set only this long after it is made (default 0) */
  delaySeconds?: number;
  /**
   * unix seconds from which this note can be withdrawn privately (its deposit's time plus the delay): the projected
   * withdrawal is never earlier, so the recommended wait counts from then. null or absent: now.
   */
  eligibleAt?: number | null;
  /** 0 = the note is the deposit itself; > 0 = a change note */
  hop: number;
  /** what the note holds now */
  noteValue: bigint;
  /** the amount to withdraw, above 0 and at most noteValue */
  amount: bigint;
  /** unix seconds; null leaves the timing test, the estimate, the verdict and the wait out (no public times on this device) */
  now: number | null;
  /** submitted through the relayer; false = from a wallet tied to your deposits (default true) */
  viaRelayer?: boolean;
  /** the recipient has no tie to your deposits (default true) */
  freshRecipient?: boolean;
}

export interface WithdrawCheck {
  /** dated with public times; false: the timing test is left out, so there is no estimate, verdict or wait */
  timed: boolean;
  /** deposits in the association set */
  setSize: number;
  /** deposits in the set that could fund the amount, yours included (other own deposits and exits are not counted) */
  couldFund: number;
  /** deposits of exactly your deposit amount, yours included, when withdrawing the whole original deposit; null otherwise */
  sameAmount: number | null;
  /** candidate deposits in the window an observer checks first (of the exact amount, for a whole deposit), yours included; null without times */
  timingCrowd: number | null;
  /** other people's deposits made since yours */
  since: number;
  /** seconds since your deposit; null without times */
  elapsed: number | null;
  /** other people's deposits per day at the pool's recent pace; null without times */
  pace: number | null;
  /** what an observer is left with from the set, the amount, the exact amount and the timing together; null without times */
  crowd: number | null;
  /** = crowd, or 1 when the route or the recipient links the withdrawal directly; null without times */
  estimate: number | null;
  /** null without times: never a verdict without the timing test */
  verdict: SimVerdict | null;
  /** the route or the recipient links the withdrawal directly */
  linked: boolean;
  wait: WaitAdvice;
  /** for a withdrawal of the whole original deposit: a standard part to withdraw instead (the rest stays as a change note) */
  roundPart: bigint | null;
  /** the most another deposit in the set could fund (its value, at most the note's); null when the set holds no other deposit */
  fundLimit: bigint | null;
  /** advice, most direct first; when the withdrawal is linked, only what links it */
  reasons: Reason[];
}

/**
 * The privacy check for one private withdrawal: who could have funded it (the association set, the amount, the
 * exact amount of a whole original deposit, the timing, applied together), what is left, and the smallest wait in
 * WAIT_STEPS after which the projected estimate reaches STRONG_CROWD at the pool's own pace. Future deposits are
 * assumed to join the set once the inclusion delay has passed (the publisher posts a newer root whenever one is due)
 * and to look like the pool's deposits so far. The set is `members` when given (a screened set), else the first
 * `setSize` deposits.
 */
export function withdrawCheck(i: WithdrawCheckInput): WithdrawCheck {
  const yours = i.deposits[i.deposit];
  if (!yours) throw new RangeError("withdrawCheck: the note's deposit is not in the list");
  const members = i.members ?? null;
  const prefix = i.setSize ?? 0;
  const inSet = (k: number) => (members ? members.has(k) : k < prefix);
  if (!inSet(i.deposit)) throw new RangeError("withdrawCheck: the association set does not hold the note's deposit");
  if (i.amount <= 0n || i.amount > i.noteValue) throw new RangeError("withdrawCheck: the amount must be above 0 and at most the note value");

  const setSize = members ? i.deposits.reduce((n, _, k) => (members.has(k) ? n + 1 : n), 0) : Math.min(prefix, i.deposits.length);
  const timed = i.now !== null;
  const now = i.now ?? 0;
  // a deposit newer than the device's public times was made moments ago
  const at = (d: PublicDeposit) => (d.timestamp === null ? now : Math.min(d.timestamp, now));
  // the earliest the withdrawal can happen (a note still inside the inclusion delay waits for it), and the delay new
  // deposits wait before they join the set
  const start = timed && typeof i.eligibleAt === "number" && Number.isFinite(i.eligibleAt) ? Math.max(now, i.eligibleAt) : now;
  const delay = typeof i.delaySeconds === "number" && Number.isFinite(i.delaySeconds) && i.delaySeconds > 0 ? i.delaySeconds : 0;

  // cover: other people's deposits in the set that are still in the pool
  const cover = i.deposits.filter((d, k) => k !== i.deposit && inSet(k) && covers(d));
  // everyone else's deposits in the pool: what the pace and the projection learn from
  const strangers = i.deposits.filter((d, k) => k !== i.deposit && !d.own);
  const full = i.hop === 0 && i.amount === yours.value;
  const exactValue = full ? yours.value : null;

  const elapsed = timed ? now - at(yours) : null;
  const since = i.deposits.slice(i.deposit + 1).filter((d) => !d.own).length;
  const pace = timed ? depositPace(strangers.map(at), now) : null;
  const share = (keep: (d: PublicDeposit) => boolean) => (strangers.length ? strangers.filter(keep).length / strangers.length : 0);
  const shareAtLeast = share((d) => d.value >= i.amount);
  const shareExact = exactValue === null ? 0 : share((d) => d.value === exactValue);
  const dated = cover.map((d) => ({ value: d.value, timestamp: timed ? at(d) : 0 }));

  const crowdAfter = (wait: number) => {
    // deposits made from now on join the set once the delay has passed: only those made by withdrawal time - delay count
    const joining = start + wait - now - delay;
    return crowds({
      others: dated,
      amount: i.amount,
      exactValue,
      timing: timed ? { depositTime: at(yours), withdrawTime: start + wait } : null,
      projected: joining > 0 && pace ? { count: (pace * joining) / DAY, shareAtLeast, shareExact } : undefined,
    });
  };
  const c = crowdAfter(0);

  const viaRelayer = i.viaRelayer ?? true;
  const freshRecipient = i.freshRecipient ?? true;
  const linked = !viaRelayer || !freshRecipient;
  const crowd = timed ? c.estimate : null;
  const estimate = crowd === null ? null : linked ? 1 : crowd;

  const roundPart = full ? ([...STANDARD_AMOUNTS].reverse().find((v) => v < yours.value) ?? null) : null;
  const largest = cover.reduce<bigint | null>((m, d) => (m === null || d.value > m ? d.value : m), null);
  const fundLimit = largest === null ? null : largest < i.noteValue ? largest : i.noteValue;

  // the crowd that limits the estimate grows only with deposits of this exact amount (a whole deposit) or this large
  const growth = exactValue !== null ? shareExact : shareAtLeast;
  const ceiling = exactValue !== null ? c.exactCrowd! : c.amountCrowd;
  let wait: WaitAdvice;
  if (!timed) wait = { kind: "unknown" };
  else if (c.estimate >= STRONG_CROWD) wait = { kind: "none" };
  else if (strangers.length > 0 && growth === 0 && ceiling < STRONG_CROWD) {
    wait = exactValue !== null ? { kind: "never", by: "exact", use: roundPart } : { kind: "never", by: "amount", use: fundLimit };
  } else if ((pace ?? 0) < QUIET_PACE) wait = { kind: "quiet" };
  else {
    const step = WAIT_STEPS.find((w) => crowdAfter(w).estimate >= STRONG_CROWD);
    wait = step === undefined ? { kind: "beyond", seconds: LONGEST_WAIT } : { kind: "wait", seconds: step };
  }

  // ── reasons: advice only (the figures are the form's rows), most direct first ──
  const reasons: Reason[] = [];
  const tone = (k: number): Reason["tone"] => (k < WEAK_CROWD ? "bad" : "warn");
  const coverInSet = cover.length + 1;
  const never = wait.kind === "never" ? wait.by : null;

  if (!freshRecipient) {
    reasons.push({ tone: "bad", topic: "recipient", text: "The recipient is tied to your deposits, so the withdrawal links straight back to you." });
  }
  if (!viaRelayer) {
    reasons.push({ tone: "bad", topic: "route", text: "The gas is paid from a wallet tied to your deposits, so the withdrawal links straight back to you. Use the relayer." });
  }
  // what links it comes first, and nothing that cannot fix it follows
  if (linked) return result();

  // A "never" wait carries the advice itself ("withdraw a part", "withdraw X ETH or less"), so it is not repeated
  // here; for a whole deposit "withdraw a part" also answers the amount. The amount advice is given when the amount
  // is what limits the crowd (timing advice covers the rest).
  const exactNarrows = c.exactCrowd !== null && c.exactCrowd < c.amountCrowd && c.estimate < STRONG_CROWD && never === null;
  if (c.amountCrowd === c.estimate && c.amountCrowd < coverInSet && c.amountCrowd < STRONG_CROWD && never === null && !exactNarrows) {
    reasons.push(
      c.amountCrowd === 1 && fundLimit !== null
        ? { tone: "bad", topic: "amount", text: `No other deposit in the association set can fund this much. Withdraw ${eth(fundLimit)} ETH or less.`, use: fundLimit }
        : { tone: tone(c.amountCrowd), topic: "amount", text: "Few deposits in the association set can fund this much: a smaller amount has a bigger crowd." },
    );
  }
  if (exactNarrows) {
    reasons.push({
      tone: tone(c.exactCrowd!),
      topic: "exact",
      text: `A whole deposit is matched by its amount. Withdraw a part instead${
        roundPart !== null ? `, such as ${eth(roundPart)} ETH` : ""
      }; the rest stays as a change note.`,
      ...(roundPart !== null ? { use: roundPart } : {}),
    });
  }
  if (c.timingCrowd !== null && c.timingCrowd < Math.min(c.amountCrowd, c.exactCrowd ?? Infinity) && c.estimate < STRONG_CROWD && never === null) {
    reasons.push({ tone: tone(c.timingCrowd), topic: "timing", text: "Timing narrows the crowd most: waiting lets more deposits join." });
  }
  // the set itself is the limit
  if (c.estimate < STRONG_CROWD && c.estimate === coverInSet && never === null) {
    reasons.push({
      tone: tone(coverInSet),
      topic: "set",
      text:
        coverInSet === 1
          ? "No other deposit in the association set could hide this withdrawal yet. Every new deposit adds to the crowd."
          : "The association set is the limit: every new deposit adds to the crowd.",
    });
  }
  const ownLeftOut = i.deposits.filter((d, k) => k !== i.deposit && inSet(k) && d.own && !d.exited && d.value >= i.amount).length;
  if (ownLeftOut > 0) {
    reasons.push({
      tone: "warn",
      topic: "own",
      text:
        ownLeftOut === 1
          ? "One of your other deposits is not counted: it points at you, not away from you."
          : `${ownLeftOut} of your other deposits are not counted: they point at you, not away from you.`,
    });
  }
  if (i.hop > 0 && i.amount === i.noteValue) {
    reasons.push({
      tone: "warn",
      topic: "change",
      text: "This takes everything left in the change note: together, your withdrawals from this deposit add up to its amount, which an observer could try to match.",
    });
  }
  if (estimate !== null && estimate >= STRONG_CROWD) {
    reasons.push({ tone: "good", topic: "summary", text: `By this estimate, an observer is left with about ${estimate} plausible deposits.` });
  }
  return result();

  function result(): WithdrawCheck {
    return {
      timed,
      setSize,
      couldFund: c.amountCrowd,
      sameAmount: c.exactCrowd,
      timingCrowd: c.timingCrowd,
      since,
      elapsed,
      pace,
      crowd,
      estimate,
      verdict: estimate === null ? null : verdictOf(estimate),
      linked,
      wait,
      roundPart,
      fundLimit,
      reasons,
    };
  }
}

// ─── the recommended wait, as the form shows it ───────────────────────────────

/** "8.6 deposits a day", "12 deposits a day" */
export const formatPace = (perDay: number): string =>
  `${perDay >= 10 ? Math.round(perDay) : perDay.toFixed(1).replace(/\.0$/, "")} ${perDay === 1 ? "deposit" : "deposits"} a day`;

export interface WaitLine {
  /** the row's value ("About 3 d"); null when the note says it all */
  value: string | null;
  /** the sentence under it */
  note: string | null;
  /** an amount to withdraw instead ("Use 0.1 ETH") */
  use: bigint | null;
}

/** The recommended-wait row of the privacy check; null when there is none to show (no public times). */
export function waitLine(check: Pick<WithdrawCheck, "wait" | "pace">): WaitLine | null {
  const w = check.wait;
  const at = check.pace !== null ? `At the pool's pace of ${formatPace(check.pace)}.` : null;
  switch (w.kind) {
    case "unknown":
      return null;
    case "none":
      return { value: "None needed", note: null, use: null };
    case "wait":
      // the last step spans 14 to 30 d: "within" it, not "about" it
      return { value: `${w.seconds >= LONGEST_WAIT ? "Within" : "About"} ${formatWait(w.seconds)}`, note: at, use: null };
    case "beyond":
      return { value: `Over ${formatWait(w.seconds)}`, note: at, use: null };
    case "quiet":
      return { value: "Too quiet to project", note: "Fewer than one other deposit a week.", use: null };
    case "never":
      return {
        value: null,
        note:
          w.by === "exact"
            ? "Waiting does not help here: withdraw a part instead."
            : `Waiting does not help here: withdraw ${w.use !== null ? `${eth(w.use)} ETH or less` : "less"} instead.`,
        use: w.use,
      };
  }
}
