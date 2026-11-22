/**
 * Phase 5, resilience: this browser's own RPC (client/src/privacy/rpcOverride.ts), the relayer list
 * (client/src/privacy/relayers.ts and server/privacy/relayerCors.ts) and the site's static pool snapshots
 * (shared/privacy/snapshot.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import superjson from "superjson";
import { computeScope } from "../../shared/privacy/context";
import { SNARK_SCALAR_FIELD } from "../../shared/privacy/constants";
import type { RelayerQuote } from "../../shared/privacy/api";
import { computeCommitment } from "../../shared/privacy/notes";
import { buildStateTree } from "../../shared/privacy/indexer";
import { encodeSnapshot, parseSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, snapshotPath, verifySnapshotAgainstChain, type PoolSnapshot, type TreeEvent } from "../../shared/privacy/snapshot";
import type { DepositedEvent, PoolEvent, RagequitEvent, WithdrawnEvent } from "../../shared/privacy/types";
import { probeRpc, resetRpcOverrideCache, rpcOverride, setRpcOverride, validateRpcUrl } from "../../client/src/privacy/rpcOverride";
import { relayerCors, relayerCorsEnabled } from "./relayerCors";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
  resetRpcOverrideCache();
});

// ─── this browser's own RPC ─────────────────────────────────────────────────

describe("a person's own RPC", () => {
  it("accepts https, and http only for this computer; refuses credentials, fragments and junk", () => {
    expect(validateRpcUrl("https://rpc.example/v2/KEY")).toEqual({ ok: true, url: "https://rpc.example/v2/KEY" });
    expect(validateRpcUrl("  http://127.0.0.1:8545 ").ok).toBe(true);
    expect(validateRpcUrl("http://localhost:8545").ok).toBe(true);
    expect(validateRpcUrl("http://rpc.example").ok).toBe(false);
    expect(validateRpcUrl("ws://rpc.example").ok).toBe(false);
    expect(validateRpcUrl("https://user:pass@rpc.example").ok).toBe(false);
    expect(validateRpcUrl("https://rpc.example/#x").ok).toBe(false);
    expect(validateRpcUrl("not a url").ok).toBe(false);
    expect(validateRpcUrl("").ok).toBe(false);
  });

  it("is set and cleared per network, and refuses an invalid URL", () => {
    resetRpcOverrideCache();
    expect(rpcOverride(46630)).toBeNull();
    setRpcOverride(46630, "https://mine.example/rpc");
    expect(rpcOverride(46630)).toBe("https://mine.example/rpc");
    expect(rpcOverride(31337)).toBeNull();
    expect(() => setRpcOverride(46630, "http://plain.example")).toThrow();
    expect(rpcOverride(46630)).toBe("https://mine.example/rpc");
    setRpcOverride(46630, null);
    expect(rpcOverride(46630)).toBeNull();
  });

  it("is checked with eth_chainId straight from the browser, without cookies or a referrer, and must be the right chain", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answer = (result: unknown) =>
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }) as unknown as typeof fetch;
    expect(await probeRpc("https://rpc.example", 46630, answer("0xb626"))).toMatchObject({ ok: true });
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.referrerPolicy).toBe("no-referrer");
    expect(calls[0].init.redirect).toBe("error");
    expect(JSON.parse(String(calls[0].init.body)).method).toBe("eth_chainId");
    const wrong = await probeRpc("https://rpc.example", 46630, answer("0x1"));
    expect(wrong.ok).toBe(false);
    const down = await probeRpc("https://rpc.example", 46630, (async () => {
      throw new TypeError("failed to fetch");
    }) as unknown as typeof fetch);
    expect(down.ok).toBe(false);
  });

  it("refuses this site's origin before probing, so an RPC URL cannot be sent to the Hylsia server", async () => {
    vi.stubGlobal("window", { location: { origin: "https://hylsia.example" } });
    const fetcher = vi.fn();
    expect(await probeRpc("https://hylsia.example/private-path?key=example", 46630, fetcher)).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("switches an existing public client directly to the chosen RPC, without cookies, referrers or redirects", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      const reply = (b: { id: number }) => ({ jsonrpc: "2.0", id: b.id, result: "0xb626" });
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    }));
    const { publicClientFor, rpcUrlFor } = await import("../../client/src/privacy/config");
    const client = publicClientFor(46630);
    setRpcOverride(46630, "https://independent.example/private-path?token=example");
    expect(await client.getChainId()).toBe(46630);
    setRpcOverride(46630, null);
    expect(await client.getChainId()).toBe(46630);
    expect(calls.map((c) => c.url)).toEqual(["https://independent.example/private-path?token=example", new URL(rpcUrlFor(46630)).toString()]);
    for (const { init } of calls) expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(client.chain?.rpcUrls.default.http).not.toContain("https://independent.example/private-path?token=example");
  });

  it("never reaches the server: no server code reads it, and it never enters a chain's rpcUrls", () => {
    for (const dir of ["server", "api"]) {
      const files = fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[];
      for (const f of files.filter((x) => /\.ts$/.test(x) && !/\.test\.ts$/.test(x))) {
        const text = read(dir, f);
        expect(text, `${dir}/${f}`).not.toMatch(/rpcOverride|hylsia\.pools\.rpc/);
      }
    }
    const config = read("client", "src", "privacy", "config.ts");
    expect(config).toMatch(/export function effectiveRpcUrl/);
    // the wallet's add-chain fallback reads rpcUrls.default: the person's RPC is never written there
    expect(config + read("client", "src", "privacy", "wagmi.ts")).not.toMatch(/rpcUrls\s*[:=][^\n]*rpcOverride|rpcUrls\s*[:=][^\n]*effectiveRpcUrl/);
    expect(read("client", "src", "privacy", "wagmi.ts")).toMatch(/rpcTransport\(network\.chainId\)/);
  });

  it("is a browser setting outside the vault's namespace, so Forget keeps it", () => {
    expect(read("client", "src", "privacy", "rpcOverride.ts")).toMatch(/RPC_OVERRIDE_KEY = "hylsia\.pools\.rpc\.v1"/);
    expect(read("client", "src", "privacy", "relayers.ts")).toMatch(/RELAYERS_KEY = "hylsia\.pools\.relayers\.v1"/);
  });
});

// ─── the relayer list ───────────────────────────────────────────────────────

describe("the relayer list", () => {
  it("calls only the chosen remote origin for quote and submit, without forwarding cookies or a referrer", async () => {
    const { remoteRelayerClient, addCustomRelayer, removeCustomRelayer, selectedRelayer } = await import("../../client/src/privacy/relayers");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const data = init.method === "POST" ? { chainId: CHAIN, txHash: HASH } : { quotes: [] };
      return Response.json({ result: { data: superjson.serialize(data) } });
    }));
    const first = addCustomRelayer("https://chosen.example");
    const chosen = selectedRelayer();
    const client = remoteRelayerClient(chosen.origin!);
    await client.privacy.relayer.quote.query();
    const second = addCustomRelayer("https://later.example");
    await client.privacy.relayer.submit.mutate({
      chainId: CHAIN,
      withdrawal: { recipient: ADDR, relayer: ADDR, fee: 0n, deadline: 123n },
      proof: { pA: [0n, 0n], pB: [[0n, 0n], [0n, 0n]], pC: [0n, 0n] },
      pubSignals: [0n, 0n, 0n, 0n, 0n, 0n],
    });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => new URL(c.url).origin)).toEqual([first, first]);
    for (const { init } of calls) expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    removeCustomRelayer(first);
    removeCustomRelayer(second);
  });

  it("rejects malformed quotes and an increased fee before a proof can be made", async () => {
    const { validRelayerQuote, checkedRelayerFee } = await import("../../client/src/privacy/relayers");
    const q: RelayerQuote = { chainId: CHAIN, pool: POOL, available: true, reason: null, relayer: ADDR, feeBps: 50, minFeeWei: "0", expiresAt: 2_000_000_000 };
    expect(checkedRelayerFee(q, 10_000n, 50n)).toBe(50n);
    expect(checkedRelayerFee({ ...q, feeBps: 25 }, 10_000n, 50n)).toBe(25n);
    expect(() => checkedRelayerFee({ ...q, feeBps: 100 }, 10_000n, 50n)).toThrow(/fee increased/);
    for (const bad of [{ feeBps: -1 }, { feeBps: 10_001 }, { feeBps: 0.5 }, { minFeeWei: "garbage" }, { minFeeWei: "-1" }, { relayer: "garbage" }, { expiresAt: NaN }]) {
      expect(validRelayerQuote({ ...q, ...bad } as RelayerQuote)).toBe(false);
      expect(() => checkedRelayerFee({ ...q, ...bad } as RelayerQuote, 10_000n)).toThrow(/invalid terms/);
    }
  });
  it("takes origins only, and drops the build's entries that do not parse", async () => {
    const { buildRelayers, parseRelayerOrigin } = await import("../../client/src/privacy/relayers");
    expect(parseRelayerOrigin("https://relayer.example")).toEqual({ ok: true, origin: "https://relayer.example" });
    expect(parseRelayerOrigin("https://relayer.example/api").ok).toBe(false);
    expect(parseRelayerOrigin("http://relayer.example").ok).toBe(false);
    expect(buildRelayers(" https://a.example , junk, https://a.example, https://b.example ").map((r) => r.id)).toEqual(["https://a.example", "https://b.example"]);
  });

  it("starts with this site, adds and removes the person's own, and falls back to this site", async () => {
    const r = await import("../../client/src/privacy/relayers");
    r.resetRelayerCache();
    expect(r.selectedRelayer().id).toBe(r.SELF_RELAYER_ID);
    expect(r.listRelayers()[0]).toMatchObject({ id: "self", origin: null });
    const o = r.addCustomRelayer("https://mine.example");
    expect(r.selectedRelayer().id).toBe(o);
    expect(() => r.selectRelayer("https://not-listed.example")).toThrow();
    r.removeCustomRelayer(o);
    expect(r.selectedRelayer().id).toBe("self");
  });

  it("one withdrawal asks its quote of, and submits to, the same relayer, chosen when it starts", () => {
    const provider = read("client", "src", "privacy", "PrivacyProvider.tsx");
    expect(provider).toMatch(/const relayerEntry = selectedRelayer\(\);/);
    expect(provider).toMatch(/api\.quotes\(relayerEntry\)/);
    expect(provider).toMatch(/api\.submit\(relayerEntry, /);
    // another relayer is called without cookies or a referrer, one call per request (no batch across origins)
    const relayers = read("client", "src", "privacy", "relayers.ts");
    expect(relayers).toMatch(/credentials: "omit", referrerPolicy: "no-referrer"/);
    expect(relayers).toMatch(/httpLink\(/);
    expect(relayers).not.toMatch(/httpBatchLink/);
  });
});

describe("cross-origin access to this server's relayer", () => {
  const run = (pathName: string, method = "GET", env: NodeJS.ProcessEnv = {}) => {
    const headers: Record<string, string> = {};
    let status = 0;
    let nexted = false;
    const res = {
      setHeader: (k: string, v: string) => (headers[k] = v),
      status: (s: number) => ((status = s), res),
      end: () => undefined,
    };
    relayerCors(env)({ path: pathName, method } as never, res as never, () => (nexted = true));
    return { headers, status, nexted };
  };

  it("answers any origin, without credentials, for the relayer's quote and submit only", () => {
    expect(run("/privacy.relayer.quote").headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(run("/privacy.relayer.submit", "POST").headers["Access-Control-Allow-Origin"]).toBe("*");
    const pre = run("/privacy.relayer.submit", "OPTIONS");
    expect(pre.status).toBe(204);
    expect(pre.nexted).toBe(false);
    expect(pre.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    for (const other of ["/privacy.asp.publish", "/privacy.pools", "/privacy.relayer.status", "/privacy.relayer.quote,privacy.pools"]) {
      const r = run(other);
      expect(r.headers["Access-Control-Allow-Origin"], other).toBeUndefined();
      expect(r.nexted).toBe(true);
    }
  });

  it("is off with PRIVACY_RELAYER_CORS=0, and mounted before tRPC in both server entries", () => {
    expect(relayerCorsEnabled({ PRIVACY_RELAYER_CORS: "0" })).toBe(false);
    expect(run("/privacy.relayer.quote", "GET", { PRIVACY_RELAYER_CORS: "0" }).headers["Access-Control-Allow-Origin"]).toBeUndefined();
    for (const f of [["server", "_core", "index.ts"], ["api", "index.ts"]]) {
      const text = read(...f);
      expect(text.indexOf('app.use("/api/trpc", relayerCors())'), f.join("/")).toBeGreaterThan(0);
      expect(text.indexOf('app.use("/api/trpc", relayerCors())')).toBeLessThan(text.indexOf("createExpressMiddleware({"));
    }
  });
});

// ─── static pool snapshots ──────────────────────────────────────────────────

const POOL = "0x00000000000000000000000000000000000000aa" as Address;
const CHAIN = 46630;
const DEPLOY = 100n;
const HASH = ("0x" + "11".repeat(32)) as Hex;
const ADDR = "0x00000000000000000000000000000000000000bb" as Address;

function deposit(i: number, block: bigint): DepositedEvent {
  const value = 10n ** 17n + BigInt(i);
  const label = 1000n + BigInt(i);
  const precommitment = 5000n + BigInt(i);
  return { kind: "deposit", depositor: ADDR, commitment: computeCommitment(value, label, precommitment), label, value, precommitment, leafIndex: i, blockNumber: block, txHash: HASH, logIndex: 0 };
}

function withdraw(i: number, block: bigint): WithdrawnEvent {
  return { kind: "withdraw", recipient: ADDR, relayer: ADDR, value: 1n, fee: 0n, spentNullifier: 77n + BigInt(i), newCommitment: 9000n + BigInt(i), leafIndex: i, blockNumber: block, txHash: HASH, logIndex: 1 };
}

function snapshot(events: TreeEvent[], over: Partial<PoolSnapshot> = {}): PoolSnapshot {
  const tree = buildStateTree(events as PoolEvent[]);
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    chainId: CHAIN,
    pool: POOL,
    deployBlock: DEPLOY,
    toBlock: 200n,
    toBlockHash: HASH,
    leafCount: tree.leaves.length,
    stateRoot: tree.root,
    createdAt: 1,
    events,
    ...over,
  };
}

const EXPECT = { chainId: CHAIN, pool: POOL, deployBlock: DEPLOY };

describe("the site's static pool snapshot", () => {
  const events: TreeEvent[] = [deposit(0, 110n), deposit(1, 120n), withdraw(2, 130n)];

  it("round-trips, and builds the stated tree", () => {
    const p = parseSnapshot(encodeSnapshot(snapshot(events)), EXPECT);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.snapshot.events).toEqual(events);
      expect(p.tree.root).toBe(buildStateTree(events as PoolEvent[]).root);
    }
  });

  it("is refused for another pool, chain or deploy block", () => {
    const text = encodeSnapshot(snapshot(events));
    expect(parseSnapshot(text, { ...EXPECT, chainId: 1 }).ok).toBe(false);
    expect(parseSnapshot(text, { ...EXPECT, pool: ADDR }).ok).toBe(false);
    expect(parseSnapshot(text, { ...EXPECT, deployBlock: 99n }).ok).toBe(false);
  });

  it("never carries a ragequit or a root, nor an event outside its range", () => {
    const rq: RagequitEvent = { kind: "ragequit", ragequitter: ADDR, commitment: 1n, label: 1n, value: 1n, blockNumber: 150n, txHash: HASH, logIndex: 2 };
    const bad = { ...snapshot(events), events: [...events, rq] } as unknown as PoolSnapshot;
    expect(parseSnapshot(encodeSnapshot(bad), EXPECT)).toMatchObject({ ok: false });
    const root = { kind: "asproot", root: 1n, cid: "x", blockNumber: 150n, txHash: HASH, logIndex: 3 };
    expect(parseSnapshot(encodeSnapshot({ ...snapshot(events), events: [...events, root] } as unknown as PoolSnapshot), EXPECT).ok).toBe(false);
    const late = [deposit(0, 110n), deposit(1, 250n)];
    expect(parseSnapshot(encodeSnapshot(snapshot(late)), EXPECT).ok).toBe(false);
  });

  it("refuses a deposit whose fields do not make its commitment, a gap, and a wrong stated root or count", () => {
    const forged = { ...deposit(1, 120n), value: 5n };
    expect(parseSnapshot(encodeSnapshot(snapshot([deposit(0, 110n), forged])), EXPECT)).toMatchObject({ ok: false, error: expect.stringMatching(/commitment/) });
    const gap = [deposit(0, 110n), deposit(2, 120n)];
    expect(parseSnapshot(encodeSnapshot({ ...snapshot([deposit(0, 110n)]), events: gap }), EXPECT).ok).toBe(false);
    expect(parseSnapshot(encodeSnapshot(snapshot(events, { stateRoot: 1n })), EXPECT).ok).toBe(false);
    expect(parseSnapshot(encodeSnapshot(snapshot(events, { leafCount: 2 })), EXPECT).ok).toBe(false);
    expect(parseSnapshot("not json", EXPECT).ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ format: SNAPSHOT_FORMAT, version: 2 }), EXPECT).ok).toBe(false);
  });

  it("is served at one input-less path per pool, and the device uses it only with a full scan after it", () => {
    expect(snapshotPath(CHAIN, POOL)).toBe(`/snapshots/46630-${POOL.toLowerCase()}.json`);
    const provider = read("client", "src", "privacy", "PrivacyProvider.tsx");
    // the snapshot's last block must be on this chain, and a snapshot copy is never cached as the device's history
    expect(provider).toMatch(/verifySnapshotAgainstChain\(snap, client, head\)/);
    expect(provider).toMatch(/if \(!snap\) saveJSON\(poolStorageKey\(ref, "events"\)/);
    expect(provider).toMatch(/historyVerified: !snap/);
    expect(provider).toMatch(/if \(bootstrapped \|\| snapFailed\) void syncPool\(ref, true\)/);
    expect(provider).toMatch(/if \(!p\.historyVerified\)/);
  });

  it("requires the exact checkpoint root, count, block hash, scope and chain; a failed historical read falls back", async () => {
    const s = snapshot(events);
    const verify = (changes: Record<string, unknown> = {}) => {
      const facts = { chainId: CHAIN, hash: HASH, getLastRoot: s.stateRoot, nextIndex: s.leafCount, SCOPE: computeScope(POOL, CHAIN), ...changes };
      const readContract = vi.fn(async (args: { functionName: string; blockNumber: bigint }) => {
        expect(args.blockNumber).toBe(s.toBlock);
        if (facts.fail) throw new Error("historical state unavailable");
        return facts[args.functionName as keyof typeof facts];
      });
      const client = { getChainId: async () => facts.chainId, getBlock: async () => ({ hash: facts.hash }), readContract } as unknown as PublicClient;
      return verifySnapshotAgainstChain(s, client, 201n);
    };
    expect(await verify()).toBe(true);
    for (const changed of [{ chainId: 1 }, { hash: "0x00" }, { getLastRoot: 123n }, { nextIndex: 0 }, { SCOPE: 0n }, { fail: true }]) expect(await verify(changed)).toBe(false);
    expect(await verifySnapshotAgainstChain(s, {} as PublicClient, 199n)).toBe(false);
  });

  it("rejects out-of-field values and unsafe indices instead of passing them to Poseidon", () => {
    for (const change of [{ label: SNARK_SCALAR_FIELD }, { precommitment: SNARK_SCALAR_FIELD }, { leafIndex: Number.MAX_SAFE_INTEGER + 1 }]) {
      const s = { ...snapshot(events), events: [{ ...events[0], ...change }, ...events.slice(1)] };
      expect(parseSnapshot(encodeSnapshot(s as PoolSnapshot), EXPECT).ok).toBe(false);
    }
  });

  it("the committed snapshot of the live pool checks out offline", async () => {
    const { DEPLOYMENTS } = await import("../../shared/privacy/deployments");
    const live = DEPLOYMENTS[CHAIN];
    if (!live) return;
    const file = path.join(ROOT, "client", "public", snapshotPath(CHAIN, live.pool).replace(/^\//, ""));
    if (!fs.existsSync(file)) return;
    const p = parseSnapshot(fs.readFileSync(file, "utf8"), { chainId: CHAIN, pool: live.pool, deployBlock: BigInt(live.deployBlock) });
    expect(p.ok).toBe(true);
  });
});
