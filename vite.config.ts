import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { siteSeoPlugin } from "./scripts/vite/siteSeo";
import { englishWalletLocalePlugin } from "./scripts/vite/englishWalletLocale";
import { DEPLOYMENTS } from "./shared/privacy/deployments";
import { resolveViteNetworks } from "./shared/privacy/networks";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

// ── the privacy area records nothing ──
// /pools, /pools/* and /privacy handle notes, amounts and recipients: the collector is not injected into those pages,
// its script records nothing while one is open (a session that starts elsewhere), and entries from them, or from the
// privacy API (/api/trpc/privacy.*), are dropped here before anything is written to .manus-logs.
const PRIVACY_PATH = /^\/(?:pools|privacy|docs)(?:\/|$)/;

function pathOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
}

/** A page in the privacy area; unreadable URLs count as one. */
function isPrivacyPage(url: unknown): boolean {
  const path = pathOf(url);
  return path === null || PRIVACY_PATH.test(path);
}

/** A call to the privacy API (a tRPC batch naming a privacy.* procedure). */
function isPrivacyRequest(url: unknown): boolean {
  const path = pathOf(url);
  if (path === null) return true;
  if (!path.startsWith("/api/trpc/")) return false;
  try {
    return /(?:^|,)privacy\./.test(decodeURIComponent(path.slice("/api/trpc/".length)));
  } catch {
    return true;
  }
}

type Entry = { url?: unknown; page?: unknown };
const keep = {
  /** UI events carry the page's URL */
  ui: (e: Entry) => !isPrivacyPage(e?.url),
  /** console lines carry the page they were written on (older collector scripts did not: then they are kept) */
  console: (e: Entry) => e?.page === undefined || !isPrivacyPage(e.page),
  /** requests carry the page they were made on, and their own URL */
  network: (e: Entry) => (e?.page === undefined || !isPrivacyPage(e.page)) && !isPrivacyRequest(e?.url),
};
const only = (list: unknown, ok: (e: Entry) => boolean): unknown[] => (Array.isArray(list) ? list.filter((e) => ok(e as Entry)) : []);

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 * - Nothing from the privacy area (see PRIVACY_PATH) is injected, recorded or written
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html, ctx) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      // not on the privacy pages: a vault opened directly runs without the collector
      if (isPrivacyPage(ctx.originalUrl ?? ctx.path)) {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files, without anything from the privacy area
          writeToLogFile("browserConsole", only(payload?.consoleLogs, keep.console));
          writeToLogFile("networkRequests", only(payload?.networkRequests, keep.network));
          writeToLogFile("sessionReplay", only(payload?.sessionEvents, keep.ui));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// ── the privacy networks this build offers ──
// The browser reads its networks from VITE_PRIVACY_CHAIN_IDS (or VITE_PRIVACY_CHAIN_ID) through the server's parser
// (client/src/privacy/config.ts, at import). A value that names a network Hylsia is not built for, such as an id an
// older configuration listed, would make every page throw there, landing included. So Vite checks it when it starts
// (dev server and build) and stops with a message that names the variable: a stale value is never shipped.
function privacyNetworksCheck(): Plugin {
  return {
    name: "hylsia-privacy-networks",
    configResolved(config) {
      try {
        resolveViteNetworks(config.env as Record<string, string | undefined>, DEPLOYMENTS);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[privacy] ${message}. Fix the variable (.env, or the hosting environment such as Vercel) and start again.`);
      }
    },
  };
}

const plugins = [privacyNetworksCheck(), englishWalletLocalePlugin(), react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector(), siteSeoPlugin(PROJECT_ROOT)];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
