import { assertPoolRuntime } from "./runtime-bytecode";
import { ZERO_VALUE } from "../../../shared/privacy/constants";
/** Exact-package native ETH deployment. Signing requires a reviewed release or an exact operator authorization. */
import "../loadDeploymentEnv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { selectMainnetTarget } from "../mainnet-target";
import { readEnvDeployer } from "../env-deployer";
import { mainnetDeploymentConfig } from "../../../shared/privacy/mainnetConfig";
import {
  mainnetReleaseRefusal,
  REVIEWED_MAINNET_RELEASES,
} from "../../../shared/privacy/mainnetRelease";
import { computeScope } from "../../../shared/privacy/context";
import type { PoolDeployment } from "../../../shared/privacy/deploymentTypes";
import { urlHost } from "../../../shared/privacy/networks";
import { isLoopbackHostname, mergeBroadcast } from "../deploymentRecords";
import { verifyReleaseDirectory } from "./release-files";
import { operatorDeploymentAuthorization } from "./operator-authorization";

const root = path.resolve(import.meta.dirname, "../../..");
class DeploymentError extends Error {}
const usage =
  "npm run zk:v2:deploy:native-eth -- --release <release-directory> [--network ethereum-mainnet|robinhood-mainnet] [--broadcast|--reconcile] [--operator-authorized]";
async function main() {
  const { args: rawArgs, target } = selectMainnetTarget(process.argv.slice(2));
  const operatorMode = rawArgs.includes("--operator-authorized");
  if (rawArgs.filter(arg => arg === "--operator-authorized").length > 1)
    throw new DeploymentError(usage);
  const args = rawArgs.filter(arg => arg !== "--operator-authorized");
  const { chainId, chain } = target;
  if (args.length === 1 && args[0] === "--help") return console.log(usage);
  if (
    args[0] !== "--release" ||
    !args[1] ||
    args.length > 3 ||
    (args[2] && !["--broadcast", "--reconcile"].includes(args[2]))
  )
    throw new DeploymentError(usage);
  const broadcast = args[2] === "--broadcast";
  const reconcile = args[2] === "--reconcile";
  // The current blocker is checked before release-file access, RPC, keystore or Ledger access.
  const refusal = mainnetReleaseRefusal(chain);
  if (
    (broadcast || reconcile) &&
    !operatorMode &&
    REVIEWED_MAINNET_RELEASES.length === 0
  )
    throw new DeploymentError(refusal!);
  const releaseDir = fs.realpathSync(path.resolve(root, args[1]));
  const release = await verifyReleaseDirectory(releaseDir);
  if (release.identity.targetChainId !== chainId)
    throw new DeploymentError(
      "Release package targets a different chain; build a package for the selected --network"
    );
  const reviewedRefusal = mainnetReleaseRefusal(chain, {
    protocol: release.protocol,
    releaseId: release.releaseId,
    artifactManifestSha256: release.artifactManifestSha256,
  });
  const config = mainnetDeploymentConfig(name => process.env[name], chainId);
  if (!config.configured)
    throw new DeploymentError(
      "Deployment configuration incomplete: " + config.issues.join("; ")
    );
  const operatorAuthorization = operatorMode
    ? await operatorDeploymentAuthorization(
        root,
        release,
        chainId,
        config.roles.deployer!
      )
    : null;
  const exactRefusal = operatorMode
    ? operatorAuthorization
      ? null
      : "No exact user-authorized single-operator deployment and final-key acceptance binding"
    : reviewedRefusal;
  if ((broadcast || reconcile) && exactRefusal)
    throw new DeploymentError(exactRefusal);
  const rpc =
    process.env[`PRIVACY_DEPLOY_RPC_URL_${chainId}`]?.trim() ||
    process.env[`PRIVACY_RPC_URL_${chainId}`]?.trim() ||
    chain.rpcUrls.default.http[0];
  const url = new URL(rpc);
  if (url.protocol !== "https:" || isLoopbackHostname(url.hostname))
    throw new DeploymentError(
      "Mainnet deployment requires an HTTPS production RPC"
    );
  const client = createPublicClient({
    chain,
    transport: http(rpc, { retryCount: 0, timeout: 20000 }),
  });
  const observedChainId = await client.getChainId();
  if (observedChainId !== chainId)
    throw new DeploymentError(
      "Deployment RPC chain ID differs from selected mainnet"
    );
  const deployer = config.roles.deployer!;
  const [currentNonce, pendingNonce, balance, fees] = await Promise.all([
    client.getTransactionCount({ address: deployer }),
    client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.getBalance({ address: deployer }),
    client.estimateFeesPerGas(),
  ]);
  if (!reconcile && currentNonce !== pendingNonce)
    throw new DeploymentError(
      "Deployer has pending transactions; reconcile before deployment"
    );
  const feeCap = fees.maxFeePerGas;
  const project = path.join(releaseDir, "solidity");
  const attemptPath = path.join(releaseDir, "broadcast-attempt.json");
  const planPath = path.join(releaseDir, "deployment-plan.json");
  const previousPlan = reconcile
    ? JSON.parse(fs.readFileSync(planPath, "utf8"))
    : null;
  const attempt = reconcile
    ? JSON.parse(fs.readFileSync(attemptPath, "utf8"))
    : null;
  if (
    reconcile &&
    (previousPlan.chainId !== chainId ||
      previousPlan.releaseId !== release.releaseId ||
      previousPlan.artifactManifestSha256 !== release.artifactManifestSha256 ||
      previousPlan.deployer !== deployer ||
      !Number.isSafeInteger(previousPlan.nonce) ||
      previousPlan.nonce < 0 ||
      attempt.chainId !== chainId ||
      attempt.releaseId !== release.releaseId ||
      attempt.deployer !== deployer ||
      attempt.nonce !== previousPlan.nonce)
  )
    throw new DeploymentError(
      "Reconciliation requires the original matching deployment plan and broadcast attempt"
    );
  const nonce: number = reconcile ? previousPlan.nonce : currentNonce;
  if (broadcast && fs.existsSync(attemptPath))
    throw new DeploymentError(
      "A broadcast attempt already exists for this package. Reconcile its receipts before another deployment"
    );
  const minimum = process.env.PRIVACY_MIN_DEPOSIT_WEI?.trim() || "0";
  if (!/^\d+$/.test(minimum) || BigInt(minimum) > (1n << 128n) - 1n)
    throw new DeploymentError("Invalid native ETH minimum deposit");
  if (
    operatorAuthorization &&
    (operatorAuthorization.parameters.owner !== config.roles.owner ||
      operatorAuthorization.parameters.publisher !== config.roles.publisher ||
      BigInt(operatorAuthorization.parameters.minDepositWei) !==
        BigInt(minimum))
  )
    throw new DeploymentError(
      "Constructor parameters differ from the exact operator authorization"
    );
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PRIVACY_DEPLOY_CHAIN_ID: String(chainId),
    PRIVACY_DEPLOYER_ADDRESS: deployer,
    PRIVACY_POOL_OWNER: config.roles.owner!,
    PRIVACY_ASP_POSTMAN: config.roles.publisher!,
    PRIVACY_MIN_DEPOSIT_WEI: minimum,
  };
  const forgeArgs = [
    "script",
    "--force",
    "--root",
    project,
    "script/DeployV2ETH.s.sol:DeployV2ETH",
    "--rpc-url",
    rpc,
    "--chain",
    String(chainId),
    "--sender",
    deployer,
    "--slow",
    "--with-gas-price",
    feeCap.toString(),
    "--priority-gas-price",
    fees.maxPriorityFeePerGas.toString(),
    "--gas-estimate-multiplier",
    "130",
  ];
  const runForge = (extra: string[]) => {
    try {
      execFileSync("forge", [...forgeArgs, ...extra], {
        cwd: project,
        env,
        stdio: ["inherit", "pipe", "pipe"],
        maxBuffer: 1 << 26,
      });
    } catch (error) {
      // The dry-run child receives no signing key. Keep signing output private even on failure.
      if (!env.PRIVACY_DEPLOY_USE_ENV_KEY && config.signer!.kind === "env") {
        const failure = error as { stdout?: Buffer; stderr?: Buffer };
        fs.writeFileSync(
          path.join(releaseDir, "deployment-simulation-error.log"),
          [failure.stdout, failure.stderr]
            .filter(Boolean)
            .map(value => value!.toString())
            .join("\n")
        );
      }
      throw new DeploymentError(
        "Native ETH Forge execution failed. Reconcile any broadcast receipts before retrying; no automatic retry or resume was attempted."
      );
    }
  };
  console.log(
    `${reconcile ? "Reconciling existing receipts for" : "Simulating"} native ETH release ${release.releaseId} on chain ${chainId} via ${urlHost(rpc)}`
  );
  if (!reconcile) runForge([]);
  const logBase = path.join(
    project,
    "broadcast/DeployV2ETH.s.sol",
    String(chainId)
  );
  const simulation = JSON.parse(
    fs.readFileSync(path.join(logBase, "dry-run/run-latest.json"), "utf8")
  );
  const txs = simulation.transactions;
  if (!Array.isArray(txs) || !txs.length)
    throw new DeploymentError("Simulation produced no deployment transactions");
  const gas = txs.reduce((total: bigint, tx: any, index: number) => {
    const value = tx.transaction?.gas;
    if (
      typeof value !== "string" ||
      !/^0x[0-9a-f]+$/i.test(value) ||
      BigInt(value) <= 0n ||
      getAddress(tx.transaction.from) !== deployer ||
      BigInt(tx.transaction.nonce) !== BigInt(nonce + index) ||
      BigInt(tx.transaction.value ?? "0x0") !== 0n
    )
      throw new DeploymentError("Invalid simulation gas or sender");
    return total + BigInt(value);
  }, 0n);
  const maximumEstimate = gas * feeCap;
  const exceedsBudget =
    config.gasBudgetWei !== null &&
    maximumEstimate > BigInt(config.gasBudgetWei);
  const insufficientBalance = balance < maximumEstimate;
  const fundingBlockers = [
    ...(exceedsBudget
      ? ["Simulated deployment exceeds the optional ETH gas cap"]
      : []),
    ...(insufficientBalance
      ? ["Deployer balance is below the simulated deployment cost"]
      : []),
  ];
  const plan = {
    chainId,
    protocol: release.protocol,
    releaseId: release.releaseId,
    artifactManifestSha256: release.artifactManifestSha256,
    authorizationMode: operatorMode
      ? "single-operator-user-authorized"
      : "independently-reviewed",
    independentReview: !operatorMode && !reviewedRefusal,
    deployer,
    owner: config.roles.owner,
    publisher: config.roles.publisher,
    minDepositWei: minimum,
    nonce,
    feeCapWei: feeCap.toString(),
    simulatedGas: gas.toString(),
    estimatedMaximumWei: maximumEstimate.toString(),
    budgetWei: config.gasBudgetWei,
    readyForBroadcast: !exactRefusal && fundingBlockers.length === 0,
    blockers: [...(exactRefusal ? [exactRefusal] : []), ...fundingBlockers],
    simulatedContracts: txs.map((tx: any) => ({
      name: tx.contractName,
      address: tx.contractAddress,
    })),
  };
  if (!reconcile) {
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
    console.log(JSON.stringify(plan, null, 2));
  }
  if (!broadcast && !reconcile) return;
  const recordPath = path.join(
    root,
    "contracts/deployments",
    `${chainId}.json`
  );
  if (fs.existsSync(recordPath))
    throw new DeploymentError(
      "Mainnet deployment record already exists; automatic replacement is forbidden"
    );
  let broadcastExecutionSucceeded = false;
  if (broadcast) {
    if (exceedsBudget)
      throw new DeploymentError(
        "Simulated deployment exceeds the configured ETH gas budget"
      );
    if (balance < maximumEstimate)
      throw new DeploymentError("Deployer balance is below the simulated cost");
    if (
      (await client.getTransactionCount({
        address: deployer,
        blockTag: "pending",
      })) !== nonce
    )
      throw new DeploymentError("Deployer nonce changed after simulation");
    await verifyReleaseDirectory(releaseDir);
    const signer =
      config.signer!.kind === "keystore"
        ? ["--account", config.signer!.account]
        : config.signer!.kind === "ledger"
          ? ["--ledger"]
          : [];
    if (config.signer!.kind === "keystore") {
      const passwordFile = process.env.PRIVACY_DEPLOY_PASSWORD_FILE?.trim();
      if (!passwordFile || !fs.statSync(passwordFile).isFile())
        throw new DeploymentError(
          "Keystore deployment requires PRIVACY_DEPLOY_PASSWORD_FILE from your secret store"
        );
      signer.push("--password-file", passwordFile);
    }
    if (config.signer!.kind === "env") {
      try {
        const { key } = readEnvDeployer(name => process.env[name], deployer);
        env.DEPLOY_PRIVATE_KEY_MAINNET = key;
        env.PRIVACY_DEPLOY_USE_ENV_KEY = "true";
      } catch {
        throw new DeploymentError(
          "Environment signer is missing, invalid or differs from the configured deployer"
        );
      }
    }
    try {
      fs.writeFileSync(
        attemptPath,
        JSON.stringify(
          {
            status: "started",
            releaseId: release.releaseId,
            chainId,
            deployer,
            nonce,
            startedAt: new Date().toISOString(),
          },
          null,
          2
        ) + "\n",
        { flag: "wx" }
      );
      try {
        runForge([
          "--broadcast",
          ...signer,
          "--verify",
          "--verifier",
          "blockscout",
          "--verifier-url",
          target.verifierApi,
        ]);
        broadcastExecutionSucceeded = true;
      } catch {
        // Explorer verification can fail after successful deployment. Reconcile all actual receipts below,
        // without automatically retrying or signing again. Missing/failed receipts still stop this run.
        console.log(
          "Forge did not finish cleanly; reconciling existing broadcast receipts without resending."
        );
      }
    } finally {
      delete env.DEPLOY_PRIVATE_KEY_MAINNET;
      delete env.PRIVACY_DEPLOY_USE_ENV_KEY;
    }
  }
  const log = JSON.parse(
    fs.readFileSync(path.join(logBase, "run-latest.json"), "utf8")
  );
  const created = (name: string) => {
    const matching = log.transactions?.filter(
      (tx: any) =>
        tx.contractName === name && /^CREATE2?$/.test(tx.transactionType)
    );
    if (matching?.length !== 1)
      throw new DeploymentError(
        "Deployment receipt set lacks a unique " + name
      );
    return getAddress(matching[0].contractAddress);
  };
  const pool = created("PrivacyPoolV2ETH");
  const w = created("WithdrawVerifierV2ETH"),
    c = created("CommitmentVerifierV2ETH");
  for (const tx of log.transactions) {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    if (
      receipt.status !== "success" ||
      receipt.from.toLowerCase() !== deployer.toLowerCase()
    )
      throw new DeploymentError("Unconfirmed or mismatched deployment receipt");
  }
  // Script verification may discard build artifacts. Rebuild the pinned sources without any signer
  // before comparing runtime bytecode; this never executes a deployment script or sends transactions.
  execFileSync("forge", ["build", "--force", "--root", project], {
    cwd: project,
    env: { PATH: env.PATH, HOME: env.HOME },
    stdio: "pipe",
    maxBuffer: 1 << 26,
  });
  // Use the exact compiled pool ABI, including its verifier getters. The shared UI ABI is intentionally smaller.
  const poolArtifact = JSON.parse(
    fs.readFileSync(
      path.join(project, "out/PrivacyPoolV2ETH.sol/PrivacyPoolV2ETH.json"),
      "utf8"
    )
  );
  const read = (functionName: string) =>
    client.readContract({
      address: pool,
      abi: poolArtifact.abi,
      functionName: functionName as any,
    });
  const [protocol, scope, owner, publisher, onchainW, onchainC, min] =
    await Promise.all([
      read("PROTOCOL_VERSION"),
      read("SCOPE"),
      read("owner"),
      read("aspPostman"),
      read("WITHDRAW_VERIFIER"),
      read("COMMITMENT_VERIFIER"),
      read("minDeposit"),
    ]);
  if (
    protocol !== release.protocol ||
    scope !== computeScope(pool, chainId) ||
    owner !== config.roles.owner ||
    publisher !== config.roles.publisher ||
    onchainW !== w ||
    onchainC !== c ||
    min !== BigInt(minimum)
  )
    throw new DeploymentError(
      "Deployed native ETH pool differs from the exact release parameters"
    );
  const verifierCodeHash = {} as NonNullable<
    PoolDeployment["verifierCodeHash"]
  >;
  for (const [kind, name, address] of [
    ["withdraw", "WithdrawVerifierV2ETH", w],
    ["commitment", "CommitmentVerifierV2ETH", c],
  ] as const) {
    const code = await client.getCode({ address });
    const expected = JSON.parse(
      fs.readFileSync(
        path.join(project, `out/${name}.sol/${name}.json`),
        "utf8"
      )
    ).deployedBytecode.object;
    if (!code || code.toLowerCase() !== expected.toLowerCase())
      throw new DeploymentError(
        "Deployed verifier bytecode differs from final release"
      );
    verifierCodeHash[kind] = keccak256(code);
  }
  const record: PoolDeployment = {
    chainId,
    protocol: release.protocol,
    pool,
    withdrawVerifier: w,
    commitmentVerifier: c,
    owner: config.roles.owner!,
    aspPostman: config.roles.publisher!,
    deployer,
    scope: computeScope(pool, chainId).toString(),
    minDepositWei: minimum,
    deployBlock: "1",
    releaseId: release.releaseId,
    artifactManifestSha256: release.artifactManifestSha256,
    vkeySha256: {
      withdraw: release.identity.files["artifacts/withdraw.vkey.json"].sha256,
      commitment:
        release.identity.files["artifacts/commitment.vkey.json"].sha256,
    },
    verifierCodeHash,
  };
  if (operatorAuthorization)
    Object.assign(record, {
      trustModel: "single-operator",
      independentReview: false,
      operatorAuthorizationSha256: operatorAuthorization.evidenceSha256,
      operatorAuthorizationEvidence: operatorAuthorization.evidencePath,
    });
  for (const tx of log.transactions) {
    const expected = simulation.transactions.find(
      (item: any) =>
        item.contractName === tx.contractName &&
        item.contractAddress?.toLowerCase() ===
          tx.contractAddress?.toLowerCase()
    );
    if (!expected || expected.transaction.nonce !== tx.transaction.nonce)
      throw new DeploymentError(
        "Deployment differs from simulated contracts or nonces"
      );
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    const recorded = log.receipts.find(
      (item: any) =>
        item.transactionHash?.toLowerCase() === tx.hash.toLowerCase()
    );
    if (
      !recorded ||
      BigInt(recorded.blockNumber) !== receipt.blockNumber ||
      recorded.status !== "0x1"
    )
      throw new DeploymentError("Broadcast log differs from actual receipt");
  }
  const merged = mergeBroadcast(record, log);
  if (merged.problems.length)
    throw new DeploymentError(merged.problems.join("; "));
  const poolCode = await client.getCode({ address: pool });
  if (!poolCode)
    throw new DeploymentError("Native ETH pool has no runtime bytecode");
  assertPoolRuntime(poolArtifact, poolCode, merged.record.libraries!, [
    ZERO_VALUE,
    computeScope(pool, chainId),
    BigInt(w),
    BigInt(c),
  ]);
  merged.record.deployBlock = merged.record.poolReceiptBlock!;
  fs.writeFileSync(recordPath, JSON.stringify(merged.record, null, 2) + "\n", {
    flag: "wx",
  });
  fs.writeFileSync(
    attemptPath,
    JSON.stringify(
      {
        status: "confirmed",
        releaseId: release.releaseId,
        chainId,
        deployer,
        nonce,
        startedAt: JSON.parse(fs.readFileSync(attemptPath, "utf8")).startedAt,
        confirmedAt: new Date().toISOString(),
        pool,
        poolReceiptBlock: merged.record.poolReceiptBlock,
        explorerVerification: broadcastExecutionSucceeded
          ? "forge-completed"
          : "pending-reconciliation",
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "Recorded receipt-verified native ETH deployment. Application/service activation is separate; no independent audit is claimed for operator-authorized deployments."
  );
}
main().catch(error => {
  console.error(
    error instanceof DeploymentError
      ? error.message
      : "Native ETH deployment did not complete. Run the read-only preflight and inspect local release/configuration; reconcile any receipts before retrying. No automatic retry was performed."
  );
  process.exitCode = 1;
});
