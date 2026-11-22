/**
 * Output types of every privacy tRPC procedure (privacy.*), for every served network. The server annotates each
 * procedure with them; the client codes against them. Types only: the imports from the server modules are type-only
 * and vanish from every bundle.
 *
 * Calls that cover every pool never fail as a whole: a pool whose chain is down, misconfigured or failed its
 * contract check is listed under `unavailable` and the others answer as usual. A network without a pool makes no RPC
 * call.
 */
import type { Address, Hex } from "viem";
import type { PoolActivity, PoolDetail, PoolInterval, PoolSummary } from "../../server/privacy/pools"; // type-only
import type { ASPStatus, PublicAssociationSet } from "../../server/privacy/asp"; // type-only
import type { ExclusionReason, RootStatus } from "./screening"; // type-only (import them from ./screening, not from here)

export type { ASPStatus, PoolActivity, PoolDetail, PoolInterval, PoolSummary, PublicAssociationSet };

// ─── shared ───────────────────────────────────────────────────────────────────

export type PoolUnavailableReason = "rpc_error" | "config_error" | "contract_check_failed" | "wrong_chain";
export interface PoolUnavailable {
  chainId: number;
  pool: Address | null;
  reason: PoolUnavailableReason;
}

/**
 * Why the server's relayer cannot send a withdrawal on a pool right now:
 *   - no_relayer_key: this server has no relayer for that network;
 *   - relayer_unfunded: the relayer's balance is below the cost of one withdrawal at the network's current gas price
 *     (with a margin). It is the server's own key: nothing here is about a visitor.
 * A balance that could not be read is unknown and never reported as unfunded.
 */
export type RelayerBlock = "no_relayer_key" | "relayer_unfunded";

/**
 * Why the server cannot post association-set roots on a pool right now (withdrawals of deposits that no published
 * root covers wait for it; ragequit still works):
 *   - no_key: no postman key is configured;
 *   - not_postman: the key is not the pool's aspPostman;
 *   - publisher_unfunded: the postman's balance is below the cost of one publish at the current gas price;
 *   - policy_error: publishing is paused because the operator's exclusion list is missing or invalid, a root would
 *     exclude more deposits than its record can list (shared/privacy/screening.ts MAX_RECIPE_EXCLUSIONS), the snapshot
 *     failed the publisher's own check, or the chain already holds a newer screening policy than this server knows.
 *     Posting anyway could re-admit an excluded deposit.
 * A balance that could not be read is unknown and never reported as unfunded.
 */
export type PublisherBlock = "no_key" | "not_postman" | "publisher_unfunded" | "policy_error";

/** The server's relayer and publisher on one pool, as privacy.networks and privacy.pools report them. */
export interface PoolServices {
  /** the relayer can send a withdrawal now */
  relayerAvailable: boolean;
  /** why not; null when relayerAvailable */
  relayerBlock: RelayerBlock | null;
  /** the server can post an association-set root now */
  aspCanPublish: boolean;
  /** why not; null when aspCanPublish */
  aspPublishBlock: PublisherBlock | null;
}

// ─── pools explorer ───────────────────────────────────────────────────────────

/** One pool's summary; `now` is that chain's head time (unix seconds). */
export type PoolSummaryEntry = PoolSummary & { now: number };

/** privacy.pools({ interval? }) */
export interface PoolsAnswer {
  /** server clock (unix seconds) */
  now: number;
  /** every served network, in registry order; pool null: not deployed yet */
  networks: { chainId: number; pool: Address | null }[];
  pools: PoolSummaryEntry[];
  unavailable: PoolUnavailable[];
}

/** privacy.poolDetail({ chainId, pool, interval? }) */
export type PoolDetailAnswer = PoolDetail;

/**
 * One pool's public activity: today's single-pool answer (server/privacy/pools.ts getPoolActivity), which fits
 * guidance's ActivityList. `now` is that chain's head time.
 */
export interface PoolActivityEntry {
  chainId: number;
  pool: Address;
  now: number;
  activity: PoolActivity[];
}

/** privacy.poolActivity(), input-less and the same for every visitor */
export interface PoolActivityAnswer {
  now: number;
  pools: PoolActivityEntry[];
  unavailable: PoolUnavailable[];
}

// ─── landing ──────────────────────────────────────────────────────────────────

export type NetworkStatus =
  | { chainId: number; configured: false }
  | { chainId: number; configured: true; available: false; pool: Address; reason: PoolUnavailableReason }
  | ({
      chainId: number;
      configured: true;
      available: true;
      pool: Address;
      deployBlock: bigint;
      scope: bigint;
      lastRoot: bigint;
      aspRoot: bigint;
      leafCount: bigint;
      dead: boolean;
      minDeposit: bigint;
      poolBalance: bigint;
      relayer: Address | null;
      relayerFeeBps: number;
    } & PoolServices);

/** privacy.networks(), input-less: one status per served network, in registry order */
export interface NetworksAnswer {
  protocol: string;
  networks: NetworkStatus[];
}

// ─── association set ──────────────────────────────────────────────────────────

/**
 * One deposit the operator's exclusion list names, as privacy.asp.status announces it (the same for every visitor; the
 * operator's notes, the list's dates and listed addresses that never deposited are never part of it, and neither is
 * when the server first matched the entry). A device treats it as the operator's claim: only a leaf in the verified
 * current root's `x` makes a deposit "excluded" on the device.
 */
export interface ExcludedDeposit {
  /** the deposit's state-tree leaf */
  leafIndex: number;
  /** its label, decimal */
  label: string;
  reason: ExclusionReason;
  /** within the snapshot's n: the next root lists its leaf in x; false: not considered yet (it never enters a root while listed) */
  considered: boolean;
}

/**
 * The screening policy on one pool (privacy.asp.status, input-less, the same for every visitor). Every field is public
 * data: the rules, counts, roots and recipe cids, and the deposits the exclusion list names with a reason code.
 */
export interface ASPScreening {
  /** Manual wallet publication obeys the same policy checks as the server signer. Missing: unsupported server. */
  walletPublishable?: boolean;
  /** Whether the operator approves roots in a wallet or configures a server signer. */
  publicationMode?: "wallet" | "server";
  /** the screening policy version this server applies (1) */
  policyVersion: number;
  /** the network's inclusion delay, seconds (0: a confirmed deposit joins at once) */
  delaySeconds: number;
  /** confirmations before a deposit is considered */
  confirmations: number;
  /** the periodic publisher as it actually runs here: running false when it is off or on serverless hosting */
  autoPublish: { running: boolean; seconds: number };
  /** the operator's exclusion list: none configured, read fine, or invalid (publishing paused, the last good list shown) */
  exclusions: "none" | "ok" | "invalid";
  /** the set the publisher would post now */
  snapshot: {
    asOfBlock: string;
    /** the snapshot head's block time, unix seconds */
    asOfTime: number;
    /** n */
    considered: number;
    memberCount: number;
    /** deposits not considered yet that the list does not name */
    waiting: number;
    root: string;
    /** its recipe cid; null when it cannot be posted (more exclusions than a cid carries) */
    cid: string | null;
  };
  /** the root on-chain as the server checks it against its own events; null before the first root */
  current: {
    root: string;
    cid: string | null;
    status: RootStatus;
    /** n of its recipe (a legacy prefix root: its size); null unless verified */
    considered: number | null;
    memberCount: number | null;
  } | null;
  /** a withdrawal should send the input-less publish request first (the snapshot differs from the root on-chain) */
  rootDue: boolean;
  /** deposits the current root excludes that the snapshot admits again (an exclusion lifted) */
  readmitted: number;
  /** every deposit the list names, considered or not */
  excluded: ExcludedDeposit[];
  /**
   * the list changed less than 30 s ago and the snapshot would admit a deposit an earlier list excluded: no root is due
   * until it has settled (absent from an older server)
   */
  settling?: boolean;
  /**
   * what the next root changes against the verified current root: deposits it adds and members it removes, counted
   * apart; null when the current root does not verify on the server (absent from an older server)
   */
  next?: { joins: number; removals: number } | null;
}

/** One pool's association-set status. `screening` is absent from an older server: devices then use on-chain data only. */
export type ASPStatusEntry = ASPStatus & { chainId: number; pool: Address; confirmations: number; screening?: ASPScreening };

/** privacy.asp.status() */
export interface ASPStatusAnswer {
  pools: ASPStatusEntry[];
  unavailable: PoolUnavailable[];
}

/**
 * One pool's public set (PublicAssociationSet already names its pool). With `onChain`, labels/root/memberCount describe
 * the current on-chain root (rebuilt from its cid and checked against it) and `cid` is that root's cid: a device whose
 * events lack the root's ASPRootUpdated event uses { root, cid } only, never the labels. Without `onChain` (an older
 * server, or no root yet) they describe the publisher's snapshot.
 */
export type PublicAssociationSetEntry = PublicAssociationSet & { chainId: number; cid?: string | null; onChain?: boolean };

/** privacy.asp.set(), the same for every caller */
export interface AssociationSetsAnswer {
  sets: PublicAssociationSetEntry[];
  unavailable: PoolUnavailable[];
}

/**
 * - published: the root was posted and its receipt arrived in time;
 * - pending: posted (txHash), receipt not yet in; a repeat call returns the same txHash and posts nothing. Without a
 *   txHash: the postman already has a transaction in flight (sent before a server restart, say), so nothing new was
 *   sent;
 * - current: the on-chain root already is the screened set's root (nothing due);
 * - empty: no root yet and no member to post;
 * - no_key / not_postman: the server cannot post on this pool;
 * - unfunded: the postman's balance is below the cost of one publish; nothing was sent;
 * - unavailable: the pool has a problem, failed its contract check, or the post reverted;
 * - policy_error: publishing is paused (PublisherBlock policy_error); nothing was sent.
 */
export type PublishStatus = "published" | "pending" | "current" | "empty" | "no_key" | "not_postman" | "unfunded" | "unavailable" | "policy_error";

export interface PublishResult {
  chainId: number;
  pool: Address | null;
  status: PublishStatus;
  /** the local root (decimal), null when unknown */
  root: string | null;
  txHash?: Hex;
}

/** privacy.asp.publish(), input-less and label-free: one result per served network */
export interface PublishAnswer {
  results: PublishResult[];
}

// ─── relayer ──────────────────────────────────────────────────────────────────

export interface RelayerQuote {
  chainId: number;
  pool: Address | null;
  available: boolean;
  /**
   * Why not available: no_pool (not deployed yet), pool_unavailable (a configuration problem or a failed contract
   * check), or a RelayerBlock (no relayer key; relayer_unfunded: its balance is below one withdrawal). The other
   * fields are filled in either way.
   */
  reason: null | "no_pool" | "pool_unavailable" | RelayerBlock;
  relayer: Address | null;
  feeBps: number;
  minFeeWei: string;
  /** unix seconds; a proof must be bound to a deadline <= this */
  expiresAt: number;
}

/** privacy.relayer.quote(), input-less: one quote per served network */
export interface RelayerQuotesAnswer {
  quotes: RelayerQuote[];
}

/** privacy.relayer.submit({ chainId, withdrawal, proof, pubSignals }) */
export interface RelaySubmitAnswer {
  chainId: number;
  txHash: Hex;
}

/** privacy.relayer.status({ chainId, txHash }) */
export interface RelayStatusAnswer {
  status: "pending" | "success" | "reverted";
  blockNumber?: string;
}
