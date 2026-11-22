/** Explicit application activation, separate from independent release approval and deployment signing. */
import type { PoolDeployment } from "./deploymentTypes";
import { DEPLOYMENTS } from "./deployments";
import ethereumDeployment from "../../contracts/deployments/1.json";
import { V2_ETH_PROTOCOL } from "./protocols";
import { resolveNetworks, type EnvReader } from "./networks";

export type ApplicationProfile = "robinhood-testnet" | "ethereum-mainnet";
export function mainnetApplicationEnabled(
  value: string | undefined,
  production: boolean
): boolean {
  const setting = value?.trim();
  return setting === "true" || (!setting && production);
}
export const ETHEREUM_APPLICATION_RELEASE = Object.freeze(
  ethereumDeployment as PoolDeployment
);
export function isAuthorizedApplicationRelease(
  record: PoolDeployment
): boolean {
  return (
    record.chainId === 1 &&
    record.protocol === V2_ETH_PROTOCOL &&
    record.pool.toLowerCase() ===
      "0xac84cfac0a7c55760197b0681576cd27837ccfea" &&
    record.deployBlock === "26465235" &&
    record.releaseId ===
      "23f30ccaa7c30be08724c67b226d37d51b6d4a0310866807f4c73637e54031ef" &&
    record.artifactManifestSha256 ===
      "546ae336183d51bf580d7118b5a945581d6d2bdbb988b12d305e338350e55c32" &&
    record.vkeySha256?.withdraw ===
      "62ae70c88b314b5080db766eb827fabdfa55851d9c705dbaea46073b643a7501" &&
    record.vkeySha256?.commitment ===
      "215abe623499ff1c7a3cafaa6dd3799d383449bd55f1b88ddd665fce6c8b7e7c"
  );
}
export const APPLICATION_DEPLOYMENTS: Readonly<Record<number, PoolDeployment>> =
  Object.freeze({
    ...DEPLOYMENTS,
    1: ETHEREUM_APPLICATION_RELEASE,
  });

export function selectedApplicationProfile(
  search: string,
  pathname = ""
): ApplicationProfile | null {
  const values = new URLSearchParams(search).getAll("environment");
  if (values.length === 0) {
    if (/^\/pools\/(?:ethereum-mainnet|1)(?:\/|$)/.test(pathname))
      return "ethereum-mainnet";
    if (/^\/pools\/(?:robinhood-testnet|46630)(?:\/|$)/.test(pathname))
      return "robinhood-testnet";
  }
  return values.length === 1 &&
    (values[0] === "ethereum-mainnet" || values[0] === "robinhood-testnet")
    ? values[0]
    : null;
}

/** Same-origin navigation only. A profile selects a fixed deployment, never an arbitrary pool or key. */
export function applicationProfileHref(
  href: string,
  profile: ApplicationProfile | null
): string {
  if (!profile || !href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://hylsia.invalid");
  url.searchParams.set("environment", profile);
  return url.pathname + url.search + url.hash;
}

export function applicationProfileReader(
  read: EnvReader,
  profile: ApplicationProfile
): EnvReader {
  return name => {
    if (name === "PRIVACY_CHAIN_IDS")
      return profile === "ethereum-mainnet" ? "1" : "46630";
    if (name === "PRIVACY_CHAIN_ID") return undefined;
    if (name === "PRIVACY_PROTOCOL")
      return profile === "ethereum-mainnet" ? V2_ETH_PROTOCOL : "hylsia-pp-v1";
    // The default testnet service key must never silently acquire mainnet authority.
    if (
      profile === "ethereum-mainnet" &&
      /^PRIVACY_(?:ASP_POSTMAN|RELAYER)_PRIVATE_KEY$/.test(name)
    )
      return undefined;
    return read(name);
  };
}

/** Owner authorized app activation for this one deployed single-operator package; no independent audit is claimed. */
export function resolveApplicationNetworks(read: EnvReader) {
  const enabled = mainnetApplicationEnabled(
    read("PRIVACY_ENABLE_MAINNET_APP"),
    read("NODE_ENV") === "production"
  );
  const deployments = enabled ? APPLICATION_DEPLOYMENTS : DEPLOYMENTS;
  const resolved = resolveNetworks(read, deployments);
  if (!enabled) return resolved;
  for (const item of resolved.networks) {
    const release = ETHEREUM_APPLICATION_RELEASE;
    if (
      !isAuthorizedApplicationRelease(release) ||
      item.network.chainId !== 1 ||
      item.protocol !== V2_ETH_PROTOCOL ||
      item.pool?.toLowerCase() !== release.pool.toLowerCase() ||
      item.deployBlock !== BigInt(release.deployBlock)
    )
      continue;
    // Preserve all address, scope, protocol and final-artifact binding errors. The generic reviewed route stays closed.
    item.problems = item.problems.filter(
      problem => problem !== "mainnet_release_blocked"
    );
    item.warnings = item.warnings.filter(
      message => !message.startsWith("Mainnet release blocked:")
    );
    item.warnings.push(
      "Owner-authorized single-operator Ethereum release; not independently audited. Publisher signatures are approved in its wallet."
    );
  }
  return resolved;
}
