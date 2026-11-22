/**
 * client/src/areas.ts and the wallet config in client/src/App.tsx: every page (the landing, any path the privacy area
 * does not claim, and the privacy area) uses Hylsia's own wallet config (client/src/privacy/wagmi.ts: the offered
 * networks only, no mainnet, no WalletConnect). The legacy trading pages and their app-wide config, which listed
 * Ethereum mainnet (on the landing it made RainbowKit look up a returning wallet's ENS name through a public mainnet
 * RPC, eth.merkle.io, on every load), are gone and must not come back.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivacyArea } from "../../client/src/areas";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("isPrivacyArea", () => {
  it("puts /pools, /pools/* and /privacy in the privacy area", () => {
    for (const p of [
      "/pools",
      "/pools/",
      "/pools/vault",
      "/pools/portfolio",
      "/pools/simulator",
      "/pools/screening",
      "/pools/robinhood-testnet/0x0000000000000000000000000000000000000001",
      "/privacy",
    ]) {
      expect(isPrivacyArea(p), p).toBe(true);
    }
  });

  it("serves the screening policy page in the privacy area, routed before the pool routes", () => {
    // in the privacy area: no page-view analytics, cookie-free API calls, the shell's one status schedule
    expect(isPrivacyArea("/pools/screening")).toBe(true);
    const app = read("client", "src", "App.tsx");
    const at = (route: string) => app.indexOf(`<Route path="${route}"`);
    expect(at("/pools/screening")).toBeGreaterThan(-1);
    // the one-segment legacy /pools/:address would otherwise take "screening" as a pool address
    expect(at("/pools/screening")).toBeLessThan(at("/pools/:network/:address"));
    expect(at("/pools/screening")).toBeLessThan(at("/pools/:address"));
    expect(app).toMatch(/<Route path="\/pools\/screening" component=\{ScreeningPolicy\} \/>/);
  });

  it("leaves the landing and every other path, the old trading paths included, on the site", () => {
    for (const p of ["/", "/terms", "/docs", "/how-it-works", "/Pools", "/privacy/", "/pool", "/poolsx", "/trade", "/strategies", "/login", "/Trade", "/login/", "/tradex", "/trade/x"]) {
      expect(isPrivacyArea(p), p).toBe(false);
    }
  });
});

describe("the wallet config (App.tsx)", () => {
  const app = read("client", "src", "App.tsx");

  it("mounts Hylsia's config once, and no config-less (app-wide) provider", () => {
    expect(app).not.toMatch(/<OnchainProvider>/);
    expect(app.match(/<OnchainProvider config=\{privacyWagmiConfig\}>/g)).toHaveLength(1);
    expect(app).toMatch(/const HylsiaArea = memo\(function HylsiaArea\(\) \{\s*return \(\s*<OnchainProvider config=\{privacyWagmiConfig\}>\s*<HylsiaRouter \/>/);
  });

  it("renders the landing and the privacy area only: no trading routes and no wallet sign-in", () => {
    expect(app).toMatch(/isPrivacyArea\(location\) \? <PrivacyRouter \/> : <SiteRouter \/>/);
    expect(code(app)).not.toMatch(/useWalletSignIn|TradingRouter|TradingArea|SESSION_ROUTES|areaOf/);
    for (const route of ["/trade", "/strategies", "/login"]) {
      expect(app, route).not.toContain(`<Route path="${route}"`);
    }
  });

  it("keeps mainnet, the trading chains and WalletConnect out of the wallet provider", () => {
    const provider = code(read("client", "src", "providers", "OnchainProvider.tsx"));
    expect(provider).not.toMatch(/wagmi\/chains|mainnet|walletConnectWallet|appWagmiConfig|VITE_WALLETCONNECT_PROJECT_ID|createConfig/);
    expect(provider).toMatch(/config: Config \}/);
  });

  it("keeps mainnet, the trading chains and WalletConnect out of Hylsia's config", () => {
    const hylsia = code(read("client", "src", "privacy", "wagmi.ts"));
    expect(hylsia).not.toMatch(/wagmi\/chains|mainnet|walletConnect|metaMask\(|coinbase/i);
    expect(hylsia).toMatch(/wallets: \[metaMaskInjectedWallet, rabbyInjectedWallet\]/);
    expect(hylsia).toMatch(/multiInjectedProviderDiscovery: false/);
    expect(hylsia).toMatch(/PRIVACY_NETWORKS\.map\(\(\{ network \}\) => \(\{ \.\.\.network\.chain, iconUrl: "" \}\)\)/);
  });
});

/**
 * Phase 4 (critique m5): under the screening policy a deposit no longer joins at the next root just because it is
 * confirmed (it waits for the inclusion delay, and the operator's list can exclude it), so the open policy's sentences
 * must not come back anywhere in the app. Hero.tsx is the owner's own file and is not read here.
 */
describe("the app's copy under the screening policy", () => {
  const SRC = path.join(ROOT, "client", "src");
  const HERO = path.join(SRC, "components", "landing", "sections", "Hero.tsx");
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.(tsx?|css)$/.test(e.name) ? [p] : [];
    });

  it("never says that every confirmed deposit joins, or that the set admits every deposit", () => {
    const found = files(SRC)
      .filter((f) => f !== HERO)
      .flatMap((f) => {
        const text = fs.readFileSync(f, "utf8").replace(/\s+/g, " ");
        return /every confirmed deposit|admits every/i.test(text) ? [path.relative(ROOT, f)] : [];
      });
    expect(found).toEqual([]);
  });

  it("links the screening policy from the vault's forms, the pool pages and the shell", () => {
    const screening = read("client", "src", "components", "privacy", "Screening.tsx");
    expect(screening).toMatch(/SCREENING_PATH = "\/pools\/screening"/);
    expect(read("client", "src", "components", "pools", "PoolsShell.tsx")).toMatch(/label: "Screening policy", href: "\/pools\/screening"/);
    for (const f of [
      ["client", "src", "components", "privacy", "DepositPanel.tsx"],
      ["client", "src", "components", "privacy", "WithdrawPanel.tsx"],
      ["client", "src", "components", "privacy", "PrivacyNotice.tsx"],
    ]) {
      expect(read(...f), f.join("/")).toMatch(/<PolicyLink/);
    }
    expect(read("client", "src", "pages", "PoolPage.tsx")).toMatch(/<ScreeningSummary/);
    expect(read("client", "src", "components", "pools", "PoolDetail.tsx")).toMatch(/<ScreeningSummary/);
  });

  it("never calls the policy page a draft", () => {
    expect(code(read("client", "src", "pages", "ScreeningPolicy.tsx"))).not.toMatch(/draft/i);
  });
});
