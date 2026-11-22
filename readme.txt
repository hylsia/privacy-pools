HYLSIA PRIVACY POOLS - PROJECT README
=====================================

Built for Robinhood Chain Testnet. Testnet ETH only. Not audited.
Last updated: 2026-11-19. All times are UTC+08:00.

This file records what has been built for Hylsia so far, how to run it and what is still open.
The detailed English developer documentation is docs/privacy-pools/README.md.
No private key or other secret is written in this file, and none should ever be added to it.

CONTENTS
--------
  1. Overview in plain language         7. Funding the relayer and publisher
  2. Current status                     8. Tests and checks
  3. What was built                     9. How privacy is protected
  4. Running it on this Mac            10. Security notes
  5. Wallets, usage and updates       11. History
  6. Deploying a pool                  12. Open items and next steps

1. OVERVIEW IN PLAIN LANGUAGE
=============================

Hylsia is a privacy pool for ETH, built for Robinhood Chain Testnet (chain id 46630).

- A privacy pool is a shared vault. You deposit ETH and later withdraw it to another address.
  Deposits and withdrawals are public on the chain. What stays hidden is the link between them:
  each withdrawal carries a zero-knowledge proof that says "this money comes from one of the
  approved deposits in the pool" without saying which one.
- Note: the secret your browser keeps for each deposit; it is what lets you withdraw. All notes
  come from one seed, kept in an encrypted vault on your device and in a backup file you download.
  You can withdraw part of a note; the rest stays in the pool as a new "change" note.
- Association set: the deposits that may leave privately. The publisher (the "postman") posts its
  root on the chain. A screening policy decides who is in it (section 3.8, and the page
  /pools/screening): on testnet a deposit becomes eligible 1 hour after its block time, then waits for
  a root that includes it, unless the operator's exclusion list names it. Each root's on-chain record says which deposits it counts
  and which it leaves out, so every device rebuilds and checks the list itself.
- Excluded deposit: one the screening policy keeps out of the set, or takes out later. It cannot
  be withdrawn privately with this app; the public exit below still returns it to the address
  that made it.
- Relayer: a server wallet that sends your withdrawal and pays its gas, so the receiving address
  never needs ETH first. Its fee is 0.5% of the amount. It cannot redirect the money: recipient,
  relayer, fee and deadline are fixed inside the proof.
- Ragequit: the public exit, independent of ASP approval and the relayer. It requires an unspent
  note, a matching proof, the original depositor's wallet and gas, and returns the remaining value
  there. It reveals the deposit label; exiting change can also link earlier partial withdrawals.
  Reused-nullifier notes are a proven exception (H-01), so do not reuse note derivation indexes.
- Anonymity set: how many deposits a withdrawal hides among. Bigger is better. Amounts and timing
  can still link a withdrawal to a deposit; the vault's privacy check warns about that.
- No liquidity is needed: the pool holds only users' own deposits; nothing is lent, traded or
  priced. It is not a bridge like Wormhole either: deposit and withdrawal happen on one chain.
- Users do not create pools. There is one shared pool per asset per network, deployed by the
  operator. More can come later: Robinhood Chain mainnet after an audit, or ERC-20 tokens with a
  contract variant. Each pool is its own crowd: deposits in one do not hide withdrawals in another.

2. CURRENT STATUS (2026-11-19)
==============================

- Phase 6 local security review, targeted tests and findings are recorded in docs/security/findings.md.
  RELEASE BLOCKED: duplicate note derivation can strand a second deposit when the same backup is used
  concurrently across profiles/devices (H-01, proved with real proofs). Same-origin multi-tab writes
  now coordinate with Web Locks; this does not solve cross-device allocation. No independent audit.
- Phase 7-9 are concretely prepared in docs/privacy-pools/release-checklist.md, not completed.
  No hosting deploy, funding, public transaction or explorer source publication was performed.
- The existing pool is live on Robinhood Chain Testnet (public read-only check, 2026-11-18):
  - Pool address: 0xbBc4362133e4d50157206Cc907909d0C0211913f
  - Deploy block: 154136323, where the app starts reading the pool's events. The pool itself was
    created in block 154136462, at 00:06 on 2026-11-17 (the last of the five deploy transactions).
  - Owner and deployer: 0x2629cCae35E1e6F5958ed618a75DE28d08763bC4 (your own wallet)
  - Association-set publisher (postman): 0x4D62c8c148a847788C385b436ed760BDe5b1b80C
  - Relayer: 0x3C28c48d6a7398244Cf50787f0E5fC6Ac1E172F9
  - Withdraw verifier: 0x7594c1923973Ee026040e935DF93244A41de7977
  - Commitment verifier: 0xfB1BFc18294a884B040f3e4B633A08f1D577ffE2
  - Deployment cost: 10.5 M gas in 5 transactions, 0.000105 ETH at 0.01 gwei (from the receipts)
  - Record: contracts/deployments/46630.json and shared/privacy/deployments.ts
  - Explorer: https://explorer.testnet.chain.robinhood.com (release verification remains open
    in Phase 7; no verification command was run in this documentation task)
- Latest on-chain check, 2026-11-18 (RPC head observed: 155043818): the pool is open
  (dead = false), with 0 deposits, 0 ETH and currentASPRoot = 0 (no association-set root posted).
  These are observations from that check, not values guaranteed to stay current.
- In the same check, the relayer and the publisher each held 0 ETH. Until they are funded
  (section 7):
  - no root can be posted, so a new deposit cannot be withdrawn privately yet;
  - the relayer shows as unavailable, so a private withdrawal would need "Pay your own gas";
  - ragequit, the public exit, works at any time.
- The latest code and production build have been validated locally. A public site's URL and
  deployed commit have not been verified in this work; a local commit/build does not update a
  hosted site automatically. The local app runs with npm run dev at http://localhost:3000.
  The existing pool's page there:
    http://localhost:3000/pools/robinhood-testnet/0xbBc4362133e4d50157206Cc907909d0C0211913f
- Phase 4, screening policy v1 (section 3.8), is built and tested on local chains. A new deposit
  waits 1 hour, then for the next root that includes it, before a private withdrawal can start.
  A funded, healthy publisher on a continuously running server normally adds up to one interval
  (600 s); an unfunded or stopped publisher makes the wait longer. With no exclusion list
  configured, no deposit is excluded. The policy text and other owner decisions in 12.2 remain
  open even where the corresponding behavior is already implemented.
- The proving keys come from a development setup, not a public ceremony. Nothing is audited.
- Latest functional validation, after the EVM wallet fix (d66a501): TypeScript, 503 unit tests
  in 22 files, 24 contract tests, the two-local-chain e2e (78 s) and the production build passed.
  Browser checks covered the landing, responsive dashboard controls and the real Connect modal
  showing only MetaMask and Rabby. Wallet switching was exercised with simulated providers;
  no live deposit, withdrawal or public exit was signed in that review (section 8).

2.1 RELEASE PHASES: IMPLEMENTED VS STILL OPEN
--------------------------------------------
Phase  Status                     Evidence / remaining work
1      Complete                   Git initialized; first commit 5328dd0, tag pool-46630-v0.1;
                                  secrets and build outputs excluded from version control.
2      Code cleanup complete      Legacy trading app removed; npm only; package named hylsia;
                                  approved unused landing files and privacy.status removed.
                                  Operator-owned secret-file housekeeping remains in 12.1.
3      Implemented and tested     Activity log and pending-deposit reservations encrypted from
                                  the vault seed; legacy migration, Lock and Forget covered.
4      Implemented and tested     Inclusion delay, exclusions/removals, verified roots, note
                                  states, public policy page, 16-root window measurements and
                                  manual eviction burst. Owner decisions remain in 12.2.
5      Implemented and tested     Verified static snapshots with full-history fallback,
                                  configurable relayers and browser-only custom RPC settings.
6      Reviewed locally;          Real-proof fuzz/invariant, boundary/rollback/recovery tests,
       release blocked            Slither/circomspect triage and findings recorded. H-01 remains
                                  High across devices/profiles. Active artifacts remain frozen.
7      Not completed              Generic verification examples exist in the developer README;
                                  prepare commands for every deployed contract/library and
                                  request owner approval before running them.
8      Not completed              An npm-based Dockerfile and Vercel config already exist.
                                  The chosen release target is a long-running Docker server:
                                  finish deploy config, health check, security headers/CSP,
                                  host secret-store setup and the exact permanent warning.
                                  Warning: "Testnet only. Not audited. Development trusted
                                  setup. Do not use real funds."
                                  Stop before the real deploy command for login/confirmation.
9      Not completed              Funding instructions exist in section 7. Fund both service
                                  wallets, then complete the live-site deposit -> screened root
                                  -> relayed withdrawal -> public exit with owner signatures
                                  and on-chain verification. Finish the release checklist/docs.

Additional work after Phase 5 (complete locally):
- e957e39: landing overflow/wrapping, honest status messages and home-link behavior.
- b0faf40: separate dashboard network/account menus, neutral reconnect state, explicit switching,
  cancellation/pending feedback and compact layouts.
- d66a501: only MetaMask and Rabby EVM connectors; no Phantom discovery/restoration; exact
  provider references and explicit connector selection for wallet-paid operations.

The next release gate is H-01 remediation/design review, followed by the unexecuted Phase 7-9
checklist. This work does not publish the site/source, move funds or change the existing pool.
Mainnet remains out of scope. See the 2026-11-19 security update below for current local evidence.

3. WHAT WAS BUILT
=================

3.1 POOL CONTRACTS, CIRCUITS AND SHARED LOGIC
---------------------------------------------
- circuits/withdraw.circom: the private withdrawal, full or partial, with its change note.
  circuits/commitment.circom: ragequit. circuits/lib/merkleProof.circom: the Merkle proof.
- Groth16 proofs (snarkjs 0.7.6; circom 2.2.3 from the circom2 npm package) with Poseidon hashes.
- contracts/src/PrivacyPool.sol: the native-ETH pool. MerkleTreeWithHistory.sol: a depth-20 tree
  that keeps its last 100 roots. contracts/src/verifiers/: the generated proof verifiers.
  contracts/script/Deploy.s.sol: the deploy script. contracts/test/: tests with real proofs.
- Admin powers, all public: the owner can windDown() (stops new deposits only), setASPPostman,
  setMinDeposit and transferOwnership; the postman can updateASPRoot (the last 16 roots count).
  No upgrade or proxy, no pause on withdrawals, no access to users' funds.
- client/public/zk/: the proving files the browser downloads, with manifest.json (the sha256 of
  each file, checked before use). Built 2026-11-16 15:54; the live verifiers match them.
- shared/privacy/networks.ts: the network registry, the one source of network facts: Robinhood
  Chain Testnet (46630), plus local chains 31337 and 31338 for development and tests only. The
  code can serve several networks side by side and always tells pools apart by chain and address.
- shared/privacy/deployments.ts: the pool records; only the deployment sync writes it (section 6).
- The rest of shared/privacy/: notes, the encrypted vault and backup (vault.ts), reading pool
  events (indexer.ts), the association set, the prover, and the privacy check's crowd model
  (guidance.ts, simulate.ts).

3.2 SERVER AND SCRIPTS
----------------------
- server/privacy/router.ts: the public privacy.* API: networks, pools, poolDetail, poolActivity,
  asp.status/set/publish and relayer.quote/submit/status. (The deprecated privacy.status was
  removed in Phase 2; use privacy.networks.) None takes a new input in Phase 4.
- relayer.ts: checks and sends withdrawals and pays their gas (fee 0.5%; a quote is valid 900 s).
  Since Phase 4 it also refuses, before anything is simulated, a proof made against an older
  association-set root that holds an excluded deposit (section 3.8; needs your approval).
- asp.ts: builds each pool's screened set from public events, block times and the exclusion list
  (screening policy v1), posts its root with its recipe as the record, and answers asp.status
  (with the screening block), asp.set and asp.publish.
- exclusions.ts: reads the operator's exclusion list (a file, or inline JSON for serverless); an
  invalid list pauses publishing. blockTimes.ts: block times shared by the publisher and the
  dashboard. evict.ts: the opt-in eviction burst (section 3.8, asp-window.md).
- autoPublish.ts: the periodic publisher (every 600 s by default, long-running server only); it
  also posts right after an edit of the exclusion file that removes a member.
- funding.ts: whether the relayer and publisher can pay for their next transaction (read at most
  every 30 s, the same answer for every visitor).
- pools.ts: the dashboard figures. config.ts: reads the environment; it prints addresses, never
  keys. server/_core/loadEnv.ts: loads .env and gives each connection attempt 1 s.
- shared/privacy/screening.ts: the screening policy itself, pure code shared by the publisher and
  the device (the recipe, the exclusion-file format, the root checks, the note states).
- config/asp-exclusions.example.json: the empty exclusion list to copy; the live list,
  config/asp-exclusions.json, is git-ignored because it may hold notes.
- scripts/privacy/: deploy.ts (section 6); sync-deployments.ts and deploymentRecords.ts (check the
  records, write shared/privacy/deployments.ts); asp-publish.ts (prints the policy, the snapshot
  and the publisher's balance, then posts any root that is due; --dry-run shows what an edit of
  the exclusion list would change; --evict previews the eviction burst and --evict --yes with
  --chain <id> sends it); e2e.ts (section 8); build-circuits.ts and gen-fixtures.ts (proving keys
  and test fixtures; not routine, see section 10).

3.3 THE VAULT (/pools/vault)
----------------------------
- Create a vault (a password of at least 8 characters), then export the backup and verify it:
  deposits stay locked until the backup is verified. A backup restores the vault on any device.
- Tabs: Deposit, Withdraw, Notes, Activity, Backup & recovery, Privacy & trust.
- Backup v2: one seed and one backup file for every network (PBKDF2-SHA256 with 600,000 rounds,
  then AES-256-GCM). Old v1 files still import, and older browser storage is moved over
  automatically (client/src/privacy/migrate.ts).
- The privacy check in the Deposit and Withdraw forms replaced the removed simulator:
  - standard amounts 0.01 / 0.05 / 0.1 / 0.5 / 1 / 5 ETH, each with how many others used it;
  - the pool size, shown before each action;
  - an estimated anonymity set with a verdict: Linked (1), Weak (under 10), Moderate (under 50)
    or Strong (50 or more);
  - a recommended waiting time.
  Two reviews and a fix stage hardened it: the exact-amount and timing tests are combined, there
  is no verdict without timing data, and the activity list is used only when it belongs to the
  vault's own pool (shared/privacy/guidance.ts, client/src/components/privacy/PrivacyCheck.tsx).
- Every wallet transaction names its own chain; a wallet on another chain is refused before
  anything is sent (client/src/privacy/walletChain.ts).
- Activity tab: this device's log of your deposits, withdrawals and exits, encrypted with a key
  derived from the seed (client/src/privacy/activityStore.ts):
  - HKDF-SHA256 over the seed (fixed salt, info "hylsia-activity-log:v1") gives an AES-256-GCM
    key that cannot be exported. It is kept in memory only while the vault is unlocked.
  - hylsia.pp.activity.v3 holds only {format, version, iv, ct}, with a fresh IV on every write;
    the additional data binds the format, the version and the vault's fingerprint.
  - Nothing of the log is read before unlock; pending entries are checked on the chain after it.
    That check holds no key; locking stops it once its current 15-second wait for a receipt ends.
  - On unlock a plaintext log from an older version (hylsia.pp.activity.v2, or a single-network
    build's per-pool log of this vault) is merged in by entry id, written encrypted, and only
    then deleted. A log that does not decrypt is set aside (hylsia.pp.activity.quarantine) and
    the tab says so.
  - Deposit-index reservations are encrypted the same way, bound to their pool. A list this vault
    cannot decrypt is never deleted or overwritten; a deposit on that pool stops and says why.
  - A tab whose vault was forgotten or replaced, in that tab or another one, writes nothing more.
  - Lock during an operation happens as soon as the operation has finished and written its
    outcome with the vault's key; the Lock buttons say so. Forget works at once: the operation
    may still complete on the chain, but nothing more of it is kept on this device.
- Other files: client/src/pages/Vault.tsx, client/src/components/privacy/ (VaultPanel,
  DepositPanel, WithdrawPanel, NotesPanel, ActivityPanel), client/src/privacy/PrivacyProvider.tsx.

3.4 THE DASHBOARD (/pools)
--------------------------
- Rewritten from a liquidity-analytics layout into privacy-pool terms: the anonymity set first,
  then pool balance, activity, net deposits and privacy health. ETH only: no prices, no USD.
- Pool page: charts, privacy health, governance and the public activity. My notes (/pools/portfolio,
  once called "Portfolio"): your notes and private balance, worked out on your device.
- Testnet polish: an empty-pool state with a "Make a deposit" pointer; honest relayer and
  publisher states when they have no gas, with "Pay your own gas" as the alternative; the
  first-root deadlock fixed (a new pool can get its first root); a responsive Pools table.
- The trading links were removed. The old /privacy vault page was merged into /pools/vault.
- Files: client/src/pages/Pools.tsx, PoolPage.tsx, Portfolio.tsx, PoolAddressRedirect.tsx;
  client/src/components/pools/.

3.5 THE LANDING PAGE (/)
------------------------
- An immersive night-scene parallax: a moon, a fox and a dive through clouds in the hero (approved
  by the owner), then How it works, The proof, What stays private, Guarantees, Network, FAQ, the
  closing call to action and the footer.
- Hero text: "Privacy Pools · built for Robinhood Chain Testnet". While the pool is live, the main
  button is "Open your vault".
- Files: client/src/pages/Landing.tsx; client/src/components/landing/sections/ and scene/.
  The Hylsia logo, client/public/logo.png, appears across the site through HylsiaMark
  (client/src/components/brand/HylsiaLogo.tsx).
- Robinhood Chain brand rules (client/src/components/brand/RobinhoodChain.tsx): the logo is never
  transformed, faded or recoloured; the copy says "built for", never "deployed on"; a trademark
  line names the owner of the marks (NetworkAttribution.tsx).

3.6 WALLET CONNECTION
---------------------
- Connect offers MetaMask and Rabby Wallet (EVM), through their own injected providers only.
  Unrestricted EIP-6963 connector discovery is off: Phantom cannot be listed or restored.
  evmWallets.ts uses local announcements for those two wallets and a matching legacy provider;
  it never falls back to whichever extension owns window.ethereum. Each connector keeps its
  exact provider in memory, so changing the browser's default wallet cannot redirect a request.
  Discovery sends no account request or RPC. The MetaMask SDK, which sent an analytics beacon
  on every page load, is no longer used. No WalletConnect on Hylsia.
- Every page uses one Robinhood-only wallet config (client/src/privacy/wagmi.ts): no Ethereum
  mainnet, so no ENS lookup. It is the app's only wallet config. client/src/providers/
  OnchainProvider.tsx holds the React providers and the RainbowKit theme.
- The dashboard has separate network and account controls (DashboardWallet.tsx). An unsupported
  wallet network keeps the account menu available and offers an explicit switch to the active
  pool's network. Connecting/reconnecting stays neutral until the wallet reports its chain.
  Opening either menu does not switch networks or read a balance; switching requires a click,
  with local messages for cancellation, a pending wallet request or an unsupported switch.
  Compact controls and bounded menus fit narrow screens. The existing wallet transport guard
  and neutral persisted chain remain in force; no wallet network choice is stored.
  The network menu names the connected wallet. Wallet-paid vault actions pin both switching
  and the wallet client to that same connector and wait for reconnection to finish.
  After this update, reload the app and select MetaMask or Rabby if a former Phantom session
  leaves it disconnected; the vault and its encrypted log are not removed.

3.7 ROUTES
----------
- /                                  the landing (an unknown path shows it too)
- /pools                             the Pools dashboard
- /pools/robinhood-testnet/<address> a pool's page; /pools/46630/<address> and the older
                                     /pools/<address> redirect here
- /pools/vault                       My vault
- /pools/portfolio                   My notes
- /pools/screening                   the screening policy, in plain language, with live values
- /privacy and /pools/simulator      old links: they redirect to /pools/vault
- The repository began as an older trading app (package name "lobstrade"). Its pages, its server
  code (Hyperliquid, Gate.io, an automated trading agent), its sign-in, database, docs pages and
  todo.md were removed in Phase 2 (git history keeps them). /trade, /strategies and /login now
  show the landing, like any unknown path.

3.8 SCREENING POLICY V1 (PHASE 4)
---------------------------------
Server only: no contract or circuit changed. The code is shared/privacy/screening.ts.
- Who joins: deposits join in the order they were made. A deposit is eligible once it has its
  confirmations (1) and its block time plus the inclusion delay has passed (1 hour on Robinhood
  Chain Testnet, 0 on the local chains; set per network). The count of deposits a root considers
  never goes down, so raising the delay later never drops a member.
- Who is kept out: deposits the operator's exclusion list names, by the deposit's label or by the
  depositing address, each with one reason code: sanctions, stolen-funds, fraud, legal-order or
  test. A deposit listed before it is eligible never joins. A member listed later is removed by
  the next root; a lifted exclusion brings it back with the next root. At most 500 excluded
  deposits per pool fit in one root's record; beyond that, publishing pauses.
- The record: each root's cid is its recipe, for example
  hylsia-asp:v1;n=15;x=8,9;asOf=65;t=1700007277;delay=3600;conf=1
  (the first n deposits, minus the leaves listed in x). Anyone with the public events can rebuild
  and check every root. The excluded leaves stay on-chain for good; the reason codes are only in
  the privacy.asp.status answer.
- The exclusion list: a JSON file on the server (PRIVACY_ASP_EXCLUSIONS_FILE; the format is in
  .env.example and config/asp-exclusions.example.json), or the same JSON inline for serverless
  hosting (PRIVACY_ASP_EXCLUSIONS_JSON, without notes). A note, a date and a listed address that
  never deposited are never published or logged. A missing or invalid list pauses publishing on
  every network (policy_error) and keeps showing the last good list read by this process. After a
  restart without the list there is none: the status then announces no exclusion, but the server
  keeps every exclusion the newest root's record lists and never reports it as lifted, so your
  app still shows it excluded. After an edit, check it with npm run zk:asp:publish -- --dry-run.
- The publisher posts a root when one is due: on its schedule, when a withdrawal's label-free
  request comes in, from npm run zk:asp:publish, and about 35 to 45 s after an edit of the file
  that removes a member. It never posts below the policy version it finds on-chain, repairs a
  root whose record does not match at most once, and does not answer another publisher's root
  with its own within 10 minutes of its own post (two publishers would flap). Run one publisher
  version and one exclusion list per pool. When the newest deposit was listed before it became
  eligible, its exclusion changes no member, so the publisher posts the same root once more with
  a record that lists it: only then is that exclusion on-chain.
- On your device: the app proves only against the newest root, after rebuilding that root's list
  from its own events and checking it; there is no fallback to an older root. A private
  withdrawal starts only for a deposit the newest root on-chain already holds and the operator
  does not announce for exclusion: every other note is held back, whatever the operator's status
  answer says, so no status answer can make one note start a withdrawal that then fails and marks
  it. Before the operator sees any request about a withdrawal, the app checks the newest root,
  finds the note in it and asks its questions about the crowd; only then does it ask for a newer
  root, if one is due, and nothing after that request depends on the note. (One exception: when
  the device's log RPC lags and the root changed a moment before, an input-less request for the
  newest root's record can come first, and a note the new root does not hold stops right after
  it; section 9.2.) If the root posted in reply leaves out a deposit of that crowd whose
  exclusion the operator's status, as the device last read it, did not announce, every withdrawal
  stops alike ("the association set changed"), so the reply singles out no deposit; an honest
  removal announced in the minute or two before stops it the same way.
- The crowd the app judges a withdrawal by is the newest root's members minus those the operator
  announces for exclusion (its answer can differ for each visitor). Before any request about the
  withdrawal, the app asks when that crowd is below 10 deposits, or when it shrank sharply (at
  least 10 deposits and 20%) against the newest root itself or a larger root among the pool's
  last 16 different roots that check out in the device's own events (looking back over at most
  64 different root values). An answer whose announcements alone shrink a pool's newest root
  that sharply sends no request for a newer root at all, on any network (one answer covers them
  all). After the request (or when none is due) the app asks at most once more: when it asked
  nothing yet, if the crowd the withdrawal is proved in is small, shrank sharply or is clearly
  smaller than the form showed; when it already asked, if that crowd is clearly smaller than the
  form showed.
- The privacy check (3.3) counts that crowd, not every deposit; the next root's crowd is the
  operator's snapshot recipe rebuilt on the device, never a count the answer only claims, and
  only when that snapshot fits the answer (it keeps every member the answer does not announce),
  so the form shows every note the same number. Its recommended wait counts new deposits only
  once they are eligible, and never ends before the deposit itself is eligible.
- What your vault shows for a deposit (Notes, Withdraw, My notes), worked out on your device:
  "Waiting for screening" (inside the delay), "Joins next root" (eligible: it joins with the next
  root the publisher posts), "Excluded" with the callout "Excluded: use the public exit" (the
  device's own copy of the newest root's on-chain record lists it; Ragequit is offered for a note
  that still holds value, naming the depositing address), "Exclusion announced" or "Removal
  announced" (the operator announces it, or a server's copy of the root's record claims it, and
  the chain does not show it yet: never a public-exit suggestion), "Checking…" and "Root not
  verified" or "Reload the app" (the newest root could not be checked). All of these are held
  back; only a deposit in the set is not.
- The policy page, /pools/screening (linked from the Pools sidebar under Privacy, the vault, the pool
  pages and the landing): the rules in plain language with live values from asp.status and
  privacy.pools. Its text waits for your approval; the dispute contact is left out until you give
  one (one constant in client/src/pages/ScreeningPolicy.tsx).
- The relayer refuses a proof made against an older root that holds an excluded deposit, or that
  it cannot rebuild ("…no longer accepted. Nothing was sent; make a new proof."). It never refuses
  the current root. Besides the list, it counts the exclusions the current root's own record
  lists, so a missing or broken list (for example after a restart) never switches it off; with
  such a list and a current root it cannot check, it refuses every older root. Needs your
  approval; removing it is one block in relayer.ts.
- The 16-root window: the contract still accepts the older roots that hold a removed deposit
  until 15 more roots are posted after the removal. The app and the relayer no longer use them; a
  client that pays its own gas still can. The opt-in eviction burst closes it:
  npm run zk:asp:publish -- --chain <id> --evict (preview), then --evict --yes (sends). It is
  never automatic. It may run while the server runs: before each post it waits until the
  postman has no transaction in flight, re-reads the newest root and its record, and sends with
  an explicit nonce, so it never posts an older root or record over a newer one. (One exception:
  a node whose mempool replaces a pending transaction by fee, as anvil and geth do, takes the
  burst's post in place of a newer post of the same nonce still pending at a clearly lower fee;
  the server then posts that newer root again after 10 minutes. Both price from the same RPC's
  estimate, so the fees normally match and the burst's post is refused instead.) A post of its
  own not mined within 120 s stops the burst with a message that says so.
  Measurement, costs and proposals: docs/privacy-pools/asp-window.md.
- The landing's "Guarantees" line now says a deposit joins 1 hour after it is made unless the
  screening policy excludes it, and the FAQ links to the policy page (both wait for your
  approval; Hero.tsx is untouched).

3.9 RESILIENCE (PHASE 5)
------------------------
- Connection settings (the server icon in the dashboard's header) hold two choices of this
  browser, kept here only and never sent to the Hylsia server ("Forget vault" keeps them):
  - Your own RPC per network. The vault's reads (event sync, contract reads) go through it; it is
    checked first (it must answer eth_chainId for that network from this browser). It never
    enters the chain details that a wallet receives, and the dashboard's figures still come from
    the server. Your wallet keeps its own RPC for what it sends.
  - The relayer: "This site", the build's list (VITE_PRIVACY_RELAYERS) or one you add (another
    Hylsia server's address). A withdrawal asks its quote of, and submits to, the relayer chosen
    when it starts, and no other; the quote's fee is bound into the proof. The list's statuses are
    asked only while the settings are open. A server serves other sites' withdrawals through
    privacy.relayer.quote/.submit with cross-origin headers (PRIVACY_RELAYER_CORS=0 turns it off).
    Invalid terms are refused, and a fresh quote cannot charge more than the fee the form showed
    when Withdraw was clicked. There is no automatic retry through a different relayer.
- Static pool snapshots: npm run zk:snapshot writes client/public/snapshots/<chainId>-<pool>.json
  (public data only, no key; it checks the tree's root with the pool first). A device with no copy
  of a pool starts from it: it holds only deposits and withdrawals (each deposit's commitment is
  recomputed), its checkpoint's chain id, block hash, scope, root and leaf count must match the
  pool at that exact block, and with the blocks after it the tree
  must give a root the pool knows. Ragequits and association-set roots never come from it: the
  device reads the whole history right after, in the background ("Reading history"), and holds
  private withdrawals until then. A copy started from a snapshot is never cached. A snapshot that
  fails any check is ignored and the device reads the history from the deploy block, as before.
  Run the script after a deployment and from time to time (before each site build is simplest);
  an older snapshot only means more blocks to read after it.
  If the RPC cannot read historical contract state at the checkpoint, the browser uses the full
  scan. RPC calls and remote-relayer calls omit cookies and referrers and refuse redirects;
  an RPC on this site's own origin is refused before probing it.

4. RUNNING IT ON THIS MAC
=========================

4.1 INSTALL AND START
---------------------
Needs Node 20.19 or newer (this Mac: 24.12), npm, and Foundry (forge, anvil, cast) for the
contracts and the end-to-end test. npm only: package-lock.json is the only lockfile, and
package.json names npm ("packageManager"). Do not use pnpm.

    npm install
    cp .env.example .env     on a new machine only (this Mac has its .env already)
    npm run dev              http://localhost:3000 (PORT changes it; if busy, the next free port)

- Pages: / (landing), /pools, /pools/vault, /pools/portfolio. Production: npm run build, then
  npm start. The live pool needs no pool variable: the app reads shared/privacy/deployments.ts.
- contracts/lib/forge-std (v1.17.0) is in the repository, so a fresh clone can run the contract
  tests and the e2e without forge install.
- npm run format (Prettier) skips the proving files, the deployment records, contracts/src,
  contracts/lib and the whitepaper draft (.prettierignore): reformatting them would break their
  sha256 pins or the match with the deployed contracts.
- RPC timeout fix: Node's fetch allowed 250 ms per connection attempt, and this Mac took 0.4-0.5 s
  to connect to the public testnet RPC ("could not read eth_chainId ... HTTP request failed.").
  .npmrc (node-options) and server/_core/loadEnv.ts raise it to 1 s. For a plain npx tsx or node
  run, set NODE_OPTIONS=--network-family-autoselection-attempt-timeout=1000 yourself.

4.2 ENVIRONMENT VARIABLES
-------------------------
Names only; .env.example has the full comments. A _46630 suffix sets a value for that network.
- PRIVACY_CHAIN_IDS / VITE_PRIVACY_CHAIN_IDS: the networks the server / the browser build serve.
  Default 46630. 31337,31338 serves the two local chains (development).
- PRIVACY_RPC_URL_46630 / VITE_PRIVACY_RPC_URL_46630: optional RPC (default: the public one).
- PRIVACY_POOL_ADDRESS_46630, PRIVACY_POOL_DEPLOY_BLOCK_46630 and their VITE_ twins: leave empty
  to serve the live pool; set both only to serve another pool.
- VITE_PRIVACY_EXPLORER_URL_46630: explorer link override ("none" turns the links off).
- PRIVACY_RELAYER_PRIVATE_KEY: the relayer's key (secret, server only).
- PRIVACY_RELAYER_FEE_BPS (default 50 = 0.5%), PRIVACY_RELAYER_MIN_FEE_WEI (default 0) and
  PRIVACY_QUOTE_TTL_SECONDS (default 900): the relayer fee, its minimum and how long a quote lasts.
- PRIVACY_ASP_POSTMAN_PRIVATE_KEY: the publisher's key; it must be the pool's aspPostman (secret).
- PRIVACY_ASP_AUTO_PUBLISH_SECONDS: the periodic publisher's interval (default 600, 0 = off,
  otherwise 10 to 86400). It runs in the long-running server only, never on Vercel.
- PRIVACY_ASP_CONFIRMATIONS_46630: confirmations before a deposit joins the set (default 1).
- PRIVACY_ASP_INCLUSION_DELAY_SECONDS_46630: how long after its block time a deposit joins the set
  (default 3600 on Robinhood Chain Testnet, 0 on the local chains; 0 to 604800; 0 = at once).
- PRIVACY_ASP_EXCLUSIONS_FILE: the operator's exclusion list, a JSON file (a relative path is read
  from the repository root; the live one is config/asp-exclusions.json, git-ignored). Unset: no
  exclusions. Set but missing or invalid: publishing pauses on every network.
- PRIVACY_ASP_EXCLUSIONS_JSON: the same list inline, for serverless hosting (no notes allowed).
  Set only one of the two.
- PRIVACY_REORG_WINDOW_46630, PRIVACY_LOG_CHUNK_46630, PRIVACY_ASP_RECEIPT_WAIT_MS_46630:
  optional tuning (defaults: 20 blocks, 100000 blocks, 20000 ms).
- Deploy only: PRIVACY_DEPLOYER_PRIVATE_KEY (optional; a keystore is better), PRIVACY_POOL_OWNER,
  PRIVACY_ASP_POSTMAN, PRIVACY_MIN_DEPOSIT_WEI, PRIVACY_DEPLOY_RPC_URL_46630, and
  PRIVACY_DEPLOYMENT_OUT (set by the e2e test; leave it unset).
- PRIVACY_CHAIN_ID: the old single-network mode (with the unsuffixed names); tests use it.
- PRIVACY_RELAYER_CORS: 0 stops other Hylsia sites from using this server's relayer (default on:
  only privacy.relayer.quote and .submit answer other origins, never with cookies).
- VITE_PRIVACY_RELAYERS: other Hylsia relayers the build lists, comma-separated origins (3.9).
- VITE_ANALYTICS_ENDPOINT, VITE_ANALYTICS_WEBSITE_ID: optional analytics, never on privacy pages.
- VITE_ values are public: they are bundled into the browser app. Never put a secret in one.

4.3 LOCAL PRACTICE DEMO
-----------------------
- Two local anvil chains (31337 on port 8545, 31338 on port 8546) with seeded deposits, served at
  http://localhost:3100. It runs from a temporary folder under /private/tmp/claude-501/ (with
  GUIDE.md, start.sh and stop.sh), which macOS clears on restart.
- It is an older snapshot: it still shows the two-network (Sepolia) text.
- To run local chains from this project instead, see "Pengembangan lokal di browser" in
  docs/privacy-pools/README.md.

5. WALLETS, USAGE AND USER UPDATES
==================================

- Use MetaMask or Rabby Wallet through its injected EVM provider. On a phone, MetaMask's in-app
  browser is supported; this release does not use a WalletConnect QR flow.
- In Hylsia, click "Connect wallet" and choose MetaMask or Rabby Wallet. Only these two are
  offered; Phantom and other installed extensions do not create connectors automatically.
  Without the selected extension, the window shows its installation instructions.
- Network: the dashboard's network menu names the selected wallet and offers an explicit switch
  to Robinhood Chain Testnet. A deposit also asks that wallet to add/switch the network when
  needed; the user approves the prompts. To add it manually in the wallet:
  - Network name: Robinhood Chain Testnet
  - RPC URL: https://rpc.testnet.chain.robinhood.com
  - Chain ID: 46630
  - Currency symbol: ETH
  - Block explorer: https://explorer.testnet.chain.robinhood.com
  Robinhood's guide: https://docs.robinhood.com/chain/add-network-to-wallet
- Testnet ETH (no real value): https://faucet.testnet.chain.robinhood.com
- Costs at 0.01 gwei (November 2026): a deposit about 0.00001 ETH, a withdrawal about 0.000011 ETH.
- Before a live test, the operator must fund both service wallets (section 7) and keep the
  publisher running. A new deposit cannot leave privately while no published root includes it;
  paying your own withdrawal gas does not replace the publisher.
- First use: open My vault (/pools/vault), create a vault, export its encrypted backup and verify
  that file with the vault password. Connect MetaMask or Rabby, get testnet ETH, then deposit a
  standard amount offered by the form, leaving some ETH in the wallet for gas. The user signs.
- Wait for screening (1 hour by default) and the next publisher root that includes the deposit.
  The app shows "Waiting for screening" or "Joins next root" until then. With a funded, healthy
  publisher the usual wait is about 1 hour to 1 hour 10 minutes; it is not a guaranteed deadline.
- Withdraw: choose a note, amount and fresh receiving address in Withdraw, review the privacy
  check and the selected relayer's fee, then choose "Via relayer". The browser makes the proof;
  the relayer sends the transaction and pays gas. The receiving address needs no ETH beforehand.
  A first/only deposit provides no crowd to hide among, even after screening.
- Public exit: Notes -> Ragequit returns an unspent note to its original depositor without an
  association-set root. The vault's note proof is still needed, and the original depositing
  wallet must sign and pay gas. This exit publicly links the deposit and exit; exiting a change
  note can also reveal the deposit behind an earlier private withdrawal.
- Keep the backup file and its password safe. Without them the notes cannot be recovered, and
  nobody, the operator included, can recover them for you.

For an existing user after an app update:
- The operator must build/restart or publish the new version first. Users then reload the page
  (hard refresh if an old tab still shows the former controls); no app reinstall or new vault
  is needed. Do not clear site data or use "Forget vault" as an update step.
- On the same origin/browser, Unlock the existing vault. Supported older vault/log formats
  migrate automatically; the wallet/UI changes do not require a new seed, backup or deposit.
- If an old Phantom session no longer reconnects, use Connect wallet and select MetaMask or
  Rabby. Disconnecting a wallet does not delete the encrypted vault or its activity log.
- A new domain, browser profile or device has separate storage. Choose Restore from a backup,
  supply the existing backup file and vault password, and let the app rediscover notes from
  public chain data. It does not copy local storage from localhost or another domain, and the
  old device's activity history is not part of the seed backup.

6. DEPLOYING A POOL
===================

The live pool is already deployed. This is historical/future deployment reference, not a step
of the current public-testnet release: do not deploy a new pool for this release. Read this only
for a separately authorized replacement pool or, later, a new network.
Deploy from one frozen build, and never run npm run zk:build in between (section 10).

    1. npm run zk:deploy:robinhood -- --sender 0x<deployer> --replace
    2. cast wallet import hylsia-deployer --interactive
    3. npm run zk:deploy:robinhood -- --broadcast --account hylsia-deployer \
           --sender 0x<deployer> --replace

- Step 1 is a dry run (the default): it checks the RPC and the chain id and simulates the whole
  deployment. No key, no funds, nothing sent, no record written.
- Step 2, once: keeps the deployer's key in a forge keystore instead of in .env.
- Step 3 deploys. Steps 1 and 3 both need --replace while contracts/deployments/46630.json exists
  (without it even the dry run is refused). The app then serves the new pool; notes in the old
  pool stay there and can only leave from it.
- Other options: --ledger --sender 0x..., --rpc-url <url> (or PRIVACY_DEPLOY_RPC_URL_46630),
  --no-verify, and --gas-estimate-multiplier 200 if a transaction runs out of gas (forge does not
  know chain 46630).
- The owner, postman and minimum deposit come from PRIVACY_POOL_OWNER, PRIVACY_ASP_POSTMAN and
  PRIVACY_MIN_DEPOSIT_WEI. The first two are empty in this Mac's .env, so the owner would be the
  deployer and the postman the owner. Set PRIVACY_ASP_POSTMAN to the publisher's address
  (0x4D62c8c148a847788C385b436ed760BDe5b1b80C) first, or its key cannot post the new pool's roots.
- Refused before anything runs: a local (loopback) RPC, an RPC on another chain, and an existing
  record without --replace. Deploy.s.sol refuses anvil's default accounts outside anvil.
- After a broadcast the script verifies the contracts on the Blockscout explorer and runs the sync
  (it checks the pool on-chain and writes shared/privacy/deployments.ts). Then rebuild and restart
  the app. npm run zk:deploy:testnet is an alias; local chains use npm run zk:deploy:local.

7. FUNDING THE RELAYER AND THE PUBLISHER
========================================

Both are server wallets on Robinhood Chain Testnet. Their keys are in the project .env and in
~/.hylsia/testnet-wallets.env (both chmod 600). They need testnet ETH to pay for gas.

- Relayer 0x3C28c48d6a7398244Cf50787f0E5fC6Ac1E172F9: send 0.002 ETH. One withdrawal uses about
  1.13 M gas (about 0.000011 ETH), so this covers well over a hundred.
- Publisher 0x4D62c8c148a847788C385b436ed760BDe5b1b80C: send 0.0005 ETH. The pool's first root
  uses about 72 k gas and later roots 38 k to 55 k (under 0.000001 ETH each, measured on anvil;
  the testnet adds a small data fee), so this covers several hundred. An eviction burst (section
  3.8) is at most 15 roots, about 0.0000083 ETH.
- How: in MetaMask, on Robinhood Chain Testnet, send to those two addresses from your wallet
  (0x2629..., about 0.0099 testnet ETH on 2026-11-17) or from the faucet. Check each address
  twice before you send.
- No restart is needed: the server reads the balances again within 30 s. To check, run
  npm run zk:asp:publish (it prints the publisher's balance and posts a root if one is due); the
  dashboard and the Withdraw form stop showing the relayer and publisher as unavailable.
- The app counts a wallet as funded once it can pay one transaction with a 2x margin: at 0.01 gwei
  that is 0.000024 ETH for the relayer and 0.000002 ETH for the publisher.
- Once the publisher is funded, the periodic publisher posts the first root within about 10 minutes
  of the first deposit passing the 1-hour inclusion delay (so 1 hour to 1 hour 10 minutes after the
  deposit), but only while the server runs (today: npm run dev here). With one network, as here,
  no withdrawal can ask for the first root (every note is held until a root holds it; with
  several networks, a withdrawal on another network's pool can): it comes from the periodic
  publisher or npm run zk:asp:publish, so on serverless hosting a scheduler must run it.

8. TESTS AND CHECKS
===================

    npm run check                 TypeScript type check (tsc --noEmit)
    npm test                      unit tests (vitest, server/**/*.test.ts)
    npm run zk:contracts:test     contract tests (forge, with real proofs)
    npm run zk:e2e                two-network end-to-end test on two local anvil chains
    npm run zk:deployments:sync   checks the records on the chain (read-only calls); rewrites
                                  shared/privacy/deployments.ts only if something changed

- Unit tests: 22 files, 503 tests, all for the privacy code (networks, vault and backup,
  association set and screening, privacy check, funding, wallet guards, storage migration, the
  encrypted activity log, locking during an operation, records, the one wallet config, the vault's
  note states, dashboard wallet state and rendering, explicit EVM provider routing). None of
  them calls the internet.
- Contract tests: 24, that is 22 PrivacyPool tests with real proofs and 2 CrossChain tests (a proof
  made for one chain is refused on another).
- End-to-end: chain A uses Robinhood Chain Testnet's id 46630 and chain B is local chain 31338,
  both anvils on this Mac; it never touches a public network. It covers deposit, root publish, the
  association-set proof built on the device, relayed and self-paid withdrawals, recovery from a v2
  backup, ragequit, cross-chain refusals, an unfunded relayer and publisher, and one
  periodic-publisher tick. Since Phase 4 it also runs the screening policy on chain A with a
  1-hour delay (anvil time travel): the delay boundary, a deposit listed before it is screened, a
  removal after inclusion, the 16-root window measured root by root, the opt-in eviction burst,
  a lifted exclusion, an invalid list, roots from another publisher, the shrink alarm and a newer
  policy version. Since the round-2 review fixes it also checks the order of a withdrawal: an
  answer that announces every member but one, or leaves 9, gets its question before any request
  (and, since round 3, its "root due" sends no request on either network); a root posted in reply
  that drops members the status never announced stops the withdrawal (SET_CHANGED); and 16 roots
  that verify nowhere do not blind the shrink alarm. It checks that no exclusion note and no key
  appears in any answer or log line.
  Ports: E2E_ANVIL_PORT_A (default 8547), E2E_ANVIL_PORT_B (default 8548).
- Historical Phase 2 run, 2026-11-17: tsc clean; vitest 15 files and 279 tests
  passed; forge 24/24; the e2e passed; npm run build built; the built server served /, /pools,
  /pools/vault and the pool page with no console errors, set no cookie, and its API calls went
  without cookies.
- Phase 3 run, 2026-11-17: tsc clean; vitest 16 files and 313 tests passed. In a browser on two
  local anvil chains: a new vault deposited and withdrew through the relayer, and a restored vault
  moved an older plaintext log in on unlock. Afterwards no tx hash, recipient, amount, label or
  commitment was readable in browser storage outside the public event caches; nothing of the log
  was read before unlock; lock, reload, a changed log and Forget behaved as described in 3.3. The
  requests matched those of the Phase 2 code, except that pending entries are now checked after
  unlock. forge and the e2e were not rerun: no contract, circuit or server code changed.
- Phase 3 review fixes run, 2026-11-18: tsc clean; vitest 17 files and 323 tests passed. In a
  browser on two local anvil chains: Lock clicked during a withdrawal and during a deposit locked
  the vault right after each had written its outcome (the deposit's reservation release
  included); a lock while a pending entry was being checked left no key in memory and stopped
  the receipt polling after its 15-second round; a reservation list the vault could not decrypt,
  and a vault replaced as if from another tab, stopped a deposit with nothing written; a vault
  forgotten during its own deposit left the next vault's reservations untouched; older plaintext
  logs, including a per-pool one, moved in on unlock. No tx hash, recipient, amount, fee, label,
  commitment or nullifier was found in browser storage, or in any value the app wrote, outside
  the public event caches. The request kinds matched those of the code before the fixes.
- Phase 3 final run before its commit, 2026-11-18: npm run check clean; npm test 17 files and 323
  tests passed; npm run zk:contracts:test 24/24; npm run zk:e2e passed; npm run build built.
- Phase 4 run, 2026-11-18: npm run check clean; npm test 19 files and 429 tests passed;
  npm run zk:contracts:test 24/24; npm run zk:e2e passed in 71 s. In the e2e, on chain A:
  - the delay: three deposits still waited at +3599 s and joined at +3600 s; the periodic
    publisher's tick posted hylsia-asp:v1;n=6;x=;…;delay=3600;conf=1;
  - a deposit listed before it was eligible was announced at once, never joined, was refused on
    the device (EXCLUDED) and left by ragequit;
  - a member listed later: the app held it back ("Removal announced", no public-exit advice; a
    status answer edited for one visitor held the app back too), then the next root left it out
    (x=8,9) and the vault showed "Excluded: use the public exit" with bob's address;
  - the window: the relayer refused proofs against the two older roots that held it, while the
    pool still took them when sent directly; R1 was gone after the 14th post after the removal
    root (burst post 12) and R2, the last root that held it, after the 15th (burst post 13); a
    proof made after the removal survived the burst; 13 burst posts used 646,545 gas (0.0000065
    ETH at 0.01 gwei), 112 ms on anvil (docs/privacy-pools/asp-window.md);
  - a lifted exclusion waited while the list was younger than 30 s, then came back with the next
    root and was withdrawn privately; an invalid list paused publishing (policy_error, nothing
    sent); a note in the set, waiting, excluded or not held made the same single request;
  - roots from another publisher (a list that is no subsequence, an open-policy root after
    screened ones, the right root with a wrong record) were refused on the device; the server
    posted its own root again (at once for the wrong record, once; after 10 minutes or a restart
    for another publisher's root); a root dropping 10 of 21 members right after a withdrawal's
    publish request raised the shrink question; a newer policy version on-chain paused the server.
  Both pools ended at 0. Earlier the same day, the server and client owners checked the same
  features on their own local anvils, the client in a browser (the vault's states, the policy page
  at 1440 and 390 px, request logs with no label or deposit hash in any request).
- Phase 4 review fixes run, 2026-11-18: npm run check clean; npm test 19 files and 440 tests
  passed; npm run zk:contracts:test 24/24; npm run zk:e2e passed (71 and 72 s), now also with a
  status answer that announces every member but one (a crowd of 1, the app asks, nothing reaches
  the relayer), a lifted exclusion held until the publisher's root re-admits it, and the shrink
  question still asked after the small root is re-posted 15 times. The reviewers' probes, run
  again, no longer reproduce. In a browser on two local anvils: the all-but-one answer showed
  "Association set 1 deposit" and the shrink question, and "Don't send" sent nothing; a lagging
  log RPC with a forged record showed "Root not verified" and no public-exit callout; an eligible
  deposit was held until a withdrawal of another note asked for its root, then left privately;
  the pool page named the joining deposit apart.
- Phase 4 review fixes, round 2, run, 2026-11-18: npm run check clean; npm test 19 files and 454
  tests passed; npm run zk:contracts:test 24/24; npm run zk:e2e passed in 73 s (the window figures
  unchanged: R1 gone after the 14th post after the removal root, R2 after the 15th, 13 burst posts
  646,545 gas; the burst took 292 ms on anvil, as it now reads the postman's nonces and a fresh
  snapshot before each post). The reviewers' scenarios, run through the new order, no longer
  reproduce, and the new server and client tests fail on the code before the fixes. In a browser
  on two local anvils, with this browser's status answer edited: an answer announcing every member
  but one, with a root due, got the question 0.2 s after the click and no request at all followed
  (before: the request for a newer root came first); two notes under a snapshot that listed one of
  them unannounced showed the same crowd and made the same requests; after 16 garbage roots the
  shrink question came before any request; a root posted in reply that dropped the withdrawn
  deposit stopped the withdrawal with "The association set changed …" and nothing more was sent;
  a restart without the exclusion list kept "Excluded: use the public exit"; a lift being settled
  showed "Joins next root" with no exit; a server without a periodic publisher says the operator
  posts a pool's first root. The owner's :3000 answered and loaded with no console error.
- Phase 4 review fixes, round 3, run, 2026-11-18: npm run check clean; npm test 19 files and 465
  tests passed (the 11 new ones fail on the code before the fixes, except the alarm's
  same-answer check, which compares with that code's rule); npm run zk:contracts:test 24/24;
  npm run zk:e2e passed in 75 s (window figures unchanged: R1 gone after burst post 12, R2 after
  13, 13 posts 646,545 gas). The shrink alarm on a pool of 5,000 deposits with 16 earlier roots of
  16 different exclusion sets: a withdrawal with a publish request took 2.5 s on the device
  instead of 19.5 s. In a browser on two local anvils: after Lock, Forget and a restore, no
  vault label is held by the device's first-sighting record (heap snapshots); an answer that
  announces all but one member of chain A, with chain B's root due, got its question 0.16 s after
  the click and, after "Withdraw anyway", no request for a newer root; the small-set dialog,
  the form's caution and the "Don't send" message give the root's on-chain count (13) beside the
  crowd this app counts (9); without a fresh status the vault says nothing about the publisher's
  schedule; the rootless pool page names the other network's withdrawal; the Privacy & trust
  tab at 390 px shows the 64-value bound with no overflow.

- Phase 5 run, 2026-11-18: npm run check clean; npm test 20 files and 487 tests passed;
  npm run zk:contracts:test 24/24; npm run zk:e2e passed in 74 s; npm run build passed.
  The e2e checks a real checkpoint on its local chain, refuses a changed value, an omitted
  history, a different block hash and the same pool on another chain, and recovers the change
  note from the snapshot plus newer RPC events. Unit tests exercise direct RPC switching,
  origin rejection, cookie/referrer/redirect settings, chosen-relayer requests and fee limits.
  npm run zk:snapshot generated the live pool's empty snapshot at block 155019673 using only
  public reads. In Chrome, the production preview's Connection settings rendered and rejected
  an RPC on the site's own origin; no wallet was connected and the publisher was off.

- Landing UI review, 2026-11-18: fixed the Network heading's overflow at 320 px and the FAQ
  faucet link that widened its card. Loading and failed status reads no longer say the pool is
  not deployed. Command/Ctrl-click on the home logo keeps the browser's normal new-tab action.
  Checked the page in Chrome at 320, 390 and 768 px and desktop width; the two wrapping fixes,
  section menu, FAQ accordion and normal/Command-click home actions were rechecked. TypeScript,
  487 unit tests, 24 contract tests, the local e2e (78 s) and the production build passed.

- Dashboard wallet review, 2026-11-18: Chrome checks at 320 px and 1280 px with a simulated
  wallet covered unsupported networks, an explicit successful switch, a cancelled switch and
  reconnecting without a premature warning; no wallet requests happened just by rendering or
  opening the menus. The real dashboard rendered with the new Connect control. TypeScript,
  495 unit tests (including 8 wallet-control tests), 24 contract tests, the local e2e (77 s) and
  the production build passed. No real wallet was connected or public transaction sent.

- EVM wallet routing review, 2026-11-18: 8 new tests exercise Phantom as the default and recent
  wallet, EIP-6963 with no legacy flags, legacy provider arrays, provider pinning and switching
  through the selected MetaMask/Rabby only. No Phantom, RPC or fetch request is made by discovery.
  Chrome's real Connect modal showed only MetaMask and Rabby Wallet; no wallet was selected.
  npm run check, all 503 unit tests (22 files), 24 contract tests, the local e2e (78 s) and the
  production build passed. No public transaction or deployment was sent.

- Progress documentation check, 2026-11-18: npm run check passed; npm test passed all 503 tests
  in 22 files; npm run zk:contracts:test passed 24/24; npm run zk:e2e passed in 74 s on two
  local anvils. Only readme.txt changed, and section 9.1's never-leak rules stayed unchanged.
  The latest production-build result remains the passing EVM wallet review above.

9. HOW PRIVACY IS PROTECTED
===========================

9.1 THE NEVER-LEAK RULES
------------------------
- Your secrets stay on your device. The seed and the notes are in the browser's memory only while
  the vault is unlocked, and so is what the app works out from them (such as when it first saw an
  exclusion of one of your deposits announced: Lock, Forget and a restore clear it); the browser
  stores them encrypted, and the activity log too. The server only ever sees proofs and public
  numbers.
- The server is never told which deposit you spend. Your browser builds the association-set
  proof itself, from the newest root's on-chain record and its own copy of the public events. The
  one request that asks for a new root carries no deposit, amount or network; it is sent when the
  operator's fresh status answer says a root is due (never while that answer's announcements alone
  shrink a pool's newest root sharply: one answer covers every network, so then no request goes
  out on any), or, without a fresh answer, when the newest root does not hold every deposit the
  device sees; either way the same for every withdrawal at that time.
- A private withdrawal starts only for a deposit that the newest root on-chain already holds and
  that the operator does not announce for exclusion; every other note is held back on your device.
  The operator's status answer can differ for each visitor, so nothing in it can make one of your
  notes start a withdrawal that then fails and marks it, and the deposits it announces for
  exclusion are left out of the crowd the app counts. The app checks the newest root, finds the
  note in it and asks about that crowd (when it is small or shrank) before the operator sees any
  request about the withdrawal, except when your device's log RPC lags and the root changed a
  moment before: then an input-less request for the newest root's record (privacy.asp.set) can
  come first, and a note the new root does not hold stops right after it (9.2). After the request
  for a newer root nothing depends on the note: a root posted in reply that leaves out a deposit
  of the crowd whose exclusion the status your device last read did not announce stops every
  withdrawal alike.
- Every visitor asks the same questions. The public data requests take no input (except the chart
  interval on /pools) and answer for every pool at once; the screening status (privacy.asp.status)
  is fetched by every visitor of the privacy pages when a page opens and every 60 s. Only three
  requests name something: a relayed withdrawal and its status check (they name the network; the
  withdrawal is public on the chain seconds later anyway), and the pool page you are looking at.
- Your app works out whether your deposit is waiting, in the set or excluded on your device, from
  that public data; nothing is sent for it, and a note the form holds back sends nothing.
- Your own RPC and your relayer choice (3.9) stay in your browser; no request to the server
  carries them. The site's pool snapshot is the same file for every visitor, fetched with no
  input. Another relayer gets your withdrawal's quote request and its submit only when you chose
  it, without cookies or a referrer. Opening Connection settings also checks every listed
  relayer with an input-less quote; it never submits a withdrawal to them.
- Your wallet address goes only to the RPC of the network you are using: no Ethereum mainnet, no
  ENS lookup, no other network (client/src/privacy/walletGuard.ts).
- No sign-in, no cookies and no analytics on the privacy pages. The development debug recorder
  records nothing there, and production builds never load it.
- No WalletConnect and no MetaMask SDK: nothing contacts a wallet service before you pick a wallet.
- The network you choose is never stored; a #network= link is read once and removed.
- The privacy check runs on your device, from public data that every visitor gets.
- The periodic publisher runs on the clock and right after the operator edits the exclusion list,
  so it reveals nothing about anyone.
- The exclusion list's notes and dates, and listed addresses that never deposited, are never
  published or logged, and neither is when the server first matched an entry; only the deposits
  it names (their label, leaf and reason code) are.
- Server logs name an RPC's host, never its full URL, and a server wallet's address, never its key.

9.2 WHAT IT DOES NOT HIDE
-------------------------
- Deposits and withdrawals are public; only the link is hidden. A small crowd, an unusual amount
  or close timing can still link them. The pool is empty today, so there is no crowd yet.
- The activity log on the device pairs deposits with withdrawal recipients. It is encrypted with a
  key from the vault seed, so it can be read only while the vault is unlocked, and "Forget vault
  on this device" deletes it. That protects it at rest; anyone using the unlocked vault can read
  it. What stays visible on the device:
  - the size of the encrypted log;
  - a pool's reservation key while a deposit is unsettled, and also after a deposit interrupted
    before the wallet answered: that index stays held, in case the wallet still sends it, until
    Forget, a new vault or a restore;
  - in local test setups only, an older single-network build's log that belongs to another vault:
    it stays unencrypted until Forget, a new vault or a restore.
- The RPC provider and the Hylsia server can see your IP address.
- Ragequit is public by design, and "Pay your own gas" shows the paying wallet. Asking the
  operator about an exclusion tells it that the deposit is yours.
- Exclusions are public, and the excluded deposits' leaf numbers stay in each root's on-chain
  record for good; the status answer adds a reason code. An exclusion the operator announces but
  the chain does not show yet holds your app back for that deposit and is counted out of your
  crowd: it never makes the app suggest the public exit. The status answer can differ for each
  visitor: one that announces every member but yours would leave a crowd of 1, and the app says so,
  with the root's on-chain count beside it, and asks before the withdrawal, or any request for a
  newer root, is sent. In a root of more than 10 members that answer's "root due" sends no
  request, on any network. In a root of 10 or fewer (its announcements then remove fewer than 10
  deposits, which is no sharp drop) "Withdraw anyway" still sends the request, and a root posted
  in reply can make those exclusions public: the app then asks again if the crowd the withdrawal
  is proved in is clearly smaller than the form showed. A server's copy of the newest root's
  record counts only for membership (the root binds the members); which other deposits it calls
  excluded is a claim.
- Only members of the newest root can start a withdrawal from this app, so the operator, which
  sees the request for a newer root and runs the relayer, can narrow a withdrawal from this app
  to those members it does not announce, even when the withdrawal is proved in a newer, larger
  root. The app asks first when that crowd is below 10.
- The crowd can shrink only through exclusions, which every root's record lists. A dishonest
  publisher could still post one root that excludes many deposits, for example right after a
  withdrawal asks for a root: if that root leaves out a deposit of your crowd whose exclusion the
  status your device last read did not announce, the app stops that withdrawal (the same for
  every note, so it names none); the next attempt meets the shrink question only when that root
  shrank the crowd sharply (at least 10 deposits and 20%), or the small-set question below 10,
  and is otherwise not asked about. The app compares the crowd with the largest of the
  pool's last 16 different roots that check out in its own copy of the events (re-posts of one
  root count once, and roots no record of which rebuilds to them do not count, so a burst, a
  heartbeat or garbage roots hide nothing) and asks before any request when it shrank by at least
  10 deposits and 20%; it also shows the crowd and asks below 10 deposits, and asks again when the
  root the withdrawal is proved in is clearly smaller than the form showed. What gets past the
  comparison: 16 different smaller roots that do check out, each a public mass exclusion with its
  own record, posted before you open the form (or more than 64 different root values in a row).
- An operator that suspects you hold a deposit can exclude it on-chain around your withdrawal.
  The withdrawal then stops, the same for every note, but whether you try again, and whether
  that attempt goes through, tells it something. The exclusion is public, with its record, for
  good.
- When your device's log RPC lags, a withdrawal may first ask the operator for the newest root's
  record (no input), before any question about the crowd; if that root changed a moment before
  and no longer holds your note, the attempt stops right after that request.
- After a removal, a client that bypasses Hylsia's app and relayer and pays its own gas can still
  withdraw that deposit privately against an older root until 15 newer roots are posted (the
  16-root window; the opt-in eviction burst closes it).
- These checks assume the RPC your device reads the chain from is independent of the operator.

10. SECURITY NOTES
==================

- Testnet only and not audited. Do not use it for anything of value.
- Development proving setup: the powers of tau were generated on this Mac (the public Hermez file
  returned HTTP 403 here; the local file only carries the Hermez file name), and each setup phase
  has one local contribution. Real value needs a public ceremony first.
- Keys, in two chmod 600 files: the project .env holds the relayer and publisher keys and your
  owner wallet's key (DEPLOY_PRIVATE_KEY_TESTNET; no code reads it); ~/.hylsia/testnet-wallets.env
  holds the relayer, publisher and a generated deployer key. Never commit, share or paste them, and
  never write one into this file. .gitignore already keeps .env out of a repository.
- The owner wallet (0x2629...) controls windDown, setASPPostman, setMinDeposit and
  transferOwnership. Guard its key (section 12.1); deploy from a forge keystore or a Ledger.
- The contracts cannot be upgraded. A fix means a new pool (--replace); notes in the old pool can
  only leave from the old pool.
- The relayer cannot steal or redirect funds; it can only refuse or delay. When it is down,
  "Pay your own gas" still works.
- Never run npm run zk:build after a deployment: it creates new proving keys, and the deployed
  verifiers would reject every proof. The script refuses while a public pool record exists, unless
  --force (meant only for a retired pool).
- Do not edit contracts/src, not even comments: the source has to match the deployed bytecode for
  explorer verification. This is why the deployed NatSpec still mentions Ethereum Sepolia.
- anvil's default accounts and keys are public. Never use them on a public chain; the deploy
  guards and the record checks refuse them. The tests and the e2e derive these keys at run time
  from anvil's public mnemonic (scripts/privacy/anvilKeys.ts), so no private key is written in the
  repository.

11. HISTORY
===========

- 2026-11-13 to 14: the privacy-pool core v0.1, from the concept spec of 13 November: circuits,
  contracts, vault, relayer, association-set publisher and a local end-to-end test.
- 2026-11-15: "Hylsia is privacy pools, not liquidity": the dashboard was rewritten in privacy-pool
  terms, the trading links were removed and "Portfolio" became "My notes". The landing was rebuilt
  as the night-scene parallax, and its hero was approved. /privacy was merged into /pools/vault.
- 2026-11-15 to 16: a consistency pass with the website (association-set proofs on the device, a
  label-free publish request, a cookie-free API client, no sign-in, the activity-log rules).
- 2026-11-16: the simulator was removed and its guidance became the vault's privacy check, which
  then went through two reviews and a fix stage. MetaMask was added to the Connect window. The app
  was built for two networks (Robinhood Chain Testnet and Ethereum Sepolia). The RPC timeout was
  fixed. The current proving keys were built (15:54).
- 2026-11-17, 00:06: the pool was deployed on Robinhood Chain Testnet from your wallet.
- 2026-11-17: Robinhood Chain only. Sepolia was removed from the registry, server, app, website,
  docs, scripts and tests; the hero went back to its approved text; the dashboard got its testnet
  polish; the landing's wallet leak to an Ethereum mainnet RPC was fixed; the final checks passed.
- 2026-11-17: the project was put under git (first commit 5328dd0, tag pool-46630-v0.1).
- 2026-11-17, Phase 2: the older trading app was removed: its pages (/trade, /strategies, /login
  and unrouted ones), server code (Hyperliquid, Gate.io, the trading agent, the LLM client), wallet
  sign-in and session cookie, database, docs and legal pages, todo.md, Fly.io deploy, its tests,
  images and unused UI kit files, 50 packages and its env names. The app now has one wallet config
  and the API only privacy.*. npm only: pnpm-lock.yaml and the pnpm patch were removed, the package
  is named "hylsia", and vercel.json and the Dockerfile install with npm ci. With your yes, also:
  the unused landing sections (HowItWorks, Marquee) and the deprecated privacy.status API were
  removed, forge-std was committed, the test keys are derived at run time, and Prettier skips the
  pinned files.
- 2026-11-17, Phase 3: the device activity log and the deposit-index reservations are encrypted
  with a key derived from the vault seed (HKDF-SHA256, AES-256-GCM, a fresh IV on every write).
  Nothing of the log is read before unlock; the older plaintext log moves in on unlock and is
  deleted; a log that does not decrypt is set aside; Forget, create and restore delete every form
  of it; Lock waits while an operation runs.
- 2026-11-18, Phase 3 review fixes: a vault forgotten or replaced (in any tab) no longer deletes
  or overwrites the current vault's reservations, and a list it cannot decrypt is never removed;
  a lock asked for during an operation now happens when the operation ends (it was refused); the
  pending check after unlock no longer keeps the key after a lock and stops polling; an older
  single-network build's per-pool log of this vault is encrypted on unlock too.
- 2026-11-18, Phase 4: association set v1, screening (server only, no contract change). With your
  "start", the defaults were taken: a 1-hour inclusion delay on testnet (0 on local chains,
  configurable per network) and an exclusion list the operator keeps on the server. Each root's
  record carries its recipe, and the device proves only against the newest root after checking
  it. The vault shows "Waiting for screening" and "Excluded: use the public exit"; the new page
  /pools/screening explains the policy. The 16-root window was measured, and an opt-in eviction
  burst was added (docs/privacy-pools/asp-window.md). A design review's findings were applied:
  the shrink alarm, announced exclusions that hold the app back, the privacy check on a screened
  set, the relayer's refusal of older roots, and several smaller fixes.
- 2026-11-18, Phase 4 review fixes (a privacy and a correctness review of the built code): a
  private withdrawal starts only for a deposit the newest root on-chain holds, so the operator's
  per-visitor status answer can no longer single out a note; deposits it announces for exclusion
  are counted out of the crowd, and the shrink alarm compares with the last 16 different roots
  (a burst no longer blinds it); only the device's own copy of a root's record can mark a deposit
  excluded; a record that does not hash to its root is never read as "lowered"; the newest
  deposit's exclusion is put on-chain by a record post; the burst's nonce-clash retry works; the
  relayer's refusal no longer switches off with a broken list; the pool page names joins and
  removals apart; the live exclusion list stays out of images.
- 2026-11-18, Phase 4 review fixes, round 2 (a privacy, a correctness and a docs review of the
  round-1 fixes): every question about the crowd now comes before the operator sees any request
  about the withdrawal (an answer that announces all but one member, with a root due, no longer
  learns the note from the request for a newer root, and in a root of more than 10 members its
  rootDue sends nothing); the form compares every note with the same crowd, and a snapshot that
  does not fit the answer counts for none; a root posted in reply that drops an unannounced
  member stops every withdrawal alike; the shrink alarm counts only roots that check out; the
  status no longer carries when the server first matched an entry; a missing list after a restart
  never re-admits an on-chain exclusion, and a lift being settled offers no public exit; the
  eviction burst waits for the postman's transactions in flight and never re-posts an older root
  or record over a newer one; the copy follows what the server runs (no periodic publisher: the
  operator posts the first root).
- 2026-11-18, Phase 4 review fixes, round 3 (a privacy, a correctness and a docs review of the
  round-2 fixes): an answer that shrinks one pool's root sharply now sends no request for a newer
  root on any network (one answer covers them all), and the form then shows the current crowd; after
  a question asked before that request, the app still asks when the crowd the withdrawal is proved
  in is clearly smaller than the form showed; the small-set texts give the root's on-chain count
  next to the crowd this app counts; Lock, Forget and a restore also clear the device's record of
  when it first saw an announced exclusion of the vault's deposits (and Lock the last operation's
  status); the shrink alarm verifies no earlier root that could not raise it (an operator could
  make it rebuild 16 lists on every withdrawing device); the burst names a post of its own that is
  not mined; the "association set changed" message no longer promises a question; without a fresh
  status the words claim nothing about the publisher's schedule; the never-leak rules name the
  lagging-RPC exception and the 64-value bound.

- 2026-11-18, Phase 5: static pool-event snapshots with exact on-chain checkpoint verification
  and a full-history fallback; browser-only RPC settings; configurable and custom relayers,
  cookie-free cross-origin quote/submit, pinned relayer choice and a limit at the displayed fee.
  No contract, circuit, deployed pool record or proving artifact changed. Next phase: security
  checks and a findings report (Phase 6); no live transaction or deployment was sent in Phase 5.

- 2026-11-18, landing UI review: narrow-screen wrapping fixes, honest loading/error status
  messages, and the home logo's modified-click behavior. Phase 6 remains the next release phase.

- 2026-11-18, dashboard wallet review: replaced the large generic "Wrong network" button with
  separate network and account menus; neutral reconnect status, explicit switching and safe
  cancellation/pending feedback. No new RPC or wallet persistence. Phase 6 remains next.

- 2026-11-18, EVM wallet routing: Connect now offers only MetaMask and Rabby; removed unrestricted
  connector discovery and Phantom restoration, bound each connector to its provider, and pinned
  vault wallet actions to the captured connector. No wallet SDK, new persistence or public
  transaction. Phase 6 remains the next release phase.

- 2026-11-18, progress documentation: consolidated all nine release phases with evidence and
  remaining work; distinguished local implementation/tests from public deployment and the live
  signed run; refreshed the on-chain funding/root observations and MetaMask/Rabby usage and
  update instructions. Existing pool, contracts, circuits and application code unchanged.

12. OPEN ITEMS AND NEXT STEPS
=============================

12.1 TO DO NOW
--------------
- Continue with Phase 6 only after this documentation task is reported: security checks/report
  in contracts/test and docs/security/findings.md, without modifying contracts/src or circuits.
  Phase 7 verification, Phase 8 hosting and Phase 9 live release validation remain open (2.1).
- Before the live signed run, fund the relayer (0.002 testnet ETH) and the publisher
  (0.0005 testnet ETH): section 7. This needs the owner's wallet/signatures; do not send funds
  automatically. Then use the hosted site for a standard deposit, wait for its root, make a
  relayed withdrawal to a fresh address, and test one public exit, verifying each on-chain.
- Remove the old trading app's names from .env (COINBASE_*, VITE_WALLETCONNECT_PROJECT_ID,
  VITE_PUBLIC_ONCHAINKIT_API_KEY, JWT_SECRET, DATABASE_URL, OPENROUTER_API_KEY, HYPERLIQUID_*,
  GATEIO_*). No code reads them any more.
- Move your owner wallet's key out of the project .env (the DEPLOY_PRIVATE_KEY_TESTNET line): keep
  it in MetaMask or a forge keystore only. The pool's admin rights hang on it (section 10).
- Optional: remove the stale *_11155111 and ETHERSCAN_API_KEY lines from .env. Nothing reads them.

12.2 DECISIONS FOR THE OWNER
----------------------------
- Verify the contract source on the Robinhood Chain Testnet explorer? Verification would publish
  the deployed NatSpec, which says "built for Robinhood Chain Testnet and Ethereum Sepolia".
  The manual commands are in docs/privacy-pools/README.md.
- Hosting target already decided: a long-running Docker server, not serverless (Phase 8).
  The host, domain, account/login and actual deploy confirmation still need the owner. The
  npm-based Dockerfile is a starting point, not a completed/validated hosting release. The
  Vercel config is retained but does not run the periodic publisher. A public URL/deployed
  commit has not been verified here; do not infer deployment from a successful local build.
  Use the host's secret store; no secrets in the image or repository. .dockerignore keeps the
  live exclusion list out of the image: mount it at run time and set PRIVACY_ASP_EXCLUSIONS_FILE,
  or use PRIVACY_ASP_EXCLUSIONS_JSON. fly.toml and its deploy workflow were removed in Phase 2.
  Without a running publisher, a new pool's first root never comes until the operator posts one;
  an eligible deposit remains held until a root includes it. Funding alone does not start a
  serverless publisher.
- Before the site goes online: Hylsia needs its own privacy notice and terms (the old legal pages
  described the trading product and were removed), and a review of the Robinhood Chain brand
  terms (https://docs.robinhood.com/chain/brand-guidelines/).
- The whitepaper draft, docs/hylsia-whitepaper-draft.md, is yours and still describes
  Ethereum/Sepolia; it was left unedited for you to rewrite.
- Screening (Phase 4), waiting for your yes or no:
  - the policy page's text (client/src/pages/ScreeningPolicy.tsx), and a contact for disputes
    (left out until you give one; the app's existing X link could serve);
  - publishing a reason code next to each excluded deposit (sanctions, stolen-funds, fraud,
    legal-order, test), or only "excluded";
  - the excluded deposits' leaf numbers kept on-chain in every root's record for good (the
    alternative, a digest, would lose the device's own rebuilding);
  - the landing copy: the Guarantees line ("On testnet a deposit joins it 1 hour after it is made,
    unless the screening policy excludes it.") and the FAQ's link to the policy page;
  - the relayer's refusal of older roots that hold an excluded deposit (on now; removing it is one
    block in server/privacy/relayer.ts);
  - whether an eviction burst runs automatically after every removal, or a heartbeat re-posts the
    root every few hours (neither is built; asp-window.md section 6 recommends one before
    mainnet);
  - an inclusion latency of the delay plus up to one auto-publish interval (1 hour to 1 hour
    10 minutes), or an extra publish at each deposit's eligibility time;
  - on serverless hosting: the list goes in PRIVACY_ASP_EXCLUSIONS_JSON (no notes), and someone
    runs npm run zk:asp:publish after every edit and from a scheduler;
  - whether the shrink alarm should also compare with every root that checks out within a time
    window (for example 24 to 72 hours, by block), so that 16 different smaller roots posted in a
    row no longer get past it; it would also keep asking for that long after an honest mass
    exclusion. Not built;
  - wording proposals from the round-2 review for the policy page and the Privacy & trust tab
    (none applied): a whole clause for the removal speed when the publisher cannot post ("the
    next root the publisher posts leaves it out"); explaining "root" once ("one number that
    stands for the whole list"); "Screening needs nothing from you: no account, no sign-in, no
    identity" instead of "Screening uses public chain data only"; the publish-speed sentence says
    a withdrawal can ask for a root, which holds only once the pool has one; and a limit to add:
    "An operator that suspects you hold a deposit can exclude it on-chain around your
    withdrawal: the withdrawal then stops (for every note alike), but whether you try again tells
    it something. The exclusion is public." The policy page's "much smaller than a recent root's"
    also holds only against the last 16 different roots that check out, found among the last 64
    different root values;
  - from the round-3 review (none applied to the policy page): the Privacy & trust row for the
    association-set service is one long sentence (now with the 64-value bound, a factual
    correction): split it into short ones with the same facts: what the service never learns;
    when the app asks it for a newer root; what the operator can do (delay deposits, exclude them
    publicly); when the app asks you first;
  - two rules extended in round 3, worth your yes: (b) an answer whose announcements alone shrink
    a pool's root sharply now sends no request for a newer root on any network, not only on that
    pool's (one answer covers every network; during an honest mass exclusion, withdrawals on the
    other networks then use their current roots until the removal root is posted); and after a
    question asked before the request, the app asks again when the crowd proved in is clearly
    smaller than the form showed. Option, not built: also ignore the "root due" of an answer whose
    announcements leave fewer than 10 members, so that in a root of 10 or fewer no "Withdraw
    anyway" sends the request either (today the app asks first, and asks again if the reply root is
    clearly smaller than the form showed).

12.3 KNOWN GAPS
---------------
- Minor layout cases: very large figures at 1024 px wide, and phone cards at 320 px.
- The activity log is encrypted since Phase 3, but its size and a pool's reservation key (while a
  deposit is unsettled, or after one interrupted before the wallet answered, until Forget) are
  visible on the device, and the unlocked vault reads it (section 9.2).
- Same-origin tabs now coordinate encrypted activity merge/write and reservations with Web Locks.
  A tab whose vault was forgotten or replaced writes nothing. Separate profiles/devices and old
  builds cannot share this lock; H-01 remains a release blocker for concurrent same-backup deposits.
- Only one relayer is operated today; Phase 5 supports configuring and manually choosing
  another, with no automatic failover. A static event snapshot speeds first sync, but browsers
  still read the full history from their RPC before private withdrawals; there is no indexer.
- Screening v1 is a testnet policy: no production operator, and nobody outside Hylsia reviews the
  exclusion list. It is only as good as that list: a deposit nobody reported is admitted.
- The 16-root window after a removal stays open for clients that pay their own gas until 15 newer
  roots are posted, which can take days on a quiet pool; the eviction burst is manual
  (docs/privacy-pools/asp-window.md).
- The shrink alarm compares with the pool's last 16 different roots that check out on the device
  (re-posts count once; roots that verify nowhere do not count); an operator that first posts 16
  different smaller roots that check out, each a public mass exclusion with its record (or more
  than 64 different root values in a row), gets past it. A targeted exclusion around a
  withdrawal stops it for every note alike, but a retry can still tell the operator something.
- Only members of the newest root can start a withdrawal from this app, so the operator, which
  sees the request for a newer root, can narrow a withdrawal to those members it does not
  announce, even when it is proved in a newer, larger root (the app asks first below 10).
- With a lagging log RPC, a withdrawal can send the input-less record request (privacy.asp.set)
  before its questions; if the root changed a moment before and no longer holds the note, it stops
  right after that request (a narrow race; the status answer's record is used first).
- The eviction burst sends with an explicit nonce; on a node whose mempool replaces a pending
  transaction by fee (anvil, geth), a newer post still pending at a clearly lower fee is replaced
  by the burst's, and the server posts that root again only after 10 minutes.
- An eligible deposit is held until the publisher's next root includes it: up to one auto-publish
  interval after the delay (or until another withdrawal's request), so 1 hour to 1 hour 10
  minutes on testnet.
- At most 500 excluded deposits per pool fit in one root's record; beyond that publishing pauses,
  and a more compact record would need a policy version 2.
- Run one publisher (one code version, one exclusion list) per pool: an older publisher with the
  same postman key would post unscreened roots, which devices refuse.
- Every root's record stays in the device's public event cache, so the cache grows with each
  root and each excluded deposit (not trimmed yet).
- Browser proving time has not been measured on target devices (phones in particular).
- My notes and the pool page may still use the older page-title layout inside the Pools shell
  (check), and the Pools table has only been seen with an empty pool: re-check it with real
  deposits.
- The kept UI kit files (dialog, select, sheet and others) and ErrorBoundary still use lucide-react
  icons, while the landing and the privacy app use Font Awesome (components/icons.tsx).
- No Phase 6 security report yet: fuzz/invariant coverage, Slither and circomspect results,
  severity-ranked findings and v2 recommendations are still due. Passing functional tests
  is not an audit. The remaining release work is listed in 2.1.

12.4 V2 ROADMAP ONLY - OUT OF SCOPE FOR THIS RELEASE
---------------------------------------------------
- ERC-20 and stock-token pools, shielded transfers, payment links, disclosure receipts, a public
  trusted-setup ceremony, multisig ownership and mainnet: document these in docs/roadmap-v2.md
  only, without implementation in this release. That roadmap file has not been written yet.
- Future real-value use needs an independent audit of circuits, contracts, key handling and
  configuration, and a public trusted setup with new verifiers from a frozen build. These are
  future prerequisites, not authorization to change the existing pool or enable mainnet now.


2026-11-19 SECURITY REVIEW UPDATE (Phase 6)
------------------------------------------
Current evidence and limitations: docs/security/findings.md. Release gates: docs/privacy-pools/release-checklist.md.
Do not read the historical Phase 5 test counts above as final Phase 6 evidence.

- Same-origin tabs use Web Locks around encrypted activity merge/write and reservation allocation.
  A settled allocation watermark prevents reuse by a tab with stale chain data. Persistent storage
  and Web Locks over HTTPS are required for deposits. The existing recovery gap (10) is preserved;
  too many unresolved allocations require sync/settlement before another deposit. No plaintext fallback.
- A backup holds the encrypted seed and reconstructs notes, change and balance from the chain. It
  does not hold all local activity history. Use one depositing profile per backup, settle outstanding
  wallet requests before restore, and close old-build tabs. Cross-profile concurrency remains H-01.
- Relayer broadcasts serialize per process; repeated identical submissions share a hash and conflicting
  terms for one nullifier are refused. Ambiguous send outcome pauses the signer for operator reconciliation.
  This is not multi-host coordination or a durable restart journal; run one signer process and check nonces.
- The contract pays recipient amount minus fee; amount includes the fee. Surplus ETH is distinct from
  liabilities. Real-proof tests cover rollback, replay, public exit/change, roots and domain separation.
- Privacy labels including Strong are estimates of this app's model; deposits are not independent people.
  Explicit note identifiers are omitted from private-flow requests, but metadata, exclusion and retry
  patterns can support inference. Screening v1 is the operator's exclusion policy, not universal detection.
- Default eligibility is one hour, then root inclusion. One hour to one hour ten minutes is an estimate
  only with a running, funded, healthy publisher. Removal from newest root, app/relayer refusal and complete
  old-root eviction are separate states. No burst/heartbeat/failover policy was activated.
- Production preparation: runtime service-key files, one-replica compose, non-root minimal runtime image,
  read-only health checks and CSP/security headers; exact permanent warning is now shown in UI.
  Docker daemon was unavailable. Browser proving under CSP, real wallet signatures, mobile and live hosting
  checks remain open. The public pool's source was not submitted to any explorer.
- Read-only bytecode comparison matched the existing pool, verifiers and linked libraries. Deployment
  source commit is 5328dd0; exact addresses/settings/constructor bytes: docs/security/deployment-verification.json.
- The setup is local development: the active ptau verifies with contributor hylsia-local. A Hermez-like
  filename is not evidence of a public ceremony. No setup, key regeneration or zk:build was run.
- 37 frozen file hashes before/after are in docs/security/frozen-artifacts.json; verify locally with
  node --import tsx scripts/privacy/check-frozen-artifacts.ts. No active source/artifact/record was changed.
- Final regression command/results are recorded in the final section of docs/security/findings.md.


PRODUCT DOCUMENTATION WEBSITE
-----------------------------
/docs is a standalone documentation area with chapter navigation, on-page contents, local search
(Cmd/Ctrl+K), copy-page links, light/dark theme and a compact mobile chapter menu. It links from the
landing navigation/footer and the Pools sidebar. It does not initialize the vault or track page views;
its search query is kept in component memory, not placed in a URL, storage or API request.

Chapters: introduction, manifesto, deposit, withdrawal, backup/recovery, ragequit, screening,
privacy/trust, security/status and network/deployment. The English copy follows the existing app.
Security evidence is dated 19 November 2026; local tests and public testnet validation remain distinct.
Content: client/src/docs/content.ts. Layout: client/src/pages/Docs.tsx and client/src/docs/docs.css.
This change does not deploy hosting or change pool artifacts.


US-ENGLISH SEO AND SOCIAL LINK PREVIEWS
--------------------------------------
Canonical public origin: https://www.hylsiapools.tech (supplied by the owner).
HTML uses en-US; Open Graph locale is en_US. US English content and a self-referencing
hreflang accompany canonical URLs. Geographic metadata is a hint, not a promise of US ranking
or a statement that Hylsia has a physical office there.

public/web-share.png is the original social artwork (1774 x 887). The Vite SEO plugin publishes
it unchanged at /web-share.png in both preview and production output. Open Graph and Twitter
summary_large_image metadata use its absolute HTTPS URL and real dimensions/alt text.
No image regeneration or change to the original artwork is performed.

The build generates initial-HTML metadata per public page, plus /robots.txt and /sitemap.xml.
This allows link-preview crawlers to read title, description and image without JavaScript.
The sitemap includes the home page, 10 docs chapters, pools and screening policy. Vault,
portfolio and API/health/proving assets are not included. Vault/portfolio/legacy privacy pages
receive noindex headers in the long-running server and prepared Vercel configuration.

Source: shared/siteMetadata.ts and scripts/vite/siteSeo.ts. The long-running server serves
prebuilt public page HTML; Vercel rewrites retain the corresponding document metadata.
These changes still require a hosting build/deploy to appear at the public domain. No hosting
deploy or social post was run. Platforms may retain a cached preview until they fetch the page again.
