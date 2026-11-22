import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOC_PAGES,
  docForPath,
  docHref,
  searchDocs,
} from "../../client/src/docs/content";
import { isDocsArea, isPrivacyArea } from "../../client/src/areas";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("standalone documentation navigation and search", () => {
  it("keeps docs separate from the vault and rejects similarly prefixed routes", () => {
    for (const path of [
      "/docs",
      "/docs/",
      "/docs/manifesto",
      "/docs/security",
    ]) {
      expect(isDocsArea(path)).toBe(true);
      expect(isPrivacyArea(path)).toBe(false);
    }
    for (const path of ["/docs-old", "/Docs", "/pools/docs", "/documentation"])
      expect(isDocsArea(path)).toBe(false);
    expect(docForPath("/docs/missing")).toBeUndefined();
  });
  it("keeps every canonical chapter, section anchor and internal card link resolvable", () => {
    expect(new Set(DOC_PAGES.map(p => p.slug)).size).toBe(DOC_PAGES.length);
    for (const page of DOC_PAGES) {
      expect(docForPath(docHref(page.slug))).toBe(page);
      expect(docForPath(`${docHref(page.slug)}/`)).toBe(page);
      expect(new Set(page.sections.map(s => s.id)).size).toBe(
        page.sections.length
      );
      for (const section of page.sections)
        for (const block of section.blocks) {
          if (block.kind === "cards")
            for (const card of block.items)
              if (isDocsArea(card.href))
                expect(docForPath(card.href)).toBeDefined();
        }
    }
  });
  it("finds full-text recovery and security concepts, with valid result anchors", () => {
    expect(
      searchDocs("  BACKUP   recovery ").some(r => r.page.slug === "recovery")
    ).toBe(true);
    expect(
      searchDocs("precommitment").some(r => r.page.slug === "security")
    ).toBe(true);
    expect(searchDocs("anvil").some(r => r.page.slug === "security")).toBe(
      true
    );
    expect(searchDocs("zzzz-nonexistent")).toEqual([]);
    for (const result of searchDocs("nullifier")) {
      if (result.section)
        expect(result.href).toBe(
          `${docHref(result.page.slug)}#${result.section.id}`
        );
    }
  });
  it("treats search input as plain text rather than HTML or a regular expression", () => {
    expect(searchDocs("<script>alert(1)</script>")).toEqual([]);
    expect(searchDocs("(.*)+[")).toEqual([]);
    expect(searchDocs("   ").length).toBeGreaterThan(0);
  });
  it("never initializes page-view tracking for a documentation visit", async () => {
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      head: { appendChild },
      createElement: vi.fn(),
    });
    vi.stubEnv("VITE_ANALYTICS_ENDPOINT", "https://analytics.example");
    vi.stubEnv("VITE_ANALYTICS_WEBSITE_ID", "test");
    const { trackPageView } = await import("../../client/src/analytics");
    trackPageView("/docs/security");
    expect(appendChild).not.toHaveBeenCalled();
  });
});

// These statements concern a reproduced loss-of-access condition, so keep the public copy aligned with the report.
describe("documentation and website safety alignment", () => {
  it("uses the same duplicate-nullifier limitation and distinguishes deployment from validation", async () => {
    const { DUPLICATE_NOTE_RISK, PUBLIC_VALIDATION_STATUS } = await import("../../client/src/privacy/safetyCopy");
    const security = DOC_PAGES.find((page) => page.slug === "security")!;
    expect(JSON.stringify(security)).toContain(DUPLICATE_NOTE_RISK);
    expect(JSON.stringify(security)).toContain(PUBLIC_VALIDATION_STATUS);
    expect(searchDocs("nullifier").some((result) => result.page.slug === "ragequit")).toBe(true);
  });

  it("does not restore the website's incorrect guarantee of duplicate-note ragequit recovery", async () => {
    const fs = await import("node:fs");
    const files = [
      "client/src/components/privacy/NotesPanel.tsx",
      "client/src/components/privacy/PrivacyNotice.tsx",
      "client/src/components/landing/sections/Faq.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain("DUPLICATE_NOTE_RISK");
      expect(source.replace(/\s+/g, " ")).not.toMatch(/others can only be recovered through ragequit|public exit back to the depositing address always works/);
    }
  });

  it("points the deposit guide to the actual vault and describes its current tabs", () => {
    const deposit = DOC_PAGES.find((page) => page.slug === "deposit")!;
    const cards = deposit.sections.flatMap((section) => section.blocks.filter((block) => block.kind === "cards"));
    expect(cards.some((block) => block.kind === "cards" && block.items.some((item) => item.href === "/pools/vault"))).toBe(true);
    expect(JSON.stringify(deposit)).toContain("Backup & recovery");
    const withdrawal = DOC_PAGES.find((page) => page.slug === "withdraw")!;
    expect(JSON.stringify(withdrawal)).toContain("Pay your own gas (from my wallet)");
    expect(JSON.stringify(withdrawal)).toContain("Connection settings");
  });
});
