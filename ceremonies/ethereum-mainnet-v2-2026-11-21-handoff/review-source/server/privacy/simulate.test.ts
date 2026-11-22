import { describe, expect, it } from "vitest";
import { crowds, simulate, verdictOf, type SimInput } from "../../shared/privacy/simulate";

const ETH = 10n ** 18n;
const now = 1_900_000_000;

function base(over: Partial<SimInput> = {}): SimInput {
  const deposits = Array.from({ length: 40 }, (_, i) => ({ value: ETH, timestamp: now - 86_400 * 10 + i * 3_600 }));
  return {
    deposits,
    depositsPerDay: 4,
    shareAtLeast: 1,
    shareExact: 1,
    now,
    depositAmount: ETH,
    withdrawAmount: ETH / 2n,
    waitSeconds: 86_400 * 7,
    viaRelayer: true,
    freshRecipient: true,
    ...over,
  };
}

describe("linkability estimate", () => {
  it("counts every deposit >= amount, projected arrivals and your own", () => {
    const r = simulate(base());
    expect(r.amountCrowd).toBe(40 + 28 + 1);
    expect(r.exactCrowd).toBeNull();
  });

  it("links immediately for a non-fresh recipient or self-paid gas", () => {
    expect(simulate(base({ freshRecipient: false })).estimate).toBe(1);
    expect(simulate(base({ viaRelayer: false })).verdict).toBe("linked");
  });

  it("an uncommon exact full withdrawal shrinks the crowd to equal amounts", () => {
    const odd = 1_234_000_000_000_000_000n;
    const r = simulate(base({ depositAmount: odd, withdrawAmount: odd, shareExact: 0, shareAtLeast: 0.2 }));
    expect(r.exactCrowd).toBe(1);
    expect(r.estimate).toBe(1);
  });

  it("a short wait leaves a small timing crowd; waiting grows it", () => {
    const quick = simulate(base({ waitSeconds: 600, deposits: [] }));
    const slow = simulate(base({ waitSeconds: 86_400 * 14, deposits: [] }));
    expect(quick.timingCrowd).toBeLessThan(slow.timingCrowd);
    expect(quick.estimate).toBeLessThan(10);
  });

  // 10 x 1 ETH (the newest, one an hour back from 1 h ago), then 20 x 0.1 ETH further back
  const others = Array.from({ length: 30 }, (_, i) => ({ value: i < 10 ? ETH : ETH / 10n, timestamp: now - 3_600 * (i + 1) }));
  const window = { depositTime: now - 7_200, withdrawTime: now }; // the 3 x 2 h window back holds the six newest

  it("the crowd model counts your deposit once and leaves timing out without times", () => {
    const c = crowds({ others, amount: ETH / 2n, exactValue: null, timing: null });
    expect(c).toEqual({ amountCrowd: 11, exactCrowd: null, timingCrowd: null, estimate: 11 });
    // a partial withdrawal: 30 could fund 0.1 ETH, and the six newest (all larger) are in the window
    const timed = crowds({ others, amount: ETH / 10n, exactValue: null, timing: window });
    expect(timed).toEqual({ amountCrowd: 31, exactCrowd: null, timingCrowd: 7, estimate: 7 });
  });

  it("a full withdrawal: the exact amount and the timing window narrow the same crowd", () => {
    // 20 deposits are exactly 0.1 ETH, but none of them is in the window: the six newest are 1 ETH. An observer who
    // looks there for exactly 0.1 ETH finds only yours. (Before the tests were combined this case counted 7: the
    // window was searched for any deposit large enough, though none of those has the exact amount.)
    const whole = crowds({ others, amount: ETH / 10n, exactValue: ETH / 10n, timing: window });
    expect(whole).toEqual({ amountCrowd: 31, exactCrowd: 21, timingCrowd: 1, estimate: 1 });
    // projected arrivals of the exact amount join the combined crowd
    const later = crowds({ others, amount: ETH / 10n, exactValue: ETH / 10n, timing: window, projected: { count: 10, shareAtLeast: 1, shareExact: 0.4 } });
    expect(later).toEqual({ amountCrowd: 41, exactCrowd: 25, timingCrowd: 5, estimate: 5 });
  });

  it("verdict thresholds", () => {
    expect([1, 2, 9, 10, 49, 50].map(verdictOf)).toEqual(["linked", "weak", "weak", "moderate", "moderate", "strong"]);
  });
});
