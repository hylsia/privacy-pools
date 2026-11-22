import { describe, expect, it } from "vitest";
import {
  activityStatus,
  depositAdvice,
  depositPace,
  formatAge,
  LONGEST_WAIT,
  poolDeposits,
  STANDARD_AMOUNTS,
  STANDARD_LADDER,
  standardAmounts,
  suggestAmount,
  waitLine,
  withdrawCheck,
  type PublicDeposit,
  type WithdrawCheckInput,
} from "../../shared/privacy/guidance";
import { crowds, WAIT_STEPS } from "../../shared/privacy/simulate";
import type { PoolEvent } from "../../shared/privacy/types";

const ETH = 10n ** 18n;
const milli = (n: number) => BigInt(n) * 10n ** 15n;
const HOUR = 3_600;
const DAY = 86_400;
const now = 1_900_000_000;

/** n deposits of `value`, the newest `newest` seconds ago, then one every `every` seconds further back */
const series = (n: number, value: bigint, newest: number, every: number, extra: Partial<PublicDeposit> = {}): PublicDeposit[] =>
  Array.from({ length: n }, (_, k) => ({ value, timestamp: now - newest - k * every, ...extra }));

/** a pool's deposits in association-set (time) order with yours in it; returns the list and your position */
function pool(others: PublicDeposit[], yours: PublicDeposit) {
  const mine = { ...yours, own: true };
  const all = [...others, mine].sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity));
  return { deposits: all, deposit: all.indexOf(mine) };
}

function check(over: Partial<WithdrawCheckInput> & Pick<WithdrawCheckInput, "deposits" | "deposit">) {
  return withdrawCheck({ setSize: over.deposits.length, hop: 0, noteValue: ETH, amount: ETH / 2n, now, ...over });
}

const topics = (r: ReturnType<typeof withdrawCheck>) => r.reasons.map((x) => x.topic);

/** what an observer combining the exact amount and the timing window finds (yours included), recomputed by hand */
function exactInWindow(deposits: readonly PublicDeposit[], deposit: number, value: bigint, depositTime: number, withdrawTime = now) {
  const start = withdrawTime - Math.max(3 * (withdrawTime - depositTime), 600);
  return deposits.filter((d, k) => k !== deposit && !d.own && !d.exited && d.value === value && d.timestamp !== null && d.timestamp >= start && d.timestamp <= withdrawTime).length + 1;
}

// ─── deposit side ─────────────────────────────────────────────────────────────

describe("standard amounts", () => {
  const deposits = [
    ...series(12, milli(100), HOUR, HOUR),
    ...series(3, milli(500), HOUR, HOUR),
    ...series(2, milli(100), HOUR, HOUR, { own: true }),
    ...series(4, milli(100), HOUR, HOUR, { exited: true }),
    { value: 1_234_000_000_000_000_000n, timestamp: now },
  ];

  it("is a fixed 1-5 ladder from 0.01 to 5 ETH, each with the other deposits of exactly that amount and your own apart", () => {
    expect(STANDARD_AMOUNTS).toEqual([milli(10), milli(50), milli(100), milli(500), ETH, 5n * ETH]);
    expect(STANDARD_LADDER).toBe("0.01 · 0.05 · 0.1 · 0.5 · 1 · 5 ETH");
    expect(standardAmounts(deposits).map((s) => [s.value, s.count, s.own])).toEqual([
      [milli(10), 0, 0],
      [milli(50), 0, 0],
      [milli(100), 12, 2], // own deposits are shown apart, exited ones not at all
      [milli(500), 3, 0],
      [ETH, 0, 0],
      [5n * ETH, 0, 0],
    ]);
  });

  it("starts at the pool's minimum deposit", () => {
    expect(standardAmounts(deposits, milli(50)).map((s) => s.value)).toEqual([milli(50), milli(100), milli(500), ETH, 5n * ETH]);
    expect(standardAmounts(deposits, milli(60)).map((s) => s.value)).toEqual([milli(100), milli(500), ETH, 5n * ETH]);
    expect(standardAmounts([], 10n * ETH)).toEqual([]);
  });

  it("an empty pool still offers the ladder, with zero counts", () => {
    expect(standardAmounts([]).every((s) => s.count === 0 && s.own === 0)).toBe(true);
  });
});

describe("deposit advice", () => {
  const odd = 1_234_000_000_000_000_000n;
  // the shape of a pool that uses the ladder: 20 x 0.01, 15 x 0.05, 40 x 0.1, 25 x 0.5, 12 x 1, 2 x 5, and a few others
  const ladderPool = [
    ...series(20, milli(10), HOUR, HOUR),
    ...series(15, milli(50), HOUR, HOUR),
    ...series(40, milli(100), HOUR, HOUR),
    ...series(25, milli(500), HOUR, HOUR),
    ...series(12, ETH, HOUR, HOUR),
    ...series(2, 5n * ETH, HOUR, HOUR),
    ...series(4, milli(250), HOUR, HOUR),
    ...series(3, odd, HOUR, HOUR),
  ];

  it("a standard amount only a few others used gets the softer note: it protects once others use it", () => {
    // pinned before: "a standard amount is never unusual, even before anyone used it" (decision 4 changed that)
    expect(depositAdvice(5n * ETH, ladderPool)).toMatchObject({ standard: true, sameAmount: 2, kind: "few", suggestion: null });
    expect(depositAdvice(5n * ETH, ladderPool).caution).toBe(
      "Only 2 other deposits used 5 ETH so far. Withdrawing exactly 5 ETH later, or more than other deposits hold, can point at this deposit; plan to withdraw a part.",
    );
    expect(depositAdvice(milli(500), series(1, milli(500), HOUR, HOUR)).caution).toMatch(/^Only 1 other deposit used 0\.5 ETH so far\./);
    expect(depositAdvice(milli(500), []).caution).toBe(
      "No other deposit used 0.5 ETH yet. Withdrawing exactly 0.5 ETH later, or more than other deposits hold, can point at this deposit; plan to withdraw a part.",
    );
    // shared by enough others: nothing to say
    expect(depositAdvice(ETH, ladderPool)).toMatchObject({ standard: true, sameAmount: 12, kind: null, caution: null });
  });

  it("an unusual amount gets the rose caution and the most-used standard amount at or below it", () => {
    const a = depositAdvice(milli(370), ladderPool);
    expect(a).toMatchObject({ standard: false, sameAmount: 0, kind: "unusual", suggestion: milli(100) });
    expect(a.caution).toBe(
      "Unusual amount: no other deposit used exactly 0.37 ETH. Withdrawing exactly this amount later, or more than other deposits hold, can point at this deposit; more deposits share 0.1 ETH.",
    );
    const b = depositAdvice(odd, ladderPool);
    expect(b).toMatchObject({ kind: "unusual", sameAmount: 3, suggestion: milli(100) });
    expect(b.caution).toContain("only 3 other deposits used exactly 1.234 ETH");
  });

  it("never suggests a standard amount fewer (or as few) other deposits used than the typed one", () => {
    // 0.37 ETH used by 3 others; 0.1 ETH by 2 (fewer), 0.05 ETH by 5 (more): 0.05 it is
    const few = [...series(3, milli(370), HOUR, HOUR), ...series(2, milli(100), HOUR, HOUR), ...series(5, milli(50), HOUR, HOUR)];
    expect(depositAdvice(milli(370), few).suggestion).toBe(milli(50));
    // launch day: no standard amount is shared yet, so none is suggested
    expect(depositAdvice(milli(370), []).suggestion).toBeNull();
    expect(depositAdvice(milli(370), []).caution).toBe(
      "Unusual amount: no other deposit used exactly 0.37 ETH. Withdrawing exactly this amount later, or more than other deposits hold, can point at this deposit; plan to withdraw a part.",
    );
    expect(depositAdvice(odd, series(3, odd, HOUR, HOUR)).suggestion).toBeNull();
  });

  it("below the ladder, or when nothing below is shared enough, the most-used standard amount the pool accepts", () => {
    expect(depositAdvice(milli(4), ladderPool).suggestion).toBe(milli(100));
    expect(depositAdvice(milli(70), ladderPool, milli(80)).suggestion).toBe(milli(100));
    expect(depositAdvice(10n * ETH, ladderPool, 20n * ETH)).toMatchObject({ kind: "unusual", suggestion: null });
    // ties go to the amount nearest the typed one
    const ladder = [
      { value: milli(50), count: 12, own: 0 },
      { value: milli(100), count: 12, own: 0 },
      { value: ETH, count: 30, own: 0 },
    ];
    expect(suggestAmount(ladder, milli(300), 0)).toBe(milli(100));
    expect(suggestAmount(ladder, milli(20), 0)).toBe(ETH); // nothing at or below: the most-used one
  });

  it("a non-standard amount many others share is not unusual", () => {
    const shared = series(12, milli(250), HOUR, HOUR);
    expect(depositAdvice(milli(250), shared)).toMatchObject({ standard: false, sameAmount: 12, kind: null, caution: null });
  });

  it("own deposits of the same amount give no cover", () => {
    const own = series(20, odd, HOUR, HOUR, { own: true });
    expect(depositAdvice(odd, own)).toMatchObject({ sameAmount: 0, kind: "unusual" });
    expect(depositAdvice(ETH, series(20, ETH, HOUR, HOUR, { own: true }))).toMatchObject({ sameAmount: 0, kind: "few" });
  });

  it("no amount, no advice", () => {
    expect(depositAdvice(0n, [])).toMatchObject({ kind: null, caution: null });
  });
});

// ─── pool data on the device ──────────────────────────────────────────────────

const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const txOf = (k: number) => `0x${k.toString(16).padStart(64, "a")}` as `0x${string}`;
function dep(leafIndex: number, value: bigint, blockNumber: bigint, depositor = "0xAbC0000000000000000000000000000000000001"): PoolEvent {
  return {
    kind: "deposit",
    depositor: depositor as `0x${string}`,
    commitment: BigInt(1000 + leafIndex),
    label: BigInt(500 + leafIndex),
    value,
    precommitment: BigInt(leafIndex + 1),
    leafIndex,
    blockNumber,
    txHash: txOf(leafIndex),
    logIndex: 0,
  };
}

describe("pool deposits on the device", () => {
  const events: PoolEvent[] = [
    dep(1, milli(500), 12n, "0x00000000000000000000000000000000000000B0"),
    dep(0, ETH, 10n),
    dep(2, milli(100), 15n),
    dep(3, milli(100), 30n),
    { kind: "ragequit", ragequitter: "0x00000000000000000000000000000000000000B0", commitment: 1001n, label: 501n, value: milli(500), blockNumber: 16n, txHash: ZERO_HASH, logIndex: 0 },
  ];
  const times = [
    { blockNumber: 10n, timestamp: now - 3 * DAY },
    { blockNumber: 16n, timestamp: now - DAY },
    { blockNumber: 12n, timestamp: now - 2 * DAY },
  ];

  it("keeps association-set order, dates blocks from the public list and marks own and exited deposits", () => {
    const rows = poolDeposits(events, times, { labels: new Set([500n]), addresses: new Set(["0x00000000000000000000000000000000000000b0"]) });
    expect(rows.map((r) => r.label)).toEqual([500n, 501n, 502n, 503n]);
    expect(rows.map((r) => r.timestamp)).toEqual([now - 3 * DAY, now - 2 * DAY, now - DAY, null]);
    expect(rows.map((r) => [r.own, r.exited])).toEqual([
      [true, false],
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(rows[1].depositor).toBe("0x00000000000000000000000000000000000000b0");
  });

  it("without the public list no deposit has a time", () => {
    expect(poolDeposits(events, null).every((r) => r.timestamp === null && !r.own)).toBe(true);
    expect(poolDeposits(events, []).every((r) => r.timestamp === null)).toBe(true);
  });
});

describe("the public activity list must be this pool's and hold the note's deposit", () => {
  const POOL = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
  const expected = { chainId: 46630, pool: POOL };
  const row = (k: number, block: bigint, kind = "deposit") => ({ kind, txHash: txOf(k).toUpperCase().replace("0X", "0x"), blockNumber: block });
  const list = { chainId: 46630, pool: POOL.toLowerCase(), activity: [row(0, 10n), row(1, 12n), row(9, 20n, "withdraw")] };
  const note = { txHash: txOf(1), blockNumber: 12n };

  it("ready: same pool (any case) and chain, and the note's deposit transaction is in it", () => {
    expect(activityStatus(list, expected, note)).toBe("ready");
    expect(activityStatus({ ...list, chainId: undefined }, expected, note)).toBe("ready"); // an answer without a chain id
  });

  it("foreign: no pool, another pool or chain (e.g. the server's pool is unset or different)", () => {
    expect(activityStatus({ now, pool: null, activity: [] } as never, expected, note)).toBe("foreign");
    expect(activityStatus({ ...list, pool: "0x0000000000000000000000000000000000000bad" }, expected, note)).toBe("foreign");
    expect(activityStatus({ ...list, chainId: 31338 }, expected, note)).toBe("foreign");
    // the list covers the deposit's block but not its transaction: not the device's chain history
    expect(activityStatus({ ...list, activity: [row(0, 10n), row(9, 20n, "withdraw")] }, expected, note)).toBe("foreign");
  });

  it("behind: this pool's list, older than the note's deposit", () => {
    expect(activityStatus(list, expected, { txHash: txOf(7), blockNumber: 25n })).toBe("behind");
    expect(activityStatus({ ...list, activity: [] }, expected, note)).toBe("behind");
  });
});

describe("deposit pace", () => {
  it("counts the last week, or the time since the first deposit, never less than a day", () => {
    expect(depositPace([], now)).toBe(0);
    expect(depositPace(series(60, ETH, 2 * HOUR, 2 * HOUR).map((d) => d.timestamp!), now)).toBeCloseTo(12, 6); // 60 over 5 days
    expect(depositPace(series(3, ETH, 60, 60).map((d) => d.timestamp!), now)).toBe(3); // three in the last minutes: per day, not per minute
    expect(depositPace(series(30, ETH, 20 * DAY, HOUR).map((d) => d.timestamp!), now)).toBe(0); // none in the last week
    expect(depositPace(series(40, ETH, 6 * HOUR, 6 * HOUR).map((d) => d.timestamp!), now)).toBeCloseTo(4, 6); // one every 6 h for 10 days: the last week holds 28
  });

  it("formats ages", () => {
    expect([5, 59, 60, 1_800, 7_200, 3 * DAY].map(formatAge)).toEqual(["under a minute", "under a minute", "1 min", "30 min", "2 h", "3 d"]);
  });
});

// ─── the privacy check ────────────────────────────────────────────────────────

describe("withdraw check", () => {
  // 60 other deposits of 1 ETH, one every 2 h over the last 5 days (12 a day)
  const busy = series(60, ETH, 2 * HOUR, 2 * HOUR);

  it("a partial withdrawal of an older deposit in a busy pool is strong and needs no wait", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - 71 * HOUR });
    const r = check({ deposits, deposit });
    expect(r).toMatchObject({ timed: true, setSize: 61, couldFund: 61, sameAmount: null, timingCrowd: 61, since: 35, elapsed: 71 * HOUR, crowd: 61, estimate: 61 });
    expect(r.pace).toBeCloseTo(12, 6);
    expect(r.verdict).toBe("strong");
    expect(r.linked).toBe(false);
    expect(r.wait).toEqual({ kind: "none" });
    // an estimate, said as one ("about", not "at least")
    expect(r.reasons).toEqual([{ tone: "good", topic: "summary", text: "By this estimate, an observer is left with about 61 plausible deposits." }]);
  });

  it("a deposit made moments ago is linked by timing; the wait is the first step that projects a strong crowd", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - 30 * 60 });
    const r = check({ deposits, deposit });
    expect(r).toMatchObject({ couldFund: 61, timingCrowd: 1, since: 0, crowd: 1, verdict: "linked" });
    expect(topics(r)).toEqual(["timing"]);
    expect(r.reasons[0]).toEqual({ tone: "bad", topic: "timing", text: "Timing narrows the crowd most: waiting lets more deposits join." });
    // after a wait w the observer looks 3 x (30 min + w) back and 12 x w / 1 d new deposits arrive:
    // 1 d leaves 24 old + 12 new + yours = 37, 2 d leaves 48 + 24 + 1 = 73
    expect(r.wait).toEqual({ kind: "wait", seconds: 2 * DAY });
  });

  it("a deposit made seconds ago (or newer than the public list) counts as made now", () => {
    const spread = series(100, milli(100), 72 * 60, 72 * 60); // 20 a day, the newest 72 min ago
    const a = pool(spread, { value: milli(500), timestamp: now - 5 });
    const r = check({ ...a, noteValue: milli(500), amount: milli(100) });
    expect(r).toMatchObject({ couldFund: 101, timingCrowd: 1, elapsed: 5, verdict: "linked" });
    expect(topics(r)).toEqual(["timing"]);
    expect(r.wait.kind).toBe("wait");
    const seconds = (r.wait as { seconds: number }).seconds;
    expect(WAIT_STEPS).toContain(seconds);

    const b = pool(spread, { value: milli(500), timestamp: null });
    expect(check({ ...b, noteValue: milli(500), amount: milli(100) })).toMatchObject({ elapsed: 0, timingCrowd: 1, wait: r.wait });
  });

  it("only your own deposit: linked, and too quiet to project a wait", () => {
    const r = check({ deposits: [{ value: ETH, timestamp: now - DAY, own: true }], deposit: 0 });
    expect(r).toMatchObject({ setSize: 1, couldFund: 1, timingCrowd: 1, since: 0, crowd: 1, estimate: 1, verdict: "linked", pace: 0, fundLimit: null });
    expect(r.wait).toEqual({ kind: "quiet" });
    expect(topics(r)).toEqual(["set"]);
    expect(r.reasons[0].text).toBe("No other deposit in the association set could hide this withdrawal yet. Every new deposit adds to the crowd.");
  });

  it("a pool with no deposits in the last week is too quiet to project, even with a moderate crowd", () => {
    const old = series(30, ETH, 20 * DAY, 8 * HOUR);
    const { deposits, deposit } = pool(old, { value: ETH, timestamp: now - 25 * DAY });
    const r = check({ deposits, deposit });
    expect(r).toMatchObject({ couldFund: 31, crowd: 31, verdict: "moderate", pace: 0, wait: { kind: "quiet" } });
    expect(topics(r)).toEqual(["set"]);
    expect(r.reasons[0]).toMatchObject({ tone: "warn", text: "The association set is the limit: every new deposit adds to the crowd." });
  });

  it("an amount above every other deposit points at yours, and no wait helps: withdraw at most the largest other deposit", () => {
    const small = series(40, milli(100), HOUR, 3 * HOUR);
    const { deposits, deposit } = pool(small, { value: ETH, timestamp: now - 2 * DAY });
    const r = check({ deposits, deposit, amount: milli(500) });
    expect(r).toMatchObject({ couldFund: 1, crowd: 1, verdict: "linked", fundLimit: milli(100) });
    // pinned before as "beyond" (Over 30 d): no other deposit is this large, so the crowd never grows (decision 5)
    expect(r.wait).toEqual({ kind: "never", by: "amount", use: milli(100) });
    expect(waitLine(r)).toEqual({ value: null, note: "Waiting does not help here: withdraw 0.1 ETH or less instead.", use: milli(100) });
    expect(topics(r)).toEqual([]); // the wait line says it once
    // without times the same advice is a reason, with the bound and a Use action (pinned before as "Withdraw less.")
    const untimed = check({ deposits, deposit, amount: milli(500), now: null });
    expect(untimed.reasons).toEqual([
      { tone: "bad", topic: "amount", text: "No other deposit in the association set can fund this much. Withdraw 0.1 ETH or less.", use: milli(100) },
    ]);
    // a part the pool's deposits can fund has a crowd again
    expect(check({ deposits, deposit, amount: milli(100) })).toMatchObject({ couldFund: 41, verdict: "moderate" });
  });

  describe("the whole original deposit amount", () => {
    // 57 x 0.5 ETH, 3 x 1 ETH, 2 x 5 ETH over the last 3 days; your 1 ETH deposit 4 days ago
    const mixed = [...series(57, milli(500), HOUR, HOUR), ...series(3, ETH, 2 * HOUR, 5 * HOUR), ...series(2, 5n * ETH, 3 * HOUR, 7 * HOUR)];
    const { deposits, deposit } = pool(mixed, { value: ETH, timestamp: now - 4 * DAY });

    it("on the deposit note (hop 0) narrows the crowd to the same amount and suggests a round part", () => {
      const r = check({ deposits, deposit, amount: ETH });
      expect(r).toMatchObject({ couldFund: 6, sameAmount: 4, timingCrowd: 4, crowd: 4, verdict: "weak", roundPart: milli(500) });
      // "withdraw a part" answers the amount too, so it is said once (the figures are the rows)
      expect(topics(r)).toEqual(["exact"]);
      expect(r.reasons[0]).toEqual({
        tone: "bad",
        topic: "exact",
        text: "A whole deposit is matched by its amount. Withdraw a part instead, such as 0.5 ETH; the rest stays as a change note.",
        use: milli(500),
      });
      // the suggested part has a large crowd
      expect(check({ deposits, deposit, amount: milli(500) })).toMatchObject({ couldFund: 63, sameAmount: null, roundPart: null, verdict: "strong" });
    });

    it("an amount nobody else deposited is linked by the exact amount alone, and waiting cannot change that", () => {
      const odd = pool(mixed, { value: 1_234_000_000_000_000_000n, timestamp: now - 4 * DAY });
      const r = check({ ...odd, noteValue: 1_234_000_000_000_000_000n, amount: 1_234_000_000_000_000_000n });
      expect(r).toMatchObject({ couldFund: 3, sameAmount: 1, crowd: 1, verdict: "linked", roundPart: ETH });
      // pinned before as "beyond": no other deposit has this amount, so the exact-amount crowd stays 1 at any wait
      expect(r.wait).toEqual({ kind: "never", by: "exact", use: ETH });
      expect(waitLine(r)).toEqual({ value: null, note: "Waiting does not help here: withdraw a part instead.", use: ETH });
      expect(topics(r)).toEqual([]);
      const far = crowds({
        others: odd.deposits.filter((d, k) => k !== odd.deposit).map((d) => ({ value: d.value, timestamp: d.timestamp! })),
        amount: 1_234_000_000_000_000_000n,
        exactValue: 1_234_000_000_000_000_000n,
        timing: { depositTime: now - 4 * DAY, withdrawTime: now + 3650 * DAY },
        projected: { count: 20 * 3650, shareAtLeast: 2 / 62, shareExact: 0 },
      });
      expect(far.estimate).toBe(1);
    });

    it("on a change note there is no exact-amount crowd, but emptying it is flagged", () => {
      const two = pool(mixed, { value: 2n * ETH, timestamp: now - 4 * DAY });
      const r = check({ ...two, hop: 1, noteValue: ETH, amount: ETH });
      expect(r).toMatchObject({ sameAmount: null, couldFund: 6, roundPart: null });
      expect(topics(r)).toEqual(["amount", "change"]);
      expect(r.reasons[0].text).toBe("Few deposits in the association set can fund this much: a smaller amount has a bigger crowd.");
      expect(r.reasons[1].text).toBe(
        "This takes everything left in the change note: together, your withdrawals from this deposit add up to its amount, which an observer could try to match.",
      );
    });
  });

  describe("exact amount and timing together (an observer applies both)", () => {
    it("(a) two popular amounts, 5 a day each for 60 days: a whole 0.1 ETH note 2 days old is moderate, not strong", () => {
      const others = [...series(300, milli(100), 3 * HOUR, DAY / 5), ...series(300, milli(500), 0, DAY / 5)];
      const { deposits, deposit } = pool(others, { value: milli(100), timestamp: now - 2 * DAY });
      const r = check({ deposits, deposit, noteValue: milli(100), amount: milli(100) });
      // pinned before as strong, 62, no wait: the exact amount (301) and the timing window (62) were counted apart
      expect(exactInWindow(deposits, deposit, milli(100), now - 2 * DAY)).toBe(31);
      expect(r).toMatchObject({ couldFund: 601, sameAmount: 301, timingCrowd: 31, crowd: 31, estimate: 31, verdict: "moderate" });
      expect(r.reasons.some((x) => x.topic === "summary")).toBe(false);
      // 1 d: 0.1 ETH deposits of the last 8 d (40) + 5 projected + yours = 46; 2 d: 50 + 10 + 1 = 61
      expect(r.wait).toEqual({ kind: "wait", seconds: 2 * DAY });
    });

    it("(b) 60 x 1 ETH and 60 x 5 ETH over 30 days: a whole 1 ETH note 5 days old leaves about half", () => {
      const others = [...series(60, ETH, 6 * HOUR, 12 * HOUR), ...series(60, 5n * ETH, 0, 12 * HOUR)];
      const { deposits, deposit } = pool(others, { value: ETH, timestamp: now - 5 * DAY });
      const r = check({ deposits, deposit, noteValue: ETH, amount: ETH });
      expect(exactInWindow(deposits, deposit, ETH, now - 5 * DAY)).toBe(31);
      // pinned before as strong (61)
      expect(r).toMatchObject({ couldFund: 121, sameAmount: 61, timingCrowd: 31, estimate: 31, verdict: "moderate" });
    });

    it("(c) the test pool's shape: a whole 0.1 ETH note 23 min old waits until the combined crowd, not the smallest single test, reaches 50", () => {
      const strangers: PublicDeposit[] = [];
      const ladder: [bigint, number][] = [[milli(10), 20], [milli(50), 15], [milli(100), 40], [milli(500), 25], [ETH, 12], [5n * ETH, 2], [milli(250), 4], [milli(370), 1], [milli(123), 1], [2500n * 10n ** 15n, 1]];
      const amounts: bigint[] = [];
      for (const [a, n] of ladder) for (let k = 0; k < n; k++) amounts.push(a);
      // a deterministic interleave over 14 days, the newest about 40 min ago
      amounts.forEach((a, k) =>
        strangers.push({ value: a, timestamp: now - 40 * 60 - Math.round(((amounts.length - 1 - ((k * 37) % amounts.length)) * (14 * DAY - 40 * 60)) / amounts.length) }),
      );
      const { deposits, deposit } = pool(strangers, { value: milli(100), timestamp: now - 23 * 60 });
      const r = check({ deposits, deposit, noteValue: milli(100), amount: milli(100) });
      expect(r.wait.kind).toBe("wait");
      const w = (r.wait as { seconds: number }).seconds;
      // pinned before as 3 d, where the exact amount and the timing together leave 28
      expect(w).toBeGreaterThan(3 * DAY);
      const cover = deposits.filter((d, k) => k !== deposit && !d.own).map((d) => ({ value: d.value, timestamp: d.timestamp! }));
      const shareAtLeast = cover.filter((d) => d.value >= milli(100)).length / cover.length;
      const shareExact = cover.filter((d) => d.value === milli(100)).length / cover.length;
      const at = (wait: number) =>
        crowds({
          others: cover,
          amount: milli(100),
          exactValue: milli(100),
          timing: { depositTime: now - 23 * 60, withdrawTime: now + wait },
          projected: { count: (r.pace! * wait) / DAY, shareAtLeast, shareExact },
        });
      // the combined crowd at the recommended wait is strong, and at the step before it is not
      expect(at(w).timingCrowd).toBeGreaterThanOrEqual(50);
      expect(at(w).estimate).toBe(at(w).timingCrowd);
      expect(at(WAIT_STEPS[WAIT_STEPS.indexOf(w) - 1]).estimate).toBeLessThan(50);
      // by hand at the old 3 d: 0.1 ETH deposits since 9 d 1 h ago + projected 0.1 ETH arrivals + yours
      const start = now + 3 * DAY - 3 * (3 * DAY + 23 * 60);
      const byHand = cover.filter((d) => d.value === milli(100) && d.timestamp >= start).length + Math.round(((r.pace! * 3 * DAY) / DAY) * shareExact) + 1;
      expect(at(3 * DAY).timingCrowd).toBe(byHand);
      expect(byHand).toBe(28);
    });
  });

  it("your other deposits and public exits are not counted as cover", () => {
    const others = [...series(20, ETH, HOUR, HOUR), ...series(30, ETH, 30 * 60, HOUR, { own: true }), ...series(10, ETH, 20 * 60, HOUR, { exited: true })];
    const { deposits, deposit } = pool(others, { value: ETH, timestamp: now - 3 * DAY });
    const r = check({ deposits, deposit });
    expect(r).toMatchObject({ couldFund: 21, crowd: 21, verdict: "moderate", since: 30 });
    expect(topics(r)).toEqual(["set", "own"]);
    expect(r.reasons[1].text).toBe("30 of your other deposits are not counted: they point at you, not away from you.");
    const one = pool([...series(20, ETH, HOUR, HOUR), { value: ETH, timestamp: now - 30 * 60, own: true }], { value: ETH, timestamp: now - 3 * DAY });
    expect(check(one).reasons.find((x) => x.topic === "own")?.text).toBe("One of your other deposits is not counted: it points at you, not away from you.");
  });

  it("only the association set counts: deposits after it are no cover yet", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - 119 * HOUR }); // position 1
    expect(check({ deposits, deposit, setSize: 40 })).toMatchObject({ setSize: 40, couldFund: 40, since: 59 });
    expect(check({ deposits, deposit, setSize: 1000 }).setSize).toBe(61);
  });

  it("a recipient or route tied to your deposits links it whatever the crowd, and only that cause is given", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - 71 * HOUR });
    const route = check({ deposits, deposit, viaRelayer: false });
    expect(route).toMatchObject({ crowd: 61, estimate: 1, linked: true, verdict: "linked", wait: { kind: "none" } });
    expect(topics(route)).toEqual(["route"]);
    const recipient = check({ deposits, deposit, freshRecipient: false });
    expect(recipient).toMatchObject({ estimate: 1, verdict: "linked" });
    expect(topics(recipient)).toEqual(["recipient"]);
    // a recent whole deposit would also be linked by timing and the exact amount: that advice cannot fix a linked
    // recipient, so it is left out (and no "waiting helps")
    const recent = pool(series(60, milli(500), 2 * HOUR, 2 * HOUR), { value: ETH, timestamp: now - 30 * 60 });
    const both = check({ ...recent, amount: ETH, freshRecipient: false });
    expect(both).toMatchObject({ linked: true, verdict: "linked", couldFund: 1 });
    expect(topics(both)).toEqual(["recipient"]);
    expect(both.reasons.some((x) => /wait/i.test(x.text))).toBe(false);
  });

  it("without public times there is no estimate, no verdict, no wait and no good-tone summary: never strong without the timing test", () => {
    // a deposit made 30 s ago: linked by timing with times, and nothing better than "unknown" without them
    const { deposits, deposit } = pool(series(80, ETH, 2 * HOUR, 2 * HOUR), { value: ETH, timestamp: now - 30 });
    expect(check({ deposits, deposit })).toMatchObject({ timed: true, verdict: "linked", estimate: 1 });
    const r = check({ deposits, deposit, now: null });
    expect(r).toMatchObject({ timed: false, couldFund: 81, timingCrowd: null, elapsed: null, pace: null, crowd: null, estimate: null, verdict: null, wait: { kind: "unknown" } });
    expect(r.reasons).toEqual([]);
    expect(waitLine(r)).toBeNull();
    // what does not need a time is still said: the exact amount of a whole deposit
    const whole = check({ deposits, deposit, amount: ETH, now: null });
    expect(whole).toMatchObject({ sameAmount: 81, verdict: null });
    // and a linked recipient is still the only cause given
    expect(topics(check({ deposits, deposit, now: null, freshRecipient: false }))).toEqual(["recipient"]);
  });

  it("the amount advice comes only when the amount is what limits the crowd (said once, compactly)", () => {
    // 30 x 1 ETH over 10 days, 60 x 0.1 ETH; your 1 ETH deposit a day ago: 31 could fund 0.5 ETH, the 3-day window holds 10
    const others = [...series(30, ETH, 8 * HOUR, 8 * HOUR), ...series(60, milli(100), HOUR, 2 * HOUR)];
    const { deposits, deposit } = pool(others, { value: ETH, timestamp: now - DAY });
    const r = check({ deposits, deposit });
    expect(r).toMatchObject({ couldFund: 31, timingCrowd: 10, estimate: 10 });
    expect(topics(r)).toEqual(["timing"]);
    // without times the amount is the limit again
    expect(topics(check({ deposits, deposit, now: null }))).toEqual(["amount"]);
  });

  it("reasons carry advice, not the figures the rows show", () => {
    const mixed = [...series(57, milli(500), HOUR, HOUR), ...series(12, ETH, 2 * HOUR, 5 * HOUR), ...series(2, 5n * ETH, 3 * HOUR, 7 * HOUR)];
    const { deposits, deposit } = pool(mixed, { value: ETH, timestamp: now - 30 * 60 });
    for (const amount of [ETH, milli(500), 2n * ETH]) {
      const r = check({ deposits, deposit, amount, noteValue: 5n * ETH, hop: 1 });
      const figures = [r.couldFund, r.sameAmount, r.timingCrowd, r.estimate, r.since].filter((x): x is number => x !== null && x > 1);
      // amounts ("0.5 ETH") are advice, not figures
      for (const reason of r.reasons.filter((x) => x.topic !== "summary"))
        for (const f of figures) expect(reason.text.replace(/\d+(?:\.\d+)? ETH/g, "")).not.toMatch(new RegExp(`\\b${f}\\b`));
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("agrees with the shared crowd model", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - 10 * HOUR });
    const r = check({ deposits, deposit });
    const others = deposits.filter((_, k) => k !== deposit).map((d) => ({ value: d.value, timestamp: d.timestamp! }));
    const c = crowds({ others, amount: ETH / 2n, exactValue: null, timing: { depositTime: now - 10 * HOUR, withdrawTime: now } });
    expect([r.couldFund, r.timingCrowd, r.crowd]).toEqual([c.amountCrowd, c.timingCrowd, c.estimate]);
  });

  it("refuses inputs the form never sends", () => {
    const { deposits, deposit } = pool(busy, { value: ETH, timestamp: now - DAY });
    expect(() => check({ deposits, deposit: 99 })).toThrow(RangeError);
    expect(() => check({ deposits, deposit, setSize: deposit })).toThrow(/association set/);
    expect(() => check({ deposits, deposit, amount: 2n * ETH })).toThrow(/amount/);
    expect(() => check({ deposits, deposit, amount: 0n })).toThrow(/amount/);
  });
});

describe("the recommended wait, as the form shows it", () => {
  const pace = 8.6;
  const line = (wait: Parameters<typeof waitLine>[0]["wait"], p: number | null = pace) => waitLine({ wait, pace: p });

  it("about a step, within the last one (14 to 30 d), over it, or none", () => {
    expect(line({ kind: "none" })).toEqual({ value: "None needed", note: null, use: null });
    expect(line({ kind: "wait", seconds: 3 * DAY })).toEqual({ value: "About 3 d", note: "At the pool's pace of 8.6 deposits a day.", use: null });
    expect(line({ kind: "wait", seconds: 10_800 }, 12.4)?.value).toBe("About 3 h");
    expect(line({ kind: "wait", seconds: 14 * DAY })?.value).toBe("About 14 d");
    // the last step: a crowd that reaches 50 after 15 days is "within 30 d", not "about 30 d"
    expect(LONGEST_WAIT).toBe(30 * DAY);
    expect(line({ kind: "wait", seconds: LONGEST_WAIT })?.value).toBe("Within 30 d");
    expect(line({ kind: "beyond", seconds: LONGEST_WAIT })).toEqual({ value: "Over 30 d", note: "At the pool's pace of 8.6 deposits a day.", use: null });
    expect(line({ kind: "quiet" }, 0)).toEqual({ value: "Too quiet to project", note: "Fewer than one other deposit a week.", use: null });
    expect(line({ kind: "unknown" }, null)).toBeNull();
    expect(line({ kind: "wait", seconds: DAY }, 1)?.note).toBe("At the pool's pace of 1 deposit a day.");
    expect(line({ kind: "wait", seconds: DAY }, 12.6)?.note).toBe("At the pool's pace of 13 deposits a day.");
  });

  it("a crowd that reaches 50 after about 15 days is shown as within 30 d", () => {
    // 3 other deposits in the last day (3 a day), your deposit 30 min ago: 14 d projects 3 + 42 + yours = 46, 30 d 94
    const others = series(3, ETH, 2 * HOUR, 8 * HOUR);
    const { deposits, deposit } = pool(others, { value: ETH, timestamp: now - 30 * 60 });
    const r = check({ deposits, deposit, setSize: deposits.length });
    expect(r.pace).toBeCloseTo(3, 6);
    expect(r.wait).toEqual({ kind: "wait", seconds: LONGEST_WAIT });
    expect(waitLine(r)?.value).toBe("Within 30 d");
  });

  it("no wait helps: say so, with the amount to use instead", () => {
    expect(line({ kind: "never", by: "exact", use: milli(500) })).toEqual({ value: null, note: "Waiting does not help here: withdraw a part instead.", use: milli(500) });
    expect(line({ kind: "never", by: "amount", use: milli(100) })?.note).toBe("Waiting does not help here: withdraw 0.1 ETH or less instead.");
    expect(line({ kind: "never", by: "amount", use: null })).toEqual({ value: null, note: "Waiting does not help here: withdraw less instead.", use: null });
  });
});
