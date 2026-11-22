/** Explicit browser-wallet routing. Discovery is local; it never requests an account or contacts an RPC. */
import type { WalletList } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rabbyWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import type { EIP1193Provider } from "viem";

type WalletId = "metaMask" | "rabby";
type Provider = EIP1193Provider & {
  isMetaMask?: true;
  isRabby?: true;
  isPhantom?: true;
  providers?: Provider[];
  [flag: string]: unknown;
};
type WalletBrowser = Omit<Window, "ethereum" | "phantom"> & {
  ethereum?: Provider;
  phantom?: { ethereum?: Provider };
};
type WalletFactory = WalletList[number]["wallets"][number];
const RDNS: Record<WalletId, string> = {
  metaMask: "io.metamask",
  rabby: "io.rabby",
};
const discovered = new WeakMap<WalletBrowser, Map<string, Provider>>();

function usable(
  provider: unknown,
  browser: WalletBrowser
): provider is Provider {
  if (!provider || typeof provider !== "object") return false;
  const p = provider as Provider;
  return (
    typeof p.request === "function" &&
    !p.isPhantom &&
    p !== browser.phantom?.ethereum
  );
}

function announcements(browser: WalletBrowser): Map<string, Provider> {
  const cached = discovered.get(browser);
  if (cached) return cached;
  const found = new Map<string, Provider>();
  discovered.set(browser, found);
  // One listener for the app's lifetime. Only the two configured EVM wallets enter this map;
  // an announcement never creates a connector and cannot restore a Phantom connection.
  browser.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (
      event as CustomEvent<{ info?: { rdns?: string }; provider?: unknown }>
    ).detail;
    const rdns = detail?.info?.rdns;
    if (
      typeof rdns === "string" &&
      Object.values(RDNS).includes(rdns) &&
      !found.has(rdns) &&
      usable(detail?.provider, browser)
    ) {
      found.set(rdns, detail.provider);
    }
  });
  browser.dispatchEvent(new Event("eip6963:requestProvider"));
  return found;
}

/** No fallback to a generic window.ethereum: another extension may own that slot. */
function providerFor(id: WalletId): Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as WalletBrowser;
  const announced = announcements(browser).get(RDNS[id]);
  if (usable(announced, browser)) return announced;
  const ethereum = browser.ethereum;
  const candidates = ethereum?.providers ?? (ethereum ? [ethereum] : []);
  return candidates.find(p => {
    if (!usable(p, browser)) return false;
    if (id === "rabby") return p.isRabby === true;
    if (p.isMetaMask !== true) return false;
    // Legacy providers sometimes advertise MetaMask compatibility as well as their own identity.
    return ![
      "isRabby",
      "isCoinbaseWallet",
      "isBraveWallet",
      "isOkxWallet",
      "isOKExWallet",
      "isTrust",
      "isTrustWallet",
      "isRainbow",
      "isTokenPocket",
      "isZerion",
    ].some(flag => p[flag]);
  });
}

function wallet(
  id: WalletId,
  stock: ReturnType<WalletFactory>
): ReturnType<WalletFactory> {
  return {
    ...stock,
    installed: !!providerFor(id),
    qrCode: undefined,
    mobile: undefined,
    createConnector: details =>
      createConnector(config => {
        // Keep the exact provider object for this connector. A later change of the browser's
        // default wallet cannot redirect a switch, signature or transaction to another extension.
        let selected: Provider | undefined;
        return {
          ...injected({
            target: {
              id,
              name: stock.name,
              provider: () => (selected ??= providerFor(id)),
            },
          })(config),
          ...details,
        };
      }),
  };
}

/** Stock metadata only: never instantiate the SDK/WalletConnect connectors shipped by the stock wallet entries. */
export const metaMaskInjectedWallet: WalletFactory = params =>
  wallet(
    "metaMask",
    metaMaskWallet({ ...params, projectId: "YOUR_PROJECT_ID" })
  );
export const rabbyInjectedWallet: WalletFactory = () =>
  wallet("rabby", rabbyWallet());
