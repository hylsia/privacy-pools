/**
 * Cross-origin access to this server's relayer (Phase 5, resilience). Another Hylsia front-end can list this server
 * as one of its relayers (client/src/privacy/relayers.ts) and send private withdrawals through it. Only the relayer's
 * own two procedures answer other origins:
 *   - privacy.relayer.quote: input-less, public terms;
 *   - privacy.relayer.submit: a proof that will be public on-chain seconds later.
 * Each is a single, unbatched call (the remote client uses httpLink): a batch path ("a,b") never gets these headers.
 * No cookies are used anywhere in the privacy area, so the answer allows any origin and never credentials.
 *
 * PRIVACY_RELAYER_CORS=0 turns it off (this server's relayer then serves this site's own pages only).
 */
import type { NextFunction, Request, Response } from "express";

const RELAYER_PROCEDURE = /^\/privacy\.relayer\.(?:quote|submit)$/;

export function relayerCorsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PRIVACY_RELAYER_CORS ?? "").trim() !== "0";
}

/** Mount on "/api/trpc", before the tRPC middleware. `req.path` is then "/privacy.relayer.quote" and so on. */
export function relayerCors(env: NodeJS.ProcessEnv = process.env) {
  const on = relayerCorsEnabled(env);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!on || !RELAYER_PROCEDURE.test(req.path)) return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "content-type, trpc-accept");
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  };
}
