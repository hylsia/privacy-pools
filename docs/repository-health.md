# Repository health review — 22 November 2026

## Scope and evidence

This review compares the local checkout at `b46edcbb82a36dfb7410e2b84032e00cf8ebd4b7`
with the public repository `hylsia/hylsia_privacy_pools`, using read-only GitHub API queries,
Git history, tracked files and a production npm dependency audit. It is not an independent security
audit and does not reproduce a new Zauth score. The user supplied the detailed **15/100** scan
narrative during this review. Its raw machine-readable result and scan identifier were not provided.
The scanned public tree has 397 files, consistent with the supplied report; the local tree has newer work.

[Zauth's documentation](https://www.zauth.inc/docs/reposcan) describes originality, repository age,
commit history, contributor diversity and development effort as score inputs. It does not publish
weights that would let this review calculate a reliable score increase. CI, documentation and
security policies are useful project improvements; their direct score effect is unconfirmed.

## Public GitHub snapshot before these changes

| Signal | Observed value |
| --- | --- |
| Public repository | [hylsia/hylsia_privacy_pools](https://github.com/hylsia/hylsia_privacy_pools) |
| GitHub creation time | 21 November 2026, 16:57:06 UTC (22 November, 00:57:06 Asia/Makassar) |
| Last push | 21 November 2026, 16:59:51 UTC |
| Public default branch head | `2a37ecb32cc5980ae3e95ccb35bbc8b13e813c5e` — `Update smartcontract` |
| Branches | One, `main`; GitHub reported `protected: false` |
| GitHub contributor accounts | `nemesisd-d` (20 contributions), `hylsia` (1); account counts do not prove independent reviewers |
| Stars / forks | 0 / 0 |
| GitHub releases / workflows | None / none |
| Repository metadata | No homepage, no topics, no detected root license; description still refers only to Robinhood Chain |
| Public Ethereum deployment record | `contracts/deployments/1.json` returned HTTP 404 |
| Public API build | Older build script without `build:serverless` |

Source history begins on 17 November, before this public GitHub repository was created. Retained
source history and GitHub creation time describe different events; do not rewrite dates or authors
to make the repository look older. The local `main` contains 22 commits attributed to one author.

The checkout's configured `origin` is `nemesisd-d/privacy-hylsia`, which returned HTTP 404 to an
unauthenticated public API request. This does not establish whether it is private, removed or
otherwise unavailable. The cached `hylsia/main` history matches the observed public head, but there
is currently no configured remote named `hylsia`.

The two histories diverge after `ee97e4f49bced54e926657491bab7468a163dc71`:
the public side has `f940f5b` and `2a37ecb`, while the local side has `1069758`, `a2c6d23`, and `b46edcb`.
Do not force-push the local branch over the public branch. Reconcile both sides in a reviewed PR,
including the public-only source/documentation changes. Until then, a scan of the public repository
cannot evaluate the local mainnet record or API fix.

## Assessment of the supplied Zauth report

The score's stated primary rationale is provenance, rather than a demonstrated contract exploit.
Several observations are real, but the report treats them as conclusive evidence beyond what they show:

| Report claim | Evidence-based assessment |
| --- | --- |
| Commits before GitHub creation are impossible without fabricated dates | Incorrect. GitHub explicitly supports [importing an existing local Git repository](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github). A GitHub container can be newer than its imported commit history. |
| A commit dated before repository creation is necessarily backdated | Not established by that comparison. All 22 local commits have equal author/committer timestamps. Both fields are user-controlled, so equality does not independently authenticate the dates either. |
| No public profile activity proves a fake contributor | Not established. GitHub documents [contribution eligibility, email linkage, visibility and update delays](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions). The public API attributes 20 commits to `nemesisd-d`; that association is not a verified signature or proof of a separate real-world contributor. |
| Code style establishes that the source was hand-written without AI | Not established by comments, complexity or style. Assess source behavior and attributable evidence instead. |
| The unexamined contracts are Solana files and the application uses Helius RPC | The reviewed contracts are Solidity and configured networks are EVM chains. Neither the local nor cached public application/protocol source contains a Helius reference. Solana-related transitive SDK packages do not establish a Solana pool implementation. |

The 22 local commits are unsigned (`git log` signature status `N`). This review does not authenticate
the author's identity or independently attest when each file was written. Begin signing future
commits using an account-associated key and preserve historical commit IDs; do not rewrite history
to manufacture verification. See [GitHub signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).

Independent chronological evidence: a public read-only Robinhood Chain Testnet RPC check returned
successful deployment transaction
[`0x3ee049e43af2f4e13f6cbff628a81a8dc623a88badda1497febc47677cea92f0`](https://explorer.testnet.chain.robinhood.com/tx/0x3ee049e43af2f4e13f6cbff628a81a8dc623a88badda1497febc47677cea92f0)
for pool `0xbBc4362133e4d50157206Cc907909d0C0211913f`, block **154136462**,
timestamp **16 November 2026, 16:06:17 UTC** (**17 November, 00:06:17 Asia/Makassar**).
This precedes the public GitHub repository's creation. It demonstrates that the contract deployment
existed earlier, not that every file or commit date is authentic or that the protocol is safe.
The [provenance evidence](security/repository-provenance-2026-11-22.json) records the exact receipt
fields and observed commit timestamps without changing them.

The repository's youth, limited contributor diversity, unsigned history, absent hosted CI/review
process, missing independent audit, v1 H-01 and operator-controlled eligibility remain real issues.
Correcting a scan's unsupported fraud inference does not resolve these risks. An English
[review-request draft](zauth-review-request.md) is prepared; it has not been sent to Zauth.

## Production dependency findings

`npm audit --omit=dev --json` reported **47 affected package entries: 1 critical, 29 high and
17 moderate** against this lockfile on 22 November. These are dependency/advisory classifications,
not 47 demonstrated application exploits; inherited findings can count several packages in one chain.
Dependencies were not upgraded in this repository-hygiene change.
The [machine-readable summary](security/repository-dependency-audit-2026-11-22.json) records the
lockfile SHA-256, severity counts, direct affected dependencies and advisory references.

Priority items:

- `proxy-addr` 2.0.7: [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
  patched in 2.0.8. The advisory concerns unsafe trust-subnet configurations; this review found no
  `trust proxy` setting or IP-based authorization in Hylsia. That is not a general exploitability proof.
- Direct `zod` 4.3.6, plus inherited Zod 3 versions:
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), patched in 4.6.6.
  Review API input limits and dependency compatibility; replacing all Zod 3 instances with 4 by
  override is not a safe assumption.
- Direct `nanoid`, and inherited wallet/connector dependencies including `ws`, `axios`, `uuid`,
  and Reown/WalletConnect packages also appear in the audit report. Some suggested fixes require
  a major `wagmi` upgrade. Plan a separate dependency remediation with wallet, network-routing,
  proving and native Node API regression checks; do not apply `--force` blindly.

The scheduled audit deliberately reports failures until findings are remediated. A passing functional
test suite must not be described as a clean dependency audit.

## Improvements prepared in this checkout

- CI for application and release-script types, tests, production build and Solidity fixture/fuzz/invariant tests.
- SHA-pinned GitHub Actions, read-only token permissions, disabled persisted checkout credentials,
  bounded job timeouts, and no deployment or production signers.
- A fresh-clone artifact check that only omits the explicitly known, untracked local build/ceremony
  paths. Missing or altered public frozen files still fail; the default full-workspace check is unchanged.
- Weekly Dependabot proposals and a separately scheduled production dependency audit.
- Security reporting policy, contribution guide, bug-report and PR templates.
- Root MIT text matching the existing package declaration, with existing per-file and upstream
  license notices preserved and documented separately.
- GitHub classifications for vendored Forge Standard Library and generated proving/verifier artifacts.
  These are attribution aids, not a claim that third-party similarity disappears from RepoScan.

## Remaining maintainer actions

1. Reconcile the divergent repository histories and publish these real changes to the intended public
   repository through a PR. Do not discard the public-only changes.
2. Let hosted CI run, then configure required checks and review on `main`. No GitHub settings were
   changed by this local review. Keep public dependency alerts and security reporting available.
3. Remediate and re-audit dependencies in a focused change with the appropriate regressions.
4. Publish an accurately scoped release with commit, chain, contract, artifact hashes, validation,
   known limitations and trust model after checking its contents. A local tag is not a GitHub release.
5. Set the public repository homepage, description and topics to reflect both actual deployments.
6. Invite genuine external review and contributions. New branches should represent actual work;
   extra identities, synthetic commits, bought stars or rewritten dates do not establish trust.
7. Re-run Zauth against the updated public repository and retain its full report. No target score is
   guaranteed, and age/community signals develop over time.

## Validation of this change

A disposable copy of tracked source plus these new files, with no `.env`, ignored local circuit
builds, ceremonies, release workspaces or local deployment records, passed:

- Application and privacy-script TypeScript checks.
- The 17-file committed v1 artifact check; the original checkout's full 37-file freeze also passed.
- **654 application tests in 43 files**, including native Node API startup and six artifact-scope regressions.
- The complete client, standalone server and Vercel API build.
- **73 Solidity tests in eight suites**, with 256 fuzz runs and stateful invariants bounded to 64 runs
  at depth 32, using Foundry 1.7.1 and solc 0.8.28.

The disposable copy reused installed `node_modules` through a symlink; it was not a clean dependency
installation. Workflow YAML parsed successfully and action references were resolved from official
GitHub repositories to commit hashes. Hosted runner execution, a fresh `npm ci` there, branch
protection and a new Zauth score remain unverified until publication. No key, onchain transaction,
repository push, external report, or GitHub settings change was made.

Mainnet remains a single-operator, unaudited deployment. The v1 H-01 finding, independent review,
browser/production operations and any previously exposed signer material require their own handling;
repository metadata does not resolve them.
