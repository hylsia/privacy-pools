/**
 * A person's own RPC, per network (Phase 5, resilience). It is kept in this browser only and used for every chain
 * read the app makes in this browser: the device's event sync and contract reads (publicClientFor) and the wallet
 * config's transports (rpcTransport, config.ts and wagmi.ts).
 *
 * It never reaches the Hylsia server:
 *   - no request to the server carries it (the server's procedures have no field for it);
 *   - it never enters a chain object's rpcUrls (wagmi's add-chain fallback hands those to the wallet);
 *   - the dashboard's own figures (privacy.pools and friends) still come from the server, which reads the chain
 *     through its own RPC.
 * The wallet keeps its own RPC for the transactions it sends.
 *
 * The key lives outside `hylsia.pp.`, so "Forget vault" keeps it, as it keeps the theme: it is a setting of this
 * browser, not of a vault.
 *
 * Imports nothing from config.ts (which imports this module).
 */

export const RPC_OVERRIDE_KEY = "hylsia.pools.rpc.v1";

type Overrides = Record<string, string>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An RPC URL a person typed, checked: https (http only for this computer), no user:password part, no fragment. */
export function validateRpcUrl(text: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { ok: false, error: "Enter the RPC's URL." };
  if (raw.length > 2048) return { ok: false, error: "That URL is too long." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "That is not a URL (it should start with https://)." };
  }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    return { ok: false, error: "Use an https:// URL (http:// only for an RPC on this computer)." };
  }
  if (u.username || u.password) return { ok: false, error: "Put no user name or password in the URL (an API key in the path is fine)." };
  if (u.hash) return { ok: false, error: "Remove the part after #." };
  if (typeof window !== "undefined" && u.origin === window.location.origin) {
    return { ok: false, error: "Use an independent RPC, outside this site's origin." };
  }
  return { ok: true, url: u.toString() };
}

let cache: Overrides | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load(): Overrides {
  if (cache) return cache;
  const out: Overrides = {};
  try {
    const raw = storage()?.getItem(RPC_OVERRIDE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [chainId, url] of Object.entries(parsed as Record<string, unknown>)) {
        // a stored value is checked again: a hand-edited or older entry that no longer passes is ignored
        if (/^\d+$/.test(chainId) && typeof url === "string") {
          const v = validateRpcUrl(url);
          if (v.ok) out[chainId] = v.url;
        }
      }
    }
  } catch {
    /* unreadable: no override */
  }
  cache = out;
  return out;
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a listener's error is its own */
    }
  }
}

// another tab of this site changed the setting
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === RPC_OVERRIDE_KEY || e.key === null) {
      cache = null;
      notify();
    }
  });
}

/** This browser's own RPC for a network, or null (the build's RPC is used). */
export function rpcOverride(chainId: number): string | null {
  return load()[String(chainId)] ?? null;
}

/** Set (a URL that passes validateRpcUrl) or clear (null) this browser's RPC for a network. */
export function setRpcOverride(chainId: number, url: string | null): void {
  const next: Overrides = { ...load() };
  if (url === null) delete next[String(chainId)];
  else {
    const v = validateRpcUrl(url);
    if (!v.ok) throw new Error(v.error);
    next[String(chainId)] = v.url;
  }
  try {
    const s = storage();
    if (Object.keys(next).length === 0) s?.removeItem(RPC_OVERRIDE_KEY);
    else s?.setItem(RPC_OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the setting lasts until the page reloads */
  }
  cache = next;
  notify();
}

/** Called after every change (this tab's or another's); returns the unsubscribe. */
export function subscribeRpcOverrides(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For tests: drop the in-memory copy so the next read goes to storage again. */
export function resetRpcOverrideCache(): void {
  cache = null;
}

/**
 * Ask an RPC for its chain id, straight from this browser (no cookies, no referrer): whether it answers at all, and
 * for the right network. Sends nothing anywhere else.
 */
export async function probeRpc(
  url: string,
  chainId: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const v = validateRpcUrl(url);
  if (!v.ok) return v;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const started = Date.now();
  try {
    const res = await fetchImpl(v.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: ctrl?.signal,
    });
    if (!res.ok) return { ok: false, error: `The RPC answered with HTTP ${res.status}.` };
    const body = (await res.json()) as { result?: unknown };
    const id = typeof body?.result === "string" && /^0x[0-9a-fA-F]+$/.test(body.result) ? Number(BigInt(body.result)) : null;
    if (id === null) return { ok: false, error: "The RPC gave no chain id." };
    if (id !== chainId) return { ok: false, error: `That RPC serves chain ${id}, not chain ${chainId}.` };
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return { ok: false, error: aborted ? "The RPC did not answer in time." : "The RPC could not be reached from this browser (offline, or it does not allow requests from websites)." };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
