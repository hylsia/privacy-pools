/**
 * client/src/privacy/unlockedWork.ts: a lock asked for while an operation runs happens once the operation has written
 * its outcome (the lock gate), and the pending check after unlock waits in rounds that stop once the vault is locked.
 */
import { describe, expect, it, vi } from "vitest";
import { createLockGate, waitInRounds } from "../../client/src/privacy/unlockedWork";

describe("the lock gate", () => {
  it("locks at once when no operation of the open log runs, or when nothing is open", () => {
    const gate = createLockGate();
    expect(gate.ask(1)).toBe(true);
    expect(gate.ask(undefined)).toBe(true);
    expect(gate.pending()).toBe(false);
  });

  it("waits for the operation's last write, then locks once (also when the operation failed)", () => {
    const gate = createLockGate();
    gate.start(1);
    expect(gate.ask(1)).toBe(false); // asked during the operation: it waits
    expect(gate.pending()).toBe(true);
    expect(gate.ask(1)).toBe(false); // asking again changes nothing
    expect(gate.finish(1, 1)).toBe(true); // the last write is done: lock now
    expect(gate.pending()).toBe(false);
    // the next operation finishes with nobody asking: no lock
    gate.start(1);
    expect(gate.finish(1, 1)).toBe(false);
  });

  it("waits for every operation of that log (a deposit's release can outlast the next operation's start)", () => {
    const gate = createLockGate();
    gate.start(1); // a deposit, now in its release after busy ended
    gate.start(1); // the next operation
    expect(gate.ask(1)).toBe(false);
    expect(gate.finish(1, 1)).toBe(false);
    expect(gate.pending()).toBe(true);
    expect(gate.finish(1, 1)).toBe(true);
  });

  it("does not hold a new vault's lock for an operation of a log that was closed (Forget, then another vault)", () => {
    const gate = createLockGate();
    gate.start(1); // vault A's deposit, its wallet prompt still open
    gate.clear(); // Forget
    expect(gate.ask(2)).toBe(true); // vault B locks at once
    // A's operation ends later: nothing happens to B
    expect(gate.finish(1, 3)).toBe(false);
    // a lock asked for and then dropped by Forget is not run by the operation's end
    gate.start(3);
    expect(gate.ask(3)).toBe(false);
    gate.clear();
    expect(gate.pending()).toBe(false);
    expect(gate.finish(3, undefined)).toBe(false);
  });
});

describe("waitInRounds (the pending check after unlock)", () => {
  class Timeout extends Error {}
  const isTimeout = (e: unknown) => e instanceof Timeout;

  it("returns the result of the round that has it", async () => {
    const wait = vi.fn().mockRejectedValueOnce(new Timeout()).mockResolvedValueOnce("receipt");
    expect(await waitInRounds(wait, () => true, { totalMs: 300_000, roundMs: 15_000, isTimeout })).toBe("receipt");
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([15_000, 15_000]);
  });

  it("starts no new round once open() is false, and resolves null", async () => {
    let open = true;
    const wait = vi.fn(async () => {
      open = false; // the vault is locked during this round
      throw new Timeout();
    });
    expect(await waitInRounds(wait, () => open, { totalMs: 300_000, roundMs: 15_000, isTimeout })).toBeNull();
    expect(wait).toHaveBeenCalledTimes(1);
    // locked before it started: no round at all
    const never = vi.fn();
    expect(await waitInRounds(never, () => false, { totalMs: 300_000, roundMs: 15_000, isTimeout })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it("throws the timeout after totalMs (its last round is cut to what is left), and any other error at once", async () => {
    let t = 0;
    const now = () => t;
    const asked: number[] = [];
    const wait = async (ms: number) => {
      asked.push(ms);
      t += ms;
      throw new Timeout();
    };
    await expect(waitInRounds(wait, () => true, { totalMs: 40_000, roundMs: 15_000, isTimeout, now })).rejects.toBeInstanceOf(Timeout);
    expect(asked).toEqual([15_000, 15_000, 10_000]);
    const boom = vi.fn().mockRejectedValue(new Error("RPC down"));
    await expect(waitInRounds(boom, () => true, { totalMs: 40_000, roundMs: 15_000, isTimeout })).rejects.toThrow("RPC down");
    expect(boom).toHaveBeenCalledTimes(1);
  });
});
