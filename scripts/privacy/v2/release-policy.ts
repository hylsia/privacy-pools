/** Content binding for native ETH release packages. Integrity never implies independent review. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";
import {
  isMainnetChainId,
  type MainnetChainId,
} from "../../../shared/privacy/mainnetTargets";

export const CIRCUITS = ["withdraw", "commitment"] as const;
export const SHA256 = /^[0-9a-f]{64}$/;
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
};
export const contentId = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export interface ReleaseFile {
  sha256: string;
  bytes: number;
}
export interface CeremonyContribution {
  type: number;
  transcript: string;
  name?: string;
  beaconHash?: string;
  numIterationsExp?: number;
}

export function checkContributionChain(
  contributions: readonly CeremonyContribution[]
) {
  // Names and a count cannot establish independent participants; that remains a release-review requirement.
  if (
    contributions.length < 3 ||
    contributions.slice(0, -1).filter(c => c.type === 0).length < 2
  )
    throw new Error(
      "Production-target keys require at least two phase-2 contributions followed by a final beacon"
    );
  const final = contributions.at(-1)!;
  if (
    final.type !== 1 ||
    !/^[0-9a-f]{64,}$/.test(final.beaconHash ?? "") ||
    !Number.isSafeInteger(final.numIterationsExp) ||
    final.numIterationsExp! < 10
  )
    throw new Error("Missing final phase-2 beacon");
  if (
    contributions.some(c => !/^[0-9a-f]{128}$/.test(c.transcript)) ||
    new Set(contributions.map(c => c.transcript)).size !== contributions.length
  )
    throw new Error("Malformed or repeated phase-2 contribution transcript");
}

export function safeFile(base: string, relative: string) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").some(p => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe release file path");
  let current = path.resolve(base);
  if (fs.lstatSync(current).isSymbolicLink())
    throw new Error("Symlinked release directory");
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error("Symlinked release file");
  }
  if (!fs.statSync(current).isFile())
    throw new Error("Release entry must be a regular file");
  return current;
}

export function reserveReleaseDirectory(root: string, requested: string) {
  const base = path.join(root, "releases");
  const out = path.resolve(root, requested);
  const relative = path.relative(base, out);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("New release packages must stay under releases/");
  let current = base;
  for (const part of ["", ...relative.split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Release output cannot traverse symlinks");
      if (current === out) throw new Error("Release output already exists");
    } else fs.mkdirSync(current);
  }
  return out;
}

export interface ReleasePackage {
  schemaVersion: 1;
  protocol: typeof V2_ETH_PROTOCOL;
  releaseId: string;
  status: "ceremony-verified";
  productionReady: false;
  reviewedRelease: false;
  identity: {
    protocol: typeof V2_ETH_PROTOCOL;
    targetChainId: MainnetChainId;
    asset: "native-ETH";
    files: Record<string, ReleaseFile>;
    ceremony: Record<string, unknown>;
  };
  artifactManifestSha256: string;
}

export function assertReleasePackage(
  raw: unknown
): asserts raw is ReleasePackage {
  const r = raw as ReleasePackage;
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.protocol !== V2_ETH_PROTOCOL ||
    r.status !== "ceremony-verified" ||
    r.productionReady !== false ||
    r.reviewedRelease !== false ||
    !SHA256.test(r.releaseId) ||
    !SHA256.test(r.artifactManifestSha256) ||
    r.identity?.protocol !== V2_ETH_PROTOCOL ||
    !isMainnetChainId(r.identity.targetChainId) ||
    r.identity.asset !== "native-ETH" ||
    !r.identity.files ||
    !r.identity.ceremony ||
    contentId(r.identity) !== r.releaseId
  )
    throw new Error("Invalid or incomplete native ETH release package");
  for (const entry of Object.values(r.identity.files))
    if (
      !entry ||
      !SHA256.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1
    )
      throw new Error("Invalid release file digest or length");
  for (const name of CIRCUITS)
    for (const kind of ["wasm", "zkey", "vkey.json"])
      if (!r.identity.files[`artifacts/${name}.${kind}`])
        throw new Error("Incomplete release proving artifacts");
  for (const file of [
    "solidity/foundry.toml",
    "solidity/script/DeployV2ETH.s.sol",
    "solidity/src/v2/PrivacyPoolV2ETH.sol",
    "solidity/src/verifiers/WithdrawVerifierV2ETH.sol",
    "solidity/src/verifiers/CommitmentVerifierV2ETH.sol",
  ])
    if (!r.identity.files[file])
      throw new Error("Incomplete release deployment sources");
}
