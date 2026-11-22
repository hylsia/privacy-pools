import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applySiteMetadata,
  METADATA_START,
  METADATA_END,
  renderSiteMetadata,
  SHARE_IMAGE,
  shouldIndexPath,
  SITE_DESCRIPTION,
  SITE_ORIGIN,
  SITE_TITLE,
} from "../../shared/siteMetadata";
import { DOC_PAGES, docHref } from "../../client/src/docs/content";
import {
  PUBLIC_PAGES,
  htmlFileForPath,
  metadataForPath,
  robotsText,
  sitemapText,
  siteSeoPlugin,
} from "../../scripts/vite/siteSeo";

const ROOT = path.resolve(import.meta.dirname, "../..");
describe("US-English metadata and original share artwork", () => {
  it("puts absolute image URLs and US locale in the initial HTML, with large-image cards", () => {
    const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain(
      `property="og:image" content="${SITE_ORIGIN}/web-share.png"`
    );
    expect(html).toContain('property="og:locale" content="en_US"');
    expect(html).toContain('name="geo.region" content="US"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(
      `name="twitter:image" content="${SITE_ORIGIN}/web-share.png"`
    );
  });

  it("keeps canonical URLs free of queries/fragments and escapes metadata instead of injecting HTML", () => {
    const tags = renderSiteMetadata({
      path: "/docs/privacy?tracking=sample#trust",
      title: '<script>"test"</script>',
      description: 'Privacy & "trust"',
    });
    expect(tags).toContain(
      `rel="canonical" href="${SITE_ORIGIN}/docs/privacy"`
    );
    expect(tags).not.toContain("tracking=");
    expect(tags).not.toContain("#trust");
    expect(tags).not.toContain("<script>");
    expect(tags).toContain("&lt;script&gt;");
    expect(() =>
      renderSiteMetadata({
        path: "https://another.example",
        title: "test",
        description: "test",
      })
    ).toThrow("Hylsia site origin");
  });

  it("renders the right chapter metadata before JavaScript and replaces the block without duplicate tags", () => {
    const template = `<html><head>${METADATA_START}old${METADATA_END}</head><body>app</body></html>`;
    for (const chapter of DOC_PAGES) {
      const page = metadataForPath(docHref(chapter.slug));
      const html = applySiteMetadata(applySiteMetadata(template, page), page);
      expect(html).toContain(
        `${chapter.title.replaceAll("&", "&amp;")} | Hylsia Docs`
      );
      expect(html).toContain(
        `rel="canonical" href="${SITE_ORIGIN}${docHref(chapter.slug)}"`
      );
      expect(html.match(/property="og:image"/g)).toHaveLength(1);
      expect(html).toContain("<body>app</body>");
    }
    expect(() =>
      applySiteMetadata("<html>missing</html>", {
        path: "/",
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
      })
    ).toThrow("markers");
    expect(htmlFileForPath("/docs/security")).toBe("docs/security/index.html");
  });

  it("publishes the user's PNG byte-for-byte with dimensions matching the social metadata", async () => {
    const image = fs.readFileSync(path.join(ROOT, "public/web-share.png"));
    expect(image.readUInt32BE(16)).toBe(SHARE_IMAGE.width);
    expect(image.readUInt32BE(20)).toBe(SHARE_IMAGE.height);
    const emitted: { fileName: string; source: string | Uint8Array }[] = [];
    const hook = siteSeoPlugin(ROOT).generateBundle;
    expect(typeof hook).toBe("function");
    await (hook as Function).call({
      emitFile: (asset: { fileName: string; source: string | Uint8Array }) =>
        emitted.push(asset),
    });
    expect(
      Buffer.from(
        emitted.find(asset => asset.fileName === "web-share.png")!.source
      )
    ).toEqual(image);
  });

  it("includes public chapters in the sitemap while excluding vault/account and API routes", () => {
    const sitemap = sitemapText();
    for (const page of PUBLIC_PAGES)
      expect(sitemap).toContain(`${SITE_ORIGIN}${page.path}`);
    expect(new Set(PUBLIC_PAGES.map(page => page.path)).size).toBe(
      PUBLIC_PAGES.length
    );
    for (const p of [
      "/pools/vault",
      "/pools/portfolio",
      "/privacy",
      "/api/trpc",
      "/health/ready",
      "/zk/withdraw.zkey",
    ]) {
      expect(shouldIndexPath(p)).toBe(false);
      expect(sitemap).not.toContain(`${SITE_ORIGIN}${p}`);
    }
    expect(shouldIndexPath("/docs/privacy")).toBe(true);
    expect(robotsText()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(renderSiteMetadata(metadataForPath("/pools/vault"))).toContain(
      'content="noindex, nofollow"'
    );
  });
});
