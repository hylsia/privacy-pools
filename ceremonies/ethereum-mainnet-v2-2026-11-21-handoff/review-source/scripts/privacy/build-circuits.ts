/**
 * Build the Privacy Pool circuits end-to-end:
 *   1. compile .circom → r1cs + wasm (circom2, WASM build of the circom compiler)
 *   2. fetch the Hermez powers-of-tau (2^16) or generate a local one as fallback
 *   3. groth16 setup + one development contribution → final zkey
 *   4. export verification keys and Solidity verifiers (→ contracts/src/verifiers)
 *   5. copy wasm/zkey/vkey into client/public/zk with a sha256 manifest
 *
 * Usage: npx tsx scripts/privacy/build-circuits.ts [--skip-compile] [--no-verify] [--force]
 *
 * DEV-ONLY TRUSTED SETUP: the phase-2 contribution here is a single local
 * contribution. It is fine for testnet, NOT for real value (see docs).
 *
 * EVERY RUN MAKES A NEW RANDOM SETUP (the contribution entropy in setup(), and the
 * local ptau fallback), so the verifiers and the served proving keys change
 * together. A pool deployed with the old verifiers then rejects every proof made
 * from the new artifacts. While a public network (Robinhood Chain Testnet: its
 * pool is live) has a deployment record, this script refuses to run unless
 * --force, which is only for a pool that is retired. It is never a routine step.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { networkById } from "../../shared/privacy/networks";
import { publicRecordIds } from "./deploymentRecords";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const BUILD_DIR = path.join(CIRCUITS_DIR, "build");
const PTAU_DIR = path.join(CIRCUITS_DIR, "ptau");
const CLIENT_ZK_DIR = path.join(ROOT, "client", "public", "zk");
const VERIFIER_DIR = path.join(ROOT, "contracts", "src", "verifiers");

const PTAU_POWER = 16;
const PTAU_FILE = path.join(PTAU_DIR, `powersOfTau28_hez_final_${PTAU_POWER}.ptau`);
const PTAU_URL = `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau`;

const SNARKJS = path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");
const CIRCOM = path.join(ROOT, "node_modules", "circom2", "cli.js");

const CIRCUITS = [
  { name: "withdraw", verifier: "WithdrawVerifier" },
  { name: "commitment", verifier: "CommitmentVerifier" },
] as const;

const args = new Set(process.argv.slice(2));
const skipCompile = args.has("--skip-compile");
const verify = !args.has("--no-verify");
const force = args.has("--force");

/**
 * A new setup replaces contracts/src/verifiers and client/public/zk together. A pool already deployed keeps the old
 * verifiers and would reject every proof from the new artifacts, so refuse while a public network has a record
 * (contracts/deployments/<id>.json, or the generated shared/privacy/deployments.ts), unless --force.
 */
function refuseWhileDeployed() {
  const dir = path.join(ROOT, "contracts", "deployments");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const ids = publicRecordIds(files, Object.keys(DEPLOYMENTS).map(Number));
  if (ids.length === 0) return;
  const names = ids.map((id) => `${networkById(id)?.name ?? "chain"} (${id})`).join(" and ");
  if (force) {
    console.warn(`--force: replacing the verifiers and proving keys although ${names} ${ids.length === 1 ? "has" : "have"} a deployment record`);
    return;
  }
  console.error(
    `build-circuits: refusing to overwrite contracts/src/verifiers and client/public/zk: ${names} ${ids.length === 1 ? "has a pool" : "have pools"} deployed with the current verifiers, and a new setup would make ${ids.length === 1 ? "it" : "them"} reject every proof from the served artifacts. Pass --force only when those pools are retired.`,
  );
  process.exit(1);
}

function run(cmd: string, cmdArgs: string[]) {
  console.log(`\n$ ${path.basename(cmd)} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT, maxBuffer: 1 << 28 });
}
const snarkjs = (...a: string[]) => run("node", [SNARKJS, ...a]);

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(url: string, dest: string) {
  console.log(`\nDownloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

async function ensurePtau() {
  fs.mkdirSync(PTAU_DIR, { recursive: true });
  if (fs.existsSync(PTAU_FILE)) {
    console.log(`ptau present: ${PTAU_FILE}`);
    return;
  }
  try {
    await download(PTAU_URL, PTAU_FILE);
    return;
  } catch (err) {
    console.warn(`ptau download failed (${(err as Error).message}); generating a local one instead`);
  }
  const p0 = path.join(PTAU_DIR, `pot${PTAU_POWER}_0000.ptau`);
  const p1 = path.join(PTAU_DIR, `pot${PTAU_POWER}_0001.ptau`);
  snarkjs("powersoftau", "new", "bn128", String(PTAU_POWER), p0, "-v");
  snarkjs("powersoftau", "contribute", p0, p1, "--name=hylsia-local", `-e=${randomBytes(32).toString("hex")}`);
  snarkjs("powersoftau", "prepare", "phase2", p1, PTAU_FILE, "-v");
}

function compile(name: string) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  run("node", [CIRCOM, path.join(CIRCUITS_DIR, `${name}.circom`), "--r1cs", "--wasm", "--sym", "-o", BUILD_DIR, "-l", "node_modules"]);
}

function setup(name: string) {
  const r1cs = path.join(BUILD_DIR, `${name}.r1cs`);
  const z0 = path.join(BUILD_DIR, `${name}_0000.zkey`);
  const zFinal = path.join(BUILD_DIR, `${name}_final.zkey`);
  const vkey = path.join(BUILD_DIR, `${name}_verification_key.json`);
  snarkjs("r1cs", "info", r1cs);
  snarkjs("groth16", "setup", r1cs, PTAU_FILE, z0);
  snarkjs("zkey", "contribute", z0, zFinal, "--name=hylsia-dev-contribution-1", `-e=${randomBytes(32).toString("hex")}`);
  if (verify) snarkjs("zkey", "verify", r1cs, PTAU_FILE, zFinal);
  snarkjs("zkey", "export", "verificationkey", zFinal, vkey);
  fs.rmSync(z0, { force: true });
  return { zFinal, vkey };
}

function exportVerifier(name: string, contractName: string, zFinal: string) {
  fs.mkdirSync(VERIFIER_DIR, { recursive: true });
  const tmp = path.join(BUILD_DIR, `${name}_verifier.sol`);
  snarkjs("zkey", "export", "solidityverifier", zFinal, tmp);
  let src = fs.readFileSync(tmp, "utf8");
  src = src.replace(/contract Groth16Verifier/g, `contract ${contractName}`);
  src = src.replace(/pragma solidity [^;]+;/, "pragma solidity >=0.7.0 <0.9.0;");
  src = `// AUTO-GENERATED by scripts/privacy/build-circuits.ts from circuits/${name}.circom — do not edit.\n${src}`;
  fs.writeFileSync(path.join(VERIFIER_DIR, `${contractName}.sol`), src);
}

function publish(name: string, zFinal: string, vkey: string) {
  fs.mkdirSync(CLIENT_ZK_DIR, { recursive: true });
  const wasmSrc = path.join(BUILD_DIR, `${name}_js`, `${name}.wasm`);
  const files = {
    wasm: { src: wasmSrc, dest: `${name}.wasm` },
    zkey: { src: zFinal, dest: `${name}.zkey` },
    vkey: { src: vkey, dest: `${name}.vkey.json` },
  };
  const entry: Record<string, { path: string; sha256: string; bytes: number }> = {};
  for (const [kind, f] of Object.entries(files)) {
    const dest = path.join(CLIENT_ZK_DIR, f.dest);
    fs.copyFileSync(f.src, dest);
    entry[kind] = { path: f.dest, sha256: sha256(dest), bytes: fs.statSync(dest).size };
  }
  const vk = JSON.parse(fs.readFileSync(vkey, "utf8")) as { nPublic: number };
  return { ...entry, nPublic: vk.nPublic };
}

async function main() {
  refuseWhileDeployed();
  const started = Date.now();
  if (!skipCompile) for (const c of CIRCUITS) compile(c.name);
  await ensurePtau();

  const manifest: Record<string, unknown> = {
    protocol: "hylsia-pp-v1",
    builtAt: new Date().toISOString(),
    ptau: { file: path.basename(PTAU_FILE), sha256: sha256(PTAU_FILE) },
    circuits: {} as Record<string, unknown>,
  };
  for (const c of CIRCUITS) {
    const { zFinal, vkey } = setup(c.name);
    exportVerifier(c.name, c.verifier, zFinal);
    (manifest.circuits as Record<string, unknown>)[c.name] = publish(c.name, zFinal, vkey);
  }
  fs.writeFileSync(path.join(CLIENT_ZK_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
