/** Public deployment configuration only. Does not read private keys, unlock signers or approve a release. */
import {
  getAddress,
  isAddress,
  parseEther,
  zeroAddress,
  type Address,
} from "viem";
import { isAnvilDefaultAccount, type EnvReader } from "./networks";

export function mainnetDeploymentConfig(read: EnvReader, chainId?: 1 | 4663) {
  const get = (key: string) =>
    (chainId ? read(`${key}_${chainId}`)?.trim() : undefined) ||
    read(key)?.trim() ||
    undefined;
  const issues: string[] = [];
  function address(key: string, required = true): Address | null {
    const value = get(key);
    if (!value) {
      if (required) issues.push(`${key}: missing`);
      return null;
    }
    if (
      !isAddress(value, { strict: false }) ||
      value.toLowerCase() === zeroAddress
    ) {
      issues.push(`${key}: invalid address`);
      return null;
    }
    if (isAnvilDefaultAccount(value)) {
      issues.push(`${key}: development account refused on mainnet`);
      return null;
    }
    return getAddress(value);
  }
  const roles = {
    deployer: address("PRIVACY_DEPLOYER_ADDRESS"),
    owner: address("PRIVACY_POOL_OWNER"),
    publisher: address("PRIVACY_ASP_POSTMAN"),
    // The pool can be deployed and users can self-relay before an operator relayer is configured.
    relayer: address("PRIVACY_RELAYER_ADDRESS", false),
  };
  if (roles.owner && roles.owner === roles.relayer)
    issues.push("Owner must be separate from the operator relayer");
  if (roles.publisher && roles.publisher === roles.relayer)
    issues.push("Publisher and relayer must use separate accounts");
  // The deployment sender holds no permanent pool authority unless assigned another role.
  // A publisher may fund deployment while a distinct cold owner controls administration.
  const account = get("PRIVACY_DEPLOY_ACCOUNT");
  const hardware = get("PRIVACY_DEPLOY_HARDWARE");
  const mode = get("PRIVACY_DEPLOY_SIGNER");
  let signer:
    | { kind: "keystore"; account: string }
    | { kind: "ledger" }
    | { kind: "env"; variable: "DEPLOY_PRIVATE_KEY_MAINNET" }
    | null = null;
  if (mode && mode !== "env")
    issues.push("PRIVACY_DEPLOY_SIGNER: supported explicit value is env");
  else if (mode === "env" && (account || hardware))
    issues.push("Choose exactly one environment, keystore or Ledger signer");
  else if (mode === "env")
    signer = { kind: "env", variable: "DEPLOY_PRIVATE_KEY_MAINNET" };
  else if (account && hardware)
    issues.push(
      "Choose only PRIVACY_DEPLOY_ACCOUNT or PRIVACY_DEPLOY_HARDWARE"
    );
  else if (account) {
    if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(account))
      signer = { kind: "keystore", account };
    else issues.push("PRIVACY_DEPLOY_ACCOUNT: invalid keystore alias");
  } else if (hardware === "ledger") signer = { kind: "ledger" };
  else if (hardware)
    issues.push("PRIVACY_DEPLOY_HARDWARE: supported value is ledger");
  else
    issues.push("PRIVACY_DEPLOY_ACCOUNT or PRIVACY_DEPLOY_HARDWARE: missing");
  const rawBudget = get("PRIVACY_DEPLOY_GAS_BUDGET_ETH");
  let gasBudgetWei: string | null = null;
  if (
    rawBudget &&
    (!/^\d+(?:\.\d{1,18})?$/.test(rawBudget) || parseEther(rawBudget) <= 0n)
  )
    issues.push(
      "PRIVACY_DEPLOY_GAS_BUDGET_ETH: expected a positive ETH amount with at most 18 decimals"
    );
  else if (rawBudget) gasBudgetWei = parseEther(rawBudget).toString();
  return {
    roles,
    signer,
    gasBudgetWei,
    sharedOwnerPublisher: !!roles.owner && roles.owner === roles.publisher,
    configured: issues.length === 0,
    issues,
  };
}
