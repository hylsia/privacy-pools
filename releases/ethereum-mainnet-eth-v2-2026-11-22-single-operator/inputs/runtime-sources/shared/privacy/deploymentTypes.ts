/**
 * The pool deployment record, as contracts/script/Deploy.s.sol writes it to contracts/deployments/<chainId>.json and
 * scripts/privacy/sync-deployments.ts merges it into the generated shared/privacy/deployments.ts.
 *
 * Hand-written (the generator imports it), so the record's shape and the generated list live in separate files.
 * The first nine fields are required; the others come from newer deploy and sync runs and are optional.
 */
export interface PoolDeployment {
  chainId: number;
  pool: `0x${string}`;
  withdrawVerifier: `0x${string}`;
  commitmentVerifier: `0x${string}`;
  owner: `0x${string}`;
  aspPostman: `0x${string}`;
  /** SCOPE as a decimal string: computeScope(pool, chainId) (shared/privacy/context.ts) */
  scope: string;
  minDepositWei: string;
  deployBlock: string;
  /** PROTOCOL_VERSION the pool was deployed for */
  protocol?: string;
  /** the account that sent the deployment transactions */
  deployer?: `0x${string}`;
  /** the Poseidon libraries the pool links against (their CREATE2 addresses depend on the build's metadata) */
  libraries?: { name: "PoseidonT3" | "PoseidonT4"; address: `0x${string}` }[];
  /** deployment transaction hashes by contract name */
  txHashes?: Record<string, `0x${string}`>;
  /** the block of the pool's deployment receipt (decimal string) */
  poolReceiptBlock?: string;
  /** sha256 of the verifying keys served in client/public/zk (manifest.json), pinned at sync time */
  vkeySha256?: { withdraw: string; commitment: string };
  /** keccak256 of each verifier's deployed code, checked by `sync-deployments --check-onchain` */
  verifierCodeHash?: { withdraw: `0x${string}`; commitment: `0x${string}` };
  /** V2 ETH content-bound release and exact artifact manifest bytes. Never inferred from an address override. */
  releaseId?: string;
  artifactManifestSha256?: string;
}
