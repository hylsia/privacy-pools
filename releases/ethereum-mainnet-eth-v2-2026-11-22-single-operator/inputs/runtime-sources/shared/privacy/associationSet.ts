/**
 * Association set: the membership proof a device builds before a private withdrawal, and the open-policy helpers the
 * dashboard and older tests still use.
 *
 * Since Phase 4 the set follows the screening policy (shared/privacy/screening.ts): every root's cid carries its
 * recipe (the first n deposits in leaf order, minus the listed exclusions x), so a device rebuilds the member list of a
 * root from its own public events, checks that it hashes to the root on-chain, and proves against it. A root of the
 * older open policy (a prefix of the deposits) is still accepted while no screened root came before it.
 *
 * Privacy rules on the device:
 *   - It never asks a server for the proof of one label: that request alone would tell the server which deposit is
 *     being spent. It builds the proof from public data.
 *   - It proves only against the pool's current root (currentASPRoot), never an older one still in the contract's ring
 *     of 16: a removal takes effect for this app at once, and the root a withdrawal used says nothing beyond "the
 *     newest root at the time".
 *   - Nothing that depends on the label happens after a request the operator sees. resolveAssociationProof runs in
 *     this order: (1) a root of 0 fails, (2) isKnownASPRoot(current root), (3) rebuild and check the root's list: at
 *     most one re-sync (when the events lack the root's ASPRootUpdated event or deposits its recipe needs), then the
 *     record of the status answer already on the device, and at most one input-less privacy.asp.set record request
 *     (only when the root's event is still missing): all label-free. (4) Only then the label: a note that root does not
 *     hold, or one the operator announces for exclusion, stops here, after nothing but those label-free reads.
 *     (5) The questions about the crowd (the shrink alarm, a small set): the same for every note that can start, since
 *     each one is a member of that root the operator does not announce. (6) The label-free publish request, when
 *     publishDue holds. (7) The root on-chain again, checked the same way: if it leaves out a deposit of the crowd in (5)
 *     the withdrawal stops for every note alike (SET_CHANGED), so a root posted in reply singles out no deposit;
 *     otherwise it holds this note too. (8) The proof, and at most one more question, about what is the same for every
 *     note (the crowd against the one the form showed).
 *   - Server answers are never trusted for membership: a record is used only when it rebuilds to the root on-chain,
 *     and even then its exclusions are the operator's claim (WAITING, never EXCLUDED); the operator's announced
 *     exclusions (privacy.asp.status) can only block this app (fail closed) and count their deposits out of the crowd
 *     the withdrawal is judged by (effectiveSize), never mark a deposit excluded or recommend the public exit.
 *   - Whether it asks the publisher for a newer root is decided without the label (publishDue: the operator's rootDue,
 *     unless its announcements alone shrink the current root sharply, or the open policy's rule; across networks
 *     publishDueAcross: no request at all while some pool's answer shrinks its root that way), so the request and the
 *     root it causes point at no deposit.
 *   - Before that request it compares the crowd with the largest root among the pool's last 16 different roots that
 *     verify on the device, and with the current root itself when announcements shrink it (the shrink alarm); the app
 *     asks before a withdrawal hides in a much smaller crowd, as it does below SMALL_ASSOCIATION_SET.
 */
import type { ASPScreening } from "./api";
import { ASP_ROOT_HISTORY_SIZE, TREE_DEPTH } from "./constants";
import { MerkleTree, type MerkleProof } from "./merkleTree";
import {
  announcedExclusions,
  checkCurrentRoot,
  checkRoot,
  depositOf,
  depositsInLeafOrder,
  EXCLUSION_REASONS,
  memberPositions,
  parseRecipe,
  publishDue,
  recipeLabels,
  rootRecordOf,
  screeningState,
  sharpDrop,
  shrinkAlarm,
  validScreening,
  type ExclusionReason,
  type RootCheck,
  type RootProblem,
  type ScreeningState,
  type SetRecipe,
  type ShrinkAlarm,
  type VerifiedSet,
} from "./screening";
import type { DepositedEvent, PoolEvent } from "./types";

// ─── the open policy's set (legacy helpers) ───────────────────────────────────

/**
 * Labels admitted by the open testnet policy, in membership order (every deposit, in state-tree leaf order).
 * `cutoffBlock` applies a confirmation rule. Kept for the dashboard and older tests; the screening policy's lists come
 * from shared/privacy/screening.ts.
 */
export function associationSetLabels(events: readonly PoolEvent[], opts: { cutoffBlock?: bigint } = {}): bigint[] {
  const { cutoffBlock } = opts;
  return events
    .filter((e): e is DepositedEvent => e.kind === "deposit" && (cutoffBlock === undefined || e.blockNumber <= cutoffBlock))
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((e) => e.label);
}

export interface AssociationSet {
  /** labels in membership order */
  labels: bigint[];
  /** roots[k] = root of the first k labels (roots[0] = the empty tree) */
  roots: bigint[];
  /** tree of all the labels; proofs against a shorter prefix come from tree.proof(index, size) */
  tree: MerkleTree;
}

export function buildAssociationSet(labels: readonly bigint[], depth: number = TREE_DEPTH): AssociationSet {
  const tree = new MerkleTree(depth);
  const roots = [tree.root];
  for (const label of labels) {
    tree.insert(label);
    roots.push(tree.root);
  }
  return { labels: [...labels], roots, tree };
}

/** root → number of labels under it, for every non-empty prefix of the set */
export function prefixSizes(set: AssociationSet): Map<bigint, number> {
  const sizes = new Map<bigint, number>();
  for (let k = 1; k < set.roots.length; k++) sizes.set(set.roots[k], k);
  return sizes;
}

/** True when `longer` holds every label of `shorter`, in the same order, and then at least one more. */
export function extendsLabels(shorter: readonly bigint[], longer: readonly bigint[]): boolean {
  return longer.length > shorter.length && shorter.every((label, i) => longer[i] === label);
}

/**
 * The open policy's publish rule: the pool's current root is not the root of every deposit in `set`. It reads public
 * data only (never a label). Under the screening policy the rule is the operator's rootDue (screening.ts publishDue);
 * this one is its fallback when no screening answer is at hand.
 */
export function currentRootIsBehind(set: AssociationSet, currentRoot: bigint): boolean {
  return set.labels.length > 0 && currentRoot !== set.roots[set.labels.length];
}

/**
 * Below this many deposits an association set is a weak crowd: an observer can narrow a withdrawal
 * proved in it to one of fewer than 10 deposits (the privacy check's "weak"; 1 names the deposit). The app
 * asks before a private withdrawal is proved against such a set.
 */
export const SMALL_ASSOCIATION_SET = 10;

/** Roots from the pool's ASPRootUpdated events, newest first, without repeats. */
export function publishedASPRoots(events: readonly PoolEvent[]): bigint[] {
  const updates = events
    .filter((e): e is Extract<PoolEvent, { kind: "asproot" }> => e.kind === "asproot" && e.root !== 0n)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1));
  return [...new Set(updates.map((e) => e.root))];
}

// ─── the proof, built on the device ───────────────────────────────────────────

export type AssociationProofErrorCode =
  | "NOT_MEMBER"
  | "NO_PUBLISHED_ROOT"
  | "ROOT_NOT_KNOWN"
  | "INVALID_PROOF"
  /** not in the current root yet: inside the inclusion delay, or eligible and waiting for the next root */
  | "WAITING"
  /** its leaf is in the verified current root's exclusions (on-chain evidence) */
  | "EXCLUDED"
  /** in the verified current root, but the operator announces its exclusion: this app fails closed, no public-exit advice */
  | "REMOVAL_ANNOUNCED"
  /** the current root's list could not be verified on this device (detail: the RootProblem) */
  | "UNVERIFIED_ROOT"
  /**
   * the root on-chain after this withdrawal's publish request leaves out deposits of the crowd it was about to hide in
   * (members of the root before it that the operator did not announce for exclusion): stopped for every note alike
   */
  | "SET_CHANGED"
  /** the person answered "Don't send" to one of the app's questions */
  | "DECLINED";

/** UNVERIFIED_ROOT: the RootProblem; WAITING: "announced" when the operator announces an exclusion for it. */
export type AssociationProofDetail = RootProblem | "announced";

const SENT = "No withdrawal was sent.";
const RAGEQUIT_NOW = "Ragequit (public exit) works now.";

const MESSAGES: Record<AssociationProofErrorCode, string> = {
  NOT_MEMBER:
    "This deposit is not in the association set yet. Wait until it is confirmed and try again. No withdrawal was sent; ragequit (public exit) works now.",
  NO_PUBLISHED_ROOT:
    "No published association-set root includes this deposit yet, so a private withdrawal is not possible right now. No withdrawal was sent. Try again after the association-set publisher posts a newer root; ragequit (public exit) works now.",
  ROOT_NOT_KNOWN:
    "The association-set root built on this device is not a known root on-chain, so no proof was made and no withdrawal was sent. Sync and try again; ragequit (public exit) works now.",
  INVALID_PROOF: "The association-set proof built on this device does not verify, so no proof was made and no withdrawal was sent.",
  WAITING: `This deposit is waiting for screening, so it cannot be withdrawn privately yet. ${SENT} ${RAGEQUIT_NOW}`,
  EXCLUDED: `This deposit was excluded from the association set, so it cannot be withdrawn privately. Use the public exit (ragequit): it returns the deposit to the address that made it. ${SENT}`,
  REMOVAL_ANNOUNCED: `The operator has announced that this deposit will be excluded from the association set, but the association set on-chain still includes it, so this app does not withdraw it privately for now. ${SENT}`,
  UNVERIFIED_ROOT: `The newest association-set root could not be checked on this device, so no proof was made. ${SENT} Sync and try again.`,
  SET_CHANGED: setChangedMessage(null),
  DECLINED: SENT,
};

/**
 * SET_CHANGED, with the count when known: the same words for every note, whichever deposit it spends. "Announced" means
 * in the operator's status as this device last read it (refetched every minute): an exclusion announced since then, an
 * honest one included, stops a withdrawal the same way. A new attempt is not always asked about (only a small or sharply
 * shrunk set is), and whether and when it comes can tell the operator something.
 */
export function setChangedMessage(dropped: number | null): string {
  const what =
    dropped === null
      ? "deposits that were in it a moment ago, whose exclusion the operator's status, as this app last read it, did not announce"
      : `${dropped.toLocaleString("en-US")} deposit${dropped === 1 ? "" : "s"} that ${dropped === 1 ? "was" : "were"} in it a moment ago, whose exclusion the operator's status, as this app last read it, did not announce`;
  return `The association set changed while this withdrawal was being prepared: the newest root leaves out ${what} (an exclusion announced since then stops a withdrawal this way too). ${SENT} A new attempt is proved against the new set; the app asks first only if that set is small or shrank sharply, and whether and when you try again can tell the operator something.`;
}

const UNVERIFIED_MESSAGES: Record<RootProblem, string> = {
  missing_deposits: MESSAGES.UNVERIFIED_ROOT,
  no_record: MESSAGES.UNVERIFIED_ROOT,
  root: `The newest association-set root does not match the list its record describes, so no proof was made. ${SENT}`,
  exclusions: `The newest association-set root does not match the list its record describes, so no proof was made. ${SENT}`,
  malformed: `The newest association-set root carries a record this app cannot read, so no proof was made. ${SENT}`,
  lowered: `The newest association-set root leaves out deposits that an earlier root counted, without listing them as excluded. The screening policy does not allow that, so no proof was made. ${SENT}`,
  version_backwards: `The newest association-set root was posted under the older open policy after screened roots (the policy version went backwards), so no proof was made. ${SENT}`,
  outdated: `The newest association-set root follows a newer screening policy than this app knows. This app is out of date: reload the page. ${SENT}`,
};

const reasonNote = (reason: ExclusionReason | null) => (reason ? ` (reason: ${EXCLUSION_REASONS[reason].title})` : "");

function messageFor(code: AssociationProofErrorCode, detail: AssociationProofDetail | null, reason: ExclusionReason | null): string {
  switch (code) {
    case "UNVERIFIED_ROOT":
      return detail && detail !== "announced" ? UNVERIFIED_MESSAGES[detail] : MESSAGES.UNVERIFIED_ROOT;
    case "WAITING":
      return detail === "announced"
        ? `This deposit is waiting for screening, and the operator has announced that it will be excluded${reasonNote(reason)}, so it cannot be withdrawn privately. ${SENT}`
        : MESSAGES.WAITING;
    case "EXCLUDED":
      return `This deposit was excluded from the association set${reasonNote(reason)}, so it cannot be withdrawn privately. Use the public exit (ragequit): it returns the deposit to the address that made it. ${SENT}`;
    case "REMOVAL_ANNOUNCED":
      return `The operator has announced that this deposit will be excluded from the association set${reasonNote(reason)}, but the association set on-chain still includes it, so this app does not withdraw it privately for now. ${SENT}`;
    default:
      return MESSAGES[code];
  }
}

/** Why the device refused to build an association-set proof. The message is written for the person withdrawing. */
export class AssociationProofError extends Error {
  readonly code: AssociationProofErrorCode;
  /** UNVERIFIED_ROOT: why; WAITING: "announced" when the operator announces its exclusion; otherwise null */
  readonly detail: AssociationProofDetail | null;
  /** EXCLUDED, REMOVAL_ANNOUNCED, WAITING: the operator's announced reason, when there is one */
  readonly reason: ExclusionReason | null;
  constructor(code: AssociationProofErrorCode, message?: string, o: { detail?: AssociationProofDetail | null; reason?: ExclusionReason | null } = {}) {
    const detail = o.detail ?? null;
    const reason = o.reason ?? null;
    super(message ?? messageFor(code, detail, reason));
    this.name = "AssociationProofError";
    this.code = code;
    this.detail = detail;
    this.reason = reason;
  }
}

export interface AssociationProof extends MerkleProof {
  /** members of the root this proof is against (on-chain) */
  size: number;
  /**
   * the crowd the app judges this withdrawal by: `size` minus the members whose exclusion the operator's answer
   * announces (`announcedOut`). That answer may differ for each visitor: a member it announces is one this app holds
   * back, so to the operator a withdrawal from this app can only be one of the others.
   */
  effectiveSize: number;
  /** members of the root whose exclusion the operator's answer announces (not on-chain yet) */
  announcedOut: number;
  /**
   * where the root's cid came from: its ASPRootUpdated event in this device's events ("device"), the status answer's
   * record already on the device ("status"), or the privacy.asp.set record ("full-set")
   */
  source: "device" | "status" | "full-set";
  /** that root's recipe (a legacy prefix root reads as version 0) */
  recipe: SetRecipe;
  /**
   * the crowd shrank sharply against a larger root among the pool's last 16 different roots, or against the root itself
   * by the operator's announcements: ask before anything is sent, as for a small set (null: no alarm)
   */
  shrink: ShrinkAlarm | null;
}

/** The input-less privacy.asp.set entry of this pool, reduced to what the device may use: the current root's cid. */
export interface RootRecordAnswer {
  root: bigint;
  cid: string | null;
}

export interface AssociationProofInput {
  /** label of the note being spent; it never leaves this function */
  label: bigint;
  /** public pool events held by the device (Deposited, Withdrawn and ASPRootUpdated) */
  events: readonly PoolEvent[];
  /** PrivacyPool.currentASPRoot(), read from the chain (0 = nothing published yet) */
  currentRoot: bigint;
  /** PrivacyPool.isKnownASPRoot(root), read from the chain. Asked once, about the current root, before anything about the label. */
  isKnownRoot: (root: bigint) => Promise<boolean>;
  /**
   * The record of the current root that the status answer every visitor fetches carries (publicData.ts statusRecord;
   * already on the device, so using it sends nothing). Used, like fetchRootRecord's, only when the device's events lack
   * that root's event, when it names the current root and when its cid rebuilds to it; then no record is asked for.
   */
  record?: RootRecordAnswer | null;
  /**
   * The input-less privacy.asp.set record of this pool's current root ({ root, cid }). Asked at most once per check of a
   * root, only when the device's events lack that root's ASPRootUpdated event (its log RPC is behind its contract reads)
   * and `record` does not rebuild to it, and used only when its root is the current root and its cid rebuilds to it.
   * Never labels from a server.
   */
  fetchRootRecord?: () => Promise<RootRecordAnswer | null>;
  /**
   * Exclusions the operator announces (screening.ts announcedExclusions(screening)), by label. Never authoritative: a
   * label in the verified current root that is announced fails closed (REMOVAL_ANNOUNCED); its reason decorates an
   * on-chain exclusion.
   */
  announced?: ReadonlyMap<bigint, { reason: ExclusionReason | null }> | null;
  /** @deprecated ignored since Phase 4: server labels are never used (see fetchRootRecord) */
  fetchFullSet?: () => Promise<readonly bigint[]>;
  /** @deprecated ignored since Phase 4: only the current root is proved against */
  extraRoots?: readonly bigint[];
  depth?: number;
}

/**
 * Build the association-set Merkle proof for `label` on this device, against the pool's current root only (steps 1 to
 * 4 and 8 of the order at the top of this file, without a publish request and without questions: the caller reads
 * `shrink`). Throws AssociationProofError: NO_PUBLISHED_ROOT, ROOT_NOT_KNOWN, UNVERIFIED_ROOT, NOT_MEMBER, EXCLUDED,
 * REMOVAL_ANNOUNCED, WAITING or INVALID_PROOF.
 */
export async function buildAssociationProof(input: AssociationProofInput): Promise<AssociationProof> {
  const depth = input.depth ?? TREE_DEPTH;
  const checked = await checkedCurrentRoot(input, { events: input.events, currentRoot: input.currentRoot }, null, depth);
  return proveIn(checked, input.label, input.announced ?? null, depth);
}

function unverified(check: Exclude<RootCheck, { status: "verified" }>): AssociationProofError {
  return new AssociationProofError("UNVERIFIED_ROOT", undefined, { detail: check.problem });
}

/** The current root on-chain as this device checked it: the events it was checked on and its verified member list. */
interface CheckedRoot {
  events: readonly PoolEvent[];
  currentRoot: bigint;
  verified: VerifiedSet;
  source: AssociationProof["source"];
}

/**
 * Steps 1 to 3: the current root, checked on this device, whatever the label, in a fixed order: a root of 0 fails;
 * isKnownASPRoot(root); its record from the device's own newest event of it (else, with `reload`, one re-sync first),
 * else the status answer's record already on the device, else one privacy.asp.set request; then its list, rebuilt from
 * the device's own events (with `reload`, one re-sync when they lack deposits the recipe needs). Throws
 * NO_PUBLISHED_ROOT, ROOT_NOT_KNOWN or UNVERIFIED_ROOT, the same for every note.
 */
async function checkedCurrentRoot(
  input: Pick<AssociationProofInput, "isKnownRoot" | "fetchRootRecord" | "record">,
  state: PublicPoolState,
  reload: (() => Promise<PublicPoolState>) | null,
  depth: number,
): Promise<CheckedRoot> {
  let { events, currentRoot } = state;
  let recordAsked = false;
  let resynced = false;
  for (;;) {
    if (currentRoot === 0n) throw new AssociationProofError("NO_PUBLISHED_ROOT");
    if (!(await input.isKnownRoot(currentRoot))) throw new AssociationProofError("ROOT_NOT_KNOWN");
    let source: AssociationProof["source"] = "device";
    let record: { cid: string | null; at: { blockNumber: bigint; logIndex: number } | null } | null = rootRecordOf(events, currentRoot);
    if (!record && reload && !resynced) {
      // the events lack the root's own event (a log RPC a little behind its contract reads): one re-sync first, whatever
      // the label, so that the chain's own record decides rather than a server's
      resynced = true;
      ({ events, currentRoot } = await reload());
      continue;
    }
    if (!record && input.record && input.record.root === currentRoot && typeof input.record.cid === "string") {
      // the status answer's record, already on this device: no request, if it rebuilds to the root
      const cid = input.record.cid;
      if (checkRoot({ root: currentRoot, cid, events, at: null, depth }).status === "verified") {
        record = { cid, at: null };
        source = "status";
      }
    }
    if (!record && input.fetchRootRecord && !recordAsked) {
      recordAsked = true;
      const fetchRecord = input.fetchRootRecord;
      // a failed request is no record (the check then says the root could not be verified)
      const answer = await Promise.resolve()
        .then(() => fetchRecord())
        .catch(() => null);
      if (answer && answer.root === currentRoot) {
        record = { cid: typeof answer.cid === "string" ? answer.cid : null, at: null };
        source = "full-set";
      }
    }
    const check = checkRoot({ root: currentRoot, cid: record?.cid ?? null, events, at: record?.at ?? null, depth });
    if (check.status === "unknown" && reload && !resynced) {
      // the events lack deposits the recipe needs (an RPC behind, or a hole): one re-sync, whatever the label
      resynced = true;
      ({ events, currentRoot } = await reload());
      continue;
    }
    if (check.status !== "verified") throw unverified(check);
    return { events, currentRoot, verified: check.set, source };
  }
}

/**
 * Step 4 and the proof: the label in the checked root (from this device's own events), then its Merkle proof and the
 * shrink alarm (public data only). Throws NOT_MEMBER, EXCLUDED, WAITING, REMOVAL_ANNOUNCED or INVALID_PROOF.
 */
function proveIn(c: CheckedRoot, label: bigint, announcedMap: ReadonlyMap<bigint, { reason: ExclusionReason | null }> | null, depth: number): AssociationProof {
  const { verified } = c;
  const own = depositOf(c.events, label);
  if (!own) throw new AssociationProofError("NOT_MEMBER");
  const announced = announcedMap?.get(label) ?? null;
  const reason = announced?.reason ?? null;
  const index = verified.indexOf(label);
  if (index === -1) {
    if (verified.recipe.excludedLeaves.includes(own.deposit.leafIndex)) {
      // on-chain evidence only from this device's own event of the root; a server's record of it is the operator's claim
      // (the root binds the members, not which non-members are "excluded"): held back, never pointed at the public exit
      if (c.source === "device") throw new AssociationProofError("EXCLUDED", undefined, { reason });
      throw new AssociationProofError("WAITING", undefined, { detail: "announced", reason });
    }
    throw new AssociationProofError("WAITING", undefined, announced ? { detail: "announced", reason } : {});
  }
  if (announced) throw new AssociationProofError("REMOVAL_ANNOUNCED", undefined, { reason });

  const proof = verified.proof(index);
  if (proof.leaf !== label || proof.root !== c.currentRoot || !MerkleTree.verify(proof, depth)) {
    throw new AssociationProofError("INVALID_PROOF");
  }
  const announcedOut = announcedMap ? [...announcedMap.keys()].filter((l) => verified.has(l)).length : 0;
  const shrink = shrinkAlarm({ events: c.events, current: verified, announced: announcedMap, depth });
  return { ...proof, size: verified.memberCount, effectiveSize: verified.memberCount - announcedOut, announcedOut, source: c.source, recipe: verified.recipe, shrink };
}

export interface PublicPoolState {
  events: readonly PoolEvent[];
  currentRoot: bigint;
}

/**
 * A question the app asks before it goes on with a withdrawal (WithdrawPanel's dialogs). Each one is about the crowd
 * only, so it is the same for every note that can start at that moment.
 *   - shrink: the crowd shrank sharply (shrinkAlarm: "history" or "current"), or, once the withdrawal's own publish
 *     request was answered (or when there is none), it is materially smaller than the crowd the form showed ("form");
 *   - small: the crowd holds fewer than SMALL_ASSOCIATION_SET deposits; `expected` is the crowd the form showed;
 *     `onChain` the members of the root on-chain it is counted from, `announced` those of them the operator's answer
 *     announces for exclusion (crowd = onChain - announced: the texts give both numbers when announced > 0).
 * `beforeRequest`: asked before the publish request, or when there is none (nothing about the withdrawal was sent
 * yet); `publishes`: the withdrawal sends, or sent, the label-free publish request.
 */
export type WithdrawalQuestion =
  | { kind: "shrink"; alarm: ShrinkAlarm; beforeRequest: boolean; publishes: boolean }
  | { kind: "small"; crowd: number; onChain: number; announced: number; expected: number | null; beforeRequest: boolean; publishes: boolean };

const finiteOrNull = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The "form" question: the proof's crowd is materially smaller than the crowd the withdraw form showed, or null. */
function formQuestion(p: AssociationProof, expectedCrowd: number | null | undefined, o: { beforeRequest: boolean; publishes: boolean }): WithdrawalQuestion | null {
  const expected = finiteOrNull(expectedCrowd);
  if (expected === null || !crowdShrankSinceForm(expected, p.effectiveSize)) return null;
  const alarm: ShrinkAlarm = {
    from: expected,
    to: p.effectiveSize,
    removed: expected - p.effectiveSize,
    unexplained: 0,
    announced: p.announcedOut,
    basis: "form",
    largerRoot: null,
    atBlock: null,
  };
  return { kind: "shrink", alarm, ...o };
}

/** The question for a proof's crowd, or null. Before a publish request the form's crowd is not compared: the next root may still come. */
function questionFor(p: AssociationProof, o: { expectedCrowd: number | null | undefined; beforeRequest: boolean; publishes: boolean }): WithdrawalQuestion | null {
  const { beforeRequest, publishes } = o;
  if (p.shrink) return { kind: "shrink", alarm: p.shrink, beforeRequest, publishes };
  const form = beforeRequest && publishes ? null : formQuestion(p, o.expectedCrowd, { beforeRequest, publishes });
  if (form) return form;
  if (p.effectiveSize < SMALL_ASSOCIATION_SET) {
    return { kind: "small", crowd: p.effectiveSize, onChain: p.size, announced: p.announcedOut, expected: finiteOrNull(o.expectedCrowd), beforeRequest, publishes };
  }
  return null;
}

export interface ResolveAssociationProofInput extends Omit<AssociationProofInput, "events" | "currentRoot" | "extraRoots"> {
  /** public state the device already holds (synced right before) */
  state: PublicPoolState;
  /** fresh public state (re-sync): after a published root, and once per check of a root that lacks its event or deposits */
  reload: () => Promise<PublicPoolState>;
  /**
   * Optional: ask the publisher to post its current set's root. Called at most once, exactly when `publishDue` holds
   * (the same for every withdrawal whichever deposit it spends), and only after this note was found in the checked
   * current root and the questions about its crowd were answered. Takes no label. Returns the root it published (then
   * the state is reloaded and checked again), or null when it did not publish.
   */
  requestPublish?: () => Promise<bigint | null>;
  /**
   * Whether a publish request is due: screening.ts publishDue (the operator's fresh rootDue, else the open policy's
   * rule). Default: the open policy's rule on `state` (currentRootIsBehind).
   */
  publishDue?: boolean;
  /**
   * The crowd the withdraw form showed (previewAssociationSet: the next root's or the current root's, decided the same
   * way for every note, WithdrawPanel). Compared once the publish request was answered, or when there is none.
   */
  expectedCrowd?: number | null;
  /**
   * The app's questions (WithdrawalQuestion); resolve true to go on, false (or throw) to send nothing more. Without it
   * nothing is asked: the caller reads `shrink` itself.
   */
  ask?: (q: WithdrawalQuestion) => Promise<boolean>;
}

/**
 * The browser's entry point, in the order at the top of this file: the current root checked on this device and this
 * note in it; the questions about its crowd; then, when a publish is due (decided without the label), one label-free
 * publish request, a re-sync and the root checked again, which must still hold every deposit of that crowd
 * (SET_CHANGED otherwise, for every note alike); the proof against the current root; at most one more question. Throws
 * a clear AssociationProofError (DECLINED for a "Don't send").
 */
export async function resolveAssociationProof(input: ResolveAssociationProofInput): Promise<AssociationProof> {
  const { state, reload, requestPublish, publishDue: due, expectedCrowd, ask, ...rest } = input;
  const depth = rest.depth ?? TREE_DEPTH;
  const announced = rest.announced ?? null;
  const publishes = !!requestPublish && (due ?? publishDue({ events: state.events, currentRoot: state.currentRoot }));
  const confirm = async (q: WithdrawalQuestion) => {
    if (!(await ask!(q))) throw new AssociationProofError("DECLINED");
  };

  // 1-4: the root on-chain now and this note in it (a note it does not hold stops here, before any request about it)
  const first = await checkedCurrentRoot(rest, state, reload, depth);
  const before = proveIn(first, rest.label, announced, depth);

  // 5: the questions about that crowd, before the operator sees any request: the same for every note that can start
  let asked = false;
  if (ask) {
    const q = questionFor(before, { expectedCrowd, beforeRequest: true, publishes });
    if (q) {
      await confirm(q);
      asked = true;
    }
  }
  if (!publishes) return before;

  // 6: the label-free publish request; 7: the root on-chain again, checked the same way
  let proof = before;
  if ((await requestPublish!()) !== null) {
    const second = await checkedCurrentRoot(rest, await reload(), reload, depth);
    // a root posted in reply that drops a deposit of the crowd above would stop only the notes it drops: stop every one
    const dropped = first.verified.labels.filter((l) => !announced?.has(l) && !second.verified.has(l)).length;
    if (dropped > 0) throw new AssociationProofError("SET_CHANGED", setChangedMessage(dropped));
    proof = proveIn(second, rest.label, announced, depth); // it holds this note: it holds the whole crowd
  }
  // 8: at most one more question, only about what is the same for every note: when none was asked, the crowd as it is
  // now; when one was asked before the request (it may have quoted the form's figure: "it would hold N"), whether the
  // crowd the withdrawal is proved in is clearly smaller than the form showed
  if (ask) {
    const q = asked ? formQuestion(proof, expectedCrowd, { beforeRequest: false, publishes }) : questionFor(proof, { expectedCrowd, beforeRequest: false, publishes });
    if (q) await confirm(q);
  }
  return proof;
}

// ─── what the withdraw form shows (nothing is sent) ───────────────────────────

export interface AssociationSetPreview {
  /** deposits in this device's events */
  deposits: number;
  /**
   * the crowd of the verified current root, when it holds the label: its members minus those whose exclusion the
   * operator's answer announces (`announcedOut`); else null
   */
  covered: number | null;
  /** members of the verified current root whose exclusion the operator's answer announces (0 without a verified root) */
  announcedOut: number;
  /** a withdrawal first sends the input-less publish request and this pool is due (publishDue: no label; never while `publishBlocked`) */
  behind: boolean;
  /**
   * the crowd of the next root when a publish is due: the operator's snapshot recipe rebuilt on this device from its own
   * events (never the member count the answer claims), minus announced exclusions; without a screening answer every
   * deposit here (the open policy); null when no publish is due, the recipe does not rebuild here, or it does not fit
   * the answer (it considers fewer deposits than the verified current root, or lists a leaf the answer does not
   * announce): such a snapshot would leave out a member the answer does not announce, and so would count differently
   * for different notes. It is the same number for every note the current root holds and the answer does not announce
   */
  next: number | null;
  /** the members that next root would hold on-chain (its recipe's list, announced members included), when `next` is set */
  nextSize: number | null;
  /** where the deposit stands (screening.ts screeningState) */
  state: ScreeningState;
  /** positions (leaf-order ordinals, guidance's poolDeposits order) of the current root's crowd, when it holds the label */
  members: ReadonlySet<number> | null;
  /** positions of the next root's crowd (its recipe rebuilt on this device), when a publish is due and it holds the label */
  nextMembers: ReadonlySet<number> | null;
}

/**
 * What a withdrawal of `label` would be proved in, from public data on this device (nothing is sent; the proof itself
 * still checks the root on-chain, and the app asks again when that crowd turns out smaller). For the withdraw form:
 * when `behind` and the publisher can post, the next root (`next`, `nextMembers`); otherwise the current root
 * (`covered`, `members`). Both leave out the members whose exclusion the operator announces: a member the app holds
 * back is no cover against the operator.
 */
export function previewAssociationSet(input: {
  label: bigint;
  events: readonly PoolEvent[];
  currentRoot: bigint;
  depth?: number;
  screening?: ASPScreening | null;
  canPublish?: boolean | null;
  depositTime?: number | null;
  now?: number | null;
  delaySeconds?: number | null;
  record?: RootRecordAnswer | null;
  /**
   * no withdrawal sends the publish request now, whatever this pool's answer says: some pool's answer has
   * announcements that alone shrink its root sharply (screening.ts announcementsShrinkSome; one answer covers every
   * network). `behind` is then false, so the form shows the current root's crowd, which the withdrawal is proved in
   */
  publishBlocked?: boolean;
}): AssociationSetPreview {
  const screening = validScreening(input.screening);
  const state = screeningState({ ...input, screening });
  const deposits = depositsInLeafOrder(input.events).length;
  const cur = checkCurrentRoot({ events: input.events, currentRoot: input.currentRoot, record: input.record, depth: input.depth });
  const set = cur && cur.check.status === "verified" ? cur.check.set : null;
  const holds = !!set && set.has(input.label);
  const behind = !input.publishBlocked && publishDue({ events: input.events, currentRoot: input.currentRoot, screening });
  const own = depositOf(input.events, input.label);
  const announced = announcedExclusions(screening);
  const crowd = set ? set.labels.filter((l) => !announced.has(l)) : null;

  let next: number | null = null;
  let nextSize: number | null = null;
  let nextMembers: ReadonlySet<number> | null = null;
  if (behind) {
    if (screening) {
      const recipe = typeof screening.snapshot.cid === "string" ? parseRecipe(screening.snapshot.cid) : null;
      const labels = recipe && recipe.version === 1 ? recipeLabels(input.events, recipe) : null;
      if (labels && recipe && snapshotFits(input.events, recipe, labels, set, announced)) {
        const nextCrowd = labels.filter((l) => !announced.has(l));
        next = nextCrowd.length;
        nextSize = labels.length;
        if (nextCrowd.includes(input.label)) nextMembers = memberPositions(input.events, nextCrowd);
      }
    } else {
      next = deposits;
      nextSize = deposits;
      if (own) nextMembers = new Set(Array.from({ length: deposits }, (_, k) => k));
    }
  }
  return {
    deposits,
    covered: holds ? crowd!.length : null,
    announcedOut: set ? set.memberCount - crowd!.length : 0,
    behind,
    next,
    nextSize,
    state,
    members: holds ? memberPositions(input.events, crowd!) : null,
    nextMembers,
  };
}

/**
 * The operator's snapshot fits its own answer and the chain, as an honest server's always does: it considers at least
 * as many deposits as the verified current root (n never decreases), it lists in x only leaves the answer announces
 * (its x and its announcements come from one list), and so it keeps every member of the current root the answer does
 * not announce. Without a verified current root only the x rule applies.
 */
function snapshotFits(
  events: readonly PoolEvent[],
  recipe: SetRecipe,
  labels: readonly bigint[],
  current: VerifiedSet | null,
  announced: ReadonlyMap<bigint, unknown>,
): boolean {
  const byLeaf = new Map(depositsInLeafOrder(events).map((d) => [d.leafIndex, d.label]));
  if (!recipe.excludedLeaves.every((leaf) => announced.has(byLeaf.get(leaf) ?? -1n))) return false;
  if (!current) return true;
  if (recipe.considered < current.recipe.considered) return false;
  const kept = new Set(labels);
  return current.labels.every((l) => announced.has(l) || kept.has(l));
}

/**
 * The verdict bands of the privacy check (simulate.ts verdictOf): 0 linked (1), 1 weak (under 10), 2 moderate (under
 * 50), 3 strong (50 or more).
 */
const crowdBand = (n: number): number => (n <= 1 ? 0 : n < 10 ? 1 : n < 50 ? 2 : 3);

/**
 * The crowd a withdrawal is actually proved in is materially smaller than the crowd the withdraw form showed (the
 * operator's snapshot when the withdrawal asked for a newer root, or the current root): a sharp drop (screening.ts
 * sharpDrop) or a lower verdict band. The app then asks again with the real number before the withdrawal is sent.
 */
export function crowdShrankSinceForm(shown: number | null | undefined, actual: number): boolean {
  if (typeof shown !== "number" || !Number.isFinite(shown) || actual >= shown) return false;
  return sharpDrop(shown, actual) || crowdBand(actual) < crowdBand(shown);
}

/**
 * The crowd private withdrawals are proved in under the open policy: deposits under the largest root among the
 * pool's last ASP_ROOT_HISTORY_SIZE root updates that is the root of a prefix of `set`. 0 when none is. `updates` are
 * the ASPRootUpdated roots, oldest first. (The screening policy's size is the verified current root's: screening.ts.)
 */
export function publishedSetSize(sizes: ReadonlyMap<bigint, number>, updates: readonly bigint[]): number {
  return updates.slice(-ASP_ROOT_HISTORY_SIZE).reduce((best, root) => Math.max(best, sizes.get(root) ?? 0), 0);
}
