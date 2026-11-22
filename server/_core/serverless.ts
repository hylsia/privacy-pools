import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { relayerCors } from "../privacy/relayerCors";

let _app: ReturnType<typeof express> | null = null;

function getApp() {
  if (_app) return _app;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, node: process.version, time: new Date().toISOString() });
  });

  // another Hylsia front-end may send withdrawals through this server's relayer: its two procedures answer any origin
  app.use("/api/trpc", relayerCors());
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Vercel API] Express error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error", message: err.message });
    }
  });

  _app = app;
  return app;
}

export default async function handler(req: any, res: any) {
  try {
    const app = getApp();
    await new Promise<void>((resolve, reject) => {
      res.on("finish", resolve);
      res.on("error", reject);
      app(req, res);
    });
  } catch (err: any) {
    console.error("[Vercel API] Handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message: err.message,
      });
    }
  }
}
