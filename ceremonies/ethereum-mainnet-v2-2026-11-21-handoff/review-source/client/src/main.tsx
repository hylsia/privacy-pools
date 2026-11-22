import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import { isWalletReadRefusal } from "./privacy/walletGuard";

const queryClient = new QueryClient();

// Analytics (client/src/analytics.ts) starts from the landing's router (App.tsx), never in the privacy area.

// Suppress known non-critical platform/environment errors from the error log: cross-origin iframe restrictions (for
// example in a preview iframe) and plain network failures that are not tRPC errors. They are not app errors.
const isIgnorableError = (error: unknown): boolean => {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  // Cross-origin iframe security errors
  if (msg.includes("cross-origin") || msg.includes("SecurityError")) return true;
  // Generic network failures that are NOT tRPC errors (e.g. analytics SDK fetch)
  if (msg.includes("Failed to fetch") && !(error instanceof TRPCClientError)) return true;
  return false;
};

// Answers the public pool page expects and shows itself (PoolPage.tsx): "There is no privacy pool at … on {network}"
// (NOT_FOUND) and "That network is not one Hylsia is built for" (BAD_REQUEST). They are not app errors. Neither is a
// wallet read the privacy area's transports refused on purpose (walletGuard.ts: the wallet's address is read on the
// active network only, e.g. when RainbowKit's account window asks for the balance on another network).
const isExpectedAnswer = (error: unknown): boolean => {
  if (isWalletReadRefusal(error)) return true;
  if (!(error instanceof TRPCClientError)) return false;
  const data = error.data as { code?: string; path?: string } | undefined;
  return data?.path === "privacy.poolDetail" && (data.code === "NOT_FOUND" || data.code === "BAD_REQUEST");
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    if (!isIgnorableError(error) && !isExpectedAnswer(error)) console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    if (!isIgnorableError(error)) console.error("[API Mutation Error]", error);
  }
});

// No page needs a session: the landing's calls (privacy.networks) go without cookies too, as the privacy area's do
// (App.tsx CookieFreeTrpc).
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "omit",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
