import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { memo, useEffect, useState, type ReactNode } from "react";
import superjson from "superjson";
import { Redirect, Route, Router, Switch, useLocation } from "wouter";
import { profileHref } from "./privacy/applicationProfile";
import { trackPageView } from "./analytics";
import { isDocsArea, isPrivacyArea } from "./areas";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Landing from "./pages/Landing";
import Docs from "./pages/Docs";
import Privacy from "./pages/Privacy";
import Pools from "./pages/Pools";
import PoolAddressRedirect, { CanonicalPoolRoute } from "./pages/PoolAddressRedirect";
import Portfolio from "./pages/Portfolio";
import ScreeningPolicy from "./pages/ScreeningPolicy";
import Vault from "./pages/Vault";
import { PrivacyProvider } from "./privacy/PrivacyProvider";
import { privacyWagmiConfig } from "./privacy/wagmi";
import { OnchainProvider } from "./providers/OnchainProvider";

// ─── Router ───────────────────────────────────────────────────────────────────
// The app areas (client/src/areas.ts): landing, standalone docs, and the privacy area under one wallet config.
// /pools/* share one PrivacyProvider so an unlocked vault survives navigation between them. /privacy (the old vault
// page) and /pools/simulator (retired; its guidance now lives in the vault's Deposit and Withdraw forms) stay in the
// area and redirect to /pools/vault.

/**
 * The privacy area talks to the server without cookies. No privacy.* procedure needs a session, and no request from
 * the privacy area, relayer submissions included, may carry a cookie that could tie it to a visitor.
 */
function CookieFreeTrpc({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [client] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch: (input, init) => globalThis.fetch(input, { ...(init ?? {}), credentials: "omit" }),
        }),
      ],
    }),
  );
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      {children}
    </trpc.Provider>
  );
}

/**
 * Route order: the fixed pages before the pool routes. The canonical pool page is /pools/<network slug>/<address>;
 * the one-segment legacy /pools/<address> comes last, since it would otherwise take "portfolio", "simulator", "vault"
 * or "screening" as an address.
 */
function PrivacyRouter() {
  return (
    <CookieFreeTrpc>
      <PrivacyProvider>
        <Switch>
          <Route path="/privacy" component={Privacy} />
          <Route path="/pools" component={Pools} />
          <Route path="/pools/portfolio" component={Portfolio} />
          <Route path="/pools/simulator">
            <Redirect to="/pools/vault" replace />
          </Route>
          <Route path="/pools/vault" component={Vault} />
          <Route path="/pools/screening" component={ScreeningPolicy} />
          <Route path="/pools/:network/:address" component={CanonicalPoolRoute} />
          <Route path="/pools/:address" component={PoolAddressRedirect} />
        </Switch>
      </PrivacyProvider>
    </CookieFreeTrpc>
  );
}

/**
 * The landing: "/" and every path the docs and privacy areas do not claim (an unknown path shows the landing). It reports
 * page views (client/src/analytics.ts: never in the privacy area).
 */
function SiteRouter() {
  const [location] = useLocation();
  useEffect(() => trackPageView(location), [location]);
  return <Landing />;
}

/** Hylsia: the landing and the privacy area, under one wallet provider, so moving between them keeps the connection. */
function HylsiaRouter() {
  const [location] = useLocation();
  if (isDocsArea(location)) return <Docs />;
  return isPrivacyArea(location) ? <PrivacyRouter /> : <SiteRouter />;
}

/**
 * The wallet provider renders once per visit, not on every navigation (HylsiaRouter follows the location itself).
 * wagmi's provider asks the wallet to reconnect each time it renders, so re-rendering it with every location change
 * would repeat that and update the wallet button while the provider renders.
 *
 * Every page uses Hylsia's own wallet config (client/src/privacy/wagmi.ts: only the networks this build offers, no
 * automatic ENS lookup, no WalletConnect, its own storage key; Ethereum is an explicit separate profile).
 */
const HylsiaArea = memo(function HylsiaArea() {
  return (
    <OnchainProvider config={privacyWagmiConfig}>
      <HylsiaRouter />
    </OnchainProvider>
  );
});

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={true}>
        <TooltipProvider>
          <Toaster theme="dark" position="top-right" />
          <Router hrefs={profileHref} aroundNav={(navigate, to, options) => navigate(profileHref(to), options)}>
            <HylsiaArea />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
