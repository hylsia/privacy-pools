# The 16-root window after a removal (screening policy v1)

Status: Phase 4 behavior, reviewed again in Phase 6 on 2026-11-19. Testnet only, not audited. Measured on local anvil chains by `npm run zk:e2e`; nothing
here was run against the live pool on Robinhood Chain Testnet.

## In short

- The pool contract accepts a private withdrawal proved against any of its **last 16** association-set roots.
- When the operator excludes a deposit that is already in the set, the publisher posts a new root without it (the
  removal root). The older roots that still hold the deposit stay valid until **15 more roots** have been posted after
  the removal root.
- Roots change only when the set changes, so on a quiet pool that can take days, or never happen at all.
- Hylsia's own app and relayer no longer use the window: the app proves only against the newest root, and the relayer
  refuses proofs against older roots that hold an excluded deposit (the relayer refusal is already active in the current code). What
  is left is someone who sends the withdrawal to the pool directly and pays their own gas, with a modified app or an
  older version of this one.
- The **eviction burst** closes that rest without a contract change: the publisher posts the current root again until
  the older roots are pushed out. Measured on anvil: 13 posts, 646,545 gas in total, about 0.0000065 ETH at 0.01 gwei.
  It is an opt-in operator command and never runs on its own.

## 1. What the contract does (verified in `contracts/src/PrivacyPool.sol`, read-only)

- `ASP_ROOT_HISTORY_SIZE = 16`. The roots live in a ring, `aspRoots[16]`, and `currentASPRootIndex` points at the
  newest one.
- `updateASPRoot(root, cid)` can be called only by the pool's `aspPostman`. It rejects a root of 0 or one outside the
  field, and nothing else: **it does not check for a duplicate root**. It writes slot `(currentASPRootIndex + 1) % 16`
  and emits `ASPRootUpdated(root, cid)`. The cid is informational for the contract; the screening policy puts its
  recipe there.
- `isKnownASPRoot(root)` looks through all 16 slots; 0 is never known. `withdraw` reverts with `UnknownASPRoot` when the
  proof's root is not among them.
- So a root is overwritten by the 16th post after it. A root that sits in several slots stays known until its newest
  copy is overwritten.
- The last root that holds an excluded deposit is the one right before the removal root. It stays known while fewer
  than 15 roots have been posted after the removal root, and it is gone after the 15th.
- The state-tree history is separate (100 roots). The window here is about association-set roots only.
- A deposit that the exclusion list names **before** it is eligible never enters a root, so it has no window at all.
  That is what the inclusion delay (3600 s on Robinhood Chain Testnet) buys: the window matters only for exclusions
  reported after a deposit joined.

## 2. Who can still use the window

| Who | During the window | Why |
| --- | --- | --- |
| This app (Phase 4) | No | It proves only against the newest root, after rebuilding that root's list from its own events and checking it, and it starts a private withdrawal only for a deposit that root holds. Once the operator announces the exclusion it already holds the deposit back ("Removal announced"), before the removal root is posted. |
| Hylsia's relayer | No | Before it simulates anything, it refuses a proof whose association-set root is an older root that holds an excluded deposit, or one it cannot rebuild: "The association-set root this proof used is no longer accepted. Nothing was sent; make a new proof." It never refuses the current root. "Excluded" is what the exclusion list names plus what the current root's own record lists, so a missing or broken list (after a restart, say) does not switch the refusal off; with such a list and a current root it cannot check, it refuses every older root. The answer depends only on the root, which is public in the proof, so it is the same for every proof and names no deposit. Implemented in Phase 4 (critique M4); **already active; policy sign-off remains an operator decision**. |
| A modified app, or an older tab of this one, with "Pay your own gas" | **Yes** | It sends `withdraw` to the pool itself. The contract accepts any of the 16 roots. A Phase 3 tab picks the largest older root that is a prefix of the deposits, so it can hit the window without meaning to. |
| The depositor's public exit (ragequit) | Not a window | Ragequit is public and names the deposit. It requires an unspent note and matching proof, the original depositor wallet and gas, excluded or not. |

## 3. Measurement (`npm run zk:e2e`, 2026-11-18)

Method. Chain A is an anvil with Robinhood Chain Testnet's chain id (46630), mining a block per transaction so block
times can be set exactly. The server modules run in process with an inclusion delay of 3600 s on chain A and an
exclusion list in a temp file. The steps:

1. Deposits 3 to 5 join with root **R1** (6 members). Deposit 5 was sent from bob's wallet, so bob is its depositor.
   Nine more deposits join with root **R2** (15 deposits considered, 14 members; deposit 6 was listed before it was
   eligible and never joined).
2. Before any exclusion of deposit 5, deposit 4's withdrawal is proved against R2 (an in-flight proof).
3. The operator lists bob's address. The next tick posts the removal root **R_rm**
   (`hylsia-asp:v1;n=15;x=8,9;…`): deposit 5 is out, and its leaf is in the record.
4. Window open. A proof of deposit 5 made by the Phase 3 rule (against R1) and the in-flight proof (against R2) are both
   refused by the relayer, and both still pass when sent to the pool directly.
5. Two natural roots, **N1** and **N2**: one deposit joins after the delay, then the tick posts. After each one, R1 and
   R2 are still known and both proofs still pass.
6. `planEviction` reads the ring from the contract (`currentASPRootIndex`, `aspRoots(0..15)`): R2 at distance 3, R1 at
   distance 4, so **13 posts** are needed (16 − 3). The preview sends nothing.
7. The burst re-posts N2 with N2's own record, 13 times. After every post the run checks `isKnownASPRoot` for R1 and R2
   and simulates both old proofs.

Results.

| Post after R_rm | What | R1 (n=6) known | R2 (n=15) known | Old proofs sent directly |
| --- | --- | --- | --- | --- |
| 1 | N1 (natural) | yes | yes | pass |
| 2 | N2 (natural) | yes | yes | pass |
| 3 to 13 | burst posts 1 to 11 | yes | yes | pass |
| 14 | burst post 12 | **no** | yes | deposit 5's (against R1): `UnknownASPRoot` |
| 15 | burst post 13 | no | **no** | deposit 4's (against R2): `UnknownASPRoot` |

- R2, the last root holding deposit 5, stayed known through 14 posts after the removal root and was gone after the
  15th, exactly as the contract's ring predicts.
- **The burst only kills proofs against the offending roots and older ones.** R_rm sat at distance 15 after the burst
  and was still known: deposit 3's proof, made against R_rm after the removal, still passed and was relayed. Deposit 4's
  in-flight proof was made again against the current root and relayed.
- A device that still held R2 as the "current" root (it read the chain before the removal) got `ROOT_NOT_KNOWN` and
  sent nothing.

Time. Chain time is artificial on anvil (time travel): N1 came 3610 s after R_rm and N2 7220 s after it, because each
waited for one deposit's 3600 s delay. The burst's 13 posts took 292 ms of wall-clock time on anvil in the round-2 final run
(blocks 73 to 85, the same chain second; 112 ms before round 2), without the run's own checks after each post. Since
round 2 the burst reads the postman's nonces and a fresh snapshot of the pool before every post (below), which is the
added time.

Gas (anvil receipts; they leave out the parent-chain data fee that an Arbitrum Orbit chain such as Robinhood Chain
Testnet adds to each transaction, so testnet receipts will show more):

| Post | Gas | Why |
| --- | --- | --- |
| The pool's first root ever | 72,369 | the index and the slot are both written from zero (the "about 71 k" in the readme) |
| A post into a slot never written before | 55,365 | the slot is written from zero |
| The post that wraps the index to slot 0 | 50,565 | slot 0 is written from zero, and the index is set back to zero (a refund) |
| A post that overwrites an older slot | 38,265 | the slot and the index change from non-zero to non-zero |

| | Posts | Gas min / avg / max | Total gas | At 0.01 gwei |
| --- | --- | --- | --- | --- |
| The burst | 13 | 38,265 / 49,734 / 55,365 | 646,545 | 0.0000065 ETH |
| All posts after R_rm (2 natural, 13 burst) | 15 | 38,265 / 50,485 / 55,365 | 757,275 | 0.0000076 ETH |
| Worst case for one burst (15 posts, ring never full) | 15 | 55,365 each | 830,475 | 0.0000083 ETH |

The burst's own funding check asks for 100,000 gas per post at the current gas price with a 2× margin: for 15 posts at
0.01 gwei that is 0.00003 ETH, well inside the 0.0005 ETH suggested for the publisher (readme section 7).

On Robinhood Chain Testnet (about 420,000 blocks a day, so about 0.2 s per block) a burst is sequential: each post waits
for its receipt before the next one. Estimated 15 to 45 seconds for 15 posts. Not measured: bursts are never run on the
live pool, and its publisher holds no ETH yet.

## 4. How long the window stays open on its own

A new root is posted only when the set changes: a deposit passes the delay and its confirmations, an exclusion is added
or lifted, or a record is repaired or lists a new exclusion. Several changes between two ticks give one root. With the
default auto-publish interval of 600 s, the schedule alone posts at most one root per 10 minutes; a withdrawal's
label-free publish request (whenever a root is due) and the exclusion file's watcher can post roots between ticks, so
roots can come faster than that. After a removal, the window stays open until 15 more roots have been posted:

| Eligible deposits on the pool | Window after a removal |
| --- | --- |
| None (the live pool today) | never closes on its own |
| 1 a day | about 15 days |
| 10 a day | about 1.5 days |
| At least 1 every 10 minutes | about 2.5 hours (15 ticks of 600 s) from the schedule alone; shorter when withdrawals' publish requests post roots in between |

## 5. Ways to shorten it without a contract change

All of these work with the deployed pool. "Implemented" means it is in Phase 4; "proposal" means it is not.

| # | Measure | State | Effect on the window | Cost | Side effects |
| --- | --- | --- | --- | --- | --- |
| 0 | **Relayer refusal**: the relayer refuses proofs against older roots that hold an excluded deposit, or that it cannot rebuild | implemented, **already active; policy sign-off remains an operator decision** | Closed at once for every relayed withdrawal | none: no gas, no new roots | An honest withdrawal proved against such a root just before the removal is refused ("make a new proof"); the app makes a new proof against the newest root. If the server's events lag, a root it cannot rebuild is refused too (fail closed). |
| 1 | **Immediate removal publish**: the file watcher checks the list every 15 s; a change that has stayed the same for 30 s and lists a member of the current root runs that pool's tick at once | implemented | The removal root comes about 35 to 45 s after the edit (server owner's measurement) instead of up to 10 minutes later. The 15-root window itself is unchanged. | one publish | none new |
| 2 | **Eviction burst**: `npm run zk:asp:publish -- --chain <id> --evict` previews (sends nothing); `--evict --yes` sends | implemented, **opt-in only** | Closed by up to 15 re-posts of the current root (13 in the measurement) | at most about 0.83 M gas, about 0.0000083 ETH at 0.01 gwei, plus the data fee | Proofs against the offending roots and older ones stop verifying; proofs against the removal root or newer survive (measured). The ring fills with copies of the current root; the app's shrink alarm counts re-posts of one root once (see below), so the copies do not blind it. The publisher needs funds for every post up front. The publisher's rule against posting a root twice gets a third exception, besides the one-time repair of a record that does not match its root and the one-time record that lists a newly excluded newest deposit (section 4). It may run while the server runs: before each post it waits until the postman has no transaction in flight, re-reads the current root and its newest record, and sends with an explicit nonce, so a post the periodic publisher or a withdrawal's request sends meanwhile is never buried under an older root or record (round 2; before, a post sent but not mined yet could end up under the burst's re-post). One exception (round 3): a node whose mempool replaces a pending transaction by fee (anvil, geth) takes the burst's post in place of such a post still pending at a clearly lower fee, and the server posts that root again after 10 minutes; both price from the same RPC's estimate, so normally the burst's post is refused instead. A post of the burst's own that is not mined within 120 s stops it with a message that says so (it may still land). |
| 3 | **Heartbeat**: re-post the current root every H hours, even when nothing changed | proposal | at most 15 × H (H = 1 h: 15 h; H = 6 h: 90 h) | H = 1 h: 24 posts a day, about 0.9 to 1.3 M gas, about 0.00001 ETH a day; H = 6 h: 4 posts a day | Driven by the clock, so it reveals nothing. Same ring effects as a burst, spread out. |
| 4 | **Automatic burst after every removal**: the tick that posts a removal root runs the burst right after it | proposal, **needs your yes** | about a minute after the edit (measure 1 plus a burst) | as 2, per removal (several removals in one edit share one burst) | as 2; every removal is followed by a visible burst on-chain (the removal itself is already public in the root's record) |
| 5 | **Root age bound** (a scheduled variant of 3): on its tick, the auto-publisher re-posts the current root when it is older than A | proposal | at most 15 × max(A, tick interval) | as 3 at the same rate | as 3 |

Also in place: **the app rule**. The official app proves only against the newest root, so for this app the window is
already closed; it matters only for clients that bypass both the app and the relayer.

Rejected:
- Dummy roots: they cost the same as re-posts, and devices would have to tell them from real roots.
- Waiting for natural churn: unbounded on a quiet pool (section 4).
- Contract changes (a shorter history, root expiry, an explicit revoke): each needs a new pool.

The shrink alarm and bursts. Before the operator sees any request about a withdrawal (but for the input-less record request
a device whose log RPC lags may send first, right after the root changed), the app compares the crowd it would
hide in (the newest root's members, minus those the operator's status announces for exclusion) with the largest of the
pool's last 16 DIFFERENT roots in the device's own copy of the events that verify on the device, not with the contract's
ring, and asks the user when it shrank sharply (at least 10 deposits and 20%). Re-posts of one root count once, and a
root value no record of which rebuilds to it does not count, so a burst, a heartbeat, a dishonest operator's small root
re-posted 15 times or 16 garbage roots leave the larger root in the comparison (the e2e checks both: 22 → 12 still asks
after 15 copies of the small root and after 16 roots that verify nowhere). What gets past it is 16 different smaller
roots in a row that do verify, each a public mass exclusion with its own on-chain record (or more than 64 different root
values in a row: the device examines at most that many); the crowd is still shown before the withdrawal is sent and
asked about below 10. A root posted in reply to a withdrawal's own request that leaves out a member whose exclusion the
status the device last read did not announce stops that withdrawal, the same for every note (an honest removal announced
in the minute or two before stops it too). So an operator that suspects a deposit and excludes it on-chain right after a
withdrawal asks for a root learns nothing from that attempt itself; whether the person tries again, and whether that
goes through, can still tell it something, and the exclusion is public in the root's record for good.

## 6. Recommendation

1. Record that relayer refusal (measure 0) is already active. This review does not switch it on or change its criteria; operator policy sign-off remains open.
2. Keep the immediate removal publish (measure 1); it is already on.
3. Until you decide on automation, run the burst by hand after a removal that matters on a quiet pool, for example a
   sanctions, stolen-funds or legal-order exclusion: preview with `--evict`, then send with `--evict --yes` and
   `--chain <id>`. A test exclusion does not need it.
4. Decide whether the burst should run automatically after every removal (measure 4), or whether a heartbeat (measure 3,
   for example every 6 hours) is the better bound. Both cost little at testnet gas prices. Before Robinhood Chain
   mainnet, one of them should be on.

Bursts stay opt-in: nothing in Phase 4 posts a duplicate root on its own, except the one-time repair of a root whose
record does not match it, and the one-time record post that lists a newly excluded newest deposit (section 4).


## 7. Phase 6 operator gates (19 November 2026)

Three states must be recorded separately: **(1)** the newest root omits the deposit, **(2)** Hylsia app/relayer refuses
its use (announced removal can make the app hold it even before state 1), and **(3)** every on-chain root still holding
it is evicted. Only state 3 closes direct-contract use with old proofs. Duplicate copies count separately in the
contract ring; checking only the latest root or waiting a fixed number of minutes does not prove state 3.

`SecurityReviewTest.test_lastASPContainingLabelEvictedAfter15PostsAfterRemoval` repeats the exact boundary with a real
withdrawal proof: still known after removal +14 posts, unknown after +15. The 19 November local e2e again measures
13 manual posts after two natural roots, 646,545 gas; receipts are local, with no public burst.

Before an operator-authorized manual burst:

1. Record chain/pool, active publisher address, exclusions version and removal-root receipt. Preview only:
   `npm run zk:asp:publish -- --chain 46630 --evict`. **Unlike the default command, this preview sends nothing.**
   Default `npm run zk:asp:publish` can broadcast; never use it as a status/health command.
2. Establish one publisher writer across host/CLI/scheduler. Compare pending and latest nonce, locate every pending
   transaction and receipt, reconcile RPC lag/reorg. Do not treat a timeout or missing response as cancellation.
3. Review roots and newest records immediately before each post. If pending nonce advances, conflict/replacement occurs,
   or RPC cannot establish outcome, stop and reconcile; do not add a fee bump or launch another burst automatically.
   The existing CLI's nonce checks reduce but do not eliminate multi-process replacement races documented above.
4. Only after separate public-action approval, funding and service signing, the operator may append `--yes` to that
   reviewed eviction command. This review did not run it on a public chain.
5. Save receipts and check `isKnownASPRoot` for **all** offending root values, including their duplicate copies; verify
   the current recipe/root again. An in-flight honest proof may need regeneration after eviction. Preserve evidence
   of the boundary and resume only one publisher.

Heartbeat, automatic burst, changed delay/exclusion criteria/reason codes, privacy thresholds and automatic relayer
failover remain unapproved proposals. No such automation was added. See [release gates](release-checklist.md).
