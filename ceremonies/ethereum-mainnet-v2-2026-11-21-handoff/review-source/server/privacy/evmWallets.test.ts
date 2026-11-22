import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connect,
  createConfig,
  createStorage,
  getAccount,
  reconnect,
  switchChain,
} from "@wagmi/core";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { custom } from "viem";
import { robinhoodTestnet } from "../../shared/privacy/chains";
import {
  metaMaskInjectedWallet,
  rabbyInjectedWallet,
} from "../../client/src/privacy/evmWallets";

const ADDRESS = "0x00000000000000000000000000000000000000AA";
const params = { projectId: "unused", appName: "Hylsia" };

/** A local EIP-1193 mock: no extensions, RPC, signatures or real wallet are used. */
function provider(flags: Record<string, boolean> = {}) {
  const events = new EventEmitter();
  let chainId = "0x1";
  return Object.assign(events, flags, {
    request: vi.fn(
      async ({ method, params }: { method: string; params?: any[] }) => {
        switch (method) {
          case "eth_accounts":
          case "eth_requestAccounts":
            return [ADDRESS];
          case "eth_chainId":
            return chainId;
          case "wallet_requestPermissions":
            return [{ caveats: [{ value: [ADDRESS] }] }];
          case "wallet_switchEthereumChain":
            chainId = params![0].chainId;
            events.emit("chainChanged", chainId);
            return null;
          default:
            throw new Error(`Unexpected mock request: ${method}`);
        }
      }
    ),
  });
}
type MockProvider = ReturnType<typeof provider>;

function browser(
  ethereum?: MockProvider,
  announcements: [string, MockProvider][] = []
) {
  const target = Object.assign(new EventTarget(), {
    ethereum,
    location: { origin: "https://hylsia.test" },
  });
  target.addEventListener("eip6963:requestProvider", () => {
    for (const [rdns, provider] of announcements) {
      target.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info: { rdns }, provider },
        })
      );
    }
  });
  vi.stubGlobal("window", target);
  return target;
}

const rpc = vi.fn(async () => {
  throw new Error("No RPC should be read by these wallet controls");
});
function config(recent = "") {
  const saved = new Map<string, string>();
  if (recent) saved.set("test.recentConnectorId", JSON.stringify(recent));
  return createConfig({
    chains: [robinhoodTestnet],
    connectors: connectorsForWallets(
      [
        {
          groupName: "EVM wallets",
          wallets: [metaMaskInjectedWallet, rabbyInjectedWallet],
        },
      ],
      params
    ),
    multiInjectedProviderDiscovery: false,
    transports: { [robinhoodTestnet.id]: custom({ request: rpc }) },
    storage: createStorage({
      key: "test",
      storage: {
        getItem: k => saved.get(k) ?? null,
        setItem: (k, v) => {
          saved.set(k, v);
        },
        removeItem: k => {
          saved.delete(k);
        },
      },
    }),
  });
}

const fetchRequest = vi.fn(async () => { throw new Error("Wallet discovery must not use the network"); });
beforeEach(() => vi.stubGlobal("fetch", fetchRequest));
afterEach(() => {
  expect(fetchRequest).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("explicit EVM wallet routing", () => {
  it("does not register or restore Phantom even when it is the default, authorized and previously used", async () => {
    const phantom = provider({ isPhantom: true, isMetaMask: true });
    browser(phantom, [["app.phantom", phantom]]);
    const c = config("app.phantom");
    expect(c.connectors.map(c => c.id)).toEqual(["metaMask", "rabby"]);
    await reconnect(c);
    expect(getAccount(c).status).toBe("disconnected");
    expect(phantom.request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("finds MetaMask's EIP-6963 provider when Phantom owns window.ethereum, without probing either wallet", async () => {
    const phantom = provider({ isPhantom: true });
    const metamask = provider(); // EIP-6963 identity works without legacy flags.
    browser(phantom, [
      ["app.phantom", phantom],
      ["io.metamask", metamask],
    ]);
    expect(metaMaskInjectedWallet(params).installed).toBe(true);
    const c = config();
    expect(await c.connectors[0].getProvider()).toBe(metamask);
    expect(metamask.request).not.toHaveBeenCalled();
    expect(phantom.request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["metaMask", "io.metamask"],
    ["rabby", "io.rabby"],
  ])(
    "connects and switches only the chosen %s provider, even after the default provider changes",
    async (id, rdns) => {
      const phantom = provider({ isPhantom: true, isMetaMask: true });
      const chosen = provider();
      const win = browser(phantom, [
        [rdns, chosen],
        ["app.phantom", phantom],
      ]);
      const c = config();
      const connector = c.connectors.find(c => c.id === id)!;
      await connect(c, { connector });
      win.ethereum = phantom;
      await switchChain(c, { connector, chainId: 46630 });
      expect(getAccount(c).connector?.id).toBe(id);
      expect(getAccount(c).chainId).toBe(46630);
      expect(chosen.request).toHaveBeenCalledWith({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xb626" }],
      });
      expect(phantom.request).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("supports legacy provider arrays without accepting Phantom's MetaMask compatibility flag", async () => {
    const phantom = provider({ isPhantom: true, isMetaMask: true });
    const metamask = provider({ isMetaMask: true });
    const rabby = provider({ isRabby: true, isMetaMask: true });
    Object.assign(phantom, { providers: [phantom, rabby, metamask] });
    browser(phantom);
    const c = config();
    expect(await c.connectors[0].getProvider()).toBe(metamask);
    expect(await c.connectors[1].getProvider()).toBe(rabby);
    expect(phantom.request).not.toHaveBeenCalled();
  });

  it("keeps a connector on its selected provider if another extension later replaces the legacy slot", async () => {
    const metamask = provider({ isMetaMask: true });
    const win = browser(metamask);
    const c = config();
    expect(await c.connectors[0].getProvider()).toBe(metamask);
    win.ethereum = provider({ isPhantom: true, isMetaMask: true });
    expect(await c.connectors[0].getProvider()).toBe(metamask);
    expect(win.ethereum.request).not.toHaveBeenCalled();
  });

  it("ignores a Phantom provider even under an allowed announcement and handles absent wallets without a generic fallback", async () => {
    const phantom = provider({
      isPhantom: true,
      isMetaMask: true,
      isRabby: true,
    });
    browser(phantom, [
      ["io.metamask", phantom],
      ["io.rabby", phantom],
    ]);
    expect(metaMaskInjectedWallet(params).installed).toBe(false);
    expect(rabbyInjectedWallet(params).installed).toBe(false);
    const c = config();
    for (const connector of c.connectors) {
      await expect(connector.getProvider()).resolves.toBeUndefined();
      await expect(connect(c, { connector })).rejects.toThrow();
    }
    expect(phantom.request).not.toHaveBeenCalled();
  });

  it("restores an authorized MetaMask connection instead of an old Phantom selection", async () => {
    const phantom = provider({ isPhantom: true });
    const metamask = provider();
    browser(phantom, [
      ["io.metamask", metamask],
      ["app.phantom", phantom],
    ]);
    const c = config("app.phantom");
    await reconnect(c);
    expect(getAccount(c).connector?.id).toBe("metaMask");
    expect(phantom.request).not.toHaveBeenCalled();
    expect(
      metamask.request.mock.calls.every(([a]) =>
        ["eth_accounts", "eth_chainId"].includes(a.method)
      )
    ).toBe(true);
  });
});
