/** Build-time public SEO documents and the user's original share artwork, without modifying the artwork. */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { DOC_PAGES, docHref } from "../../client/src/docs/content";
import {
  applySiteMetadata,
  shouldIndexPath,
  SITE_DESCRIPTION,
  SITE_ORIGIN,
  SITE_TITLE,
  SHARE_IMAGE,
  type PageMetadata,
} from "../../shared/siteMetadata";

export const PUBLIC_PAGES: PageMetadata[] = [
  { path: "/", title: SITE_TITLE, description: SITE_DESCRIPTION },
  ...DOC_PAGES.map(page => ({
    path: docHref(page.slug),
    title: `${page.title} | Hylsia Docs`,
    description: `${page.description} Built for Robinhood Chain Testnet. Testnet only. Not audited.`,
  })),
  {
    path: "/pools",
    title: "Explore ETH Privacy Pools | Hylsia Testnet",
    description:
      "Explore the native ETH privacy pool, public contract data and privacy estimates on Robinhood Chain Testnet. Testnet only. Not audited.",
  },
  {
    path: "/pools/screening",
    title: "Screening Policy | Hylsia Privacy Pools",
    description:
      "Read Hylsia's association-set inclusion delay, exclusion policy and old-root limits on Robinhood Chain Testnet. Testnet only. Not audited.",
  },
];
export const metadataForPath = (pathname: string): PageMetadata =>
  PUBLIC_PAGES.find(
    page => page.path === pathname.replace(/\/+$/, "") || page.path === pathname
  ) ?? {
    path: pathname,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    index: false,
  };
export const htmlFileForPath = (pathname: string) =>
  pathname === "/" ? "index.html" : `${pathname.replace(/^\//, "")}/index.html`;
export const robotsText = () =>
  `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /health/\nDisallow: /zk/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
export const sitemapText = () =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map(page => `  <url><loc>${new URL(page.path, SITE_ORIGIN).href}</loc></url>`).join("\n")}\n</urlset>\n`;

export function siteSeoPlugin(root: string): Plugin {
  const imageFile = path.join(root, "public", "web-share.png");
  let outputDirectory = "";
  let building = false;
  return {
    name: "hylsia-site-seo",
    enforce: "post",
    configResolved(config) {
      building = config.command === "build";
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!shouldIndexPath(pathname))
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
        if (pathname === SHARE_IMAGE.path) {
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Content-Length", fs.statSync(imageFile).size);
          res.setHeader("Cache-Control", "public, max-age=3600");
          fs.createReadStream(imageFile).pipe(res);
          return;
        }
        if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
          res.setHeader(
            "Content-Type",
            pathname.endsWith(".xml")
              ? "application/xml; charset=utf-8"
              : "text/plain; charset=utf-8"
          );
          res.end(pathname.endsWith(".xml") ? sitemapText() : robotsText());
          return;
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const pathname = context.server
          ? new URL(context.originalUrl ?? context.path, "http://localhost")
              .pathname
          : "/";
        return applySiteMetadata(html, metadataForPath(pathname));
      },
    },
    generateBundle() {
      const image = fs.readFileSync(imageFile);
      if (
        !image
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        image.readUInt32BE(16) !== SHARE_IMAGE.width ||
        image.readUInt32BE(20) !== SHARE_IMAGE.height
      )
        throw new Error(
          "Share PNG changed size/format; update its metadata to match"
        );
      this.emitFile({
        type: "asset",
        fileName: "web-share.png",
        source: image,
      });
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: robotsText(),
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: sitemapText(),
      });
    },
    closeBundle() {
      if (!building) return;
      const file = path.join(outputDirectory, "index.html");
      if (!fs.existsSync(file)) return;
      const html = fs.readFileSync(file, "utf8");
      for (const page of PUBLIC_PAGES.filter(page => page.path !== "/")) {
        const destination = path.join(
          outputDirectory,
          htmlFileForPath(page.path)
        );
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, applySiteMetadata(html, page));
      }
    },
  };
}
