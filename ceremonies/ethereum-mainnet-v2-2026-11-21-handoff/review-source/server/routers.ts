import { router } from "./_core/trpc";
import { privacyRouter } from "./privacy/router";

// ─── App Router ───────────────────────────────────────────────────────────────
// Hylsia's whole API is the public privacy.* router (server/privacy/router.ts). client/src/lib/trpc.ts types its
// calls against AppRouter; api/index.ts (Vercel) and server/_core/index.ts serve it under /api/trpc.

export const appRouter = router({
  privacy: privacyRouter,
});

export type AppRouter = typeof appRouter;
