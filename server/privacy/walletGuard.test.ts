/**
 * client/src/privacy/walletGuard.ts: the two rules the privacy area's wallet config (client/src/privacy/wagmi.ts)
 * enforces below every component.
 *   1. A read that carries the wallet's address goes to the active network's RPC only, and a network without a pool
 *      gets no request (RainbowKit's account window read the balance on the wallet's own network).
 *   2. The stored wallet connection never names a network (it showed the network of the last wallet-signed operation
 *      on a locked or forgotten device).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connect, createConfig, createStorage, deserialize, getAccount, mock, serialize, switchChain } from "@wagmi/core";
import { createPublicClient, custom, type Address } from "viem";
import { anvilB, robinhoodTestnet } from "../../shared/privacy/chains";
import {
  ACCOUNT_READS,
  guardTransport,
  isWalletReadRefusal,
  setWalletReadChain,
  transportRefusal,
  walletReadChain,
  WalletReadRefusedError,
  withoutWalletChain,
} from "../../client/src/privacy/walletGuard";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

/** An RPC that records what reaches it. */
function recordingTransport() {
  const seen: string[] = [];
  const transport = custom({
    request: async ({ method }: { method: string }) => {
      seen.push(method);
      if (method === "eth_chainId") return "0xb626";
      return "0x1";
    },
  });
  return { transport, seen };
}

afterEach(() => setWalletReadChain(null));

describe("transportRefusal", () => {
  it("lets a wallet read through on the active network only", () => {
    const base = { chainId: 31338, name: "Local chain B", hasPool: true };
    expect(transportRefusal({ ...base, method: "eth_getBalance", activeChainId: 31338 })).toBeNull();
    expect(transportRefusal({ ...base, method: "eth_getBalance", activeChainId: 46630 })).toBe(
      "The wallet's address is read only on the network the vault acts on, not on Local chain B.",
    );
    expect(transportRefusal({ ...base, method: "eth_getBalance", activeChainId: null })).not.toBeNull();
    for (const method of ACCOUNT_READS) expect(transportRefusal({ ...base, method, activeChainId: 46630 })).not.toBeNull();
    // public pool data is not the wallet's: it may be read on any network that has a pool
    expect(transportRefusal({ ...base, method: "eth_blockNumber", activeChainId: 46630 })).toBeNull();
    expect(transportRefusal({ ...base, method: "eth_call", activeChainId: 46630 })).toBeNull();
  });

  it("refuses every request to a network without a pool", () => {
    const pending = { chainId: 31338, name: "Local chain B", hasPool: false };
    expect(transportRefusal({ ...pending, method: "eth_blockNumber", activeChainId: 46630 })).toBe(
      "Nothing is read from Local chain B: this build has no pool there.",
    );
    expect(transportRefusal({ ...pending, method: "eth_getBalance", activeChainId: 31338 })).not.toBeNull();
  });
});

describe("guardTransport", () => {
  it("a balance read on another network than the active one never reaches its RPC", async () => {
    const sep = recordingTransport();
    const client = createPublicClient({
      chain: anvilB,
      transport: guardTransport({ chainId: 31338, name: "Local chain B", hasPool: true }, sep.transport),
    });
    setWalletReadChain(46630); // the vault acts on Robinhood Chain Testnet; the wallet sits on Local chain B
    const refused = await client.getBalance({ address: WALLET }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(WalletReadRefusedError);
    expect(isWalletReadRefusal(refused)).toBe(true);
    expect(sep.seen).toEqual([]);
    // public reads still go out
    await client.getBlockNumber();
    expect(sep.seen).toEqual(["eth_blockNumber"]);

    // once Local chain B is the active network, its balance read goes to its own RPC
    setWalletReadChain(31338);
    expect(walletReadChain()).toBe(31338);
    await expect(client.getBalance({ address: WALLET })).resolves.toBe(1n);
    expect(sep.seen).toEqual(["eth_blockNumber", "eth_getBalance"]);
  });

  it("a network without a pool gets no request at all", async () => {
    const sep = recordingTransport();
    const client = createPublicClient({
      chain: anvilB,
      transport: guardTransport({ chainId: 31338, name: "Local chain B", hasPool: false }, sep.transport),
    });
    setWalletReadChain(31338);
    await expect(client.getBlockNumber()).rejects.toBeInstanceOf(WalletReadRefusedError);
    await expect(client.getBalance({ address: WALLET })).rejects.toBeInstanceOf(WalletReadRefusedError);
    expect(sep.seen).toEqual([]);
  });

  it("is recognised inside a wrapping error's cause chain (the query logger skips it)", () => {
    const inner = new WalletReadRefusedError("x");
    expect(isWalletReadRefusal({ name: "BalanceError", cause: { cause: inner } })).toBe(true);
    expect(isWalletReadRefusal(new Error("HTTP request failed"))).toBe(false);
    expect(isWalletReadRefusal(null)).toBe(false);
  });

  it("the privacy area's wallet config puts every transport behind it, and the stored connection through the scrub", () => {
    const text = fs.readFileSync(path.join(ROOT, "client", "src", "privacy", "wagmi.ts"), "utf8");
    // rpcTransport: the build's RPC, or the person's own (rpcOverride.ts), still behind the guard
    expect(text).toMatch(/guardTransport\(\{ chainId: network\.chainId, name: network\.name, hasPool: pool !== null \}, rpcTransport\(network\.chainId\)\)/);
    expect(text).toMatch(/serialize: \(value\) => serialize\(withoutWalletChain\(value, NEUTRAL_CHAIN_ID\)\)/);
    const provider = fs.readFileSync(path.join(ROOT, "client", "src", "privacy", "PrivacyProvider.tsx"), "utf8");
    expect(provider).toMatch(/setWalletReadChain\(activePool\?\.chainId \?\? null\)/);
  });
});

describe("withoutWalletChain (the stored wallet connection)", () => {
  const persisted = {
    state: {
      connections: {
        __type: "Map",
        value: [["uid-1", { accounts: [WALLET], chainId: 31338, connector: { id: "metaMask", name: "MetaMask", type: "injected", uid: "uid-1" } }]],
      },
      chainId: 31338,
      current: "uid-1",
    },
    version: 2,
  };

  it("keeps the connector and the account, with every chain id the neutral one", () => {
    expect(withoutWalletChain(persisted, 46630)).toEqual({
      state: {
        connections: {
          __type: "Map",
          value: [["uid-1", { accounts: [WALLET], chainId: 46630, connector: { id: "metaMask", name: "MetaMask", type: "injected", uid: "uid-1" } }]],
        },
        chainId: 46630,
        current: "uid-1",
      },
      version: 2,
    });
    expect(persisted.state.chainId).toBe(31338); // input untouched
    // anything else wagmi stores passes through
    expect(withoutWalletChain("metaMask", 46630)).toBe("metaMask");
    expect(withoutWalletChain(true, 46630)).toBe(true);
    expect(withoutWalletChain(null, 46630)).toBeNull();
  });

  it("with wagmi itself: after a connect and a switch to another network, the stored text never names it", async () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    };
    const config = createConfig({
      chains: [robinhoodTestnet, anvilB],
      connectors: [mock({ accounts: [WALLET] })],
      transports: { [robinhoodTestnet.id]: recordingTransport().transport, [anvilB.id]: recordingTransport().transport },
      storage: createStorage({ key: "hylsia.pools.wagmi", storage, serialize: (v) => serialize(withoutWalletChain(v, robinhoodTestnet.id)) }),
    });
    await connect(config, { connector: config.connectors[0], chainId: anvilB.id });
    await switchChain(config, { chainId: anvilB.id });
    expect(getAccount(config).chainId).toBe(anvilB.id); // in memory, the live chain
    await new Promise((r) => setTimeout(r, 0));
    const text = stored.get("hylsia.pools.wagmi.store");
    expect(text).toBeDefined();
    expect(text).not.toContain(String(anvilB.id));
    // (wagmi's deserialize gives the connections back as a Map)
    const saved = deserialize(text!) as { state: { chainId: number; connections: Map<string, { chainId: number; accounts: string[] }> } };
    expect(saved.state.chainId).toBe(robinhoodTestnet.id);
    expect([...saved.state.connections.values()].map((c) => [c.chainId, c.accounts])).toEqual([[robinhoodTestnet.id, [WALLET]]]);
  });
});
