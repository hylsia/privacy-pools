/**
 * anvil's default development accounts for local chains, tests and the e2e.
 *
 * The keys are derived at run time from anvil's public test mnemonic, so no private key is written in the repository.
 * They are public knowledge (Foundry documents them): use them only on local anvil chains. The deploy guards and the
 * deployment-record checks refuse these accounts on public networks (ANVIL_DEFAULT_ACCOUNTS in
 * shared/privacy/networks.ts).
 */
import { bytesToHex, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

/** anvil's (and Hardhat's) public default mnemonic. */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

/** The private key of anvil default account `index` (0 to 9), derived on demand. */
export function anvilKey(index: number): Hex {
  if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error(`anvil account index out of range: ${index}`);
  const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey().privateKey;
  if (!key) throw new Error(`could not derive anvil account ${index}`);
  return bytesToHex(key);
}
