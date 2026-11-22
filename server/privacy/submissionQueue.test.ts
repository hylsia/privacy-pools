import { describe, it, expect } from "vitest";
import { SubmissionQueue } from "./submissionQueue";
const hash = `0x${"ab".repeat(32)}` as const;
describe("relayer submission queue (state isolation, not proof verification)", () => {
  it("shares duplicate submissions before the response and serializes distinct sends", async () => {
    const q = new SubmissionQueue();
    let active = 0,
      most = 0,
      sent = 0;
    const job = async (broadcast: () => void) => {
      active++;
      most = Math.max(most, active);
      broadcast();
      sent++;
      await new Promise(r => setTimeout(r, 5));
      active--;
      return hash;
    };
    expect(
      await Promise.all([
        q.run("same", job),
        q.run("same", job),
        q.run("other", job),
      ])
    ).toEqual([hash, hash, hash]);
    expect(sent).toBe(2);
    expect(most).toBe(1);
    expect(await q.run("same", job)).toBe(hash);
    expect(sent).toBe(2);
  });
  it("allows a corrected pre-broadcast failure but blocks automatic retry after an ambiguous send", async () => {
    const q = new SubmissionQueue();
    let sent = 0;
    await expect(
      q.run("invalid", async () => {
        throw new Error("simulation rejected");
      })
    ).rejects.toThrow("simulation rejected");
    expect(
      await q.run("invalid", async broadcast => {
        broadcast();
        sent++;
        return hash;
      })
    ).toBe(hash);
    await expect(
      q.run("timeout", async broadcast => {
        broadcast();
        sent++;
        throw new Error("response lost after broadcast");
      })
    ).rejects.toThrow("response lost");
    await expect(
      q.run("timeout", async () => {
        sent++;
        return hash;
      })
    ).rejects.toThrow("response lost");
    await expect(
      q.run("another", async () => {
        sent++;
        return hash;
      })
    ).rejects.toThrow("uncertain");
    expect(sent).toBe(2);
  });
});

describe("conflicting terms for one nullifier", () => {
  it("refuses another payout or proof while the original nullifier submission is remembered", async () => {
    const q = new SubmissionQueue();
    let sent = 0;
    await q.run(
      "nullifier",
      async () => {
        sent++;
        return hash;
      },
      "recipient-a"
    );
    await expect(
      q.run(
        "nullifier",
        async () => {
          sent++;
          return hash;
        },
        "recipient-b"
      )
    ).rejects.toThrow("different withdrawal");
    expect(sent).toBe(1);
  });
});
