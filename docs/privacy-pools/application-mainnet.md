# Testnet and Ethereum application profiles

The upper-right network menu offers **Testnet** (Robinhood Chain Testnet, chain `46630`) and
**Mainnet** (Ethereum, chain `1`). Ethereum uses the [existing native ETH deployment](../../contracts/deployments/1.json)
at `0xAC84cFAC0a7C55760197b0681576CD27837cCfea`, with the exact finalized v2 artifact bundle.
Robinhood Chain mainnet is not offered because no pool is deployed there.

The project owner explicitly authorized enabling deposits and withdrawals for this single-operator
Ethereum release. This is not an independent security audit. The generic reviewed-release deployment
gate remains unchanged; application activation accepts only this fixed pool, release ID, manifest,
deployment block and both verifying-key pins. An environment variable cannot authorize a different pool.

## Switching and recovery

Choosing a network locks the current vault and reloads the application with that protocol profile.
The selected public environment is carried in `?environment=ethereum-mainnet` or
`?environment=robinhood-testnet`; it is preserved in internal navigation. Canonical Ethereum pool URLs
also select the Ethereum profile. A wallet network change is requested separately and requires the
wallet's confirmation. Switching is unavailable while a transaction or proof operation is in progress.

Testnet v1 and native ETH v2 use distinct seed derivation, authenticated backups, encrypted vaults,
activity keys and storage namespaces. A testnet backup cannot be imported as a mainnet backup.
Existing testnet vaults, notes, balances and frozen proving assets remain unchanged. Verify the new
mainnet vault's encrypted backup before depositing. Switching networks never bridges funds.

The server can serve both pools with a protocol-specific configuration per chain. Each browser profile
shows only its own pools and statistics; real ETH balances and testnet balances are never added together.
Wallet transports remain restricted to the selected profile, and ENS resolver metadata is removed from
wallet chain configuration to avoid automatic address lookups.

## Publisher and withdrawal operation

The Ethereum ASP publisher signs **manually in its wallet**. Connect the current publisher account on
the mainnet vault page to see **ASP publisher → Publish eligibility root**. The application rebuilds the
proposed root from complete, verified local public history, checks the chain and current publisher,
rejects an already-published root or a pending publisher nonce, and simulates before requesting a wallet
signature. Its busy state blocks concurrent vault transactions and profile switching.

The publication includes a public eligibility recipe; it does not send note secrets or a wallet key to
the server. The UI shows the eligible deposit count and snapshot block before the operator signs.
Every publication spends the publisher wallet's Ethereum gas only after that wallet approves it.
No publication or mainnet deposit/withdrawal was submitted during implementation.

On Ethereum, deposits require **12 confirmations** and the configured **one-hour inclusion delay**,
followed by a publisher-approved root that includes them. The publisher must return to post due roots;
this mode does not run an automatic mainnet publisher. The server accurately reports its own publisher
as unavailable when no service key is configured, while the deposit form explains wallet publication.
Readiness reports a pending manual action as `walletPublicationDue`; it does not remove the wallet
publisher's UI from service for lacking an automatic signer or schedule. Invalid policy data still
fails readiness and blocks new mainnet deposits. Mainnet deposits also require a fresh, supported
screening status before the application requests a wallet transaction.

Mainnet withdrawals default to **pay your own gas**; an operator relayer is optional. The proof binds
the recipient, fee, deadline, pool and chain. The gas-paying wallet is publicly visible. An unspent note
can also use the public exit from its original depositor wallet without ASP approval. A deposit is not
privately withdrawable before its eligibility root is published.

No owner/deployer key is reused as a service key. Unsuffixed testnet relayer/publisher secrets never
fall back into the Ethereum configuration. If separate services are configured later, only explicit
`PRIVACY_RELAYER_PRIVATE_KEY_1` / `PRIVACY_ASP_POSTMAN_PRIVATE_KEY_1` (or their `_FILE` forms) apply.

## Build and hosting

Production builds enable the authorized mainnet application by default. Local development can enable
it with the two public values in [the application profile](../../config/application-mainnet.env.example):

```dotenv
PRIVACY_ENABLE_MAINNET_APP=true
VITE_PRIVACY_ENABLE_MAINNET_APP=true
```

Set both to `false` to retain a testnet-only application. They select the already-authorized application
feature; they do not establish an audit, unlock arbitrary networks, or authorize deployment signing.
Stage the exact final package before building a fresh checkout:

```sh
node --import tsx scripts/privacy/v2/stage-application.ts \
  --release releases/ethereum-mainnet-eth-v2-2026-11-22-single-operator
npm run check
npm test
npm run build
npm run zk:v2:e2e -- --native-eth-local
```

The seven staged public files live in `client/public/zk-v2-eth/<releaseId>/` and must be included in
hosting deployment. Their exact-byte manifest SHA-256 is
`546ae336183d51bf580d7118b5a945581d6d2bdbb988b12d305e338350e55c32`.
Initial ceremony and development keys are not staged. Deploy the updated client and server together;
changing this checkout does not publish a new build to the hosted website.

Vercel uses the native ESM entrypoint `api/index.js`, which imports
`dist/serverless/index.mjs`. `npm run build` creates this bundle alongside the client and standalone
server. It includes internal TypeScript modules and the public deployment JSON; npm dependencies
remain external for Vercel to trace. `vercel.json` includes the serverless bundle explicitly and routes
`/api/*` to the JavaScript entrypoint. Do not replace the build command with a client-only build.

An `ERR_MODULE_NOT_FOUND` referring to `/var/task/server/routers` means an older, unbundled API was
deployed. Redeploy the updated source with `npm run build`, then check `/api/health` for HTTP 200 and
`ok: true` before checking `/api/trpc/privacy.networks` and `/api/trpc/privacy.pools`. This failure happens
before any RPC request and does not require redeploying the pool contract. The regression test in
`server/_core/serverless.test.ts` builds the actual artifact and checks these routes, plus a batched ASP
query, using native Node from an isolated deployment directory without source files or `.env`.

## Validation on 22 November 2026

Application and privacy-script type checks passed, along with **647 tests in 41 files** and the production
build. The owned-Anvil native ETH E2E passed wallet-only ASP publication with no publisher key configured
on the server, real relayed and self-paid withdrawals, encrypted backup recovery, duplicate deposits
and the public exit. These are local development-proof tests, not live-mainnet fund transactions.

Local HTTP checks served both application routes and the exact manifest plus all six final proving
files. All seven build copies matched byte-for-byte; all 37 frozen v1 hashes remained unchanged.
Visual browser inspection was unavailable because the computer-use browser host was offline. The
updated build has not been published to production hosting.

After fixing the Vercel API packaging, **648 tests in 42 files**, the application type check and the
full production build passed. The added native Node test served health, pools, networks and a batched
ASP query from the isolated build, and checked relayer CORS behavior. All 37 frozen v1 files still
matched their SHA-256 pins. These checks validate the local build; the hosting fix still requires a
new Vercel deployment and live endpoint checks.
