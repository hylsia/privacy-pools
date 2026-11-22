/** One origin-wide writer across tabs. Never emulate a browser lock with a localStorage lease. */
const tails = new Map<string, Promise<unknown>>();

export function withDeviceLock<T>(
  key: string,
  job: () => Promise<T>
): Promise<T> {
  if (globalThis.navigator?.locks) {
    return Promise.resolve(
      navigator.locks.request(`hylsia:${key}`, { mode: "exclusive" }, job)
    ).then(value => value);
  }
  // Depositing without coordination can reuse a note's nullifier. Fail closed on unsupported browsers.
  if (typeof window !== "undefined")
    return Promise.reject(
      new Error(
        "This browser needs Web Locks to coordinate vault writes. Use a supported browser over HTTPS."
      )
    );
  // Non-browser callers (unit tests) share one process; browsers must use the native origin-wide lock.
  const run = (tails.get(key) ?? Promise.resolve()).then(job);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
