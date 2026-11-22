/** Verify the Phase 6 freeze. Does not rebuild, sync, publish or write any artifact. */
import fs from "node:fs";
import { createHash } from "node:crypto";
const baseline: Record<string, string> = JSON.parse(
  fs.readFileSync("docs/security/frozen-artifacts.json", "utf8")
);
const changed = Object.entries(baseline)
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
    `${Object.keys(baseline).length} frozen files unchanged (SHA-256).`
  );
