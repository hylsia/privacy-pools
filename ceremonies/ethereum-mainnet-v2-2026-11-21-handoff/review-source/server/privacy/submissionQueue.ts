/** One process, one service signer: serialize broadcasts and remember public transaction hashes.
 * An ambiguous transport failure pauses this signer until an operator reconciles pending transactions and restarts.
 * This is deliberately not a distributed nonce manager or automatic transaction replacement policy.
 */
export class SubmissionQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private entries = new Map<
    string,
    { terms: string; promise: Promise<`0x${string}`> }
  >();
  private uncertain = false;
  run(
    id: string,
    job: (
      broadcasting: (uncertain?: boolean) => void
    ) => Promise<`0x${string}`>,
    terms = id
  ): Promise<`0x${string}`> {
    const existing = this.entries.get(id);
    if (existing)
      return existing.terms === terms
        ? existing.promise
        : Promise.reject(
            new Error(
              "A different withdrawal for this note was already submitted. Sync and check its transaction before retrying."
            )
          );
    if (this.entries.size >= 1000)
      return Promise.reject(
        new Error(
          "Relayer submission capacity reached; operator reconciliation is required."
        )
      );
    let attempted = false;
    const run = this.tail.then(async () => {
      if (this.uncertain)
        throw new Error(
          "Relayer submission status is uncertain. Check chain status; the operator must reconcile pending transactions before this signer resumes."
        );
      return job((uncertain = true) => {
        attempted = uncertain;
      });
    });
    this.entries.set(id, { terms, promise: run });
    this.tail = run.catch(() => undefined);
    void run.catch(() => {
      if (attempted) this.uncertain = true;
      else if (this.entries.get(id)?.promise === run) this.entries.delete(id);
    });
    return run;
  }
}
