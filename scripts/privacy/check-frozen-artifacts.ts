/** Verify the Phase 6 freeze. Does not rebuild, sync, publish or write any artifact. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--tracked-only") || args.length > 1)
  throw new Error("Usage: check-frozen-artifacts.ts [--tracked-only]");
const trackedOnly = args.includes("--tracked-only");
const baseline: Record<string, string> = JSON.parse(
  fs.readFileSync("docs/security/frozen-artifacts.json", "utf8")
);
const entries = Object.entries(baseline);
// Fresh clones omit historical local builds, transcripts and the Anvil deployment.
// Default invocation still checks every entry, including those local-only files.
const tracked = trackedOnly
  ? new Set(execFileSync("git", ["ls-files", "-z", "--", ...Object.keys(baseline)], { encoding: "utf8" }).split("\0").filter(Boolean))
  : null;
const localOnly = (path: string) =>
  path.startsWith("circuits/build/") ||
  path.startsWith("circuits/ptau/") ||
  path === "contracts/deployments/31337.json";
// Removing a public file from Git must not silently remove it from verification.
const selected = entries.filter(([path]) => !tracked || tracked.has(path) || !localOnly(path));
if (selected.length === 0) throw new Error("No frozen artifacts selected");
const changed = selected
  .filter(
    ([path, hash]) =>
      !fs.existsSync(path) ||
      createHash("sha256").update(fs.readFileSync(path)).digest("hex") !== hash
  )
  .map(([path]) => path);
if (changed.length) {
  console.error("Frozen artifacts changed:", changed);
  process.exitCode = 1;
} else
  console.log(
    trackedOnly
      ? `${selected.length} tracked frozen files unchanged (SHA-256); ${entries.length - selected.length} local-only entries excluded.`
      : `${entries.length} frozen files unchanged (SHA-256).`
  );
