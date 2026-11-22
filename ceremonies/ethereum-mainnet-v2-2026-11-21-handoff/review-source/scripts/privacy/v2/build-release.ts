import { writeSolidityProject } from "./solidity-project";
/** Prepare a content-bound native ETH package for independent release review. Never approves or publishes it. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";
import { assertPublicPhase1, hashFile, PUBLIC_PHASE1 } from "./ceremony-policy";
import { readContributions } from "./read-contributions";
import {
  checkContributionChain,
  CIRCUITS,
  contentId,
  reserveReleaseDirectory,
  safeFile,
  type ReleaseFile,
} from "./release-policy";
import { listFiles, verifyReleaseDirectory } from "./release-files";
import { resolveReleaseInputs } from "./release-inputs";
import { selectMainnetTarget } from "../mainnet-target";
import { isMainnetChainId } from "../../../shared/privacy/mainnetTargets";

const root = path.resolve(import.meta.dirname, "../../..");
const usage =
  "npm run zk:v2:release:build -- --ceremony <workspace> --withdraw-zkey <final.zkey> --commitment-zkey <final.zkey> --out releases/<new-session> [--network ethereum-mainnet|robinhood-mainnet]";
async function main() {
  const { args, target } = selectMainnetTarget(process.argv.slice(2));
  if (args.length === 1 && args[0] === "--help") return console.log(usage);
  if (
    args.length !== 8 ||
    args[0] !== "--ceremony" ||
    args[2] !== "--withdraw-zkey" ||
    args[4] !== "--commitment-zkey" ||
    args[6] !== "--out"
  )
    throw new Error(usage);
  const { ceremony, finals } = resolveReleaseInputs(
    root,
    args[1],
    args[3],
    args[5]
  );
  const setup = JSON.parse(
    fs.readFileSync(path.join(ceremony, "manifest.json"), "utf8")
  );
  if (
    setup.schemaVersion !== 1 ||
    !isMainnetChainId(setup.targetChainId) ||
    !setup.circuits ||
    !setup.sources ||
    !setup.phase1
  )
    throw new Error("Incomplete ceremony workspace");
  const transcripts: Record<string, unknown> = {};
  // Fail fast for initial keys and development keys, before creating an output or doing a long phase-1 verification.
  for (const name of CIRCUITS) {
    const summary = await readContributions(finals[name]);
    checkContributionChain(summary.contributions);
    if (summary.nPublic !== (name === "withdraw" ? 6 : 4))
      throw new Error("Incorrect final-key public signals");
    transcripts[name] = summary;
  }
  for (const [file, expected] of Object.entries({
    ...setup.sources,
    ...Object.assign({}, ...CIRCUITS.map(name => setup.circuits[name].files)),
    [setup.phase1.path]: setup.phase1,
  }) as [string, any][]) {
    const local = safeFile(ceremony, file);
    if (
      fs.statSync(local).size !== expected.bytes ||
      (await hashFile(local)) !== expected.sha256
    )
      throw new Error("Ceremony workspace integrity mismatch: " + file);
  }
  const ptau = safeFile(ceremony, setup.phase1.path);
  assertPublicPhase1(await hashFile(ptau, "blake2b512"));
  for (const file of [
    "circuits/v2/withdraw.circom",
    "circuits/v2/commitment.circom",
    "circuits/lib/merkleProof.circom",
  ])
    if (
      (await hashFile(path.join(root, file))) !==
      setup.sources["sources/" + file]?.sha256
    )
      throw new Error("Current circuit source differs from ceremony snapshot");
  if (
    (await hashFile(path.join(root, "node_modules/circom2/circom.wasm"))) !==
    setup.toolchain?.circomWasmSha256
  )
    throw new Error("Ceremony compiler differs from installed compiler");
  const out = reserveReleaseDirectory(root, args[7]);
  const progress = path.join(out, "preparation.json");
  const marker = (status: string) =>
    fs.writeFileSync(
      progress,
      JSON.stringify(
        {
          protocol: V2_ETH_PROTOCOL,
          status,
          productionReady: false,
          reviewedRelease: false,
        },
        null,
        2
      ) + "\n"
    );
  marker("building");
  try {
    fs.mkdirSync(path.join(out, "logs"));
    const snark = path.join(root, "node_modules/snarkjs/build/cli.cjs");
    function run(
      stage: string,
      executable: string,
      argv: string[],
      cwd = root
    ) {
      console.log("Release preparation: " + stage);
      const fd = fs.openSync(path.join(out, "logs", stage + ".log"), "wx");
      try {
        execFileSync(executable, argv, {
          cwd,
          stdio: ["ignore", fd, fd],
          env: { PATH: process.env.PATH ?? "" },
        });
      } finally {
        fs.closeSync(fd);
      }
    }
    // Always verify the copied public transcript cryptographically; a user-edited JSON flag is not evidence.
    const inputs = path.join(out, "inputs");
    fs.mkdirSync(inputs);
    fs.copyFileSync(ptau, path.join(inputs, "phase1.ptau"));
    assertPublicPhase1(
      await hashFile(path.join(inputs, "phase1.ptau"), "blake2b512")
    );
    run("phase1-verify", process.execPath, [
      snark,
      "powersoftau",
      "verify",
      path.join(inputs, "phase1.ptau"),
      "-v",
    ]);
    fs.cpSync(path.join(ceremony, "sources"), path.join(inputs, "sources"), {
      recursive: true,
      dereference: false,
    });
    fs.writeFileSync(
      path.join(inputs, "toolchain.json"),
      JSON.stringify(
        {
          node: process.version,
          snarkjs: JSON.parse(
            fs.readFileSync(
              path.join(root, "node_modules/snarkjs/package.json"),
              "utf8"
            )
          ).version,
          snarkjsCliSha256: await hashFile(snark),
          circomWasmSha256: await hashFile(
            path.join(root, "node_modules/circom2/circom.wasm")
          ),
          forge: execFileSync("forge", ["--version"], {
            encoding: "utf8",
          }).trim(),
          solc: "0.8.28",
          optimizationRuns: 200,
          evmVersion: "shanghai",
          reviewedRelease: false,
        },
        null,
        2
      ) + "\n"
    );
    for (const directory of [
      "shared/privacy",
      "client/src/privacy",
      "server/privacy",
    ]) {
      const inventory = await listFiles(root, directory);
      for (const file of Object.keys(inventory)) {
        if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
        if (
          file.endsWith(".test.ts") ||
          file.endsWith(".spec.ts") ||
          file === "shared/privacy/deployments.ts"
        )
          continue;
        const target = path.join(inputs, "runtime-sources", file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(
          path.join(root, file),
          target,
          fs.constants.COPYFILE_EXCL
        );
      }
    }
    const artifacts = path.join(out, "artifacts");
    fs.mkdirSync(artifacts);
    const copy = (source: string, relative: string) => {
      const dest = path.join(out, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
    };
    for (const name of CIRCUITS) {
      const build = path.join(inputs, name);
      fs.mkdirSync(build);
      run(name + "-compile", process.execPath, [
        path.join(root, "node_modules/circom2/cli.js"),
        path.join(inputs, `sources/circuits/v2/${name}.circom`),
        "--r1cs",
        "--wasm",
        "--O1",
        "-o",
        build,
        "-l",
        path.join(inputs, "sources/node_modules"),
      ]);
      const r1cs = path.join(build, name + ".r1cs");
      if (
        (await hashFile(r1cs)) !==
        setup.circuits[name].files[`${name}/${name}.r1cs`]?.sha256
      )
        throw new Error("Recompiled R1CS differs from ceremony");
      copy(finals[name], `artifacts/${name}.zkey`);
      const key = path.join(artifacts, name + ".zkey");
      const summary = await readContributions(key);
      checkContributionChain(summary.contributions);
      if (contentId(summary) !== contentId(transcripts[name]))
        throw new Error("Final key changed while preparing release");
      run(name + "-verify", process.execPath, [
        snark,
        "zkey",
        "verify",
        r1cs,
        path.join(inputs, "phase1.ptau"),
        key,
      ]);
      run(name + "-vkey", process.execPath, [
        snark,
        "zkey",
        "export",
        "verificationkey",
        key,
        path.join(artifacts, name + ".vkey.json"),
      ]);
      const contract =
        name === "withdraw"
          ? "WithdrawVerifierV2ETH"
          : "CommitmentVerifierV2ETH";
      const generated = path.join(inputs, contract + ".sol");
      run(name + "-verifier", process.execPath, [
        snark,
        "zkey",
        "export",
        "solidityverifier",
        key,
        generated,
      ]);
      const source = fs.readFileSync(generated, "utf8");
      if ((source.match(/contract Groth16Verifier/g) ?? []).length !== 1)
        throw new Error("Unexpected generated verifier contract");
      const target = path.join(out, `solidity/src/verifiers/${contract}.sol`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        source.replace("contract Groth16Verifier", "contract " + contract)
      );
      copy(
        path.join(build, `${name}_js/${name}.wasm`),
        `artifacts/${name}.wasm`
      );
    }
    writeSolidityProject(root, path.join(out, "solidity"));
    run(
      "contracts-build",
      "forge",
      ["build", "--root", path.join(out, "solidity")],
      path.join(out, "solidity")
    );
    const files: Record<string, ReleaseFile> = {
      ...(await listFiles(out, "artifacts")),
      ...(await listFiles(out, "inputs")),
      ...(await listFiles(out, "logs")),
      ...(await listFiles(out, "solidity/src")),
      ...(await listFiles(out, "solidity/script")),
      ...(await listFiles(out, "solidity/lib")),
      "solidity/foundry.toml": {
        bytes: fs.statSync(path.join(out, "solidity/foundry.toml")).size,
        sha256: await hashFile(path.join(out, "solidity/foundry.toml")),
      },
    };
    const identity = {
      protocol: V2_ETH_PROTOCOL,
      targetChainId: target.chainId,
      asset: "native-ETH",
      files,
      ceremony: {
        phase1Blake2b512: PUBLIC_PHASE1.blake2b512,
        phase1Verified: true,
        transcripts,
        independenceReviewed: false,
      },
    };
    const releaseId = contentId(identity);
    const circuits = Object.fromEntries(
      CIRCUITS.map(name => [
        name,
        {
          nPublic: name === "withdraw" ? 6 : 4,
          ...Object.fromEntries(
            ["wasm", "zkey", "vkey"].map(kind => {
              const filename = `${name}.${kind === "vkey" ? "vkey.json" : kind}`;
              return [
                kind,
                { path: filename, ...files["artifacts/" + filename] },
              ];
            })
          ),
        },
      ])
    );
    fs.writeFileSync(
      path.join(artifacts, "manifest.json"),
      JSON.stringify(
        {
          protocol: V2_ETH_PROTOCOL,
          releaseId,
          builtAt: new Date().toISOString(),
          status: "ceremony-verified",
          productionReady: false,
          circuits,
        },
        null,
        2
      ) + "\n"
    );
    const release = {
      schemaVersion: 1,
      protocol: V2_ETH_PROTOCOL,
      releaseId,
      status: "ceremony-verified",
      productionReady: false,
      reviewedRelease: false,
      identity,
      artifactManifestSha256: await hashFile(
        path.join(artifacts, "manifest.json")
      ),
    };
    fs.writeFileSync(
      path.join(out, "release.json"),
      JSON.stringify(release, null, 2) + "\n"
    );
    await verifyReleaseDirectory(out);
    marker("prepared-for-independent-review");
    console.log(
      `Prepared ${releaseId}. Ceremony consistency verified; independent review and mainnet approval remain outstanding. No assets published.`
    );
  } catch (error) {
    marker("failed");
    throw error;
  }
}
main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "Release preparation failed"
  );
  process.exitCode = 1;
});
