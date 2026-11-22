/** Read-only public configuration report. Never reads private key values or opens a signer. */
import "./loadDeploymentEnv";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { MAINNET_TARGETS } from "../../shared/privacy/mainnetTargets";
import { MAINNET_RELEASE_BLOCKERS } from "../../shared/privacy/mainnetRelease";
import { urlHost } from "../../shared/privacy/networks";
import { mainnetDeploymentConfig } from "../../shared/privacy/mainnetConfig";
import { selectMainnetTarget } from "./mainnet-target";
import { checkRecord } from "./deploymentRecords";
import { APPLICATION_DEPLOYMENTS, applicationProfileReader, resolveApplicationNetworks } from "../../shared/privacy/applicationProfiles";

const root = path.resolve(import.meta.dirname, "../..");

async function main() {
  const { args, target } = selectMainnetTarget(process.argv.slice(2));
  if (args.some(arg => arg !== "--offline" && arg !== "--all"))
    throw new Error(
      "Usage: npm run zk:mainnet:preflight -- [--network ethereum-mainnet|robinhood-mainnet] [--all] [--offline]"
    );
  const reports = await Promise.all(
    (args.includes("--all") ? Object.values(MAINNET_TARGETS) : [target]).map(
      async selected => {
        const { chainId, chain } = selected;
        const rpc =
          process.env[`PRIVACY_DEPLOY_RPC_URL_${chainId}`]?.trim() ||
          process.env[`PRIVACY_RPC_URL_${chainId}`]?.trim() ||
          chain.rpcUrls.default.http[0];
        const appProfile = chainId === 1 ? resolveApplicationNetworks(applicationProfileReader(name => process.env[name], "ethereum-mainnet")).networks[0] : null;
        const appEnabled = !!appProfile?.pool && appProfile.problems.length === 0;
        const applicationDeployment = appEnabled ? APPLICATION_DEPLOYMENTS[chainId] : DEPLOYMENTS[chainId];
        const recordFile = path.join(
          root,
          "contracts/deployments",
          `${chainId}.json`
        );
        const rawRecord = fs.existsSync(recordFile)
          ? JSON.parse(fs.readFileSync(recordFile, "utf8"))
          : null;
        const checkedRecord = rawRecord
          ? checkRecord(`${chainId}.json`, rawRecord, { includeLocal: false })
          : null;
        if (checkedRecord && checkedRecord.kind !== "ok")
          throw new Error("Invalid mainnet contract deployment record");
        const deployment =
          checkedRecord?.kind === "ok"
            ? checkedRecord.record
            : applicationDeployment;
        const configuration = mainnetDeploymentConfig(
          name => process.env[name],
          chainId
        );
        const report = {
          network: chain.name,
          expectedChainId: chainId,
          rpcHost: urlHost(rpc),
          rpcCheck: "not_checked",
          observedChainId: null as number | null,
          latestBlock: null as string | null,
          recordedPool: deployment?.pool ?? null,
          contractDeploymentRecorded: checkedRecord?.kind === "ok",
          recordedProtocol: deployment?.protocol ?? null,
          recordedReleaseId: deployment?.releaseId ?? null,
          recordedTrustModel:
            rawRecord?.trustModel === "single-operator"
              ? "single-operator"
              : null,
          applicationRegisteredPool: applicationDeployment?.pool ?? null,
          applicationReleaseStatus: appEnabled ? "operator_authorized_single_operator" : "blocked_pending_independent_review",
          recordedPoolHasCode: null as boolean | null,
          configuration,
          readyForBroadcast: false,
          applicationReleaseBlockers: appEnabled ? [] : [...MAINNET_RELEASE_BLOCKERS],
          blockers: [
            ...(checkedRecord?.kind === "ok"
              ? [
                  "Contract deployment is already recorded; do not deploy it again",
                  ...(appEnabled ? [] : ["Hosted application activation is separate and remains blocked"]),
                ]
              : MAINNET_RELEASE_BLOCKERS),
            ...configuration.issues,
          ],
        };
        if (!args.includes("--offline")) {
          try {
            const client = createPublicClient({
              transport: http(rpc, { retryCount: 0, timeout: 10000 }),
            });
            report.observedChainId = await client.getChainId();
            if (report.observedChainId !== chainId)
              report.rpcCheck = "wrong_chain";
            else {
              report.latestBlock = (await client.getBlockNumber()).toString();
              report.rpcCheck = "ok";
              if (deployment) {
                const code = await client.getCode({ address: deployment.pool });
                report.recordedPoolHasCode = !!code && code !== "0x";
              }
            }
          } catch {
            report.rpcCheck = "unavailable";
          }
        }
        return report;
      }
    )
  );
  console.log(
    JSON.stringify(
      args.includes("--all") ? { networks: reports } : reports[0],
      null,
      2
    )
  );
  process.exitCode = 1; // The default reviewed application-release path remains blocked; contract evidence is reported separately.
}
main().catch(() => {
  console.error(
    "Mainnet preflight failed. Check arguments and local configuration; no transaction was sent."
  );
  process.exitCode = 1;
});
