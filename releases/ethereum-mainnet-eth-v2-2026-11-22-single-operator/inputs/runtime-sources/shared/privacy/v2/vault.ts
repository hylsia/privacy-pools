/** Protocol v2 vault API. Backup envelope version 2 is distinct from the protocol's version. */
import type { BackupFile, BackupFileV2 } from "../types";
import {
  decryptProtocolSeed,
  encryptProtocolSeed,
  parseProtocolBackup,
  PBKDF2_ITERATIONS,
  seedFingerprintForProtocol,
} from "../vault";
import { V2_PROTOCOL } from "../protocols";

export { generateSeed, PBKDF2_ITERATIONS, VaultError } from "../vault";

export const seedFingerprint = (seed: Uint8Array): string =>
  seedFingerprintForProtocol(seed, V2_PROTOCOL);

export function encryptSeed(
  seed: Uint8Array,
  password: string,
  iterations = PBKDF2_ITERATIONS
): Promise<BackupFileV2> {
  return encryptProtocolSeed(seed, password, V2_PROTOCOL, iterations);
}

export function parseBackup(text: string): BackupFileV2 {
  return parseProtocolBackup(text, V2_PROTOCOL) as BackupFileV2;
}

export function decryptSeed(
  backup: BackupFile,
  password: string
): Promise<Uint8Array> {
  return decryptProtocolSeed(backup, password, V2_PROTOCOL);
}
