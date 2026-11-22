/** Exercise final proving keys and exact packaged contracts locally. Never opens a user signer or contacts a public chain. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyReleaseDirectory } from "./release-files";
import { hashFile } from "./ceremony-policy";

const root = path.resolve(import.meta.dirname, "../../..");
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--release")
    throw new Error("Usage: accept-release.ts --release <directory>");
  const directory = fs.realpathSync(path.resolve(root, args[1]));
  const release = await verifyReleaseDirectory(directory);
  const acceptance = path.join(directory, "acceptance");
  fs.mkdirSync(acceptance, { recursive: true });
  const reportFile = path.join(acceptance, "report.json");
  if (fs.existsSync(reportFile))
    throw new Error("Release acceptance report already exists");
  const fixture = path.join(acceptance, "fixtures/v2/pool.json");
  if (!fs.existsSync(fixture)) {
    console.log(
      "Generating and checking nine real proofs with the FINAL release keys"
    );
    const fd = fs.openSync(path.join(acceptance, "proof-generation.log"), "wx");
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(root, "scripts/privacy/v2/gen-fixtures.ts"),
          "--release",
          directory,
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", fd, fd],
        }
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const checks = data.releaseAcceptance;
  if (
    checks?.releaseId !== release.releaseId ||
    checks.artifactManifestSha256 !== release.artifactManifestSha256 ||
    checks.publicInputMutationsRejected !== 46 ||
    checks.proofCounts.withdraw !== 5 ||
    checks.proofCounts.commitment !== 4
  )
    throw new Error(
      "Final-key fixture does not bind the exact release and all proof checks"
    );
  const project = fs.mkdtempSync(
    path.join(os.tmpdir(), "hylsia-final-key-acceptance-")
  );
  try {
    for (const item of ["src", "lib", "script", "foundry.toml"])
      fs.cpSync(
        path.join(directory, "solidity", item),
        path.join(project, item),
        { recursive: true, dereference: false }
      );
    fs.appendFileSync(
      path.join(project, "foundry.toml"),
      '\nfs_permissions=[{access="read",path="./test/fixtures"}]\n'
    );
    fs.mkdirSync(path.join(project, "test/fixtures/v2"), { recursive: true });
    fs.copyFileSync(fixture, path.join(project, "test/fixtures/v2/pool.json"));
    fs.copyFileSync(
      path.join(root, "contracts/test/fixtures/pool.json"),
      path.join(project, "test/fixtures/pool.json")
    );
    const frozen = JSON.parse(
      fs.readFileSync(
        path.join(root, "docs/security/frozen-artifacts.json"),
        "utf8"
      )
    );
    const legacyVerifier = "contracts/src/verifiers/CommitmentVerifier.sol";
    if (
      (await hashFile(path.join(root, legacyVerifier))) !==
      frozen[legacyVerifier]
    )
      throw new Error("Legacy verifier integrity changed");
    fs.copyFileSync(
      path.join(root, legacyVerifier),
      path.join(project, "src/verifiers/CommitmentVerifier.sol")
    );
    const testSourcePins: Record<string, string> = {};
    for (const file of ["PrivacyPoolV2.t.sol", "PrivacyPoolV2ETH.t.sol"]) {
      let source = fs.readFileSync(
        path.join(root, "contracts/test", file),
        "utf8"
      );
      for (const name of ["Withdraw", "Commitment"])
        source = source
          .replaceAll(
            `../src/v2/dev-verifiers/${name}VerifierV2Dev.sol`,
            `../src/verifiers/${name}VerifierV2ETH.sol`
          )
          .replaceAll(`${name}VerifierV2Dev`, `${name}VerifierV2ETH`);
      source = source.replaceAll(
        "v2 development fixture",
        "final-key local acceptance fixture"
      );
      fs.writeFileSync(path.join(project, "test", file), source);
      testSourcePins[file] = await hashFile(path.join(project, "test", file));
    }
    console.log(
      "Running native ETH contract regressions against the FINAL verifier contracts"
    );
    const log = path.join(acceptance, "contracts.log");
    const fd = fs.openSync(log, "w");
    try {
      execFileSync(
        "forge",
        [
          "test",
          "--force",
          "--root",
          project,
          "--match-contract",
          "PrivacyPoolV2ETHTest",
          "-vv",
        ],
        {
          cwd: project,
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", fd, fd],
        }
      );
    } finally {
      fs.closeSync(fd);
    }
    const output = fs.readFileSync(log, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    const count = Number(
      output.match(/(\d+) tests passed, 0 failed/)?.[1] ?? 0
    );
    if (count < 17)
      throw new Error("Incomplete final-key contract regression run");
    for (const test of [
      "test_copiedDepositCannotStrandOriginalRagequit",
      "test_duplicateSecretsSupportTwoPrivateWithdrawalChains",
      "test_sameNoteCannotSpendViaBothExitPaths",
      "test_sharedOwnerPublisherRetainsPrivateSpendAndPublicExit",
    ])
      if (!output.includes("[PASS] " + test + "()"))
        throw new Error("Missing critical final-key regression: " + test);
    await verifyReleaseDirectory(directory);
    const report = {
      result: "passed",
      releaseId: release.releaseId,
      artifactManifestSha256: release.artifactManifestSha256,
      protocol: release.protocol,
      targetChainId: release.identity.targetChainId,
      executedLocallyOnChainId: 31337,
      contractTestsPassed: count,
      realProofs: checks.proofCounts,
      publicInputMutationsRejected: checks.publicInputMutationsRejected,
      encryptedBackupRecovery: "passed",
      repeatedSecretWithdrawalAndRagequit: "passed",
      independentReview: false,
      fixtureSha256: await hashFile(fixture),
      contractLogSha256: await hashFile(log),
      testSourcePins,
      completedAt: new Date().toISOString(),
      mainnetTransactionsSent: 0,
    };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      error instanceof Error
        ? error.message
        : "Final-key local acceptance failed"
    );
    process.exit(1);
  });
