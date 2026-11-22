import { selectMainnetTarget } from "../mainnet-target";
import { anvilKey } from "../anvilKeys";
import { listFiles } from "./release-files";
import { assertPoolRuntime } from "./runtime-bytecode";
import { ZERO_VALUE } from "../../../shared/privacy/constants";
/** Deployment-template smoke test on an OWNED local Anvil with the selected mainnet chain ID. Development verifiers only. */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicClient, getAddress, http, keccak256 } from "viem";
import { PRIVACY_POOL_V2_ABI } from "../../../shared/privacy/v2/abi";
import { computeScope } from "../../../shared/privacy/context";
import { mergeBroadcast } from "../deploymentRecords";
import { writeSolidityProject } from "./solidity-project";
import { V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";

const root = path.resolve(import.meta.dirname, "../../..");
const rpc = "http://127.0.0.1:8552";
const client = createPublicClient({
  transport: http(rpc, { retryCount: 0, timeout: 1000 }),
});
const deployer = getAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
async function main() {
  const { args: extra, target } = selectMainnetTarget(process.argv.slice(2));
  const { chainId } = target;
  const envSigner = extra.includes("--env-signer-local");
  const sharedOwnerPublisher = extra.includes("--shared-owner-publisher-local");
  if (
    new Set(extra).size !== extra.length ||
    extra.some(
      arg =>
        !["--env-signer-local", "--shared-owner-publisher-local"].includes(arg)
    )
  )
    throw new Error(
      "Deployment smoke accepts no RPC, chain or broadcast arguments"
    );
  const publisher = sharedOwnerPublisher
    ? deployer
    : getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  let busy = false;
  try {
    await client.getChainId();
    busy = true;
  } catch {}
  if (busy) throw new Error("Smoke port is already in use");
  const project = fs.mkdtempSync(
    path.join(os.tmpdir(), "hylsia-native-deploy-")
  );
  const anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      "8552",
      "--chain-id",
      String(chainId),
      "--silent",
    ],
    { stdio: "ignore" }
  );
  try {
    let started = false;
    for (let i = 0; i < 50; i++) {
      try {
        started = (await client.getChainId()) === chainId;
        if (started) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!started || anvil.exitCode !== null)
      throw new Error("Owned smoke Anvil did not start");
    await client.request({ method: "anvil_nodeInfo" as any });
    const dir = path.join(project, "src/verifiers");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ["Withdraw", "Commitment"]) {
      const source = fs.readFileSync(
        path.join(
          root,
          `contracts/src/v2/dev-verifiers/${name}VerifierV2Dev.sol`
        ),
        "utf8"
      );
      fs.writeFileSync(
        path.join(dir, `${name}VerifierV2ETH.sol`),
        "// LOCAL SMOKE ONLY. NOT PRODUCTION VERIFIERS.\n" +
          source.replaceAll(`${name}VerifierV2Dev`, `${name}VerifierV2ETH`)
      );
    }
    writeSolidityProject(root, project);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      PRIVACY_DEPLOY_CHAIN_ID: String(chainId),
      PRIVACY_DEPLOYER_ADDRESS: deployer,
      PRIVACY_POOL_OWNER: deployer,
      PRIVACY_ASP_POSTMAN: publisher,
      PRIVACY_MIN_DEPOSIT_WEI: "0",
    };
    const args = [
      "script",
      "--root",
      project,
      "script/DeployV2ETH.s.sol:DeployV2ETH",
      "--rpc-url",
      rpc,
      "--sender",
      deployer,
      "--slow",
      "--with-gas-price",
      "1000000000",
      "--gas-estimate-multiplier",
      "130",
    ];
    execFileSync("forge", args, {
      cwd: project,
      env,
      stdio: "pipe",
      maxBuffer: 1 << 24,
    });
    const base = path.join(
      project,
      "broadcast/DeployV2ETH.s.sol",
      String(chainId)
    );
    const simulation = JSON.parse(
      fs.readFileSync(path.join(base, "dry-run/run-latest.json"), "utf8")
    );
    if (
      !simulation.transactions.length ||
      simulation.transactions.some(
        (tx: any) => !/^0x[0-9a-f]+$/i.test(tx.transaction?.gas)
      )
    )
      throw new Error("Missing actual Forge simulation gas fields");
    if (envSigner) {
      env.DEPLOY_PRIVATE_KEY_MAINNET = anvilKey(0);
      env.PRIVACY_DEPLOY_USE_ENV_KEY = "true";
    }
    execFileSync(
      "forge",
      [...args, "--broadcast", ...(envSigner ? [] : ["--unlocked"])],
      {
        cwd: project,
        env,
        stdio: "pipe",
        maxBuffer: 1 << 24,
      }
    );
    const log = JSON.parse(
      fs.readFileSync(path.join(base, "run-latest.json"), "utf8")
    );
    const at = (name: string) =>
      getAddress(
        log.transactions.find((tx: any) => tx.contractName === name)
          .contractAddress
      );
    const pool = at("PrivacyPoolV2ETH"),
      w = at("WithdrawVerifierV2ETH"),
      c = at("CommitmentVerifierV2ETH");
    const version = await client.readContract({
      address: pool,
      abi: PRIVACY_POOL_V2_ABI,
      functionName: "PROTOCOL_VERSION",
    });
    if (version !== V2_ETH_PROTOCOL)
      throw new Error("Native ETH deployed protocol mismatch");
    for (const [functionName, expected] of [
      ["owner", deployer],
      ["aspPostman", publisher],
    ] as const) {
      const actual = await client.readContract({
        address: pool,
        abi: PRIVACY_POOL_V2_ABI,
        functionName,
      });
      if (getAddress(actual) !== expected)
        throw new Error("Local deployment role differs from selected custody");
    }
    for (const tx of log.transactions)
      if (
        (await client.getTransactionReceipt({ hash: tx.hash })).status !==
        "success"
      )
        throw new Error("Local deployment receipt failed");
    const merged = mergeBroadcast(
      {
        chainId,
        protocol: V2_ETH_PROTOCOL,
        pool,
        withdrawVerifier: w,
        commitmentVerifier: c,
        owner: deployer,
        aspPostman: publisher,
        scope: computeScope(pool, chainId).toString(),
        deployBlock: "1",
        minDepositWei: "0",
      },
      log
    );
    if (
      merged.problems.length ||
      !merged.record.poolReceiptBlock ||
      !merged.record.libraries?.length
    )
      throw new Error("Actual deployment receipts could not be reconciled");
    const poolArtifact = JSON.parse(
      fs.readFileSync(
        path.join(project, "out/PrivacyPoolV2ETH.sol/PrivacyPoolV2ETH.json"),
        "utf8"
      )
    );
    const poolCode = (await client.getCode({ address: pool }))!;
    const immutables = [
      ZERO_VALUE,
      computeScope(pool, chainId),
      BigInt(w),
      BigInt(c),
    ];
    assertPoolRuntime(
      poolArtifact,
      poolCode,
      merged.record.libraries!,
      immutables
    );
    let rejectedTampering = false;
    try {
      assertPoolRuntime(
        poolArtifact,
        "0xff" + poolCode.slice(4),
        merged.record.libraries!,
        immutables
      );
    } catch {
      rejectedTampering = true;
    }
    if (!rejectedTampering)
      throw new Error("Pool bytecode tampering was accepted");
    for (const [name, address] of [
      ["Withdraw", w],
      ["Commitment", c],
    ] as const) {
      const actual = await client.getCode({ address });
      const compiled = JSON.parse(
        fs.readFileSync(
          path.join(
            project,
            `out/${name}VerifierV2ETH.sol/${name}VerifierV2ETH.json`
          ),
          "utf8"
        )
      ).deployedBytecode.object;
      if (!actual || keccak256(actual) !== keccak256(compiled))
        throw new Error(
          "Deployed verifier code differs from compiled smoke verifier"
        );
    }
    if (envSigner) {
      const secret = anvilKey(0).slice(2).toLowerCase();
      for (const directory of ["broadcast", "cache", "out"]) {
        if (!fs.existsSync(path.join(project, directory))) continue;
        const files = await listFiles(project, directory);
        for (const file of Object.keys(files))
          if (
            [secret, BigInt("0x" + secret).toString()].some(value =>
              fs
                .readFileSync(path.join(project, file), "utf8")
                .toLowerCase()
                .includes(value)
            )
          )
            throw new Error(
              "Environment test key was persisted in generated Forge output"
            );
      }
      delete env.DEPLOY_PRIVATE_KEY_MAINNET;
    }
    console.log(
      `Native ETH deployment template passed (owned local chain ${chainId}, env signer ${envSigner}, shared owner/publisher ${sharedOwnerPublisher}): simulation, receipts, custody, runtime bytecode and key non-persistence checks. DEVELOPMENT verifiers; no public chain or deployment record.`
    );
  } finally {
    anvil.kill("SIGTERM");
    fs.rmSync(project, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "Local deployment smoke failed"
  );
  process.exitCode = 1;
});
