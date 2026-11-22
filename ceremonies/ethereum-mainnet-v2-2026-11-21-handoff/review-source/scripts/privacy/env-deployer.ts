import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Hex } from "viem";

/** Deployment-only key loading. Errors never include supplied values; never import this from the application. */
export function readEnvDeployer(
  read: (name: string) => string | undefined,
  expectedAddress?: string
) {
  const raw = read("DEPLOY_PRIVATE_KEY_MAINNET")?.trim();
  if (!raw) throw new Error("DEPLOY_PRIVATE_KEY_MAINNET is missing");
  const key = (raw.startsWith("0x") ? raw : "0x" + raw) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error(
      "DEPLOY_PRIVATE_KEY_MAINNET must be a valid 32-byte private key"
    );
  let address: `0x${string}`;
  try {
    address = privateKeyToAccount(key).address;
  } catch {
    throw new Error("DEPLOY_PRIVATE_KEY_MAINNET is not a valid private key");
  }
  if (expectedAddress && getAddress(expectedAddress) !== address)
    throw new Error(
      "Environment signer does not match PRIVACY_DEPLOYER_ADDRESS"
    );
  return { address, key };
}
