/**
 * Work that belongs to an unlocked vault and can outlive a click: the operations in flight, which a lock waits for,
 * and the pending check after unlock, which a lock stops. Pure (no React, no network), so it is tested from
 * server/privacy/unlockedWork.test.ts. Both name the vault's open log by a number (ActivitySession.opened in
 * PrivacyProvider), never by the session itself, so neither keeps the log's key alive.
 */

export interface LockGate {
  /** An operation of the log opening `opened` starts. */
  start(opened: number): void;
  /**
   * That operation's last write with the vault's key is done. True when a lock asked for while it ran must happen
   * now: no other operation of that opening still runs, and it is still the open one (`current`).
   */
  finish(opened: number, current: number | undefined): boolean;
  /**
   * A lock is asked for while `current` is open (undefined: nothing is open). True: lock now. False: one of its
   * operations is in flight, so the lock waits for its finish(); pending() is true until then.
   */
  ask(current: number | undefined): boolean;
  /** The open log closed (a lock, Forget, create, restore): a lock still waiting is dropped. */
  clear(): void;
  /** A lock is waiting for an operation. */
  pending(): boolean;
}

/**
 * An operation records its outcome in the log, and a deposit updates and then releases its index reservation, with
 * the vault's key. So a lock asked for meanwhile happens after the operation's last write instead of dropping the key
 * under it. Operations of a log that was closed meanwhile (Forget, then another vault) do not hold up the new one.
 */
export function createLockGate(): LockGate {
  const running = new Map<number, number>();
  let asked: number | null = null;
  return {
    start(opened) {
      running.set(opened, (running.get(opened) ?? 0) + 1);
    },
    finish(opened, current) {
      const left = (running.get(opened) ?? 1) - 1;
      if (left > 0) running.set(opened, left);
      else running.delete(opened);
      if (left > 0 || asked !== opened || current !== opened) return false;
      asked = null;
      return true;
    },
    ask(current) {
      if (current === undefined || (running.get(current) ?? 0) === 0) {
        asked = null;
        return true;
      }
      asked = current;
      return false;
    },
    clear() {
      asked = null;
    },
    pending() {
      return asked !== null;
    },
  };
}

/**
 * Waits for something (a transaction receipt) in rounds of at most `roundMs`, `totalMs` in all, asking `open()` before
 * each round: once it is false no new round starts, and the result is null. `wait(ms)` resolves with the result or
 * rejects; a rejection that `isTimeout` accepts ends only that round, until `totalMs` has passed, when it is thrown.
 * Any other rejection is thrown at once.
 */
export async function waitInRounds<T>(
  wait: (timeoutMs: number) => Promise<T>,
  open: () => boolean,
  o: { totalMs: number; roundMs: number; isTimeout: (err: unknown) => boolean; now?: () => number },
): Promise<T | null> {
  const now = o.now ?? Date.now;
  const deadline = now() + o.totalMs;
  for (;;) {
    if (!open()) return null;
    try {
      return await wait(Math.max(1, Math.min(o.roundMs, deadline - now())));
    } catch (err) {
      if (!o.isTimeout(err) || now() >= deadline) throw err;
    }
  }
}
