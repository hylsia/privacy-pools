import type { Chain } from "viem";
import { V2_ETH_PROTOCOL } from "./protocols";
import { isMainnetChainId, type MainnetChainId } from "./mainnetTargets";

export interface MainnetReleaseBinding {
  protocol?: string;
  releaseId?: string;
  artifactManifestSha256?: string;
}
/** Populate only with actual independent review evidence for an exact immutable package. No approvals exist yet. */
export const REVIEWED_MAINNET_RELEASES: readonly (Required<MainnetReleaseBinding> & {
  chainId: MainnetChainId;
  reviewEvidence: string;
})[] = Object.freeze([]);

/** Current protocol's observed release blockers, not an environment-toggle approval. */
export const MAINNET_RELEASE_BLOCKERS = [
  "H-01: cross-profile/device note reuse can strand deposited funds",
  "Active Groth16 proving keys use a local development trusted setup",
  "Mainnet security review and production wallet/service validation are incomplete",
] as const;

/** Shared by app configuration and the deploy CLI; testnet/local flows remain available. */
export function mainnetReleaseRefusal(
  chain: Pick<Chain, "testnet"> & { id?: number },
  binding?: MainnetReleaseBinding
): string | null {
  if (chain.testnet === true) return null;
  if (
    isMainnetChainId(chain.id) &&
    binding?.protocol === V2_ETH_PROTOCOL &&
    REVIEWED_MAINNET_RELEASES.some(
      r =>
        r.chainId === chain.id &&
        r.protocol === binding.protocol &&
        r.releaseId === binding.releaseId &&
        r.artifactManifestSha256 === binding.artifactManifestSha256 &&
        !!r.reviewEvidence
    )
  )
    return null;
  return `Mainnet release blocked: ${MAINNET_RELEASE_BLOCKERS.join("; ")}. Native ETH v2 requires an exact independently reviewed release binding. See docs/privacy-pools/mainnet-migration.md.`;
}
