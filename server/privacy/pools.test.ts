import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { STANDARD_AMOUNTS } from "../../shared/privacy/guidance";
import { privacyHealth, type PoolActivity } from "./pools";

const milli = (n: number) => BigInt(n) * 10n ** 15n;
const A = "0x00000000000000000000000000000000000000a1" as Address;
const B = "0x00000000000000000000000000000000000000b2" as Address;
const R = "0x00000000000000000000000000000000000000c3" as Address;

let n = 0;
const act = (kind: PoolActivity["kind"], value: bigint, over: Partial<PoolActivity> = {}): PoolActivity => ({
  kind,
  value,
  fee: 0n,
  account: A,
  relayer: kind === "withdraw" ? R : null,
  txHash: `0x${(++n).toString(16).padStart(64, "0")}`,
  blockNumber: BigInt(n),
  timestamp: 1_900_000_000 + n,
  ...over,
});

describe("privacy health", () => {
  it("counts standard amounts with the vault forms' ladder, not 'any multiple of 0.01 ETH'", () => {
    const activity = [
      act("deposit", milli(100)),
      act("deposit", milli(500)),
      act("deposit", milli(370)), // a multiple of 0.01 ETH, but not on the ladder: the Deposit form calls it unusual
      act("deposit", milli(250)),
      act("withdraw", milli(50), { account: B }),
      act("withdraw", 123_400_000_000_000_000n, { account: B }),
    ];
    const h = privacyHealth(activity);
    expect(h.standardAmountShare).toBeCloseTo(3 / 6, 9);
    expect(STANDARD_AMOUNTS.every((v) => privacyHealth([act("deposit", v)]).standardAmountShare === 1)).toBe(true);
    expect(privacyHealth([]).standardAmountShare).toBe(1);
  });

  it("keeps the other heuristics", () => {
    const activity = [
      act("deposit", milli(100)),
      act("deposit", milli(100), { account: B }),
      act("deposit", milli(370)),
      act("withdraw", milli(100), { account: B }), // an earlier deposit's exact amount, to an address that deposited
      act("withdraw", milli(50), { account: R, relayer: null }), // paid its own gas
    ];
    expect(privacyHealth(activity)).toEqual({
      uniqueAmountDeposits: 1,
      exactMatchWithdrawals: 1,
      recipientIsDepositor: 1,
      selfRelayed: 1,
      standardAmountShare: 4 / 5,
    });
  });
});
