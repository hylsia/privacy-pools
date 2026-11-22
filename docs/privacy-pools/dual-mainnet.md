# Native ETH on Ethereum and Robinhood Chain

Native ETH v2 tooling supports **Ethereum mainnet (1)** and **Robinhood Chain mainnet (4663)**.
Ethereum has a [recorded single-operator native ETH v2 deployment](single-operator-mainnet.md), explicitly
authorized by the project owner without independent contributors. Robinhood Chain remains a preparation
target without a recorded mainnet deployment. Neither has an independently reviewed application release.
The existing Robinhood Chain testnet v1 pool remains the default application network.

## Deployment wallet

Select `PRIVACY_DEPLOY_SIGNER=env` to use `DEPLOY_PRIVATE_KEY_MAINNET` from the private local deployment
environment. Set `PRIVACY_DEPLOYER_ADDRESS` to its public address. Keystore and Ledger remain alternatives;
select exactly one mode. Environment signing validates the key against the configured address and forwards
it only through Forge's child environment after the release/broadcast checks. Simulation does not forward it.
The Solidity script uses `vm.envUint` and `vm.startBroadcast`; the key is never passed as a CLI argument.
A shared owner/publisher wallet is supported when selected explicitly. It holds both administration and ASP publishing authority; separate custody remains an operational option. Keep deployment keys out of the hosted application environment.

```sh
npm run zk:mainnet:wallet -- --all
npm run zk:mainnet:preflight -- --all --offline
```

Wallet diagnostics derive only the public address for their output, verify each RPC's chain ID and query
balances separately. RPC failure is reported as unavailable, not zero. Preflight reads public configuration
only. Neither command signs transactions. ETH on one network does not pay gas on the other; no bridge,
transfer or funding transaction is automatically performed.

Configure owner and publisher for each chain. A relayer and custom gas cap are optional for contract deployment;
users can self-relay before an operator relayer service is activated. Settings accept chain suffixes, for example
`PRIVACY_POOL_OWNER_1`, `PRIVACY_ASP_POSTMAN_4663` and `PRIVACY_DEPLOY_GAS_BUDGET_ETH_1`. Empty or absent
chain-specific values fall back to unsuffixed defaults. Owner and publisher may share a wallet, and the deployment sender may be either. A configured operator relayer uses a separate account. A custom gas cap is compared with the simulation; when absent, broadcast still requires enough actual wallet balance. Simulation reports funding gaps without sending transactions.

Preparation profiles: [Ethereum](../../config/ethereum-mainnet.env.example) and
[Robinhood Chain](../../config/robinhood-mainnet.env.example). To offer both after verified deployment,
select `PRIVACY_CHAIN_IDS=1,4663` and `VITE_PRIVACY_CHAIN_IDS=1,4663` with protocol `hylsia-pp-v2-eth`.
`VITE_` values are public. Ethereum's public fallback is [PublicNode](https://ethereum.publicnode.com/);
production indexing requires suitable provider access.

## Separate release and deployment per network

Complete the independent [ceremony](mainnet-ceremony.md) and release review first. Initial keys are not
production final keys. Circuits are shared; the pool/chain scope separates notes and proofs. The release
builder still creates a content-bound package for one specific target chain.

Use `--network ethereum-mainnet` or `--network robinhood-mainnet` with ceremony preparation, release build
and native ETH deployment. Omitting it retains the previous Robinhood target. Command usage:

```sh
npm run zk:v2:release:build -- --help
npm run zk:v2:deploy:native-eth -- --help
```

Actual final zkeys and a verified source workspace are required. Example paths are placeholders, not
available release files. The deployer rejects a package for another chain before RPC or signer access.
Reviewed release entries bind the chain ID, protocol, release ID, manifest digest and actual review evidence.
The reviewed-release registry is empty, so the default reviewed deployment routes remain blocked.
The separately authorized Ethereum package uses `--operator-authorized` and exact evidence in
`config/operator-mainnet-deployments.json`; this does not open the application's mainnet gate.

Ethereum source verification uses Ethereum Blockscout; Robinhood uses Robinhood Chain Blockscout. Records
are generated only after actual receipts and runtime checks, under `contracts/deployments/1.json` and
`contracts/deployments/4663.json`. The [Ethereum record](../../contracts/deployments/1.json) now exists;
there is no Robinhood mainnet deployment record.

After reviewed deployments, stage each exact artifact directory at `client/public/zk-v2-eth/<its-releaseId>/`.
Deployment sync accepts `--v2-release-1` and `--v2-release-4663` to validate both packages in one run.
The older `--v2-release` option remains available for a single package. Each record is checked against
its own package, published manifest and onchain verifiers.

## Local checks

```sh
npm run zk:v2:deploy:smoke -- --network ethereum-mainnet --env-signer-local
npm run zk:v2:deploy:smoke -- --network robinhood-mainnet --env-signer-local
```

Each test owns disposable Anvil on localhost:8552, with derived Anvil keys and development verifiers.
The user's mainnet key is never used. Tests check simulation, local signatures/receipts, protocol/scope,
pool/verifier runtime, library links and immutables, plus generated Forge output for test-key persistence.
These are local results, not public deployments, final ceremony evidence or browser validation.
