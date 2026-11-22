import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_DEFAULT_ACCOUNTS } from "../../shared/privacy/networks";
import { anvilKey } from "../../scripts/privacy/anvilKeys";

describe("anvil test keys are derived, never written in the repository", () => {
  it("anvilKey(i) belongs to anvil default account i, the list the deploy guards refuse on public chains", () => {
    expect(ANVIL_DEFAULT_ACCOUNTS).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(privateKeyToAccount(anvilKey(i)).address).toBe(ANVIL_DEFAULT_ACCOUNTS[i]);
    }
  });

  it("refuses an index outside anvil's ten default accounts", () => {
    expect(() => anvilKey(10)).toThrow(/out of range/);
    expect(() => anvilKey(-1)).toThrow(/out of range/);
    expect(() => anvilKey(1.5)).toThrow(/out of range/);
  });
});
