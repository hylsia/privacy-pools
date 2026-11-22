/** Protocol-specific browser behavior. Version selection is explicit and fixed for one build. */
import { PROTOCOL_VERSION } from "./constants";
import { PRIVACY_POOL_ABI } from "./abi";
import { PRIVACY_POOL_V2_ABI } from "./v2/abi";
import { discoverNotes, type DiscoveryResult } from "./indexer";
import {
  computePrecommitment,
  deriveMasterKeys,
  deriveNoteSecrets,
  type MasterKeys,
  type Note,
} from "./notes";
import { discoverNotesV2, type PoolEventV2 } from "./v2/indexer";
import {
  createRecoveryNonce,
  deriveMasterKeysV2,
  deriveNoteSecretsV2,
} from "./v2/notes";
import {
  decryptProtocolSeed,
  encryptProtocolSeed,
  generateSeed,
  parseProtocolBackup,
  seedFingerprintForProtocol,
} from "./vault";
import {
  protocolDefinition,
  isV2Protocol,
  type PrivacyProtocol,
} from "./protocols";
import type { PoolEvent } from "./types";

export function protocolRuntime(protocol: PrivacyProtocol) {
  protocolDefinition(protocol);
  const v2 = isV2Protocol(protocol);
  return Object.freeze({
    protocol,
    abi: v2 ? PRIVACY_POOL_V2_ABI : PRIVACY_POOL_ABI,
    generateSeed,
    deriveMasterKeys: (seed: Uint8Array) =>
      isV2Protocol(protocol)
        ? deriveMasterKeysV2(seed, protocol)
        : deriveMasterKeys(seed),
    encryptSeed: (seed: Uint8Array, password: string) =>
      encryptProtocolSeed(seed, password, protocol),
    decryptSeed: (
      backup: Parameters<typeof decryptProtocolSeed>[0],
      password: string
    ) => decryptProtocolSeed(backup, password, protocol),
    parseBackup: (text: string) => parseProtocolBackup(text, protocol),
    seedFingerprint: (seed: Uint8Array) =>
      seedFingerprintForProtocol(seed, protocol),
    discover(
      keys: MasterKeys,
      scope: bigint,
      events: readonly PoolEvent[]
    ): DiscoveryResult {
      if (!v2) {
        if (
          events.some(
            event =>
              event.kind === "deposit" && event.recoveryNonce !== undefined
          )
        )
          throw new Error("Cannot discover v2 events with the v1 protocol");
        return discoverNotes(keys, scope, events);
      }
      if (
        events.some(
          event =>
            event.kind === "deposit" && typeof event.recoveryNonce !== "bigint"
        )
      )
        throw new Error("V2 history is missing recovery nonces");
      const discovered = discoverNotesV2(
        keys,
        scope,
        events as readonly PoolEventV2[]
      );
      return { notes: discovered.notes, nextDepositIndex: 0, conflicts: [] };
    },
    nextSecrets(keys: MasterKeys, scope: bigint, note: Note) {
      if (v2) {
        if (note.recoveryNonce === undefined)
          throw new Error("V2 note is missing its recovery nonce");
        return deriveNoteSecretsV2(
          keys,
          scope,
          note.recoveryNonce,
          note.hop + 1
        );
      }
      if (note.recoveryNonce !== undefined)
        throw new Error("Cannot spend a v2 note with the v1 protocol");
      return deriveNoteSecrets(keys, scope, note.depositIndex, note.hop + 1);
    },
    prepareDeposit(keys: MasterKeys, scope: bigint, depositIndex: number) {
      if (protocol === PROTOCOL_VERSION)
        return {
          precommitment: computePrecommitment(
            deriveNoteSecrets(keys, scope, depositIndex, 0)
          ),
          recoveryNonce: undefined,
        };
      const recoveryNonce = createRecoveryNonce();
      return {
        recoveryNonce,
        precommitment: computePrecommitment(
          deriveNoteSecretsV2(keys, scope, recoveryNonce, 0)
        ),
      };
    },
  });
}
