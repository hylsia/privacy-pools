/** Exact user-authorized deployments are separate from independently reviewed application releases. */
import fs from "node:fs";
import path from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";
import type { MainnetChainId } from "../../../shared/privacy/mainnetTargets";
import type { ReleasePackage } from "./release-policy";
import { SHA256, safeFile } from "./release-policy";
import { hashFile } from "./ceremony-policy";

export interface OperatorDeploymentAuthorization {
  chainId: MainnetChainId;
  protocol: typeof V2_ETH_PROTOCOL;
  releaseId: string;
  artifactManifestSha256: string;
  deployer: Address;
  evidencePath: string;
  evidenceSha256: string;
}

export function matchesOperatorAuthorization(
  approval: OperatorDeploymentAuthorization,
  release: Pick<
    ReleasePackage,
    "protocol" | "releaseId" | "artifactManifestSha256" | "identity"
  >,
  chainId: MainnetChainId,
  deployer: Address
) {
  return (
    approval.chainId === chainId &&
    release.identity.targetChainId === chainId &&
    approval.protocol === V2_ETH_PROTOCOL &&
    release.protocol === V2_ETH_PROTOCOL &&
    approval.releaseId === release.releaseId &&
    SHA256.test(approval.releaseId) &&
    approval.artifactManifestSha256 === release.artifactManifestSha256 &&
    SHA256.test(approval.artifactManifestSha256) &&
    approval.deployer.toLowerCase() === deployer.toLowerCase() &&
    release.identity.ceremony.trustModel === "single-operator" &&
    release.identity.ceremony.independenceReviewed === false &&
    SHA256.test(approval.evidenceSha256)
  );
}

export async function operatorDeploymentAuthorization(
  root: string,
  release: ReleasePackage,
  chainId: MainnetChainId,
  deployer: Address
) {
  const approvals: OperatorDeploymentAuthorization[] = JSON.parse(
    fs.readFileSync(
      path.join(root, "config/operator-mainnet-deployments.json"),
      "utf8"
    )
  );
  if (!Array.isArray(approvals))
    throw new Error("Invalid operator deployment authorization registry");
  const approval = approvals.find(item =>
    matchesOperatorAuthorization(item, release, chainId, deployer)
  );
  if (!approval) return null;
  const evidenceFile = safeFile(root, approval.evidencePath);
  if ((await hashFile(evidenceFile)) !== approval.evidenceSha256)
    throw new Error("Operator authorization evidence changed");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  if (
    evidence.operatorAuthorized !== true ||
    evidence.independentReview !== false ||
    evidence.trustModel !== "single-operator" ||
    evidence.releaseId !== release.releaseId ||
    evidence.artifactManifestSha256 !== release.artifactManifestSha256 ||
    evidence.chainId !== chainId ||
    evidence.deployer?.toLowerCase() !== deployer.toLowerCase()
  )
    throw new Error(
      "Operator authorization does not bind the exact unreviewed release"
    );
  const acceptanceFile = safeFile(root, evidence.acceptance.path);
  if ((await hashFile(acceptanceFile)) !== evidence.acceptance.sha256)
    throw new Error("Final-key acceptance evidence changed");
  const acceptance = JSON.parse(fs.readFileSync(acceptanceFile, "utf8"));
  if (
    acceptance.result !== "passed" ||
    acceptance.releaseId !== release.releaseId ||
    acceptance.artifactManifestSha256 !== release.artifactManifestSha256 ||
    acceptance.contractTestsPassed < 17 ||
    acceptance.publicInputMutationsRejected !== 46
  )
    throw new Error("Final-key contract/proof acceptance is incomplete");
  const parameters = evidence.parameters;
  if (
    !parameters ||
    !isAddress(parameters.owner, { strict: false }) ||
    !isAddress(parameters.publisher, { strict: false }) ||
    typeof parameters.minDepositWei !== "string" ||
    !/^\d+$/.test(parameters.minDepositWei)
  )
    throw new Error(
      "Operator authorization lacks exact constructor parameters"
    );
  return {
    ...approval,
    parameters: {
      owner: getAddress(parameters.owner),
      publisher: getAddress(parameters.publisher),
      minDepositWei: parameters.minDepositWei,
    },
  };
}
