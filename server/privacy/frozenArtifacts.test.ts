import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = path.resolve(import.meta.dirname, "../..");
const script = path.join(repo, "scripts/privacy/check-frozen-artifacts.ts");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const publicFile = "client/public/zk/example.zkey";
const localFile = "circuits/build/example.r1cs";
const contents = "frozen test artifact";
let root: string;

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, env: { PATH: process.env.PATH }, stdio: "pipe" });
}
function check(...args: string[]) {
  return spawnSync(process.execPath, ["--import", loader, script, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH },
    encoding: "utf8",
    timeout: 10_000,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-freeze-check-"));
  git("init", "--quiet");
  const digest = createHash("sha256").update(contents).digest("hex");
  write("docs/security/frozen-artifacts.json", JSON.stringify({ [publicFile]: digest, [localFile]: digest }));
  write(publicFile, contents);
  git("add", "--", publicFile);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("fresh-clone frozen artifact verification", () => {
  it("omits only known untracked local files, while the default still requires them", () => {
    const fresh = check("--tracked-only");
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stdout).toContain("1 tracked frozen files unchanged");
    const full = check();
    expect(full.status).toBe(1);
    expect(full.stderr).toContain(localFile);
  });

  it.each(["modified", "deleted"])("fails when a public frozen file is %s", change => {
    if (change === "modified") write(publicFile, "changed");
    else {
      git("rm", "--cached", "--", publicFile);
      fs.rmSync(path.join(root, publicFile));
    }
    const result = check("--tracked-only");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(publicFile);
  });

  it("checks a local build artifact if it is tracked", () => {
    write(localFile, "changed");
    git("add", "--", localFile);
    const result = check("--tracked-only");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(localFile);
  });

  it("retains the complete-workspace verification when all files exist", () => {
    write(localFile, contents);
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 frozen files unchanged");
  });

  it("rejects unknown scope flags", () => {
    const result = check("--skip-missing");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });
});
