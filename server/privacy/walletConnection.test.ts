import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkById } from "../../shared/privacy/networks";
import {
  networkSwitchMessage,
  walletConnectionState,
} from "../../client/src/privacy/walletConnection";

const view = vi.hoisted(() => ({
  account: {
    status: "connected",
    address: "0x00000000000000000000000000000000000000aa",
    chainId: 46630,
    connector: { name: "Test wallet", uid: "test-wallet" },
  },
  target: 46630,
  busy: false,
  switching: false,
  switchChainAsync: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => view.account,
  useDisconnect: () => ({ disconnect: view.disconnect, isPending: false }),
  useSwitchChain: () => ({
    switchChainAsync: view.switchChainAsync,
    isPending: view.switching,
  }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: view.connect }),
}));
vi.mock("../../client/src/privacy/PrivacyProvider", () => ({
  usePrivacy: () => ({
    activePool: { network: networkById(view.target) },
    busy: view.busy,
  }),
}));
import DashboardWallet from "../../client/src/components/pools/DashboardWallet";

const target = { name: "Robinhood Chain Testnet", chainId: 46630 };

beforeEach(() => {
  view.account.status = "connected";
  view.account.chainId = 46630;
  view.target = 46630;
  view.busy = false;
  view.switching = false;
  vi.clearAllMocks();
});

describe("dashboard wallet network state", () => {
  it("waits for the real connection instead of judging a persisted or stale chain during reconnect", () => {
    for (const status of ["connecting", "reconnecting"] as const) {
      for (const chainId of [undefined, 1, 46630]) {
        expect(
          walletConnectionState({
            status,
            address: view.account.address,
            chainId,
            targetChainId: 46630,
          })
        ).toBe("restoring");
      }
    }
    expect(
      walletConnectionState({
        status: "disconnected",
        address: view.account.address,
        chainId: 46630,
        targetChainId: 46630,
      })
    ).toBe("disconnected");
  });

  it("checks the active pool's chain, including a different chain that this build also supports", () => {
    expect(
      walletConnectionState({
        ...view.account,
        status: "connected",
        targetChainId: 46630,
      })
    ).toBe("ready");
    expect(
      walletConnectionState({
        ...view.account,
        status: "connected",
        chainId: undefined,
        targetChainId: 46630,
      })
    ).toBe("checking");
    expect(
      walletConnectionState({
        ...view.account,
        status: "connected",
        chainId: 1,
        targetChainId: 46630,
      })
    ).toBe("switch");
    expect(
      walletConnectionState({
        ...view.account,
        status: "connected",
        chainId: 31338,
        targetChainId: 46630,
      })
    ).toBe("switch");
    expect(
      walletConnectionState({
        ...view.account,
        status: "connected",
        chainId: 31338,
        targetChainId: 31338,
      })
    ).toBe("ready");
  });
});

describe("the dashboard's independent network and account controls", () => {
  const render = () => renderToStaticMarkup(createElement(DashboardWallet));

  it("keeps the account menu available on an unsupported chain and names the target network", () => {
    view.account.chainId = 1;
    const html = render();
    expect(html).toContain(
      'aria-label="Wallet is on Ethereum. Switch to Robinhood Chain Testnet"'
    );
    expect(html).toContain('aria-label="Wallet 0x0000…00aa"');
    expect(html).not.toContain("Wrong network");
  });

  it("shows a neutral reconnecting state even if the old address and an unsupported chain are still present", () => {
    view.account.status = "reconnecting";
    view.account.chainId = 1;
    const html = render();
    expect(html).toContain("Checking wallet connection");
    expect(html).not.toContain("Switch network");
    expect(html).not.toContain("Wallet 0x0000");
  });

  it("tracks the pool in a multi-network build without claiming another supported chain is ready", () => {
    view.target = 31338;
    expect(render()).toContain("Switch to Local chain B");
    view.account.chainId = 31338;
    expect(render()).toContain('aria-label="Wallet network: Local chain B"');
  });

  it("never opens or switches a wallet as a side effect of showing the dashboard", () => {
    for (const status of ["disconnected", "reconnecting", "connected"]) {
      for (const chainId of [1, 46630, 31338]) {
        view.account.status = status;
        view.account.chainId = chainId;
        render();
      }
    }
    expect(view.connect).not.toHaveBeenCalled();
    expect(view.switchChainAsync).not.toHaveBeenCalled();
    expect(view.disconnect).not.toHaveBeenCalled();
  });
});

describe("network switch feedback", () => {
  it("distinguishes a rejected request, a pending request and a wallet that cannot switch", () => {
    expect(networkSwitchMessage({ code: 4001 }, target)).toMatch(/cancelled/);
    expect(
      networkSwitchMessage(
        { name: "SwitchChainError", cause: { code: -32002 } },
        target
      )
    ).toMatch(/already open/);
    expect(networkSwitchMessage({ code: 4902 }, target)).toContain(
      "Robinhood Chain Testnet (chain 46630)"
    );
    expect(networkSwitchMessage({ code: 4100 }, target)).toMatch(
      /disconnected/
    );
  });

  it("never reflects a provider's URL or raw error into the UI", () => {
    const error = new Error(
      "Failed https://private-rpc.example/private-token?auth=example"
    );
    expect(networkSwitchMessage(error, target)).toBe(
      "The network could not be changed. Open your wallet and try again."
    );
  });
});
