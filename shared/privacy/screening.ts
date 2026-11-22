/**
 * Association-set screening, policy v1. Pure and deterministic: no I/O and no clock of its own. The publisher
 * (server/privacy/asp.ts) builds each set with it; the device (the browser, scripts/privacy/e2e.ts) rebuilds and checks
 * every set it proves against with it, and works out on its own whether a deposit is in the set, waiting or excluded.
 * It never imports associationSet.ts (which builds on it).
 *
 * The rule, "the recipe":
 *   - deposits in state-tree leaf order; change-note leaves never count;
 *   - n, the deposits considered: the leading run that has the confirmations and whose block time plus the inclusion
 *     delay is at or before the snapshot head's time (equality joins), never fewer than an earlier root considered
 *     (n never decreases: raising the delay never drops a member), never more than the deposits there are;
 *   - x, the excluded leaves: the considered deposits that the operator's exclusion list names, by label or by
 *     depositing address;
 *   - members: the first n deposits minus x, in leaf order; root: their Poseidon Merkle root (depth 20).
 * Every root's cid carries its recipe ("hylsia-asp:v1;n=42;x=17,30;asOf=…;t=…;delay=3600;conf=1"), so anyone holding
 * the public events can rebuild the list of every root without asking anyone. The root binds the member list only: it
 * does not bind the split between "not considered yet" and "excluded" (n=5 with x={leaf of deposit 5} and n=4 with no
 * x give the same root), nor asOf, t, delay or conf. That split, and "removed", are the operator's claim.
 *
 * What a device trusts:
 *   - its own public events (from an RPC independent of the operator) and the contract's current root;
 *   - the cid of its own newest ASPRootUpdated event for that root (with duplicates the newest wins): the chain's record,
 *     the same for everyone. When its events lack that event, a server's record of it (privacy.asp.set, or the status
 *     answer's) is used only when it rebuilds to the root on-chain, and then only for membership: the root binds the
 *     member list, not the split into "excluded" and "not considered yet", which stays the operator's claim;
 *   - never the operator's privacy.asp.status answer on its own: it can differ per visitor and cannot be checked. An
 *     announced exclusion may block the official app (fail closed), counts its deposit out of the crowd the app judges a
 *     withdrawal by (shrinkAlarm), or gives an on-chain exclusion its reason; it never marks a deposit "excluded" or
 *     recommends the public exit by itself (that needs a leaf in the x of this device's own record of the verified
 *     root, or a member a later root dropped). An answer whose announcements alone shrink the current root sharply
 *     sends no publish request (publishDue).
 *
 * Results that depend only on a pool's events are memoized per events array (treat the arrays as immutable: the
 * server and the browser replace theirs on every sync).
 */
import type { ASPScreening, ExcludedDeposit } from "./api";
import { ASP_ROOT_HISTORY_SIZE, SNARK_SCALAR_FIELD, TREE_DEPTH } from "./constants";
import { computeZeros, MerkleTree, type MerkleProof } from "./merkleTree";
import { hash2 } from "./poseidon";
import type { ASPRootUpdatedEvent, DepositedEvent, PoolEvent } from "./types";

// ─── policy constants and exclusion reasons ───────────────────────────────────

/** The screening policy version this code publishes and understands. A root of a higher version: "reload the app". */
export const ASP_POLICY_VERSION = 1;
/** The most excluded leaves one recipe cid carries (about 4 KB). Beyond it nothing can be posted: policy_error. */
export const MAX_RECIPE_EXCLUSIONS = 500;
/** The most entries an exclusion file may hold. */
export const MAX_EXCLUSION_ENTRIES = 10_000;
/** The longest operator note an exclusion entry may carry (never published or logged). */
export const MAX_EXCLUSION_NOTE_CHARS = 500;
/** The longest inclusion delay a network may be configured with: one week. */
export const MAX_INCLUSION_DELAY_SECONDS = 604_800;
/** The shrink alarm fires when the crowd lost at least this many members against a larger crowd (shrinkAlarm) ... */
export const SHRINK_ALARM_MIN = 10;
/** ... and at least this share of that larger root's members. */
export const SHRINK_ALARM_SHARE = 0.2;
/** A removal the operator announced is "overdue" this long after one auto-publish interval while the publisher can post. */
export const ANNOUNCEMENT_GRACE_SECONDS = 120;

export type ExclusionReason = "sanctions" | "stolen-funds" | "fraud" | "legal-order" | "test";

/** The reason codes, in the order the screening policy page lists them. */
export const EXCLUSION_REASON_CODES: readonly ExclusionReason[] = Object.freeze(["sanctions", "stolen-funds", "fraud", "legal-order", "test"]);

/**
 * Each reason as the screening policy page lists it: "<title>: <text>". `text` starts in lower case and ends with a
 * full stop.
 */
export const EXCLUSION_REASONS: Readonly<Record<ExclusionReason, Readonly<{ title: string; text: string }>>> = Object.freeze({
  sanctions: Object.freeze({ title: "Sanctions", text: "the depositing address is on a public sanctions list." }),
  "stolen-funds": Object.freeze({ title: "Stolen funds", text: "the deposit was reported as coming from stolen funds." }),
  fraud: Object.freeze({ title: "Fraud", text: "the deposit was reported as coming from a scam or fraud." }),
  "legal-order": Object.freeze({ title: "Legal order", text: "a court or regulator ordered the operator to exclude it." }),
  test: Object.freeze({ title: "Test", text: "an exclusion made on the testnet to test screening." }),
});

export function isExclusionReason(v: unknown): v is ExclusionReason {
  return typeof v === "string" && (EXCLUSION_REASON_CODES as readonly string[]).includes(v);
}

// ─── small helpers ────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface EventPosition {
  blockNumber: bigint;
  logIndex: number;
}

const byPosition = (a: EventPosition, b: EventPosition) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
const isBefore = (e: EventPosition, at: EventPosition) => byPosition(e, at) < 0;

// ─── what one events array holds (memoized per array) ────────────────────────

interface EventInfo {
  /** Deposited events in state-tree leaf order */
  deposits: readonly DepositedEvent[];
  /** label → position in `deposits` */
  ordinal: ReadonlyMap<bigint, number>;
  /** leaves 0 … contiguous-1 (deposits and change notes) are all in the events */
  contiguous: number;
  /** no leaf beyond `contiguous`: the events have no hole */
  gapFree: boolean;
  /** ASPRootUpdated events with a non-zero root, oldest first */
  roots: readonly ASPRootUpdatedEvent[];
  memo: Map<string, unknown>;
  /** the deposits minus an excluded-leaf set, with their tree's layers, for the last few sets used (recipeMembers) */
  minus: Map<string, { labels: readonly bigint[]; layers: bigint[][] }>;
}

const infos = new WeakMap<readonly PoolEvent[], { length: number; info: EventInfo }>();

function infoOf(events: readonly PoolEvent[]): EventInfo {
  const hit = infos.get(events);
  if (hit && hit.length === events.length) return hit.info;
  const deposits = events.filter((e): e is DepositedEvent => e.kind === "deposit").sort((a, b) => a.leafIndex - b.leafIndex);
  const ordinal = new Map<bigint, number>();
  deposits.forEach((d, i) => {
    if (!ordinal.has(d.label)) ordinal.set(d.label, i);
  });
  const leaves = new Set<number>();
  for (const e of events) if (e.kind === "deposit" || e.kind === "withdraw") leaves.add(e.leafIndex);
  let contiguous = 0;
  while (leaves.has(contiguous)) contiguous++;
  const roots = events.filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot" && e.root !== 0n).sort(byPosition);
  const info: EventInfo = { deposits, ordinal, contiguous, gapFree: leaves.size === contiguous, roots, memo: new Map(), minus: new Map() };
  infos.set(events, { length: events.length, info });
  return info;
}

function memo<T>(info: EventInfo, key: string, make: () => T): T {
  if (info.memo.has(key)) return info.memo.get(key) as T;
  const value = make();
  info.memo.set(key, value);
  return value;
}

/** The pool's deposits in state-tree leaf order (change notes are not deposits). */
export function depositsInLeafOrder(events: readonly PoolEvent[]): readonly DepositedEvent[] {
  return infoOf(events).deposits;
}

/** One deposit by label: its position in leaf order (the "ordinal" recipes count) and its event; null when absent. */
export function depositOf(events: readonly PoolEvent[], label: bigint): { ordinal: number; deposit: DepositedEvent } | null {
  const info = infoOf(events);
  const ordinal = info.ordinal.get(label);
  return ordinal === undefined ? null : { ordinal, deposit: info.deposits[ordinal] };
}

/** Positions (leaf-order ordinals, the order of guidance's poolDeposits) of the given member labels that are deposits here. */
export function memberPositions(events: readonly PoolEvent[], labels: readonly bigint[]): Set<number> {
  const { ordinal } = infoOf(events);
  const out = new Set<number>();
  for (const l of labels) {
    const k = ordinal.get(l);
    if (k !== undefined) out.add(k);
  }
  return out;
}

/** The first `n` deposits are all known and nothing before the n-th one's leaf is missing. */
const completeThrough = (info: EventInfo, n: number) =>
  n <= info.deposits.length && (n === 0 || info.deposits[n - 1].leafIndex < info.contiguous);

// ─── the association-set tree, bottom-up ──────────────────────────────────────

const zerosByDepth = new Map<number, readonly bigint[]>();

function zerosOf(depth: number): readonly bigint[] {
  let z = zerosByDepth.get(depth);
  if (!z) {
    z = Object.freeze(computeZeros(depth));
    zerosByDepth.set(depth, z);
  }
  return z;
}

function checkMembers(labels: readonly bigint[], depth: number): void {
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("unsupported depth");
  if (labels.length > 2 ** depth) throw new RangeError("too many members for the tree");
  for (const l of labels) if (typeof l !== "bigint" || l < 0n || l >= SNARK_SCALAR_FIELD) throw new RangeError("a member is out of the field");
}

/**
 * The Poseidon Merkle root of a member list (depth 20 by default), the same as MerkleTree's root, built bottom-up: about
 * 2 hashes per member instead of 20, so a device can check many roots. The empty list gives the empty tree's root.
 */
export function setRoot(labels: readonly bigint[], depth: number = TREE_DEPTH): bigint {
  checkMembers(labels, depth);
  const zeros = zerosOf(depth);
  let level: readonly bigint[] = labels;
  for (let d = 0; d < depth; d++) {
    if (level.length === 0) return zeros[depth];
    const next: bigint[] = new Array(Math.ceil(level.length / 2));
    for (let i = 0; i < level.length; i += 2) next[i >> 1] = hash2(level[i], i + 1 < level.length ? level[i + 1] : zeros[d]);
    level = next;
  }
  return level.length === 0 ? zeros[depth] : level[0];
}

function setLayers(labels: readonly bigint[], depth: number): bigint[][] {
  checkMembers(labels, depth);
  const zeros = zerosOf(depth);
  const layers: bigint[][] = [[...labels]];
  for (let d = 0; d < depth; d++) {
    const level = layers[d];
    const next: bigint[] = new Array(Math.ceil(level.length / 2));
    for (let i = 0; i < level.length; i += 2) next[i >> 1] = hash2(level[i], i + 1 < level.length ? level[i + 1] : zeros[d]);
    layers.push(next);
  }
  return layers;
}

/**
 * The root of the first `m` members of a list, from the layers of the whole list (setLayers): the same as
 * setRoot(list.slice(0, m)), in `depth` hashes. Every node left of the last member's path covers members only, so the
 * whole list's node is the prefix's; every node right of it covers none, so it is the empty subtree's.
 */
function prefixRootOf(layers: readonly (readonly bigint[])[], m: number, depth: number): bigint {
  const zeros = zerosOf(depth);
  if (m === 0) return zeros[depth];
  let idx = m - 1;
  let node = layers[0][idx];
  for (let d = 0; d < depth; d++) {
    node = idx & 1 ? hash2(layers[d][idx - 1], node) : hash2(node, zeros[d]);
    idx >>= 1;
  }
  return node;
}

/** How many excluded-leaf sets keep their layers per events array (a few in an honest history; bounded for any other). */
const MINUS_CACHE = 8;

/**
 * The pool's deposits in leaf order minus the excluded leaves `x`, with the layers of their tree. A recipe's members are
 * a prefix of this list (its x leaves are all among its first n deposits), so every root of one x shares these layers
 * and costs `depth` hashes (prefixRootOf). The last MINUS_CACHE sets are kept per events array.
 */
function minusLayers(info: EventInfo, x: ReadonlySet<number>, depth: number): { labels: readonly bigint[]; layers: bigint[][] } {
  const key = `${depth}|${[...x].sort((a, b) => a - b).join(",")}`;
  const hit = info.minus.get(key);
  if (hit) {
    info.minus.delete(key);
    info.minus.set(key, hit); // most recently used last
    return hit;
  }
  const labels = info.deposits.filter((d) => !x.has(d.leafIndex)).map((d) => d.label);
  const value = { labels, layers: setLayers(labels, depth) };
  info.minus.set(key, value);
  if (info.minus.size > MINUS_CACHE) info.minus.delete(info.minus.keys().next().value!);
  return value;
}

// ─── the recipe (a root's cid) ────────────────────────────────────────────────

export interface SetRecipe {
  /** 1: the screening policy; 0: the open testnet policy's "open-testnet-policy:count=N:head=H" (or a legacy prefix root) */
  version: 0 | 1;
  /** n: the first n deposits in leaf order are considered */
  considered: number;
  /** x: the state-tree leaves of considered deposits that are excluded, ascending */
  excludedLeaves: readonly number[];
  /** the snapshot's head block (v1; the legacy head for v0) */
  asOfBlock: bigint | null;
  /** the snapshot head's block time, unix seconds (v1) */
  asOfTime: number | null;
  /** the inclusion delay applied, seconds (v1) */
  delaySeconds: number | null;
  /** the confirmations applied (v1) */
  confirmations: number | null;
}

export type RecipeV1 = SetRecipe & { version: 1; asOfBlock: bigint; asOfTime: number; delaySeconds: number; confirmations: number };

const SCREENED_PREFIX = "hylsia-asp:";
const NUM = "(?:0|[1-9][0-9]*)";
const RECIPE_V1 = new RegExp(`^hylsia-asp:v1;n=(${NUM});x=(${NUM}(?:,${NUM})*)?;asOf=(${NUM});t=(${NUM});delay=(${NUM});conf=(${NUM})$`);
const RECIPE_V0 = new RegExp(`^open-testnet-policy:count=(${NUM}):head=(${NUM})$`);
const SCREENED_VERSION = /^hylsia-asp:v([1-9][0-9]{0,8})(?:;|$)/;
const MAX_CID_CHARS = 16_384;

const safeInt = (s: string): number | null => {
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : null;
};

/** The cid of a screening-policy root (any version, even a malformed one): "hylsia-asp:…". */
export const isScreenedCid = (cid: string | null | undefined): boolean => typeof cid === "string" && cid.startsWith(SCREENED_PREFIX);

/**
 * The policy version a cid names: k for "hylsia-asp:vk;…", 0 for the open testnet policy's
 * "open-testnet-policy:count=N:head=H", null for anything else (including a malformed "hylsia-asp:" cid).
 */
export function cidPolicyVersion(cid: string | null | undefined): number | null {
  if (typeof cid !== "string") return null;
  const m = SCREENED_VERSION.exec(cid);
  if (m) return Number(m[1]);
  return RECIPE_V0.test(cid) ? 0 : null;
}

/** The highest screening-policy version any root in these events names (0 when none): a publisher refuses to post below it. */
export function highestPolicyVersion(events: readonly PoolEvent[]): number {
  return infoOf(events).roots.reduce((max, e) => Math.max(max, cidPolicyVersion(e.cid) ?? 0), 0);
}

/**
 * The cid of a v1 recipe: "hylsia-asp:v1;n=<n>;x=<leaf>,<leaf>;asOf=<block>;t=<unix s>;delay=<s>;conf=<c>". Every
 * field, in this order, decimal without leading zeros; x may be empty and is strictly ascending, at most
 * MAX_RECIPE_EXCLUSIONS. Throws RangeError for anything else.
 */
export function formatRecipe(r: SetRecipe & { version: 1 }): string {
  const bad = (what: string) => new RangeError(`formatRecipe: ${what}`);
  if (r.version !== 1) throw bad("version must be 1");
  if (!isUint(r.considered)) throw bad("n must be a whole number");
  if (!Array.isArray(r.excludedLeaves)) throw bad("x must be a list of leaves");
  if (r.excludedLeaves.length > MAX_RECIPE_EXCLUSIONS) throw bad(`x holds more than ${MAX_RECIPE_EXCLUSIONS} leaves`);
  if (r.excludedLeaves.length > r.considered) throw bad("x holds more leaves than n considers");
  r.excludedLeaves.forEach((leaf, k) => {
    if (!isUint(leaf)) throw bad("every leaf in x must be a whole number");
    if (k > 0 && leaf <= r.excludedLeaves[k - 1]) throw bad("x must be strictly ascending");
  });
  if (typeof r.asOfBlock !== "bigint" || r.asOfBlock < 0n) throw bad("asOf must be a block number");
  if (!isUint(r.asOfTime)) throw bad("t must be a whole number of seconds");
  if (!isUint(r.delaySeconds)) throw bad("delay must be a whole number of seconds");
  if (!isUint(r.confirmations)) throw bad("conf must be a whole number");
  return `hylsia-asp:v1;n=${r.considered};x=${r.excludedLeaves.join(",")};asOf=${r.asOfBlock};t=${r.asOfTime};delay=${r.delaySeconds};conf=${r.confirmations}`;
}

/**
 * A cid's recipe, strictly: the exact v1 grammar (formatRecipe), or the legacy "open-testnet-policy:count=N:head=H"
 * as version 0 (considered N, no exclusions). Anything else, a v2 cid included, is null.
 */
export function parseRecipe(cid: string): SetRecipe | null {
  if (typeof cid !== "string" || cid.length > MAX_CID_CHARS) return null;
  const v1 = RECIPE_V1.exec(cid);
  if (v1) {
    const considered = safeInt(v1[1]);
    const t = safeInt(v1[4]);
    const delay = safeInt(v1[5]);
    const conf = safeInt(v1[6]);
    if (considered === null || t === null || delay === null || conf === null) return null;
    const x: number[] = [];
    if (v1[2] !== undefined) {
      for (const part of v1[2].split(",")) {
        const leaf = safeInt(part);
        if (leaf === null || (x.length > 0 && leaf <= x[x.length - 1])) return null;
        x.push(leaf);
      }
    }
    if (x.length > MAX_RECIPE_EXCLUSIONS || x.length > considered) return null;
    return { version: 1, considered, excludedLeaves: x, asOfBlock: BigInt(v1[3]), asOfTime: t, delaySeconds: delay, confirmations: conf };
  }
  const v0 = RECIPE_V0.exec(cid);
  if (v0) {
    const count = safeInt(v0[1]);
    if (count === null) return null;
    return { version: 0, considered: count, excludedLeaves: [], asOfBlock: BigInt(v0[2]), asOfTime: null, delaySeconds: null, confirmations: null };
  }
  return null;
}

/** The member count a recipe claims: n minus the excluded leaves. */
export const recipeMemberCount = (r: Pick<SetRecipe, "considered" | "excludedLeaves">): number => r.considered - r.excludedLeaves.length;

function labelsFor(deposits: readonly DepositedEvent[], r: Pick<SetRecipe, "considered" | "excludedLeaves">): bigint[] | null {
  if (!isUint(r.considered) || r.considered > deposits.length) return null;
  const x = new Set(r.excludedLeaves);
  const labels: bigint[] = [];
  let hit = 0;
  for (let i = 0; i < r.considered; i++) {
    const d = deposits[i];
    if (x.has(d.leafIndex)) hit++;
    else labels.push(d.label);
  }
  return hit === x.size ? labels : null;
}

/**
 * The member labels a recipe names: the first n deposits in leaf order (from any event list; change notes never count),
 * minus those whose leaf is in x. null when there are fewer than n deposits, or an x leaf is not one of the first n
 * deposits' leaves.
 */
export function recipeLabels(events: readonly PoolEvent[], r: Pick<SetRecipe, "considered" | "excludedLeaves">): bigint[] | null {
  return labelsFor(infoOf(events).deposits, r);
}

/**
 * The largest n that a v1 root among these events names AND whose list rebuilds to that root (0 when none), counting
 * only roots posted before `at` when it is given. "n never decreases": a device refuses a v1 root whose n is below
 * min(this, its deposit count), and the publisher never considers fewer: its previousConsidered is at least this.
 * A root whose recipe does not rebuild to it (a typo, another publisher's bad record) never raises the floor: its n
 * claims nothing, and counting it would make the publisher consider every deposit at once, without the delay.
 */
export function considerationFloor(events: readonly PoolEvent[], at?: EventPosition | null, depth: number = TREE_DEPTH): number {
  const info = infoOf(events);
  return floorOf(info, at ? info.roots.filter((e) => isBefore(e, at)) : info.roots, depth);
}

/** The largest n among `history`'s v1 roots whose list rebuilds to their root (largest claims first: the first that verifies). */
function floorOf(info: EventInfo, history: readonly ASPRootUpdatedEvent[], depth: number): number {
  const claims: { e: ASPRootUpdatedEvent; r: SetRecipe }[] = [];
  for (const e of history) {
    const r = isScreenedCid(e.cid) ? parseRecipe(e.cid) : null;
    if (r && r.version === 1 && r.considered > 0) claims.push({ e, r });
  }
  claims.sort((a, b) => b.r.considered - a.r.considered);
  for (const { e, r } of claims) if (recipeList(info, e.root, e.cid, r, depth).status === "verified") return r.considered;
  return 0;
}

type RecipeList =
  | { status: "verified"; labels: readonly bigint[] }
  | { status: "mismatch"; problem: "root" | "exclusions" }
  | { status: "unknown"; problem: "missing_deposits" };

/**
 * Whether a v1 recipe's member list (the first n deposits minus x) rebuilds to `root` from these events: unknown when the
 * events lack deposits the recipe needs, else verified or a mismatch. The policy rules (n never decreases) are not
 * applied here. Memoized per events array.
 */
function recipeList(info: EventInfo, root: bigint, cid: string, r: Pick<SetRecipe, "considered" | "excludedLeaves">, depth: number): RecipeList {
  return memo(info, `list|${root}|${depth}|${cid}`, (): RecipeList => {
    if (!completeThrough(info, r.considered)) return { status: "unknown", problem: "missing_deposits" };
    const members = recipeMembers(info, r, depth);
    if (members === null) return { status: "mismatch", problem: "exclusions" };
    return members.root === root ? { status: "verified", labels: members.labels } : { status: "mismatch", problem: "root" };
  });
}

/**
 * A recipe's members here (the first n deposits minus x) and their root, or null when an x leaf is not one of the first
 * n deposits' leaves (labelsFor's rule). The members are a prefix of "every deposit minus x", so the root comes from
 * that list's shared layers (minusLayers) in `depth` hashes: checking every root of a long history stays cheap.
 */
function recipeMembers(info: EventInfo, r: Pick<SetRecipe, "considered" | "excludedLeaves">, depth: number): { labels: readonly bigint[]; root: bigint } | null {
  if (!isUint(r.considered) || r.considered > info.deposits.length) return null;
  const x = new Set(r.excludedLeaves);
  let hit = 0;
  for (let i = 0; i < r.considered; i++) if (x.has(info.deposits[i].leafIndex)) hit++;
  if (hit !== x.size) return null;
  const all = minusLayers(info, x, depth);
  const m = r.considered - x.size;
  return { labels: all.labels.slice(0, m), root: prefixRootOf(all.layers, m, depth) };
}

/**
 * Leaves the current root excludes that the new snapshot admits again (an exclusion lifted, or an entry removed by
 * mistake): logged and reported, so a re-admission is visible.
 */
export function readmittedLeaves(current: Pick<SetRecipe, "excludedLeaves"> | null, snapshot: Pick<SetRecipe, "considered" | "excludedLeaves">): number[] {
  if (!current) return [];
  const still = new Set(snapshot.excludedLeaves);
  return current.excludedLeaves.filter((leaf) => !still.has(leaf));
}

// ─── the operator's exclusion file ────────────────────────────────────────────

export const EXCLUSIONS_FORMAT = "hylsia-asp-exclusions";

export interface ExclusionEntry {
  /** null: every network */
  chainId: number | null;
  label: bigint | null;
  /** lowercase */
  depositor: string | null;
  reason: ExclusionReason;
}

export type ExclusionFileResult = { ok: true; entries: ExclusionEntry[]; warnings: string[] } | { ok: false; error: string };

const FILE_FIELDS: readonly string[] = ["format", "version", "comment", "entries"];
const ENTRY_FIELDS: readonly string[] = ["label", "depositor", "reason", "chainId", "note", "added"];

/** Where JSON.parse stopped, as line and column only: its message can quote the text, which may hold notes. */
function jsonWhere(err: unknown, text: string): string {
  const message = err instanceof Error ? err.message : "";
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return ` (line ${lc[1]}, column ${lc[2]})`;
  const pos = /position (\d+)/.exec(message);
  if (!pos) return "";
  const p = Math.min(Number(pos[1]), text.length);
  const before = text.slice(0, p);
  return ` (line ${before.split("\n").length}, column ${p - before.lastIndexOf("\n")})`;
}

function fieldElement(v: unknown): bigint | null {
  if (typeof v !== "string" || v.length > 80 || !/^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(v)) return null;
  const n = BigInt(v);
  return n > 0n && n < SNARK_SCALAR_FIELD ? n : null;
}

function isDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * The operator's exclusion list (JSON):
 *   { "format": "hylsia-asp-exclusions", "version": 1, "comment"?: text,
 *     "entries": [ { "label": "<decimal|0x-hex>" | "depositor": "0x<40 hex>", "reason": <code>,
 *                    "chainId"?: number, "note"?: text (<= 500), "added"?: "YYYY-MM-DD" } ] }
 * Exactly one of label or depositor per entry; unknown fields are refused; at most MAX_EXCLUSION_ENTRIES entries. A
 * repeated entry is allowed (the first one's reason counts) and gives a warning. With `notes: "reject"` (an inline list
 * from the environment) a note is an error.
 *
 * Errors and warnings name the entry number and the field only: never a value, a label, an address or a note.
 */
export function parseExclusionFile(text: string, o: { notes?: "allow" | "reject" } = {}): ExclusionFileResult {
  const fail = (error: string): ExclusionFileResult => ({ ok: false, error });
  if (typeof text !== "string") return fail("the exclusion list is not text");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return fail(`the exclusion list is not valid JSON${jsonWhere(err, text)}`);
  }
  if (!isRecord(doc)) return fail("the exclusion list must be a JSON object");
  if (Object.keys(doc).some((k) => !FILE_FIELDS.includes(k))) {
    return fail(`the exclusion list has a top-level field that is not allowed (allowed: ${FILE_FIELDS.join(", ")})`);
  }
  if (doc.format !== EXCLUSIONS_FORMAT) return fail(`field "format" must be "${EXCLUSIONS_FORMAT}"`);
  if (doc.version !== 1) return fail('field "version" must be 1');
  if (doc.comment !== undefined && typeof doc.comment !== "string") return fail('field "comment" must be text');
  if (!Array.isArray(doc.entries)) return fail('field "entries" must be a list');
  if (doc.entries.length > MAX_EXCLUSION_ENTRIES) return fail(`field "entries" holds more than ${MAX_EXCLUSION_ENTRIES.toLocaleString("en-US")} entries`);

  const entries: ExclusionEntry[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < doc.entries.length; i++) {
    const n = i + 1;
    const raw: unknown = doc.entries[i];
    const field = (name: string, rule: string) => fail(`entry #${n}: field "${name}" ${rule}`);
    if (!isRecord(raw)) return fail(`entry #${n} must be an object`);
    if (Object.keys(raw).some((k) => !ENTRY_FIELDS.includes(k))) {
      return fail(`entry #${n} has a field that is not allowed (allowed: ${ENTRY_FIELDS.join(", ")})`);
    }
    const hasLabel = raw.label !== undefined;
    if (hasLabel === (raw.depositor !== undefined)) return fail(`entry #${n} must name exactly one of "label" or "depositor"`);
    let label: bigint | null = null;
    let depositor: string | null = null;
    if (hasLabel) {
      label = fieldElement(raw.label);
      if (label === null) return field("label", "must be text holding a decimal or 0x number above 0 and below the field size");
    } else {
      if (typeof raw.depositor !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw.depositor)) return field("depositor", "must be an address: 0x and 40 hex digits");
      depositor = raw.depositor.toLowerCase();
    }
    if (!isExclusionReason(raw.reason)) return field("reason", `must be one of ${EXCLUSION_REASON_CODES.join(", ")}`);
    let chainId: number | null = null;
    if (raw.chainId !== undefined) {
      if (typeof raw.chainId !== "number" || !Number.isSafeInteger(raw.chainId) || raw.chainId <= 0) return field("chainId", "must be a whole number above 0");
      chainId = raw.chainId;
    }
    if (raw.note !== undefined) {
      if (o.notes === "reject") return field("note", "is not allowed in an inline list (keep notes in the file only)");
      if (typeof raw.note !== "string" || raw.note.length > MAX_EXCLUSION_NOTE_CHARS) return field("note", `must be text of at most ${MAX_EXCLUSION_NOTE_CHARS} characters`);
    }
    if (raw.added !== undefined && !isDate(raw.added)) return field("added", "must be a date written YYYY-MM-DD");
    const key = `${chainId ?? "*"}|${label !== null ? `l${label}` : `d${depositor}`}`;
    const first = seen.get(key);
    if (first !== undefined) warnings.push(`entry #${n} repeats entry #${first}; the first one's reason counts`);
    else seen.set(key, n);
    entries.push({ chainId, label, depositor, reason: raw.reason });
  }
  return { ok: true, entries, warnings };
}

/**
 * The exclusion rule for one network: a deposit is excluded when an entry for that network (or for every network) names
 * its label or its depositing address (any case). When several entries match, the first in the file gives the reason.
 */
export function exclusionMatcher(entries: readonly ExclusionEntry[], chainId: number): (d: Pick<DepositedEvent, "label" | "depositor">) => ExclusionReason | null {
  const byLabel = new Map<bigint, { at: number; reason: ExclusionReason }>();
  const byDepositor = new Map<string, { at: number; reason: ExclusionReason }>();
  entries.forEach((e, at) => {
    if (e.chainId !== null && e.chainId !== chainId) return;
    if (e.label !== null && !byLabel.has(e.label)) byLabel.set(e.label, { at, reason: e.reason });
    if (e.depositor !== null) {
      const key = e.depositor.toLowerCase();
      if (!byDepositor.has(key)) byDepositor.set(key, { at, reason: e.reason });
    }
  });
  return (d) => {
    const a = byLabel.get(d.label);
    const b = typeof d.depositor === "string" ? byDepositor.get(d.depositor.toLowerCase()) : undefined;
    const hit = a && b ? (a.at < b.at ? a : b) : (a ?? b);
    return hit ? hit.reason : null;
  };
}

// ─── building a set (the publisher) ───────────────────────────────────────────

export interface ScreeningInput {
  /** the pool's events (or its Deposited events alone): any order */
  deposits: readonly PoolEvent[];
  /** the snapshot's head block and its block time (unix seconds) */
  head: { block: bigint; time: number };
  /** a deposit is confirmed when its block <= head - confirmations + 1 */
  confirmations: number;
  /** a deposit is old enough when its block time + delaySeconds <= head.time; 0 reads no block time */
  delaySeconds: number;
  /** block → unix seconds; asked only for the blocks blocksNeedingTime names (screenDeposits throws on a missing one) */
  blockTime: (block: bigint) => number | undefined;
  /** the exclusion rule (exclusionMatcher) */
  exclude: (d: DepositedEvent) => ExclusionReason | null;
  /** max(n of the verified current root, considerationFloor(events)): n never goes below it */
  previousConsidered: number;
  /**
   * leaves that stay in x whatever `exclude` says, never announced (no reason is known for them): the publisher passes
   * the leaves the verified current root's own record lists while the operator's list cannot be read, so a missing or
   * broken list never re-admits a deposit the chain shows excluded
   */
  keepExcluded?: ReadonlySet<number> | null;
}

export interface ScreenedExclusion {
  leafIndex: number;
  label: bigint;
  reason: ExclusionReason;
  /** within n: its leaf is in x; false: not considered yet, announced at once, and it never enters a root while listed */
  considered: boolean;
}

export interface ScreeningSnapshot {
  recipe: RecipeV1;
  /** the recipe's cid; null when x holds more than MAX_RECIPE_EXCLUSIONS leaves (nothing can be posted: policy_error) */
  cid: string | null;
  /** the members, in leaf order */
  labels: bigint[];
  /** their root (depth 20); the empty tree's root when there is no member */
  root: bigint;
  memberCount: number;
  /** every deposit the list names, considered or not, in leaf order */
  excluded: ScreenedExclusion[];
  /** deposits not considered yet that the list does not name */
  waiting: number;
  /** every deposit in the events */
  deposits: number;
}

function screeningArgs(input: Omit<ScreeningInput, "blockTime" | "exclude"> & Partial<Pick<ScreeningInput, "exclude">>): void {
  if (!isUint(input.confirmations)) throw new RangeError("screening: confirmations must be a whole number");
  if (!isUint(input.delaySeconds)) throw new RangeError("screening: the delay must be a whole number of seconds");
  if (!isUint(input.previousConsidered)) throw new RangeError("screening: previousConsidered must be a whole number");
  if (!input.head || typeof input.head.block !== "bigint" || input.head.block < 0n || !isUint(input.head.time)) {
    throw new RangeError("screening: the head needs a block number and a block time");
  }
}

/**
 * The blocks whose time screenDeposits needs: the confirmed deposits' blocks from position min(previousConsidered,
 * deposits) on (earlier deposits stay members whatever their time), ascending, without repeats. None when the delay is 0.
 */
export function blocksNeedingTime(input: Omit<ScreeningInput, "blockTime">): bigint[] {
  screeningArgs(input);
  if (input.delaySeconds === 0) return [];
  const { deposits } = infoOf(input.deposits);
  const cutoff = input.head.block - BigInt(input.confirmations) + 1n;
  const out: bigint[] = [];
  for (let i = Math.min(input.previousConsidered, deposits.length); i < deposits.length; i++) {
    const block = deposits[i].blockNumber;
    if (block > cutoff) break;
    if (out[out.length - 1] !== block) out.push(block);
  }
  return out;
}

/**
 * Apply the screening policy to one pool's deposits (the publisher's snapshot):
 *   n = min(max(nRule, previousConsidered), deposits), nRule = the leading run that is confirmed and whose block time +
 *   delay <= head.time; x = the considered deposits the list names (and those `keepExcluded` keeps); members = the
 *   first n minus x.
 * Every listed deposit is reported, considered or not (one beyond n is announced at once and never enters a root while
 * listed). Throws when a needed block time is missing.
 */
export function screenDeposits(input: ScreeningInput): ScreeningSnapshot {
  screeningArgs(input);
  const { deposits } = infoOf(input.deposits);
  const count = deposits.length;
  const cutoff = input.head.block - BigInt(input.confirmations) + 1n;
  let n = Math.min(input.previousConsidered, count);
  while (n < count) {
    const d = deposits[n];
    if (d.blockNumber > cutoff) break;
    if (input.delaySeconds > 0) {
      const t = input.blockTime(d.blockNumber);
      if (typeof t !== "number" || !Number.isFinite(t)) throw new Error(`screenDeposits: no block time for block ${d.blockNumber}`);
      if (t + input.delaySeconds > input.head.time) break;
    }
    n++;
  }

  const excluded: ScreenedExclusion[] = [];
  const x: number[] = [];
  const keep = input.keepExcluded ?? null;
  for (let i = 0; i < count; i++) {
    const d = deposits[i];
    const reason = input.exclude(d);
    if (reason === null) {
      if (i < n && keep?.has(d.leafIndex)) x.push(d.leafIndex); // the chain's own exclusion, kept (not announced)
      continue;
    }
    if (!isExclusionReason(reason)) throw new RangeError("screenDeposits: the exclusion rule gave an unknown reason");
    excluded.push({ leafIndex: d.leafIndex, label: d.label, reason, considered: i < n });
    if (i < n) x.push(d.leafIndex);
  }
  const xs = new Set(x);
  const labels = deposits.slice(0, n).filter((d) => !xs.has(d.leafIndex)).map((d) => d.label);
  const recipe: RecipeV1 = {
    version: 1,
    considered: n,
    excludedLeaves: x,
    asOfBlock: input.head.block,
    asOfTime: input.head.time,
    delaySeconds: input.delaySeconds,
    confirmations: input.confirmations,
  };
  return {
    recipe,
    cid: x.length <= MAX_RECIPE_EXCLUSIONS ? formatRecipe(recipe) : null,
    labels,
    root: setRoot(labels),
    memberCount: labels.length,
    excluded,
    waiting: count - n - excluded.filter((e) => !e.considered).length,
    deposits: count,
  };
}

// ─── checking a root (the device, and the publisher about the chain) ──────────

/** A root whose member list this device rebuilt from its own events and that root's recipe. */
export interface VerifiedSet {
  root: bigint;
  cid: string | null;
  /** its recipe; a legacy prefix root reads as version 0 with considered = its prefix size */
  recipe: SetRecipe;
  /** the members in leaf order (read-only) */
  labels: readonly bigint[];
  memberCount: number;
  has(label: bigint): boolean;
  /** the label's position among the members, -1 when absent */
  indexOf(label: bigint): number;
  /** the membership proof of members[index] against `root` (bottom-up layers, built once) */
  proof(index: number): MerkleProof;
  /** a MerkleTree of the members, built on first use (slower than proof()) */
  readonly tree: MerkleTree;
}

class Verified implements VerifiedSet {
  readonly root: bigint;
  readonly cid: string | null;
  readonly recipe: SetRecipe;
  readonly labels: readonly bigint[];
  readonly memberCount: number;
  private readonly depth: number;
  private index: Map<bigint, number> | null = null;
  private layers: bigint[][] | null = null;
  private merkle: MerkleTree | null = null;

  constructor(root: bigint, cid: string | null, recipe: SetRecipe, labels: readonly bigint[], depth: number) {
    this.root = root;
    this.cid = cid;
    this.recipe = recipe;
    this.labels = labels;
    this.memberCount = labels.length;
    this.depth = depth;
  }

  indexOf(label: bigint): number {
    if (!this.index) {
      this.index = new Map();
      this.labels.forEach((l, i) => {
        if (!this.index!.has(l)) this.index!.set(l, i);
      });
    }
    return this.index.get(label) ?? -1;
  }

  has(label: bigint): boolean {
    return this.indexOf(label) !== -1;
  }

  proof(index: number): MerkleProof {
    if (!Number.isInteger(index) || index < 0 || index >= this.labels.length) throw new RangeError("leaf index out of range");
    this.layers ??= setLayers(this.labels, this.depth);
    const zeros = zerosOf(this.depth);
    const siblings: bigint[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.layers[level][idx ^ 1] ?? zeros[level]);
      idx >>= 1;
    }
    return { leaf: this.labels[index], index, siblings, root: this.layers[this.depth][0] ?? zeros[this.depth] };
  }

  get tree(): MerkleTree {
    this.merkle ??= new MerkleTree(this.depth, [...this.labels]);
    return this.merkle;
  }
}

/** Why a root could not be verified on this device. */
export type RootProblem =
  /** unknown: this device lacks deposits the recipe needs (its RPC lags, or its events have a hole): sync and try again */
  | "missing_deposits"
  /** unknown: neither the root's ASPRootUpdated event nor a record of its cid */
  | "no_record"
  /** mismatch: the recipe's list does not hash to the root */
  | "root"
  /** mismatch: an excluded leaf is not one of the first n deposits */
  | "exclusions"
  /** mismatch: a screening cid that does not follow the grammar */
  | "malformed"
  /**
   * mismatch: the record's list does hash to the root, but its n is below an earlier verified root's n while the
   * deposits did not drop ("n never decreases"): members left without being listed, a policy violation
   */
  | "lowered"
  /** mismatch: an open-policy (unscreened) root after a screened one: the policy version went backwards */
  | "version_backwards"
  /** a newer screening policy than this code knows: this app is out of date */
  | "outdated";

export type RootStatus = "verified" | "mismatch" | "unknown" | "outdated";

/**
 * Three-valued (plus "outdated"), so that "cannot check" is never taken for "does not match":
 *   - verified: the list rebuilt from the device's own events and the recipe hashes to the root;
 *   - mismatch: the events hold everything the recipe needs, and it still does not rebuild (or breaks the policy);
 *   - unknown: the events lack what the recipe needs (fewer than n deposits, a hole before the n-th deposit, no record);
 *   - outdated: the cid names a newer policy version.
 */
export type RootCheck =
  | { status: "verified"; set: VerifiedSet }
  | { status: "mismatch"; problem: "root" | "exclusions" | "malformed" | "lowered" | "version_backwards"; recipe: SetRecipe | null }
  | { status: "unknown"; problem: "missing_deposits" | "no_record"; recipe: SetRecipe | null }
  | { status: "outdated"; problem: "outdated"; version: number };

export interface RootCheckInput {
  root: bigint;
  /** the root's cid: from its newest ASPRootUpdated event, or a record; null when there is neither */
  cid: string | null;
  events: readonly PoolEvent[];
  /**
   * where the root was posted (its newest ASPRootUpdated event): only roots posted before it count as its history.
   * null or absent: after every event here (a record without its event, or a snapshot not posted yet).
   */
  at?: EventPosition | null;
  depth?: number;
}

/** A legacy prefix root: the size of the prefix of the deposits whose root it is (memoized per events array). */
function prefixSize(info: EventInfo, root: bigint, depth: number): number | undefined {
  const sizes = memo(info, `prefix|${depth}`, () => {
    const map = new Map<bigint, number>();
    const tree = new MerkleTree(depth);
    for (const d of info.deposits) {
      tree.insert(d.label);
      if (!map.has(tree.root)) map.set(tree.root, tree.size);
    }
    return map;
  });
  return sizes.get(root);
}

function checkUncached(root: bigint, cid: string | null, info: EventInfo, at: EventPosition | null, depth: number): RootCheck {
  const history = at ? info.roots.filter((e) => isBefore(e, at)) : info.roots;
  const verified = (recipe: SetRecipe, labels: readonly bigint[]): RootCheck => ({ status: "verified", set: new Verified(root, cid, recipe, labels, depth) });
  if (root === 0n) return { status: "unknown", problem: "no_record", recipe: null };

  if (isScreenedCid(cid)) {
    const m = SCREENED_VERSION.exec(cid!);
    if (!m) return { status: "mismatch", problem: "malformed", recipe: null };
    const version = Number(m[1]);
    if (version > ASP_POLICY_VERSION) return { status: "outdated", problem: "outdated", version };
    const r = parseRecipe(cid!);
    if (!r || r.version !== 1) return { status: "mismatch", problem: "malformed", recipe: null };
    // first whether the record describes this root at all: only a list that hashes to the root says anything about it
    const list = recipeList(info, root, cid!, r, depth);
    if (list.status !== "verified") return { ...list, recipe: r };
    // a real list, posted with a lower n than an earlier (verified) root: members left without being listed
    if (r.considered < Math.min(floorOf(info, history, depth), info.deposits.length)) return { status: "mismatch", problem: "lowered", recipe: r };
    return verified(r, list.labels);
  }

  // The open testnet policy: a prefix of the deposits. Never after a screened root (an older publisher still running).
  if (history.some((e) => isScreenedCid(e.cid))) {
    return cid === null ? { status: "unknown", problem: "no_record", recipe: null } : { status: "mismatch", problem: "version_backwards", recipe: null };
  }
  const r0 = cid !== null ? parseRecipe(cid) : null;
  if (r0 && r0.considered > 0 && completeThrough(info, r0.considered)) {
    const labels = info.deposits.slice(0, r0.considered).map((d) => d.label);
    if (setRoot(labels, depth) === root) return verified(r0, labels);
  }
  const k = prefixSize(info, root, depth);
  if (k !== undefined) {
    const recipe: SetRecipe = { version: 0, considered: k, excludedLeaves: [], asOfBlock: r0?.asOfBlock ?? null, asOfTime: null, delaySeconds: null, confirmations: null };
    return verified(recipe, info.deposits.slice(0, k).map((d) => d.label));
  }
  if (cid === null) return { status: "unknown", problem: "no_record", recipe: null };
  // With the root's own event here and no hole in the events, every deposit it could count is here: it matches none.
  return at && info.gapFree ? { status: "mismatch", problem: "root", recipe: r0 } : { status: "unknown", problem: "missing_deposits", recipe: r0 };
}

/**
 * Check one root against this device's own events and its cid:
 *   - a screening cid ("hylsia-asp:v1;…"): the recipe's list (first n deposits minus x) must hash to the root (else
 *     "root" or "exclusions", whatever its n says), then n must not fall below an earlier verified v1 root's n (unless
 *     the deposits themselves dropped, a reorg: else "lowered"), and a newer version is "outdated";
 *   - anything else (the legacy "open-testnet-policy:…", another cid, or none): a prefix of the deposits with that root,
 *     accepted only while no screened root came before it.
 * Memoized per events array.
 */
export function checkRoot(i: RootCheckInput): RootCheck {
  const depth = i.depth ?? TREE_DEPTH;
  const at = i.at ?? null;
  const info = infoOf(i.events);
  const cid = typeof i.cid === "string" ? i.cid : null;
  return memo(info, `check|${i.root}|${at ? `${at.blockNumber}:${at.logIndex}` : "-"}|${depth}|${cid === null ? "\u0000" : cid}`, () =>
    checkUncached(i.root, cid, info, at, depth),
  );
}

/**
 * The verified member list of a root, or null. The root counts as posted after every event here (a snapshot about to be
 * posted, as the publisher's self-check before it sends): for a root already in the history, use checkRoot with `at`.
 */
export function verifySet(root: bigint, cid: string | null, events: readonly PoolEvent[], depth?: number): VerifiedSet | null {
  const c = checkRoot({ root, cid, events, depth });
  return c.status === "verified" ? c.set : null;
}

export interface RootRecord {
  root: bigint;
  cid: string | null;
  /** its newest ASPRootUpdated event; null for a record that came without one (privacy.asp.set) */
  at: EventPosition | null;
}

/** The newest ASPRootUpdated event of `root` in these events (with duplicates the newest cid wins), or null. */
export function rootRecordOf(events: readonly PoolEvent[], root: bigint): RootRecord | null {
  const { roots } = infoOf(events);
  for (let k = roots.length - 1; k >= 0; k--) {
    const e = roots[k];
    if (e.root === root) return { root, cid: e.cid, at: { blockNumber: e.blockNumber, logIndex: e.logIndex } };
  }
  return null;
}

/**
 * The check of the pool's current root (currentASPRoot from the chain): its cid from its newest event, else from
 * `record` when that names the same root. null when nothing is published (root 0).
 */
export function checkCurrentRoot(i: {
  events: readonly PoolEvent[];
  currentRoot: bigint;
  record?: { root: bigint; cid: string | null } | null;
  depth?: number;
}): { check: RootCheck; source: "event" | "record" | "none"; at: EventPosition | null } | null {
  if (i.currentRoot === 0n) return null;
  const own = rootRecordOf(i.events, i.currentRoot);
  if (own) return { check: checkRoot({ root: i.currentRoot, cid: own.cid, events: i.events, at: own.at, depth: i.depth }), source: "event", at: own.at };
  const rec = i.record && i.record.root === i.currentRoot ? i.record : null;
  const cid = rec && typeof rec.cid === "string" ? rec.cid : null;
  return { check: checkRoot({ root: i.currentRoot, cid, events: i.events, at: null, depth: i.depth }), source: rec ? "record" : "none", at: null };
}

/** The contract's ring of roots as these events show it: the last ASP_ROOT_HISTORY_SIZE posts, newest first (distance 0). */
export function aspRing(events: readonly PoolEvent[]): { root: bigint; cid: string; at: EventPosition; distance: number }[] {
  const { roots } = infoOf(events);
  return roots
    .slice(-ASP_ROOT_HISTORY_SIZE)
    .reverse()
    .map((e, distance) => ({ root: e.root, cid: e.cid, at: { blockNumber: e.blockNumber, logIndex: e.logIndex }, distance }));
}

/**
 * Leaves the snapshot excludes that the verified current root's record does not list. With the same root value they
 * are deposits the current root does not count yet (a member listed later would change the root): typically the newest
 * deposit, listed before it became eligible. Its exclusion is on-chain only once a record lists it.
 */
export function newlyListedLeaves(current: RootCheck | null, snapshot: Pick<SetRecipe, "excludedLeaves"> | null | undefined): number[] {
  if (!snapshot || !current || current.status !== "verified") return [];
  const listed = new Set(current.set.recipe.excludedLeaves);
  return snapshot.excludedLeaves.filter((leaf) => !listed.has(leaf));
}

/**
 * Whether the root is due (the publisher's rootDue): something to post or remove, and either the snapshot's root is not
 * the current one, or the current root's cid demonstrably does not match it (a mismatch decided on fresh events; an
 * unknown never counts, so a lagging event cache never re-posts), or the same root needs a record that lists an
 * exclusion the current record does not (newlyListedLeaves: without it a deposit listed before it was eligible, and
 * then the newest to become eligible, would never be excluded on-chain).
 */
export function rootDueFor(i: {
  currentRoot: bigint;
  current: RootCheck | null;
  snapshot: { root: bigint; memberCount: number; recipe?: Pick<SetRecipe, "excludedLeaves"> | null };
}): boolean {
  // no root yet: the first one once it has a member, or once it has an exclusion to record (the empty set's root)
  if (i.currentRoot === 0n) return i.snapshot.memberCount > 0 || (i.snapshot.recipe?.excludedLeaves.length ?? 0) > 0;
  if (i.snapshot.root !== i.currentRoot || i.current?.status === "mismatch") return true;
  return newlyListedLeaves(i.current, i.snapshot.recipe).length > 0;
}

// ─── the shrink alarm (the device, before it proves) ──────────────────────────

export interface ShrinkAlarm {
  /** the larger crowd it is compared with: see `basis` */
  from: number;
  /** the crowd the withdrawal would hide in: the current root's members minus those whose exclusion the operator announces */
  to: number;
  /** members of the larger crowd that this one leaves out */
  removed: number;
  /** of those, the ones the operator gave no reason for (not in its announced list) */
  unexplained: number;
  /**
   * members of the current root counted out because the operator's answer announces their exclusion: not on-chain yet,
   * and an answer that may differ for each visitor
   */
  announced: number;
  /**
   * what `from` is: "history" the largest verified root among the pool's last SHRINK_ALARM_ROOTS different verified
   * roots before the current one; "current" the current root itself, shrunk by the operator's announcements; "form" the
   * crowd the withdraw form showed (asked about once the withdrawal's own request for a newer root was answered)
   */
  basis: "history" | "current" | "form";
  /** the root of the larger crowd (null for "form") */
  largerRoot: bigint | null;
  /** the block of the current root's event (null without it) */
  atBlock: bigint | null;
}

/**
 * The shrink alarm compares with the largest of this many different root values before the current one that verify on
 * the device (copies of one value count once; values that verify nowhere do not count).
 */
export const SHRINK_ALARM_ROOTS = ASP_ROOT_HISTORY_SIZE;
/** The most different root values it examines, newest first, to find them (so roots that verify nowhere cost bounded work). */
export const SHRINK_ALARM_SCAN = 4 * SHRINK_ALARM_ROOTS;

/** A drop from `from` to `to` that is sharp enough to ask about: at least max(SHRINK_ALARM_MIN, SHRINK_ALARM_SHARE of `from`). */
export const sharpDrop = (from: number, to: number): boolean => from - to >= Math.max(SHRINK_ALARM_MIN, Math.ceil(from * SHRINK_ALARM_SHARE));

/**
 * The verified lists of the newest SHRINK_ALARM_ROOTS different root values before `current` in these events that
 * verify here, newest first. Re-posts of one root value count once, so a burst or a heartbeat of copies never pushes a
 * larger root out; a value no record of which rebuilds to it (a garbage root, another publisher's bad record) does not
 * count either, so only roots that are real lists, each one public with its record, can push it out. At most
 * SHRINK_ALARM_SCAN different values are examined. Memoized per events array.
 */
function verifiedEarlierRoots(info: EventInfo, events: readonly PoolEvent[], current: bigint, depth: number): readonly VerifiedSet[] {
  return memo(info, `earlier|${current}|${depth}`, () => {
    const order: { root: bigint; records: ASPRootUpdatedEvent[] }[] = [];
    const byRoot = new Map<bigint, ASPRootUpdatedEvent[]>();
    for (let k = info.roots.length - 1; k >= 0; k--) {
      const e = info.roots[k];
      if (e.root === current) continue;
      let records = byRoot.get(e.root);
      if (!records) {
        if (order.length === SHRINK_ALARM_SCAN) continue;
        records = [];
        byRoot.set(e.root, records);
        order.push({ root: e.root, records });
      }
      records.push(e);
    }
    const out: VerifiedSet[] = [];
    for (const { root, records } of order) {
      if (out.length === SHRINK_ALARM_ROOTS) break;
      for (const e of records) {
        const c = checkRoot({ root, cid: e.cid, events, at: { blockNumber: e.blockNumber, logIndex: e.logIndex }, depth });
        if (c.status !== "verified") continue;
        out.push(c.set); // a root binds its list: the first record that verifies decides
        break;
      }
    }
    return out;
  });
}

/**
 * The most members any root verifiedEarlierRoots can return may hold, from the records' own claims and without hashing:
 * a v1 record that verifies holds exactly n - |x| members (recipeMembers), any other record at most every deposit here.
 * Over the same candidates (the newest SHRINK_ALARM_SCAN different values before `current`, every record of each).
 * Memoized per events array.
 */
function earlierRootsBound(info: EventInfo, current: bigint): number {
  return memo(info, `earlier-bound|${current}`, () => {
    let bound = 0;
    const seen = new Set<bigint>();
    for (let k = info.roots.length - 1; k >= 0; k--) {
      const e = info.roots[k];
      if (e.root === current) continue;
      if (!seen.has(e.root)) {
        if (seen.size === SHRINK_ALARM_SCAN) continue;
        seen.add(e.root);
      }
      const r = isScreenedCid(e.cid) ? parseRecipe(e.cid) : null;
      bound = Math.max(bound, r && r.version === 1 ? recipeMemberCount(r) : info.deposits.length);
    }
    return bound;
  });
}

/**
 * A dishonest publisher could answer a device's publish request with a root that keeps the suspected deposits and its
 * own, and excludes everyone else; or tell one visitor alone that every member but one will be excluded, so that the
 * app holds back every other note. The device compares the crowd its withdrawal would hide in (the current root's
 * verified members, minus those whose exclusion the operator's answer announces) with the largest of:
 *   - the largest root among the last SHRINK_ALARM_ROOTS DIFFERENT root values in its own event history that verify
 *     here (not the contract's ring: re-posting the small root, a burst or a heartbeat, never hides a larger root from
 *     it, and neither do roots that verify nowhere);
 *   - the current root itself, when announcements shrink it.
 * A drop of at least max(SHRINK_ALARM_MIN, SHRINK_ALARM_SHARE of the larger one) gives an alarm, which the app asks
 * about before any request the operator sees (like the small-set question). Label-independent, and no request.
 * Earlier roots are verified only when their records claim enough members for a sharp drop (earlierRootsBound): the
 * same answer, without rebuilding the lists of roots that could not raise the alarm anyway.
 */
export function shrinkAlarm(i: {
  events: readonly PoolEvent[];
  current: VerifiedSet;
  announced?: ReadonlyMap<bigint, unknown> | null;
  depth?: number;
}): ShrinkAlarm | null {
  const info = infoOf(i.events);
  const announced = i.announced ?? null;
  const out = announced ? [...announced.keys()].filter((l) => i.current.has(l)).length : 0;
  const to = i.current.memberCount - out;
  const inCrowd = (l: bigint) => i.current.has(l) && !announced?.has(l);
  const atBlock = rootRecordOf(i.events, i.current.root)?.at?.blockNumber ?? null;

  // sharpDrop grows with `from`: when even the largest claim among the candidates gives no sharp drop, no verified one
  // can, so nothing needs verifying (an operator can no longer make every withdrawing device rebuild many lists with
  // roots that could not raise the alarm)
  if (!sharpDrop(Math.max(earlierRootsBound(info, i.current.root), i.current.memberCount), to)) return null;

  let best: VerifiedSet | null = null;
  for (const set of verifiedEarlierRoots(info, i.events, i.current.root, i.depth ?? TREE_DEPTH)) {
    if (!best || set.memberCount > best.memberCount) best = set;
  }

  const larger = best && best.memberCount > i.current.memberCount ? best : null;
  const from = larger ? larger.memberCount : i.current.memberCount;
  if (!sharpDrop(from, to)) return null;
  const gone = (larger ?? i.current).labels.filter((l) => !inCrowd(l));
  return {
    from,
    to,
    removed: gone.length,
    unexplained: gone.filter((l) => !announced?.has(l)).length,
    announced: out,
    basis: larger ? "history" : "current",
    largerRoot: (larger ?? i.current).root,
    atBlock,
  };
}

// ─── the operator's answer, read defensively ──────────────────────────────────

/**
 * The privacy.asp.status `screening` block when it has the shape this code reads, else null (an older server, or an
 * answer of another shape: the device then works from on-chain data alone).
 */
export function validScreening(s: unknown): ASPScreening | null {
  if (!isRecord(s)) return null;
  const snap = s.snapshot;
  const auto = s.autoPublish;
  if (
    typeof s.rootDue !== "boolean" ||
    !isUint(s.delaySeconds) ||
    !isRecord(snap) ||
    !isUint(snap.considered) ||
    !isUint(snap.memberCount) ||
    !Array.isArray(s.excluded) ||
    !isRecord(auto) ||
    typeof auto.running !== "boolean" ||
    !isUint(auto.seconds)
  ) {
    return null;
  }
  return s as unknown as ASPScreening;
}

export interface AnnouncedExclusion {
  reason: ExclusionReason;
  leafIndex: number | null;
  /** within the operator's snapshot n (its next root lists the leaf in x) */
  considered: boolean;
}

/**
 * The exclusions the operator announces (screening.excluded), by label. Never authoritative on the device: they can
 * block the official app or name the reason of an on-chain exclusion, nothing more. Malformed items are skipped, and
 * so is any field beyond the label, leaf, reason and `considered` (an older server's `since`, the time it first
 * matched an entry, is not used: the device times an announcement from when it first saw it).
 */
export function announcedExclusions(screening: Pick<ASPScreening, "excluded"> | null | undefined): Map<bigint, AnnouncedExclusion> {
  const out = new Map<bigint, AnnouncedExclusion>();
  const list: readonly unknown[] = screening && Array.isArray(screening.excluded) ? screening.excluded : [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const e = item as Partial<Record<keyof ExcludedDeposit, unknown>>;
    if (typeof e.label !== "string" || !/^[0-9]{1,80}$/.test(e.label) || !isExclusionReason(e.reason)) continue;
    const label = BigInt(e.label);
    if (out.has(label)) continue;
    out.set(label, { reason: e.reason, leafIndex: isUint(e.leafIndex) ? e.leafIndex : null, considered: e.considered === true });
  }
  return out;
}

/**
 * The operator's answer's record of the current root ({ root, cid }), or null: like privacy.asp.set's, it counts only
 * when it names the root on-chain and its cid rebuilds to it from this device's own events (checkCurrentRoot).
 */
export function answerRecord(screening: Pick<ASPScreening, "current"> | null | undefined): { root: bigint; cid: string | null } | null {
  const current = screening?.current ?? null;
  const root = current && typeof current.root === "string" && /^[0-9]{1,80}$/.test(current.root) ? BigInt(current.root) : null;
  return root !== null ? { root, cid: typeof current!.cid === "string" ? current!.cid : null } : null;
}

/**
 * The operator's announcements alone shrink the verified current root's crowd sharply (shrinkAlarm's "current" basis:
 * at least max(10, 20%) of its members announced for exclusion). Every withdrawal from this app could then only be one
 * of the few members the answer does not announce, so publishDue does not follow that answer's rootDue, and
 * publishDueAcross sends no request on any network while it holds (the app asks about that crowd first anyway). Below
 * that share (a root of 10 or fewer members whose every other member is announced, for one) the rootDue is followed:
 * the small-set question comes first. Label-independent; no request.
 */
export function announcementsShrinkCurrent(i: {
  events: readonly PoolEvent[];
  currentRoot: bigint;
  screening: Pick<ASPScreening, "excluded" | "current"> | null | undefined;
  depth?: number;
}): boolean {
  const announced = announcedExclusions(i.screening);
  if (announced.size === 0) return false;
  const cur = checkCurrentRoot({ events: i.events, currentRoot: i.currentRoot, record: answerRecord(i.screening), depth: i.depth });
  if (!cur || cur.check.status !== "verified") return false;
  const set = cur.check.set;
  let out = 0;
  for (const label of announced.keys()) if (set.has(label)) out++;
  return out > 0 && sharpDrop(set.memberCount, set.memberCount - out);
}

// ─── a deposit's screening state (the device) ─────────────────────────────────

/**
 * - in_set: a member of the verified current root (`next`: the next root's size when one is due);
 * - waiting: not in the current root: inside the delay ("delay"), or eligible and waiting for the next root
 *   ("next_root"; both from the answer and the public activity times, for the words only); `announced`: the operator
 *   announces an exclusion for it, or a server's record of the current root (not this device's own event of it) lists
 *   its leaf ("Exclusion announced": never a public-exit recommendation);
 * - excluded: on-chain evidence only, from this device's own newest event of the current root: its leaf is in the
 *   verified root's x (`listed`), or an earlier root counted it and the current one, whose list hashes to it, dropped it
 *   without listing it (`listed` false, no reason). `removed`: an earlier root counted it (the operator's claim, read
 *   from earlier cids). The reason comes from the operator's announcement, if any;
 * - removal_announced: in the verified current root, but the operator announces its exclusion. The official app does
 *   not withdraw it privately (fail closed) and does not recommend the public exit. `overdue`: no removal root although
 *   one was due (the operator's answer and the chain disagree);
 * - unverified: the current root could not be verified on this device (`problem`);
 * - unknown: this device's events do not hold the deposit.
 */
export type ScreeningState =
  | { kind: "in_set"; size: number; next: number | null }
  | { kind: "waiting"; why: "delay" | "next_root"; eligibleAt: number | null; announced: boolean }
  | { kind: "excluded"; reason: ExclusionReason | null; removed: boolean; listed: boolean }
  | { kind: "removal_announced"; reason: ExclusionReason | null; size: number; overdue: boolean }
  | { kind: "unverified"; problem: RootProblem }
  | { kind: "unknown" };

export interface ScreeningStateInput {
  /** the note's deposit label (a change note keeps its deposit's label) */
  label: bigint;
  /** this device's public events of the pool */
  events: readonly PoolEvent[];
  /** currentASPRoot from the chain (0: nothing published) */
  currentRoot: bigint;
  /** the active pool's privacy.asp.status screening block, when fresh; null or absent: on-chain data only */
  screening?: ASPScreening | null;
  /** the publisher can post now (the status entry's canPublish); used only to tell an overdue announced removal */
  canPublish?: boolean | null;
  /** the deposit's block time (privacy.poolActivity, matched by tx hash: no block read), unix seconds */
  depositTime?: number | null;
  /** that chain's time now (the activity entry's now plus the time since), unix seconds */
  now?: number | null;
  /** the network's inclusion delay when there is no screening answer (NetworkInfo.aspInclusionDelaySeconds) */
  delaySeconds?: number | null;
  /** the input-less privacy.asp.set record of the current root, for a device whose events lack that root's event */
  record?: { root: bigint; cid: string | null } | null;
  /**
   * that chain's time when this device first saw the operator announce this deposit's exclusion (kept in memory for
   * the session); used only to tell an overdue announced removal. null or absent: not timed (never overdue by time)
   */
  announcedSince?: number | null;
  depth?: number;
}

/** An earlier root (before `at`) counted this deposit as a member, as its cid says (parse only: the operator's claim). */
function countedEarlier(info: EventInfo, ordinal: number, leaf: number, at: EventPosition | null): boolean {
  const history = at ? info.roots.filter((e) => isBefore(e, at)) : info.roots;
  return history.some((e) => {
    const r = parseRecipe(e.cid);
    if (!r) return false;
    return ordinal < r.considered && !r.excludedLeaves.includes(leaf);
  });
}

/** A list change younger than this holds back a root that admits a deposit again (server/privacy/exclusions.ts). */
const SETTLE_SECONDS = 30;

/** The operator's answer's own record of the current root (its decimal root), or null. */
const answerRoot = (screening: ASPScreening): bigint | null => answerRecord(screening)?.root ?? null;

function overdueRemoval(screening: ASPScreening, since: number | null, now: number | null, canPublish: boolean | null | undefined, deviceRoot: bigint): boolean {
  // the answer and this device must be talking about the same root: a device behind (or ahead of) the answer is not judged
  if (answerRoot(screening) !== deviceRoot) return false;
  // the operator's own answer says no root is due, yet it announces a removal the chain does not show (while its list
  // is settling, a root that also lifts an exclusion waits up to 30 s: no contradiction then)
  if (!screening.rootDue) return screening.settling !== true;
  if (canPublish === false || !screening.autoPublish.running) return false; // the publisher cannot post: nothing promised
  // timed from when this device first saw the announcement (the answer carries no time of the operator's)
  if (since === null || now === null) return false;
  return now - since > screening.autoPublish.seconds + SETTLE_SECONDS + ANNOUNCEMENT_GRACE_SECONDS;
}

/**
 * Where a deposit stands, worked out on the device from public data every visitor gets (its own events, the chain's
 * current root, the input-less status answer, the public activity times). No request depends on it.
 */
export function screeningState(i: ScreeningStateInput): ScreeningState {
  const info = infoOf(i.events);
  const ordinal = info.ordinal.get(i.label);
  if (ordinal === undefined) return { kind: "unknown" };
  const deposit = info.deposits[ordinal];
  const screening = validScreening(i.screening);
  const ann = announcedExclusions(screening).get(i.label) ?? null;
  const reason = ann?.reason ?? null;
  const now = finiteOrNull(i.now);
  const depositTime = finiteOrNull(i.depositTime);
  const delay = screening ? screening.delaySeconds : isUint(i.delaySeconds) ? i.delaySeconds : null;
  const eligibleAt = depositTime !== null && delay !== null ? depositTime + delay : null;

  // "delay" or "next_root" is for the words only: the official app holds back every note the verified current root does
  // not hold (client/src/privacy/publicData.ts withdrawHold), so nothing the answer says here can make it send anything
  const waiting = (claimed = false): ScreeningState => {
    const counted = screening !== null && ordinal < screening.snapshot.considered;
    const due = counted || delay === 0 || (eligibleAt !== null && now !== null && now >= eligibleAt);
    return { kind: "waiting", why: due ? "next_root" : "delay", eligibleAt, announced: ann !== null || claimed };
  };

  const cur = checkCurrentRoot({ events: i.events, currentRoot: i.currentRoot, record: i.record, depth: i.depth });
  if (cur === null) return waiting();
  const c = cur.check;
  // Only the cid of this device's own newest event of the root is the chain's record. A record from a server answer (the
  // status answer, privacy.asp.set) proves membership (the root binds the member list), but its split into "excluded"
  // and "not considered yet" is not bound by the root and may differ for each visitor: it is the operator's claim.
  const onChain = cur.source === "event";
  if (c.status === "verified") {
    const set = c.set;
    if (set.has(i.label)) {
      if (ann && screening) {
        const since = finiteOrNull(i.announcedSince);
        return { kind: "removal_announced", reason, size: set.memberCount, overdue: overdueRemoval(screening, since, now, i.canPublish, i.currentRoot) };
      }
      return { kind: "in_set", size: set.memberCount, next: screening?.rootDue ? screening.snapshot.memberCount : null };
    }
    if (set.recipe.excludedLeaves.includes(deposit.leafIndex)) {
      if (!onChain) return waiting(true); // a server's record names it excluded: held back, never pointed at the public exit
      return { kind: "excluded", reason, removed: countedEarlier(info, ordinal, deposit.leafIndex, cur.at), listed: true };
    }
    return waiting();
  }
  if (onChain && c.status === "mismatch" && c.problem === "lowered" && c.recipe) {
    // a policy violation whose list does hash to the root: the proof fails closed for everyone, but what the chain itself
    // shows about this deposit is shown (its leaf listed, or dropped without being listed)
    if (c.recipe.excludedLeaves.includes(deposit.leafIndex)) {
      return { kind: "excluded", reason, removed: countedEarlier(info, ordinal, deposit.leafIndex, cur.at), listed: true };
    }
    if (ordinal >= c.recipe.considered && countedEarlier(info, ordinal, deposit.leafIndex, cur.at)) {
      return { kind: "excluded", reason, removed: true, listed: false };
    }
  }
  return { kind: "unverified", problem: c.problem };
}

/**
 * Whether a private withdrawal first sends the input-less publish request: the operator's rootDue when its screening
 * answer is at hand (fresh), else the open policy's rule (the current root is not the root of every deposit held). An
 * answer whose announcements alone shrink the current root sharply (announcementsShrinkCurrent) is not followed: its
 * rootDue sends nothing. It takes no label: every withdrawal at a given time decides the same, whichever deposit it
 * spends.
 */
export function publishDue(i: { events: readonly PoolEvent[]; currentRoot: bigint; screening?: ASPScreening | null }): boolean {
  const screening = validScreening(i.screening);
  if (screening) return screening.rootDue && !announcementsShrinkCurrent({ events: i.events, currentRoot: i.currentRoot, screening });
  const info = infoOf(i.events);
  if (info.deposits.length === 0) return false;
  return i.currentRoot !== memo(info, "all-deposits-root", () => setRoot(info.deposits.map((d) => d.label)));
}

/** One pool as a withdrawal's publish decision reads it: its public events, its current root, its fresh screening block. */
export interface PoolForPublish {
  events: readonly PoolEvent[];
  currentRoot: bigint;
  screening?: ASPScreening | null;
}

/**
 * Some pool's fresh answer has announcements that alone shrink that pool's current root sharply
 * (announcementsShrinkCurrent). One status answer covers every network, so such an answer sends no publish request on
 * any of them (publishDueAcross), and the withdraw form then shows the current root's crowd. No label, no network.
 */
export function announcementsShrinkSome(pools: readonly PoolForPublish[]): boolean {
  return pools.some((p) => announcementsShrinkCurrent({ events: p.events, currentRoot: p.currentRoot, screening: validScreening(p.screening) }));
}

/**
 * Whether a private withdrawal, on any network, sends the one input-less publish request (it covers every network's
 * pool): publishDue holds for some pool, unless some pool's answer has announcements that alone shrink that pool's root
 * sharply (announcementsShrinkSome). Every withdrawal on every network decides the same, whichever deposit it spends.
 */
export function publishDueAcross(pools: readonly PoolForPublish[]): boolean {
  return !announcementsShrinkSome(pools) && pools.some((p) => publishDue(p));
}

// ─── wording ──────────────────────────────────────────────────────────────────

const UNITS: readonly [number, string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/** The inclusion delay in words: 0 → "right away", 3600 → "1 hour", 5400 → "1 hour 30 minutes" (two units at most). */
export function formatDelay(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "right away";
  const s = Math.floor(seconds);
  const k = UNITS.findIndex(([size]) => s >= size);
  const [size, name] = UNITS[k];
  const whole = Math.floor(s / size);
  const parts = [`${whole} ${name}${whole === 1 ? "" : "s"}`];
  const next = UNITS[k + 1];
  if (next) {
    const more = Math.floor((s - whole * size) / next[0]);
    if (more > 0) parts.push(`${more} ${next[1]}${more === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}
