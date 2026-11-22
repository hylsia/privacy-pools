/**
 * The association-set publisher's command line (screening policy v1), for every served pool or for one network with
 * --chain <id>. Reads the same env as the server (server/_core/loadEnv: .env, then .env.local), in multi mode
 * (PRIVACY_CHAIN_IDS) or legacy single-network mode (PRIVACY_CHAIN_ID). Posting needs PRIVACY_ASP_POSTMAN_PRIVATE_KEY
 * (or PRIVACY_ASP_POSTMAN_PRIVATE_KEY_<id>), which must be the pool's aspPostman and hold enough testnet ETH (about
 * 100,000 gas at the network's gas price, twice over, per post).
 *
 *   npm run zk:asp:publish [-- --chain <id>]
 *       Prints the policy (inclusion delay, confirmations), the exclusion list's state, the snapshot (deposits
 *       considered, members, waiting, excluded), the root on-chain as the server checks it and the publisher's balance;
 *       then posts every root that is due. The long-running server already does this on its own schedule
 *       (PRIVACY_ASP_AUTO_PUBLISH_SECONDS, default 600 s, and right after an edit of the exclusion file adds a removal);
 *       this is for a one-off publish, after an edit of the exclusion list on serverless hosting, or from a scheduler.
 *   npm run zk:asp:publish -- [--chain <id>] --dry-run
 *       What the current exclusion list would change, sending nothing: members it would remove, deposits it would admit
 *       again, the next root and its record.
 *   npm run zk:asp:publish -- [--chain <id>] --evict
 *       The eviction plan, sending nothing: the contract's 16-root ring, the older roots that still hold an excluded
 *       deposit, how many re-posts of the current root push them out, and what that costs.
 *   npm run zk:asp:publish -- --chain <id> --evict --yes
 *       The eviction burst itself (opt-in, one network at a time; server/privacy/evict.ts). Never automatic.
 *
 * Exits 1 when a pool could not be published (unfunded and paused included) or a burst was refused or failed; a
 * network without a pool yet ("no pool yet, nothing to publish") is not a failure. Prints addresses and balances,
 * never a key, a reason's note or an entry of the exclusion file.
 */
import "../../server/_core/loadEnv";
import { formatEther, formatGwei } from "viem";
import { formatDelay } from "../../shared/privacy/screening";
import { networkById } from "../../shared/privacy/networks";

const nameOf = (chainId: number) => `${networkById(chainId)?.name ?? "chain"} (${chainId})`;
const shortError = (err: unknown) => String((err as Error)?.message ?? err).split("\n")[0];
const short = (v: bigint | string) => `${v.toString().slice(0, 12)}…`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const USAGE = "usage: asp-publish.ts [--chain <id>] [--dry-run | --evict [--yes]] (--evict --yes needs --chain <id>)";

interface Args {
  chain: number | null;
  mode: "publish" | "dry-run" | "evict";
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { chain: null, mode: "publish", yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chain" && args.chain === null && /^\d+$/.test(argv[i + 1] ?? "")) args.chain = Number(argv[++i]);
    else if (a === "--dry-run" && args.mode === "publish") args.mode = "dry-run";
    else if (a === "--evict" && args.mode === "publish") args.mode = "evict";
    else if (a === "--yes" && !args.yes) args.yes = true;
    else throw new Error(USAGE);
  }
  if (args.yes && args.mode !== "evict") throw new Error(USAGE);
  if (args.yes && args.chain === null) throw new Error("asp-publish: --evict --yes sends transactions on one network only: name it with --chain <id>");
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { privacyConfig } = await import("../../server/privacy/config");
  const asp = await import("../../server/privacy/asp");
  const { readFunding } = await import("../../server/privacy/funding");
  const { readExclusions } = await import("../../server/privacy/exclusions");

  const cfg = privacyConfig();
  const served = cfg.chains;
  const chains = served.filter((c) => args.chain === null || c.chainId === args.chain);
  if (args.chain !== null && chains.length === 0) {
    console.error(`asp-publish: this environment does not serve ${nameOf(args.chain)} (serving ${served.map((c) => nameOf(c.chainId)).join(", ")})`);
    return 1;
  }

  // the exclusion list, once for the whole server (its state line; never an entry)
  const list = readExclusions(cfg.aspExclusions, { log: (line) => console.log(line.replace(/^\[privacy\] /, "")) });

  let failed = false;
  /** the publisher's balance line, per chain, for an `unfunded` answer */
  const fundingNote = new Map<number, string>();
  const ready: number[] = [];
  const snapshots = new Map<number, Awaited<ReturnType<typeof asp.getScreenedSet>>>();
  for (const c of chains) {
    const name = nameOf(c.chainId);
    if (!c.pool) {
      if (c.problems.length > 0) {
        // a configured pool this environment cannot use (e.g. an invalid address): a failure, unlike "not deployed yet"
        console.log(`${name}: unavailable (configuration problem: ${c.problems.join(", ")})`);
        failed = true;
      } else console.log(`${name}: no pool yet, nothing to publish`);
      continue;
    }
    ready.push(c.chainId);
    console.log(`${name}: screening policy v1: inclusion delay ${formatDelay(c.aspInclusionDelaySeconds)} (${c.aspInclusionDelaySeconds} s), ${plural(c.aspConfirmations, "confirmation")}`);
    try {
      const s = await asp.getScreenedSet({ chainId: c.chainId, fresh: true });
      snapshots.set(c.chainId, s);
      const snap = s.snapshot;
      const inRecord = snap.excluded.filter((e) => e.considered).length;
      console.log(
        `${name}: snapshot at block ${s.head.block}: ${plural(snap.deposits, "deposit")}, ${snap.recipe.considered} considered, ${plural(snap.memberCount, "member")}, ${snap.waiting} waiting, ${snap.excluded.length} excluded (${inRecord} in the root's record, ${snap.excluded.length - inRecord} not considered yet); root ${short(snap.root)}`,
      );
      const verified = asp.verifiedCurrent(s);
      const current =
        s.currentRoot === 0n
          ? "none posted yet"
          : `${short(s.currentRoot)} (${s.current?.status ?? "unknown"}${verified ? `, ${plural(verified.memberCount, "member")}` : ""})`;
      const due = s.rootDue ? "a new root is due" : s.settling ? "a new root waits until the exclusion list has settled (30 s)" : "current";
      console.log(`${name}: root on-chain ${current}; ${due}${s.policyError ? `; publishing is paused: ${s.policyError}` : ""}`);
    } catch (err) {
      console.log(`${name}: status unavailable (${shortError(err)})`);
    }
    const funding = await readFunding(c.chainId, { fresh: true });
    if (funding?.postman) {
      const { address, balance, required, funded } = funding.postman;
      const line = `the publisher ${address} holds ${formatEther(balance)} ETH; one publish needs about ${formatEther(required)} ETH`;
      fundingNote.set(c.chainId, line);
      console.log(`${name}: ${line}${funded ? "" : " (too little: fund it with testnet ETH, then run this again)"}`);
    }
  }
  if (list.status === "invalid") failed = true;

  if (args.mode === "dry-run") return dryRun(snapshots, asp.verifiedCurrent) || failed ? 1 : 0;
  if (args.mode === "evict") return (await evict(ready, args.yes)) || failed ? 1 : 0;

  const answered = args.chain !== null ? [await asp.publishASPRoot(args.chain)] : (await asp.publishBehindRoots()).results;
  // A network without a pool yet was named above ("no pool yet, nothing to publish"): it is not a failure.
  const results = answered.filter((r) => r.pool !== null);
  for (const r of results) {
    const tx = r.txHash ? `, transaction ${r.txHash}` : "";
    const root = r.root ? `, root ${r.root.slice(0, 12)}…` : "";
    const why =
      r.status === "unfunded"
        ? `: ${fundingNote.get(r.chainId) ?? "the publisher has too little testnet ETH for one publish"}. Nothing was sent`
        : r.status === "policy_error"
          ? `: publishing is paused (${asp.policyErrorReason(r) ?? "see above"}). Nothing was sent`
          : "";
    console.log(`${nameOf(r.chainId)}: ${r.status}${tx}${root}${why}`);
  }
  const notPublished = new Set(["unavailable", "no_key", "not_postman", "unfunded", "policy_error"]);
  return failed || results.some((r) => notPublished.has(r.status)) ? 1 : 0;
}

/** --dry-run: what the current exclusion list changes, from the fresh snapshots printed above. Sends nothing. */
function dryRun(
  snapshots: ReadonlyMap<number, Awaited<ReturnType<typeof import("../../server/privacy/asp").getScreenedSet>>>,
  verifiedCurrent: typeof import("../../server/privacy/asp").verifiedCurrent,
): boolean {
  let failed = false;
  for (const [chainId, s] of snapshots) {
    const name = nameOf(chainId);
    const members = verifiedCurrent(s);
    const removed = members ? s.snapshot.excluded.filter((e) => members.has(e.label)) : [];
    // new members that are not re-admissions: deposits that passed the inclusion delay since the current root
    const joining = (members ? s.snapshot.labels.filter((l) => !members.has(l)).length : s.snapshot.memberCount) - (members ? s.readmitted.length : 0);
    const notYet = s.snapshot.excluded.filter((e) => !e.considered);
    console.log(`${name}: dry run (nothing is sent):`);
    console.log(`  members of the current root the list removes: ${removed.length}${removed.length > 0 ? ` (leaves ${removed.map((e) => e.leafIndex).join(", ")})` : ""}`);
    console.log(`  excluded deposits the next root admits again: ${s.readmitted.length}${s.readmitted.length > 0 ? ` (leaves ${s.readmitted.join(", ")})` : ""}`);
    console.log(`  listed deposits not considered yet (they never join while listed): ${notYet.length}${notYet.length > 0 ? ` (leaves ${notYet.map((e) => e.leafIndex).join(", ")})` : ""}`);
    console.log(`  new deposits that join with the next root: ${joining}; still waiting (delay or confirmations): ${s.snapshot.waiting}`);
    console.log(`  the next root: ${plural(s.snapshot.memberCount, "member")}, root ${s.snapshot.root}, record ${s.snapshot.cid ?? "(none: too many exclusions for one record)"}`);
    const would = s.policyError
      ? `no: publishing is paused (${s.policyError})`
      : s.rootDue
        ? s.repair
          ? "yes (the same root again, with its screening record)"
          : s.record
            ? "yes (the same root again, with a record that lists the newly excluded deposits)"
            : "yes"
        : s.settling
          ? "not yet: it admits an excluded deposit again, so it waits until the list has been unchanged for 30 s"
          : "no: the root on-chain is current";
    console.log(`  would post: ${would}`);
    if (s.policyError) failed = true;
  }
  return failed;
}

async function evict(chainIds: number[], yes: boolean): Promise<boolean> {
  const { evictExcludedRoots, planEviction } = await import("../../server/privacy/evict");
  let failed = false;
  for (const chainId of chainIds) {
    const name = nameOf(chainId);
    let plan;
    try {
      plan = await planEviction(chainId);
    } catch (err) {
      console.log(`${name}: eviction plan unavailable (${shortError(err)})`);
      failed = true;
      continue;
    }
    const ring = plan.ring
      .map((e) => `d${e.distance}=${short(e.root)}${e.distance === 0 ? " (current)" : ""}${e.taint === "clean" ? "" : e.taint === "holds" ? " HOLDS AN EXCLUDED DEPOSIT" : " (cannot be rebuilt here)"}`)
      .join(", ");
    console.log(`${name}: the contract's ring (${plan.ringSize} slots, newest first, d = posts since): ${ring || "empty"}`);
    console.log(`${name}: ${plural(plan.excludedDeposits, "deposit")} excluded; ${plural(plan.offending.length, "older slot")} still ${plan.offending.length === 1 ? "holds" : "hold"} one${plan.offending.length > 0 ? ` (nearest at distance ${Math.min(...plan.offending.map((o) => o.distance))})` : ""}`);
    if (plan.postsNeeded === 0) {
      console.log(`${name}: nothing to evict`);
      continue;
    }
    const price = plan.gasPrice !== null ? ` at ${formatGwei(plan.gasPrice)} gwei` : "";
    console.log(
      `${name}: ${plural(plan.postsNeeded, "re-post")} of the current root close the window; the publisher needs about ${formatEther(plan.costWei)} ETH for them${price} (with the margin)${plan.balance !== null ? `, and holds ${formatEther(plan.balance)} ETH` : ""}`,
    );
    for (const b of plan.blockers) console.log(`${name}: refused now: ${b}`);
    if (!yes) {
      console.log(`${name}: nothing was sent (preview). To send: npm run zk:asp:publish -- --chain ${chainId} --evict --yes`);
      if (plan.blockers.length > 0) failed = true;
      continue;
    }
    try {
      const gas: bigint[] = [];
      const result = await evictExcludedRoots(chainId, {
        send: true,
        onPost: (k, post) => {
          gas.push(post.gasUsed);
          console.log(`${name}: post ${k}/${plan.postsNeeded}: transaction ${post.txHash}, block ${post.block}, gas ${post.gasUsed}`);
        },
      });
      const total = gas.reduce((a, b) => a + b, 0n);
      const blocks = result.posts.length > 0 ? `blocks ${result.posts[0].block}-${result.posts.at(-1)!.block}` : "no block";
      const stats =
        gas.length > 0
          ? `; gas min ${gas.reduce((a, b) => (b < a ? b : a))}, avg ${total / BigInt(gas.length)}, max ${gas.reduce((a, b) => (b > a ? b : a))}, total ${total}${plan.gasPrice !== null ? ` (${formatEther(total * plan.gasPrice)} ETH at ${formatGwei(plan.gasPrice)} gwei)` : ""}`
          : "";
      console.log(`${name}: ${plural(result.posts.length, "post")} in ${(result.ms / 1000).toFixed(1)} s, ${blocks}${stats}; the excluded deposits' older roots ${result.evicted ? "are no longer known to the contract" : "are STILL known"}`);
      if (!result.evicted) failed = true;
    } catch (err) {
      console.log(`${name}: ${shortError(err)}`);
      failed = true;
    }
  }
  return failed;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`asp-publish: ${shortError(err)}`);
    process.exit(1);
  });
