import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";
import { shouldIndexPath } from "../../shared/siteMetadata";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");
  // URL-based path prevents esbuild from inlining vite.config (and its dev-only deps) into the production bundle
  const cfgPath = new URL("../../vite.config.ts", import.meta.url).href;
  const viteConfig = (await import(cfgPath)).default;

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Do NOT serve HTML for API routes — let tRPC handle them or return 404
    if (url.startsWith("/api/")) {
      res.status(404).json({ error: "API route not found" });
      return;
    }

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  let distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    // Fallback: check dist/public relative to CWD (common in some deployments)
    const cwdDistPath = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(cwdDistPath)) {
      distPath = cwdDistPath;
    } else {
      console.error(
        `Could not find the build directory: ${distPath} or ${cwdDistPath}, make sure to build the client first`
      );
    }
  }

  // Index only public content. The generated HTML carries metadata before JavaScript executes.
  app.use((req, res, next) => {
    if (!shouldIndexPath(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  app.use(express.static(distPath, { redirect: false }));

  // fall through to index.html if the file doesn't exist (but not for API routes)
  app.use("*", (req, res) => {
    if (req.originalUrl.startsWith("/api/")) {
      res.status(404).json({ error: "API route not found" });
      return;
    }
    const pathname = new URL(req.originalUrl, "http://localhost").pathname.replace(/\/+$/, "");
    const publicPage = /^\/(?:docs(?:\/[a-z-]+)?|pools(?:\/screening)?)$/.test(pathname)
      ? path.join(distPath, pathname.slice(1), "index.html") : null;
    res.sendFile(publicPage && fs.existsSync(publicPage) ? publicPage : path.resolve(distPath, "index.html"));
  });
}
