import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const view = vi.hoisted(() => ({
  chainId: 46630,
  busy: false,
  lock: vi.fn(() => true),
}));
vi.mock("../../client/src/privacy/PrivacyProvider", () => ({
  usePrivacy: () => ({
    activePool: { chainId: view.chainId },
    busy: view.busy,
    lock: view.lock,
  }),
}));
vi.mock("../../client/src/privacy/applicationProfile", () => ({
  MAINNET_APPLICATION_ENABLED: true,
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ status: "disconnected" }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../client/src/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  PopoverTrigger: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  PopoverContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
import ApplicationNetworkMenu from "../../client/src/components/pools/ApplicationNetworkMenu";

beforeEach(() => {
  view.chainId = 46630;
  view.busy = false;
  vi.clearAllMocks();
});
describe("upper-right application network selector", () => {
  it("offers Testnet and Ethereum Mainnet independently of wallet connection, without changing a vault on render", () => {
    const html = renderToStaticMarkup(createElement(ApplicationNetworkMenu));
    expect(html).toContain(
      'aria-label="Application network: Robinhood Chain Testnet"'
    );
    expect(html).toContain("Ethereum Mainnet");
    expect(html).toContain("Native ETH · Chain 1");
    expect(html).toContain("separate vaults and backups");
    expect(html).not.toContain("Robinhood Chain Mainnet");
    expect(view.lock).not.toHaveBeenCalled();
  });
  it("shows the selected mainnet profile and blocks switching during an operation", () => {
    view.chainId = 1;
    view.busy = true;
    const html = renderToStaticMarkup(createElement(ApplicationNetworkMenu));
    expect(html).toContain(
      'aria-label="Application network: Ethereum Mainnet"'
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(view.lock).not.toHaveBeenCalled();
  });
});
