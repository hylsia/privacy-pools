/** Creates UNSAFE initial phase-2 challenges from a digest-pinned transcript. No release approval. */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { selectMainnetTarget } from "../mainnet-target";
import { V2_PROTOCOL } from "../../../shared/privacy/v2/notes";
import {
  assertPublicPhase1,
  hashFile,
  PUBLIC_PHASE1,
  reserveCeremonyWorkspace,
} from "./ceremony-policy";

const root = path.resolve(import.meta.dirname, "../../..");
const { args, target } = selectMainnetTarget(process.argv.slice(2));
const usage =
  "Usage: npm run zk:v2:ceremony:prepare -- --ptau <public-ptau-file> --out ceremonies/<new-session> [--network ethereum-mainnet|robinhood-mainnet]";

async function main() {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  if (
    args.length !== 4 ||
    args[0] !== "--ptau" ||
    args[2] !== "--out" ||
    !args[1] ||
    !args[3]
  )
    throw new Error(usage);
  const ptau = path.resolve(root, args[1]);
  if (!fs.statSync(ptau).isFile())
    throw new Error("Expected a local public phase-1 file.");
  // Check provenance before creating any workspace or invoking cryptographic tools.
  assertPublicPhase1(await hashFile(ptau, "blake2b512"));
  const out = reserveCeremonyWorkspace(root, args[3]);
  const relative = (file: string) =>
    path.relative(out, file).split(path.sep).join("/");
  const manifestFile = path.join(out, "manifest.json");
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    protocol: V2_PROTOCOL,
    targetChainId: target.chainId,
    status: "preparing",
    productionReady: false,
    broadcastAllowed: false,
    phase2ContributionCount: 0,
    phase1TranscriptVerified: false,
    createdAt: new Date().toISOString(),
    warning:
      "UNSAFE initial keys. Await independent contributions, finalization, and review. Never deploy or publish as proving assets.",
  };
  const save = () =>
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  save();
  let stage = "snapshot";
  try {
    const sourceRoot = path.join(out, "sources");
    fs.mkdirSync(sourceRoot);
    const sources: Record<string, { bytes: number; sha256: string }> = {};
    async function snapshot(source: string, dest: string) {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink())
        throw new Error("Source snapshots must not contain symlinks.");
      if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const name of fs.readdirSync(source).sort())
          await snapshot(path.join(source, name), path.join(dest, name));
      } else if (stat.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
        sources[relative(dest)] = {
          bytes: stat.size,
          sha256: await hashFile(dest),
        };
      } else throw new Error("Source snapshots require ordinary files.");
    }
    for (const source of [
      "circuits/v2/withdraw.circom",
      "circuits/v2/commitment.circom",
      "circuits/lib/merkleProof.circom",
      "package.json",
      "package-lock.json",
    ])
      await snapshot(path.join(root, source), path.join(sourceRoot, source));
    await snapshot(
      path.join(root, "node_modules/circomlib/circuits"),
      path.join(sourceRoot, "node_modules/circomlib/circuits")
    );
    const publicPtau = path.join(out, "phase1.ptau");
    fs.copyFileSync(ptau, publicPtau, fs.constants.COPYFILE_EXCL);
    assertPublicPhase1(await hashFile(publicPtau, "blake2b512"));
    manifest.phase1 = {
      ...PUBLIC_PHASE1,
      path: "phase1.ptau",
      bytes: fs.statSync(publicPtau).size,
      sha256: await hashFile(publicPtau),
      integrity: "matches-published-digest",
      fullTranscriptVerification: "pending",
    };
    manifest.sources = sources;
    manifest.repository = {
      head: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      dirty: !!execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      reviewedRelease: false,
    };
    const tool = (name: string) => path.join(root, "node_modules", name);
    manifest.toolchain = {
      node: process.version,
      circom2: JSON.parse(fs.readFileSync(tool("circom2/package.json"), "utf8"))
        .version,
      snarkjs: JSON.parse(fs.readFileSync(tool("snarkjs/package.json"), "utf8"))
        .version,
      circomlib: JSON.parse(
        fs.readFileSync(tool("circomlib/package.json"), "utf8")
      ).version,
      circomWasmSha256: await hashFile(tool("circom2/circom.wasm")),
      snarkjsCliSha256: await hashFile(tool("snarkjs/build/cli.cjs")),
      optimization: "O1",
    };
    save();
    const logs = path.join(out, "logs");
    fs.mkdirSync(logs);
    const logFiles: string[] = [];
    async function run(name: string, argv: string[]) {
      stage = name;
      console.log(`Ceremony preparation: ${name}`);
      const log = path.join(logs, `${name}.log`);
      logFiles.push(log);
      const fd = fs.openSync(log, "wx");
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, argv, {
            cwd: sourceRoot,
            stdio: ["ignore", fd, fd],
            // Setup tools do not need application environment or any signer/service secret.
            env: { PATH: process.env.PATH ?? "" },
          });
          child.once("error", reject);
          child.once("close", code =>
            code === 0
              ? resolve()
              : reject(
                  new Error(`Stage ${name} failed; inspect its local log.`)
                )
          );
        });
      } finally {
        fs.closeSync(fd);
      }
    }
    const cli = tool("snarkjs/build/cli.cjs");
    // Full transcript verification is a separate, potentially long-running command.
    // Hash provenance is sufficient for preparing UNSAFE initial challenges, never for release approval.
    const circuits: Record<string, unknown> = {};
    for (const [name, publicSignals] of [
      ["withdraw", 6],
      ["commitment", 4],
    ] as const) {
      const build = path.join(out, name);
      fs.mkdirSync(build);
      await run(`${name}-compile`, [
        tool("circom2/cli.js"),
        path.join(sourceRoot, `circuits/v2/${name}.circom`),
        "--r1cs",
        "--wasm",
        "--sym",
        "--O1",
        "-o",
        build,
        "-l",
        path.join(sourceRoot, "node_modules"),
      ]);
      const r1cs = path.join(build, `${name}.r1cs`);
      const initial = path.join(build, `${name}_0000.zkey`);
      const challenge = path.join(build, `${name}_0000.mpcparams`);
      await run(`${name}-setup`, [
        cli,
        "groth16",
        "setup",
        r1cs,
        publicPtau,
        initial,
      ]);
      await run(`${name}-initial-verify`, [
        cli,
        "zkey",
        "verify",
        r1cs,
        publicPtau,
        initial,
      ]);
      await run(`${name}-challenge-export`, [
        cli,
        "zkey",
        "export",
        "bellman",
        initial,
        challenge,
      ]);
      const files: Record<string, unknown> = {};
      for (const file of [
        r1cs,
        initial,
        challenge,
        path.join(build, `${name}_js/${name}.wasm`),
        path.join(build, `${name}_js/generate_witness.js`),
        path.join(build, `${name}_js/witness_calculator.js`),
        path.join(build, `${name}.sym`),
      ])
        files[relative(file)] = {
          bytes: fs.statSync(file).size,
          sha256: await hashFile(file),
        };
      circuits[name] = { publicSignals, phase2ContributionCount: 0, files };
    }
    manifest.circuits = circuits;
    manifest.logs = Object.fromEntries(
      await Promise.all(
        logFiles.map(async file => [relative(file), await hashFile(file)])
      )
    );
    manifest.status =
      "awaiting-phase1-verification-and-independent-contributions";
    save();
    console.log(
      `Prepared ${path.relative(root, out)}/manifest.json. UNSAFE: phase-1 verification pending and zero phase-2 contributions; mainnet remains blocked.`
    );
  } catch (error) {
    manifest.status = "failed";
    manifest.failedStage = stage;
    save();
    throw error;
  }
}

main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "Ceremony preparation failed."
  );
  process.exitCode = 1;
});
