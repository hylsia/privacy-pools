/**
 * The operator's exclusion list for the association-set publisher (screening policy v1, shared/privacy/screening.ts).
 *
 * Where it comes from (server/privacy/config.ts reads the environment; this module never does):
 *   - PRIVACY_ASP_EXCLUSIONS_FILE: a JSON file on the server (a relative path is resolved against the repository root,
 *     never the working directory). The live file, config/asp-exclusions.json, is git-ignored: it may hold notes.
 *   - PRIVACY_ASP_EXCLUSIONS_JSON: the same JSON inline, for serverless hosting where no file ships with the code.
 *     Notes are refused there (an environment value is easy to print by mistake).
 *   - neither: no exclusions; every eligible deposit joins.
 * Setting both is a configuration error.
 *
 * States: "none" (nothing configured), "ok" (the list in force) and "invalid" (missing, unreadable or malformed). An
 * invalid list fails closed: the publisher posts nothing on any network (publishing without the list could re-admit an
 * excluded deposit), while the last good list read in this process is kept for display and for the relayer's check.
 *
 * The file is read at most once a second and parsed again only when its content changes. Every change is logged once,
 * and an invalid list is logged again every 10 minutes while it stays invalid. Logs and errors name the entry number
 * and the field only: never a label, an address, a reason's note or a value from the file (parseExclusionFile).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { parseExclusionFile, type ExclusionEntry } from "../../shared/privacy/screening";

/** Where the list comes from, as server/privacy/config.ts resolved it. */
export type ExclusionSource =
  | { kind: "none" }
  /** `path` is absolute; `display` is the value as written in PRIVACY_ASP_EXCLUSIONS_FILE */
  | { kind: "file"; path: string; display: string }
  /** PRIVACY_ASP_EXCLUSIONS_JSON (never printed) */
  | { kind: "inline"; text: string }
  /** a configuration error that fails closed (both variables set) */
  | { kind: "error"; error: string };

export interface ExclusionsState {
  /** none: no list configured; ok: the list in force; invalid: publishing is paused (the last good list is kept) */
  status: "none" | "ok" | "invalid";
  /** the entries in force; while invalid, the last good list read in this process ([] when there is none) */
  entries: readonly ExclusionEntry[];
  /** changes whenever `entries` or `status` change (memo keys) */
  version: number;
  /** sha256 of the text read; null when nothing was read */
  hash: string | null;
  /** why it is invalid (entry number and field only); null otherwise */
  error: string | null;
  /** the parser's warnings (entry numbers only) */
  warnings: readonly string[];
  /** for messages: the file as configured, "PRIVACY_ASP_EXCLUSIONS_JSON", or null */
  where: string | null;
  /**
   * when the list in force last changed (ms): a file's modification time (never later than when it was read), 0 for an
   * inline list or none (they change only with a restart), the first read for a failure. The settle rule counts from
   * it: a root that admits a deposit an earlier list excluded, and the auto-publisher's immediate tick, wait until the
   * list is 30 s old.
   */
  changedAt: number;
  /**
   * the entries of the last list before this one that stayed unchanged for 30 s (null: none seen in this process): while
   * this list is younger than 30 s, a root that admits a deposit that list excluded waits (asp.ts)
   */
  previousSettled: readonly ExclusionEntry[] | null;
}

/** A file is read at most this often. */
const READ_EVERY_MS = 1_000;
/**
 * A changed list must stay the same this long before it triggers a tick (server/privacy/autoPublish.ts) or before a
 * root that admits an excluded deposit again goes out (server/privacy/asp.ts): a half-saved edit never posts.
 */
export const EXCLUSIONS_SETTLE_SECONDS = 30;
/** An invalid list is logged again this often while it stays invalid. */
const REPEAT_INVALID_MS = 10 * 60_000;

interface Cache {
  key: string;
  state: ExclusionsState;
  readAt: number;
  /** the identity of the content: its hash, or the failure */
  contentKey: string;
  lastGood: readonly ExclusionEntry[];
  /** Date.now() of the last line logged about this source */
  loggedAt: number;
}

let cache: Cache | null = null;
let versions = 0;

function sourceKey(source: ExclusionSource): string {
  switch (source.kind) {
    case "none":
      return "none";
    case "file":
      return `file:${source.path}`;
    case "inline":
      return `inline:${sha256(source.text)}`;
    case "error":
      return `error:${source.error}`;
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function where(source: ExclusionSource): string | null {
  return source.kind === "file" ? source.display : source.kind === "inline" ? "PRIVACY_ASP_EXCLUSIONS_JSON" : null;
}

/** Why a file could not be read, by error code only (a message can quote the path or more). */
function readFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return "the file does not exist";
  if (code === "EISDIR") return "the path is a folder, not a file";
  if (code === "EACCES" || code === "EPERM") return "the file cannot be read (permission denied)";
  return `the file cannot be read${typeof code === "string" ? ` (${code})` : ""}`;
}

type Read = { ok: true; text: string; mtimeMs: number | null } | { ok: false; error: string };

function readSource(source: ExclusionSource): Read | null {
  switch (source.kind) {
    case "none":
      return null;
    case "error":
      return { ok: false, error: source.error };
    case "inline":
      return { ok: true, text: source.text, mtimeMs: null };
    case "file":
      try {
        const { mtimeMs } = fs.statSync(source.path);
        return { ok: true, text: fs.readFileSync(source.path, "utf8"), mtimeMs };
      } catch (err) {
        return { ok: false, error: readFailure(err) };
      }
  }
}

function describe(state: ExclusionsState, lastGoodCount: number): { line: string; warn: boolean } {
  if (state.status === "none") return { line: "[privacy] exclusion list: none configured (PRIVACY_ASP_EXCLUSIONS_FILE is unset): no deposit is excluded", warn: false };
  if (state.status === "ok") {
    const n = state.entries.length;
    const w = state.warnings.length > 0 ? `; ${state.warnings.join("; ")}` : "";
    return { line: `[privacy] exclusion list (${state.where}): ${n} ${n === 1 ? "entry" : "entries"}${w}`, warn: false };
  }
  const kept = lastGoodCount > 0 ? ` The last good list (${lastGoodCount} ${lastGoodCount === 1 ? "entry" : "entries"}) is still shown.` : "";
  return {
    line: `[privacy] exclusion list${state.where ? ` (${state.where})` : ""} is invalid: ${state.error}. Publishing association-set roots is paused on every network until it is fixed.${kept}`,
    warn: true,
  };
}

export interface ReadExclusionsOptions {
  /** clock (tests) */
  now?: number;
  /** read the file now, whatever the last read */
  force?: boolean;
  /**
   * print the state line through this logger now, changed or not (the boot summary); without it a line goes to
   * console.log (console.warn while invalid) on a change only
   */
  log?: (line: string) => void;
}

/**
 * The exclusion list from `source`: read at most once a second, parsed again only when the content changes. Never
 * throws. Logs one line per change (the first read of a configured list counts as one; "none" is silent), and every
 * 10 minutes while the list stays invalid.
 */
export function readExclusions(source: ExclusionSource, o: ReadExclusionsOptions = {}): ExclusionsState {
  const now = o.now ?? Date.now();
  const key = sourceKey(source);
  if (cache && cache.key === key && !o.force && now - cache.readAt < READ_EVERY_MS) {
    if (o.log) o.log(describe(cache.state, cache.lastGood.length).line);
    return cache.state;
  }
  const prev = cache && cache.key === key ? cache : null;

  const read = readSource(source);
  const contentKey = read === null ? "none" : read.ok ? `text:${sha256(read.text)}` : `fail:${read.error}`;
  let state: ExclusionsState;
  let lastGood = prev?.lastGood ?? [];
  if (prev && prev.contentKey === contentKey) {
    state = prev.state;
  } else {
    // a file counts from its own modification time (a new process, the CLI included, sees a settled list as settled)
    const changedAt = read === null || source.kind === "inline" ? 0 : read.ok && read.mtimeMs !== null ? Math.min(now, read.mtimeMs) : now;
    // the list this one replaces had settled if it stayed unchanged for 30 s before this one appeared
    const before = prev?.state ?? null;
    const previousSettled =
      before === null
        ? null
        : before.status !== "invalid" && changedAt - before.changedAt >= EXCLUSIONS_SETTLE_SECONDS * 1000
          ? before.entries
          : before.previousSettled;
    const base = { version: ++versions, where: where(source), changedAt, previousSettled };
    if (read === null) {
      state = { ...base, status: "none", entries: [], hash: null, error: null, warnings: [] };
      lastGood = [];
    } else if (!read.ok) {
      state = { ...base, status: "invalid", entries: lastGood, hash: null, error: read.error, warnings: [] };
    } else {
      const parsed = parseExclusionFile(read.text, { notes: source.kind === "inline" ? "reject" : "allow" });
      const hash = sha256(read.text);
      if (parsed.ok) {
        state = { ...base, status: "ok", entries: Object.freeze(parsed.entries), hash, error: null, warnings: Object.freeze(parsed.warnings) };
        lastGood = state.entries;
      } else {
        state = { ...base, status: "invalid", entries: lastGood, hash, error: parsed.error, warnings: [] };
      }
    }
  }

  const next: Cache = { key, state, readAt: now, contentKey, lastGood, loggedAt: prev?.loggedAt ?? 0 };
  const changed = prev ? prev.contentKey !== contentKey : state.status !== "none";
  const repeat = state.status === "invalid" && now - next.loggedAt >= REPEAT_INVALID_MS;
  if (o.log || changed || repeat) {
    const { line, warn } = describe(state, lastGood.length);
    if (o.log) o.log(line);
    else if (warn) console.warn(line);
    else console.log(line);
    next.loggedAt = now;
  }
  cache = next;
  return state;
}

/** The list currently cached for `source` (no read, no log); null before the first read. */
export function cachedExclusions(source: ExclusionSource): ExclusionsState | null {
  return cache && cache.key === sourceKey(source) ? cache.state : null;
}

/** test hook (resetASPCache calls it): forget the list read, its log state and its versions */
export function resetExclusionsCache(): void {
  cache = null;
}
