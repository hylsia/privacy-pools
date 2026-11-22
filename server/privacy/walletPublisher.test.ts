import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { publishWalletRoot } from "../../client/src/privacy/publishRoot";
import { buildAssociationSet } from "../../shared/privacy/associationSet";
import { formatRecipe } from "../../shared/privacy/screening";
import { networkById } from "../../shared/privacy/networks";
import type { ASPScreening } from "../../shared/privacy/api";
import type { PoolEvent } from "../../shared/privacy/types";
import type { PoolRef } from "../../client/src/privacy/config";

const publisher = getAddress("0x1111111111111111111111111111111111111111");
const pool = getAddress("0x2222222222222222222222222222222222222222");
const events: PoolEvent[] = [
  {
    kind: "deposit",
    depositor: publisher,
    commitment: 4n,
    label: 7n,
    value: 1n,
    precommitment: 5n,
    leafIndex: 0,
    blockNumber: 1n,
    txHash: "0x01",
    logIndex: 0,
  },
];
const root = buildAssociationSet([7n]).tree.root;
const cid = formatRecipe({
  version: 1,
  considered: 1,
  excludedLeaves: [],
  asOfBlock: 20n,
  asOfTime: 1000,
  delaySeconds: 0,
  confirmations: 1,
});
const screening = {
  policyVersion: 1,
  walletPublishable: true,
  rootDue: true,
  exclusions: "none",
  settling: false,
  snapshot: { root: root.toString(), cid, memberCount: 1 },
} as ASPScreening;
function setup() {
  const wallet = {
    account: { address: publisher },
    getChainId: vi.fn(async () => 1),
    writeContract: vi.fn(async () => "0x1234"),
  };
  const client = {
    getChainId: vi.fn(async () => 1),
    readContract: vi.fn(async ({ functionName }) =>
      functionName === "aspPostman" ? publisher : 0n
    ),
    getTransactionCount: vi.fn(async () => 0),
    simulateContract: vi.fn(async request => ({ request })),
  };
  const options = {
    ref: { chainId: 1, pool, network: networkById(1) } as PoolRef,
    events,
    screening,
    client: client as any,
    getWallet: vi.fn(async () => wallet as any),
  };
  return { wallet, client, options };
}
describe("wallet-signed ASP publication", () => {
  it("simulates and signs only the verified root, exact pool and operation chain", async () => {
    const { wallet, client, options } = setup();
    expect(await publishWalletRoot(options)).toBe("0x1234");
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: pool,
        functionName: "updateASPRoot",
        args: [root, cid],
        chain: options.ref.network.chain,
      })
    );
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
  });
  it("rejects unverified or incomplete history before asking for a wallet", async () => {
    const { options, wallet } = setup();
    await expect(publishWalletRoot({ ...options, events: [] })).rejects.toThrow(
      "verified pool history"
    );
    expect(options.getWallet).not.toHaveBeenCalled();
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("does not sign during a policy error, settling, empty set or unchanged root", async () => {
    const { options, client, wallet } = setup();
    await expect(
      publishWalletRoot({
        ...options,
        screening: { ...screening, exclusions: "invalid" },
      })
    ).rejects.toThrow("paused");
    expect(
      await publishWalletRoot({
        ...options,
        screening: { ...screening, rootDue: false },
      })
    ).toBeNull();
    client.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "aspPostman" ? publisher : root
    );
    const posted: PoolEvent = {
      kind: "asproot",
      root,
      cid,
      blockNumber: 2n,
      txHash: "0x02",
      logIndex: 0,
    };
    expect(
      await publishWalletRoot({ ...options, events: [...events, posted] })
    ).toBeNull();
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });
  it("permits publishing an empty eligibility set when exclusions remove every member", async () => {
    const { options, wallet } = setup();
    const empty = buildAssociationSet([]).tree.root;
    const excluded = formatRecipe({
      version: 1,
      considered: 1,
      excludedLeaves: [0],
      asOfBlock: 20n,
      asOfTime: 1000,
      delaySeconds: 0,
      confirmations: 1,
    });
    expect(
      await publishWalletRoot({
        ...options,
        screening: {
          ...screening,
          snapshot: {
            ...screening.snapshot,
            root: empty.toString(),
            cid: excluded,
            memberCount: 0,
          },
        },
      })
    ).toBe("0x1234");
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
  });
  it("refuses unsupported or server-paused publication without requesting a wallet", async () => {
    for (const changed of [
      { ...screening, walletPublishable: false },
      { ...screening, walletPublishable: undefined },
      { ...screening, policyVersion: 2 },
    ]) {
      const { options, wallet } = setup();
      await expect(
        publishWalletRoot({ ...options, screening: changed })
      ).rejects.toThrow("paused");
      expect(options.getWallet).not.toHaveBeenCalled();
      expect(wallet.writeContract).not.toHaveBeenCalled();
    }
  });
  it("rejects a different publisher, wrong network and pending nonce without signing", async () => {
    for (const kind of ["publisher", "rpc", "wallet", "pending"] as const) {
      const { options, wallet, client } = setup();
      if (kind === "publisher") wallet.account.address = pool;
      if (kind === "rpc") client.getChainId.mockResolvedValue(46630);
      if (kind === "wallet") wallet.getChainId.mockResolvedValue(46630);
      if (kind === "pending")
        client.getTransactionCount.mockImplementation(async (...args: any[]) =>
          args[0].blockTag === "pending" ? 1 : 0
        );
      await expect(publishWalletRoot(options)).rejects.toThrow();
      expect(wallet.writeContract).not.toHaveBeenCalled();
    }
  });
});
