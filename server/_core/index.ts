import "./loadEnv";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startAutoPublisher } from "../privacy/autoPublish";
import { logPrivacyConfigSummary } from "../privacy/config";
import { privacyHealth } from "../privacy/health";
import { securityHeaders } from "./securityHeaders";
import { relayerCors } from "../privacy/relayerCors";
import { registerV2DevelopmentAssets } from "../privacy/devArtifacts";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.on("error", () => {
      console.error("[Server] Could not bind configured port");
      process.exitCode = 1;
    });
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export async function createApp() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use(securityHeaders(process.env.NODE_ENV === "production"));
  registerV2DevelopmentAssets(app);
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  app.get("/health/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await privacyHealth();
      res.status(result.ok ? 200 : 503).json(result);
    } catch {
      res.status(503).json({ ok: false, problem: "health_unavailable" });
    }
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // tRPC API
  // another Hylsia front-end may send withdrawals through this server's relayer: its two procedures answer any origin
  app.use("/api/trpc", relayerCors());
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Server] Unhandled request error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  
  return { app, server };
}

async function startServer() {
  // One line per privacy network (pool and RPC sources, RPC host only, derived addresses, never keys). Non-fatal.
  logPrivacyConfigSummary();
  const { app, server } = await createApp();

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.on("error", () => {
    console.error("[Server] Could not bind configured port");
    process.exitCode = 1;
  });
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // The periodic association-set publisher: this long-running server only (PRIVACY_ASP_AUTO_PUBLISH_SECONDS, default
    // 600; 0 = off). The serverless entry (api/index.js, Vercel) never starts it. Never throws; logs its own state.
    startAutoPublisher();
  });
}

import { fileURLToPath } from "url";
if (import.meta.url.startsWith("file:")) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    startServer().catch(() => {
      console.error("[Server] Startup failed");
      process.exitCode = 1;
    });
  }
}
