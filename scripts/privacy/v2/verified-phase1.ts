/** Reuse only the exact public transcript and complete verification evidence already produced locally. */
import fs from "node:fs";
import path from "node:path";
import { hashFile, assertPublicPhase1 } from "./ceremony-policy";

export const VERIFIED_PHASE1 = Object.freeze({
  receipt: "docs/security/mainnet-phase1-verification.json",
  receiptSha256:
    "049f9185d56ec68a92fa59bd2cec45ecc37e2784b955c72c6292f58c5e8b6c7d",
  transcriptSha256:
    "1c401abb57c9ce531370f3015c3e75c0892e0f32b8b1e94ace0f6682d9695922",
  cliSha256: "6d787e37a4d1a2c6dd6032dadca09c0b3b007d4d4578bb6232a98136555d051a",
  logSha256: "e0a7deea27e2c6a7c872aec2895c0a27063fc6480062c8505bd3fd66554ce191",
});

export function assertVerifiedPhase1Hashes(hashes: {
  receiptSha256: string;
  transcriptSha256: string;
  cliSha256: string;
  logSha256: string;
}) {
  for (const key of [
    "receiptSha256",
    "transcriptSha256",
    "cliSha256",
    "logSha256",
  ] as const)
    if (hashes[key] !== VERIFIED_PHASE1[key])
      throw new Error("Previously verified phase-1 evidence mismatch: " + key);
}

export async function verifiedPhase1Evidence(root: string, transcript: string) {
  const receiptPath = path.join(root, VERIFIED_PHASE1.receipt);
  const receiptSha256 = await hashFile(receiptPath);
  if (receiptSha256 !== VERIFIED_PHASE1.receiptSha256)
    throw new Error("Previously verified phase-1 receipt changed");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const logPath = path.join(root, receipt.log.path);
  const hashes = {
    receiptSha256,
    transcriptSha256: await hashFile(transcript),
    cliSha256: await hashFile(
      path.join(root, "node_modules/snarkjs/build/cli.cjs")
    ),
    logSha256: await hashFile(logPath),
  };
  assertVerifiedPhase1Hashes(hashes);
  assertPublicPhase1(await hashFile(transcript, "blake2b512"));
  if (
    receipt.exitCode !== 0 ||
    receipt.phase1TranscriptVerified !== true ||
    !fs
      .readFileSync(logPath, "utf8")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .includes("Powers of Tau Ok!")
  )
    throw new Error("Full phase-1 verification success is missing");
  return { receiptPath, logPath, hashes };
}
