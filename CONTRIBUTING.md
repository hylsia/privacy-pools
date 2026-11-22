# Contributing to Hylsia

Start with the [README](README.md), [security policy](SECURITY.md), and the
[protocol documentation](docs/privacy-pools/README.md). Use English for code comments,
documentation, issues, and pull requests.

## Scope a change

Open an issue or discussion for substantial protocol, cryptography, recovery, licensing, or public
API changes. Report exploitable vulnerabilities privately. Choose a focused branch such as
`fix/serverless-startup` or `feat/vault-recovery` and explain its purpose in the PR.

Preserve real author attribution and commit dates. Credit upstream dependencies and generated code.
Do not create commits, authors, branches, stars, or forks merely to influence a repository score.

## Development

Node.js 24 and npm 11.6.2 are the CI toolchain; `.nvmrc` selects Node 24.
Solidity tests use Foundry v1.7.1 and the compiler pinned in `contracts/foundry.toml`.
Install dependencies with `npm ci`. No production signer or `.env` file is required for checks.

```sh
npm run check
npm run check:privacy-scripts
npm run check:artifacts
npm test
npm run build
npm run zk:contracts:test
```

`check:artifacts` verifies the Git-tracked subset of the historical v1 freeze on a fresh clone.
The original full inventory also contains ignored local build/ceremony files; a release workspace
must additionally run `node --import tsx scripts/privacy/check-frozen-artifacts.ts` without flags.
Do not rebuild v1 keys or circuits to make a check pass. The production build must include both
the client and the Vercel API bundle.

CI bounds stateful invariant tests to 64 runs of depth 32 and retains 256 fuzz runs. An extended
release review must document its own larger budgets and results. E2E, ceremony verification, browser
wallet validation, and independent review are separate tasks; a green PR does not claim them.

## Review and dependencies

Describe the problem, resulting behavior, validation actually performed, and remaining risks.
Keep generated proving artifacts and deployed source unchanged unless a separately versioned
protocol/release change requires them. Use fixture proofs for routine contract regressions.

Review dependency updates, especially wallet connectors, cryptographic tooling, and major versions.
Do not run `npm audit fix --force` as a routine cleanup. The scheduled production audit reports
known findings rather than suppressing them or treating them as proof of exploitation.

Only use synthetic secrets and local test accounts in fixtures. Keep `.env`, private service
configuration, signing keys, decrypted vaults, and credential-bearing RPC URLs out of Git and logs.

## Maintainer workflow

Merge real changes through reviewable PRs. Maintainers should configure protection for the public
`main` branch after the `Application checks` and `Solidity tests` jobs have run successfully.
Use required checks and review; creating a local workflow file does not enable branch protection.

The public Hylsia repository and this checkout had divergent commits during the 22 November review.
Reconcile the histories in a PR before publishing these changes. Preserve the public-only work;
do not force-push one history over the other. See [the recorded review](docs/repository-health.md).
