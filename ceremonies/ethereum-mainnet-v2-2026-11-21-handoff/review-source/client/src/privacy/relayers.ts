/**
 * The relayer list (Phase 5, resilience). A private withdrawal is sent through one relayer; if this site's relayer is
 * down or unfunded, the person can pick another.
 *
 *   - "This site": the Hylsia server that serves this page (same origin, the default).
 *   - The build's list: VITE_PRIVACY_RELAYERS, a comma-separated list of other Hylsia relayers' origins
 *     (https://relayer.example). Every VITE_ value is public in the bundle.
 *   - The person's own: origins added in Connection settings, kept in this browser only.
 *
 * A relayer is another Hylsia server: the same privacy.relayer.quote (input-less) and privacy.relayer.submit, at
 * <origin>/api/trpc. The app talks to the CHOSEN relayer only: its quote and the withdrawal's submit go there, and
 * nowhere else; checking another relayer's quote happens only when the person opens the list. No request carries the
 * vault, a note or a label beyond what submit inherently carries (the proof's public signals, public on-chain seconds
 * later). The quote binds the relayer's address and fee into the proof, so a relayer cannot take more than its quote.
 * Requests to another origin go without cookies and without a referrer.
 *
 * The choice and the person's own list live outside `hylsia.pp.`, so "Forget vault" keeps them (a browser setting).
 */
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import { isAddress, zeroAddress } from "viem";
import type { RelayerQuote } from "@shared/privacy/api";
import { validateRpcUrl } from "./rpcOverride";

export const RELAYERS_KEY = "hylsia.pools.relayers.v1";
export const SELF_RELAYER_ID = "self";

/** Quotes from another operator are untrusted input, including strings later passed to BigInt in the form. */
export function validRelayerQuote(q: RelayerQuote): boolean {
  return !!q && q.available === true && typeof q.relayer === "string" && isAddress(q.relayer) && q.relayer !== zeroAddress
    && Number.isSafeInteger(q.feeBps) && q.feeBps >= 0 && q.feeBps <= 10_000
    && typeof q.minFeeWei === "string" && /^(0|[1-9]\d{0,38})$/.test(q.minFeeWei)
    && Number.isSafeInteger(q.expiresAt) && q.expiresAt > 0;
}

/** Stop before proving if a new quote would charge more than the form showed when Withdraw was clicked. */
export function checkedRelayerFee(q: RelayerQuote, amount: bigint, maximum?: bigint): bigint {
  if (!validRelayerQuote(q)) throw new Error("The relayer returned invalid terms. Nothing was sent.");
  const pct = amount * BigInt(q.feeBps) / 10_000n;
  const fee = pct > BigInt(q.minFeeWei) ? pct : BigInt(q.minFeeWei);
  if (maximum !== undefined && fee > maximum) throw new Error("The relayer fee increased. Review the new quote before trying again. Nothing was sent.");
  if (fee >= amount) throw new Error("Amount is too small to cover the relayer fee");
  return fee;
}

export interface RelayerEntry {
  /** "self", or the relayer's origin */
  id: string;
  /** null for this site (same origin) */
  origin: string | null;
  label: string;
  source: "self" | "build" | "custom";
}

/** An origin a person or a build gave for a relayer: https (http only for this computer), nothing after the host. */
export function parseRelayerOrigin(text: string): { ok: true; origin: string } | { ok: false; error: string } {
  const v = validateRpcUrl(text);
  if (!v.ok) return { ok: false, error: v.error.replace("RPC's", "relayer's") };
  const u = new URL(v.url);
  if ((u.pathname !== "/" && u.pathname !== "") || u.search) {
    return { ok: false, error: "Give the relayer's address only, like https://relayer.example (no path)." };
  }
  if (typeof window !== "undefined" && u.origin === window.location.origin) return { ok: false, error: "That is this site, which is already listed." };
  return { ok: true, origin: u.origin };
}

/** VITE_PRIVACY_RELAYERS: the build's other relayers; an entry that does not parse is left out. */
export function buildRelayers(raw: string | undefined): RelayerEntry[] {
  const out: RelayerEntry[] = [];
  for (const part of (raw ?? "").split(",")) {
    if (!part.trim()) continue;
    const p = parseRelayerOrigin(part);
    if (p.ok && !out.some((r) => r.id === p.origin)) out.push({ id: p.origin, origin: p.origin, label: new URL(p.origin).host, source: "build" });
  }
  return out;
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const SELF: RelayerEntry = { id: SELF_RELAYER_ID, origin: null, label: "This site", source: "self" };
const BUILD = buildRelayers(env.VITE_PRIVACY_RELAYERS);

interface Stored {
  custom: string[];
  selected: string;
}

let cache: Stored | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(): Stored {
  if (cache) return cache;
  let custom: string[] = [];
  let selected = SELF_RELAYER_ID;
  try {
    const raw = storage()?.getItem(RELAYERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    if (parsed && Array.isArray(parsed.custom)) {
      custom = parsed.custom.flatMap((c) => {
        const p = typeof c === "string" ? parseRelayerOrigin(c) : null;
        return p?.ok ? [p.origin] : [];
      });
    }
    if (parsed && typeof parsed.selected === "string") selected = parsed.selected;
  } catch {
    /* unreadable: the defaults */
  }
  cache = { custom: [...new Set(custom)], selected };
  return cache;
}

function save(next: Stored) {
  try {
    storage()?.setItem(RELAYERS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: lasts until the page reloads */
  }
  cache = next;
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === RELAYERS_KEY || e.key === null) {
      cache = null;
      for (const fn of listeners) fn();
    }
  });
}

/** Every relayer the person can pick: this site, the build's, then their own. */
export function listRelayers(): RelayerEntry[] {
  const own = load().custom.filter((o) => !BUILD.some((b) => b.id === o));
  return [SELF, ...BUILD, ...own.map((o): RelayerEntry => ({ id: o, origin: o, label: new URL(o).host, source: "custom" }))];
}

/** The relayer withdrawals go through; an unknown stored choice falls back to this site. */
export function selectedRelayer(): RelayerEntry {
  const id = load().selected;
  return listRelayers().find((r) => r.id === id) ?? SELF;
}

export function selectRelayer(id: string): void {
  if (!listRelayers().some((r) => r.id === id)) throw new Error("That relayer is not in the list");
  save({ ...load(), selected: id });
}

/** Add one of the person's own relayers (and pick it). Returns the origin. */
export function addCustomRelayer(text: string): string {
  const p = parseRelayerOrigin(text);
  if (!p.ok) throw new Error(p.error);
  const s = load();
  save({ custom: [...new Set([...s.custom, p.origin])], selected: p.origin });
  return p.origin;
}

export function removeCustomRelayer(origin: string): void {
  const s = load();
  save({ custom: s.custom.filter((o) => o !== origin), selected: s.selected === origin ? SELF_RELAYER_ID : s.selected });
}

export function subscribeRelayers(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For tests. */
export function resetRelayerCache(): void {
  cache = null;
}

const remote = new Map<string, TRPCClient<AppRouter>>();

/**
 * A tRPC client for another relayer: one request per call (no batching across origins), no cookies, no referrer.
 * This site's own relayer goes through the app's usual client instead (relayerCall in PrivacyProvider).
 */
export function remoteRelayerClient(origin: string): TRPCClient<AppRouter> {
  let c = remote.get(origin);
  if (!c) {
    c = createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: `${origin}/api/trpc`,
          transformer: superjson,
          fetch: (input, init) => globalThis.fetch(input, { ...(init ?? {}), credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" }),
        }),
      ],
    });
    remote.set(origin, c);
  }
  return c;
}
