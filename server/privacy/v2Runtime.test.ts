import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type PublicClient } from "viem";
import { protocolRuntime } from "../../shared/privacy/runtime";
import {
  PROTOCOL_VERSION,
  SNARK_SCALAR_FIELD,
} from "../../shared/privacy/constants";
import { V2_PROTOCOL } from "../../shared/privacy/protocols";
import { computeScope } from "../../shared/privacy/context";
import { fetchPoolEvents } from "../../shared/privacy/indexer";
import { resolveNetworks } from "../../shared/privacy/networks";
import { V2_DEV_KEY_PINS } from "../../shared/privacy/v2/devKeyPins";

const pool = "0x1111111111111111111111111111111111111111" as Address;
const fixture = JSON.parse(
  fs.readFileSync("contracts/test/fixtures/v2/pool.json", "utf8")
);
const seed = toBytes(keccak256(toBytes("hylsia-v2-test-seed")));
const events = fixture.events.map((event: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value,
    ])
  )
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("v2 runtime integration", () => {
  it("prepares random-nonce deposits and follows v2 change derivation independently of display indices", () => {
    const runtime = protocolRuntime(V2_PROTOCOL);
    const keys = runtime.deriveMasterKeys(seed);
    const prepared = runtime.prepareDeposit(keys, BigInt(fixture.scope), -1);
    expect(prepared.recoveryNonce).toBeGreaterThan(0n);
    const notes = runtime.discover(keys, BigInt(fixture.scope), events).notes;
    expect(notes).toHaveLength(7);
    expect(notes[0].recoveryNonce).toBeDefined();
    expect(runtime.nextSecrets(keys, BigInt(fixture.scope), notes[0])).toEqual({
      nullifier: notes[1].nullifier,
      secret: notes[1].secret,
    });
    expect(() =>
      protocolRuntime(PROTOCOL_VERSION).nextSecrets(
        keys,
        BigInt(fixture.scope),
        notes[0]
      )
    ).toThrow("v2 note");
  });
  it("refuses mixed protocol event histories instead of guessing their derivation", () => {
    const v2 = protocolRuntime(V2_PROTOCOL);
    const v1 = protocolRuntime(PROTOCOL_VERSION);
    expect(() =>
      v1.discover(v1.deriveMasterKeys(seed), BigInt(fixture.scope), events)
    ).toThrow("v2 events");
    const legacy = events
      .filter((e: any) => e.kind === "deposit")
      .map(({ recoveryNonce: _, ...event }: any) => event);
    expect(() =>
      v2.discover(v2.deriveMasterKeys(seed), BigInt(fixture.scope), legacy)
    ).toThrow("missing recovery nonces");
  });
  it("decodes v2 recovery nonces and uses the distinct v2 deposit event topic layout", async () => {
    const deposit = events[0];
    const getLogs = vi.fn(async () => [
      {
        eventName: "Deposited",
        args: deposit,
        blockNumber: 1n,
        transactionHash: deposit.txHash,
        logIndex: 0,
      },
    ]);
    const client = { getLogs } as unknown as PublicClient;
    const fetched = await fetchPoolEvents(client, pool, 0n, 1n, {
      protocol: V2_PROTOCOL,
    });
    expect(fetched[0]).toMatchObject({
      kind: "deposit",
      recoveryNonce: deposit.recoveryNonce,
    });
    expect(
      getLogs.mock.calls[0][0].events
        .find((e: any) => e.name === "Deposited")
        .inputs.some((i: any) => i.name === "recoveryNonce")
    ).toBe(true);
  });
  it("rejects invalid/missing nonces before admitting v2 events", async () => {
    for (const recoveryNonce of [undefined, 0n, SNARK_SCALAR_FIELD]) {
      const deposit = { ...events[0], recoveryNonce };
      const client = {
        getLogs: vi.fn(async () => [
          {
            eventName: "Deposited",
            args: deposit,
            blockNumber: 1n,
            transactionHash: deposit.txHash,
            logIndex: 0,
          },
        ]),
      } as unknown as PublicClient;
      await expect(
        fetchPoolEvents(client, pool, 0n, 1n, { protocol: V2_PROTOCOL })
      ).rejects.toThrow("invalid recovery nonce");
    }
  });
  it("makes v2 opt-in on local loopback chains while keeping public deployment blocked", () => {
    const config = (chainId: number, rpc?: string) =>
      resolveNetworks(
        name =>
          ({
            PRIVACY_PROTOCOL: V2_PROTOCOL,
            PRIVACY_CHAIN_IDS: String(chainId),
            [`PRIVACY_POOL_ADDRESS_${chainId}`]: pool,
            [`PRIVACY_POOL_DEPLOY_BLOCK_${chainId}`]: "1",
            ...(rpc ? { [`PRIVACY_RPC_URL_${chainId}`]: rpc } : {}),
          })[name],
        {}
      );
    expect(config(31337).networks[0].problems).toEqual([]);
    expect(config(31337, "https://example.com").networks[0].problems).toContain(
      "candidate_protocol_public"
    );
    expect(config(4663).networks[0].problems).toContain(
      "mainnet_release_blocked"
    );
    expect(config(46630).networks[0].problems).toContain(
      "candidate_protocol_public"
    );
  });
  it("wires browser v2 pools and storage without adopting or deleting the existing v1 vault", async () => {
    vi.stubEnv("VITE_PRIVACY_PROTOCOL", V2_PROTOCOL);
    vi.stubEnv("VITE_PRIVACY_CHAIN_IDS", "31337");
    vi.stubEnv("VITE_PRIVACY_POOL_ADDRESS_31337", pool);
    const config = await import("../../client/src/privacy/config");
    expect(config.PRIVACY_POOLS[0]).toMatchObject({
      protocol: V2_PROTOCOL,
      scope: computeScope(pool, 31337),
      artifacts: { protocol: V2_PROTOCOL, vkeySha256: V2_DEV_KEY_PINS },
    });
    const storage = new Map<string, string>([
      ["hylsia.pp.vault.v2", "legacy encrypted seed"],
      [config.DEVICE_KEYS.vault, "v2 encrypted seed"],
      [config.DEVICE_KEYS.activity, "v2 log"],
    ]);
    const store = {
      get length() {
        return storage.size;
      },
      key: (i: number) => [...storage.keys()][i] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const migration = await import("../../client/src/privacy/migrate");
    expect(
      migration.migrateLegacyStorage(store, config.PRIVACY_POOLS).adopted
    ).toBeNull();
    migration.forgetDeviceStorage(store);
    expect(storage.get("hylsia.pp.vault.v2")).toBe("legacy encrypted seed");
    expect(storage.has(config.DEVICE_KEYS.vault)).toBe(false);
  });
});
