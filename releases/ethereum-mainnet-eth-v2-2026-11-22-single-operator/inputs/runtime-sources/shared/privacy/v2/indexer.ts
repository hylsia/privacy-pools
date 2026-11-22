/** V2 seed-only discovery from complete, validated public pool history. */
import type { MasterKeys } from "../notes";
import { computeCommitment, computePrecommitment } from "../notes";
import type {
  DepositedEvent,
  PoolEvent,
  RagequitEvent,
  WithdrawnEvent,
} from "../types";
import {
  computeNullifierHashV2,
  deriveNoteSecretsV2,
  type NoteV2,
} from "./notes";

export type DepositedEventV2 = DepositedEvent & { recoveryNonce: bigint };
export type PoolEventV2 = Exclude<PoolEvent, DepositedEvent> | DepositedEventV2;

export function discoverNotesV2(
  keys: MasterKeys,
  scope: bigint,
  events: readonly PoolEventV2[]
): {
  notes: NoteV2[];
  /** Reuse leaks a deposit link, but does not share a spend nullifier across labels. */
  reusedRecoveryNonces: bigint[];
} {
  const withdrawals = new Map<bigint, WithdrawnEvent>();
  const exits = new Map<bigint, RagequitEvent>();
  for (const event of events) {
    if (event.kind === "withdraw") withdrawals.set(event.spentNullifier, event);
    if (event.kind === "ragequit") exits.set(event.commitment, event);
  }
  const notes: NoteV2[] = [];
  const used = new Set<bigint>();
  const reused = new Set<bigint>();
  for (const deposit of events) {
    if (deposit.kind !== "deposit") continue;
    let secrets = deriveNoteSecretsV2(keys, scope, deposit.recoveryNonce, 0);
    if (computePrecommitment(secrets) !== deposit.precommitment) continue;
    if (
      computeCommitment(deposit.value, deposit.label, deposit.precommitment) !==
      deposit.commitment
    ) {
      throw new Error("v2 deposit commitment mismatch");
    }
    if (used.has(deposit.recoveryNonce)) reused.add(deposit.recoveryNonce);
    used.add(deposit.recoveryNonce);
    let value = deposit.value;
    let commitment = deposit.commitment;
    let leafIndex = deposit.leafIndex;
    let blockNumber = deposit.blockNumber;
    let txHash = deposit.txHash;
    for (let hop = 0; ; hop++) {
      const nullifierHash = computeNullifierHashV2(
        secrets.nullifier,
        deposit.label
      );
      const note: NoteV2 = {
        depositIndex: deposit.leafIndex,
        recoveryNonce: deposit.recoveryNonce,
        hop,
        value,
        label: deposit.label,
        ...secrets,
        precommitment: computePrecommitment(secrets),
        commitment,
        nullifierHash,
        leafIndex,
        blockNumber,
        txHash,
        spent: false,
      };
      const exit = exits.get(commitment);
      const withdrawal = withdrawals.get(nullifierHash);
      if (exit) {
        note.spent = true;
        note.spentBy = {
          kind: "ragequit",
          txHash: exit.txHash,
          blockNumber: exit.blockNumber,
        };
      } else if (withdrawal) {
        note.spent = true;
        note.spentBy = {
          kind: "withdraw",
          txHash: withdrawal.txHash,
          blockNumber: withdrawal.blockNumber,
        };
      }
      notes.push(note);
      if (exit || !withdrawal) break;
      const next = deriveNoteSecretsV2(
        keys,
        scope,
        deposit.recoveryNonce,
        hop + 1
      );
      const remainder = value - withdrawal.value;
      if (
        remainder < 0n ||
        computeCommitment(
          remainder,
          deposit.label,
          computePrecommitment(next)
        ) !== withdrawal.newCommitment
      ) {
        // An externally constructed spend may use change secrets outside this derivation.
        break;
      }
      if (withdrawal.leafIndex <= leafIndex)
        throw new Error("v2 change must follow its input note");
      secrets = next;
      value = remainder;
      commitment = withdrawal.newCommitment;
      leafIndex = withdrawal.leafIndex;
      blockNumber = withdrawal.blockNumber;
      txHash = withdrawal.txHash;
    }
  }
  return { notes, reusedRecoveryNonces: [...reused] };
}
