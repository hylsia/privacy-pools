import "@/docs/docs.css";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { HylsiaMark } from "@/components/brand/HylsiaLogo";
import {
  BookOpen,
  Layers,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Info,
  KeyRound,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  X,
  AlertTriangle,
  type IconType,
} from "@/components/icons";
import { SCOPE_LINE } from "@/components/landing/system";
import { useTheme } from "@/contexts/ThemeContext";
import {
  DOC_GROUPS,
  DOC_PAGES,
  DOCS_REVIEW_DATE,
  docForPath,
  docHref,
  searchDocs,
  type DocBlock,
  type DocPage,
} from "@/docs/content";

const cardIcons: Record<string, IconType> = {
  book: BookOpen,
  shield: ShieldCheck,
  key: KeyRound,
  pool: Layers,
};

function DocLink({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return href.startsWith("https://") ? (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

function Blocks({ blocks }: { blocks: DocBlock[] }) {
  return blocks.map((block, index) => {
    if (block.kind === "text") return <p key={index}>{block.text}</p>;
    if (block.kind === "quote")
      return (
        <blockquote className="hd-quote" key={index}>
          <p>{block.text}</p>
          <cite>{block.caption}</cite>
        </blockquote>
      );
    if (block.kind === "callout") {
      const Icon = block.tone === "warning" ? AlertTriangle : Info;
      return (
        <aside key={index} className={`hd-callout hd-callout-${block.tone}`}>
          <Icon className="hd-icon" />
          <div>
            <strong>{block.title}</strong>
            <p>{block.text}</p>
          </div>
        </aside>
      );
    }
    if (block.kind === "list" || block.kind === "steps") {
      const Tag = block.kind === "steps" ? "ol" : "ul";
      return (
        <Tag key={index} className={`hd-${block.kind}`}>
          {block.items.map(item => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </li>
          ))}
        </Tag>
      );
    }
    if (block.kind === "table")
      return (
        <div
          className="hd-table-scroll"
          key={index}
          role="region"
          aria-label={block.headings.join(" and ")}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {block.headings.map(heading => (
                  <th key={heading} scope="col">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    if (block.kind === "cards")
      return (
        <div className="hd-cards" key={index}>
          {block.items.map(item => {
            const Icon = cardIcons[item.icon];
            return (
              <DocLink key={item.href} href={item.href} className="hd-card">
                <span className="hd-card-heading">
                  <Icon className="hd-icon" />
                </span>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </DocLink>
            );
          })}
        </div>
      );
    return (
      <div
        className="hd-flow"
        key={index}
        aria-label="Deposit, generate a proof locally, then withdraw. The transactions are public; their connection is not explicitly identified by the proof."
      >
        <div className="hd-flow-label">
          THE PRIVATE CONNECTION
        </div>
        <div className="hd-flow-track">
          <span>
            <span className="hd-flow-symbol">↘</span>
            <strong>Deposit</strong>
            <small>Into the shared pool</small>
          </span>
          <span className="hd-flow-line" aria-hidden />
          <span>
            <span className="hd-flow-symbol hd-flow-proof">
              <ShieldCheck className="hd-icon" />
            </span>
            <strong>Prove</strong>
            <small>On your device</small>
          </span>
          <span className="hd-flow-line" aria-hidden />
          <span>
            <span className="hd-flow-symbol">↗</span>
            <strong>Withdraw</strong>
            <small>To another address</small>
          </span>
        </div>
        <p>Public transactions. A connection the proof does not identify.</p>
      </div>
    );
  });
}

function Sidebar({
  page,
  onNavigate,
}: {
  page?: DocPage;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Documentation chapters" className="hd-chapters">
      {DOC_GROUPS.map(group => (
        <div className="hd-nav-group" key={group}>
          <h2>{group}</h2>
          {DOC_PAGES.filter(item => item.group === group).map(item => (
            <Link
              key={item.slug}
              href={docHref(item.slug)}
              onClick={onNavigate}
              aria-current={page?.slug === item.slug ? "page" : undefined}
              className="hd-nav-link"
            >
              {item.title}
              <span aria-hidden className="hd-nav-dot" />
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

function DocSearch({
  dialogRef,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const results = searchDocs(query).slice(0, 8);
  const finishNavigation = (href: string) => {
    dialogRef.current?.close();
    requestAnimationFrame(() => {
      const anchor = href.split("#")[1];
      if (anchor) document.getElementById(anchor)?.scrollIntoView();
    });
  };
  return (
    <dialog
      ref={dialogRef}
      className="hd-search-dialog"
      onClose={() => {
        setQuery("");
        onClose();
      }}
      onClick={e => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      aria-labelledby="docs-search-title"
    >
      <div className="hd-search-inner">
        <form
          onSubmit={e => {
            e.preventDefault();
            if (results[0]) {
              navigate(results[0].href);
              finishNavigation(results[0].href);
            }
          }}
        >
          <label
            htmlFor="docs-search-input"
            id="docs-search-title"
            className="sr-only"
          >
            Search documentation
          </label>
          <Search className="hd-icon" />
          <input
            id="docs-search-input"
            type="search"
            placeholder="Search the documentation…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <button
            type="button"
            className="hd-icon-button"
            aria-label="Close search"
            onClick={() => dialogRef.current?.close()}
          >
            <X className="hd-icon" />
          </button>
        </form>
        <div className="hd-search-results">
          <p className="hd-search-label" aria-live="polite">
            {query.trim()
              ? `${results.length} ${results.length === 1 ? "page" : "pages"} found`
              : "Start exploring"}
          </p>
          {results.map(result => (
            <Link
              key={result.href}
              href={result.href}
              onClick={() => finishNavigation(result.href)}
              className="hd-search-result"
            >
              <BookOpen className="hd-icon" />
              <span>
                <strong>{result.page.title}</strong>
                <small>{result.excerpt}</small>
              </span>
            </Link>
          ))}
          {results.length === 0 && (
            <p className="hd-search-empty">
              No pages match “{query}”. Try “backup”, “screening” or “withdraw”.
            </p>
          )}
        </div>
        <div className="hd-search-foot">
          <span>Search stays on this device</span>
          <span>
            <kbd>↵</kbd> open first result <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </dialog>
  );
}

export default function Docs() {
  const [location] = useLocation();
  const page = docForPath(location);
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLDialogElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const mobileRef = useRef<HTMLDetailsElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const firstRender = useRef(true);
  const pageIndex = DOC_PAGES.findIndex(item => item.slug === page?.slug);
  const previous = pageIndex > 0 ? DOC_PAGES[pageIndex - 1] : null;
  const next = pageIndex >= 0 ? DOC_PAGES[pageIndex + 1] : null;

  useEffect(() => {
    const previous = document.title;
    document.title = `${page?.title ?? "Page not found"} · Hylsia Docs`;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    const previousDescription = meta?.content;
    if (meta)
      meta.content =
        page?.description ?? "Explore Hylsia Privacy Pools documentation.";
    const hash = window.location.hash;
    if (hash)
      requestAnimationFrame(() => {
        try {
          document
            .getElementById(decodeURIComponent(hash.slice(1)))
            ?.scrollIntoView();
        } catch {
          /* malformed URL fragments are ignored, never rendered or executed */
        }
      });
    else window.scrollTo({ top: 0, behavior: "instant" });
    if (!firstRender.current)
      articleRef.current?.focus({ preventScroll: true });
    firstRender.current = false;
    setCopyState("idle");
    setActiveSection(page?.sections[0]?.id ?? "");
    return () => {
      document.title = previous;
      if (meta && previousDescription !== undefined)
        meta.content = previousDescription;
    };
  }, [page]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!searchRef.current?.open) searchRef.current?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!page || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries)
          visible.set(entry.target.id, entry.isIntersecting);
        const first = page.sections.find(section => visible.get(section.id));
        if (first) setActiveSection(first.id);
      },
      { rootMargin: "-100px 0px -55% 0px" }
    );
    for (const section of page.sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [page]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="hd-root">
      <a className="hd-skip" href="#docs-article">
        Skip to content
      </a>
      <header className="hd-header">
        <div className="hd-header-inner">
          <div className="hd-brand-group">
            <Link href="/" className="hd-brand" aria-label="Hylsia home">
              <HylsiaMark size={30} />
              <span>Hylsia</span>
            </Link>
            <span className="hd-brand-divider" aria-hidden />
            <Link href="/docs" className="hd-brand-docs">
              Docs
            </Link>
          </div>
          <button
            ref={searchTrigger}
            type="button"
            className="hd-search-trigger"
            onClick={() => searchRef.current?.showModal()}
            aria-label="Search documentation"
          >
            <Search className="hd-icon" />
            <span>Search documentation…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="hd-header-actions">
            <span className="hd-testnet-badge">
              <span />
              Testnet
            </span>
            <button
              type="button"
              className="hd-icon-button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="hd-icon" />
              ) : (
                <Moon className="hd-icon" />
              )}
            </button>
            <Link href="/pools" className="hd-open-app">
              Open app
            </Link>
          </div>
        </div>
      </header>

      <div className="hd-layout">
        <aside className="hd-sidebar">
          <div className="hd-space-label">
            <BookOpen className="hd-icon" />
            <span>
              Privacy Pools<small>The Hylsia documentation</small>
            </span>
            <span className="hd-version">v0.1</span>
          </div>
          <Sidebar page={page} />
          <div className="hd-sidebar-foot">
            <ShieldCheck className="hd-icon" />
            <p>
              Built for Robinhood Chain Testnet.
              <br />
              <Link href="/docs/security">Read the current safety limits </Link>
            </p>
          </div>
        </aside>
        <div className="hd-main-column">
          <details className="hd-mobile-menu" ref={mobileRef}>
            <summary>
              <span>
                <BookOpen className="hd-icon" />
                {page?.title ?? "Documentation"}
              </span>
              <ChevronDown className="hd-icon" />
            </summary>
            <Sidebar
              page={page}
              onNavigate={() => mobileRef.current?.removeAttribute("open")}
            />
          </details>
          <main
            id="docs-article"
            className="hd-article"
            ref={articleRef}
            tabIndex={-1}
          >
            {page ? (
              <>
                <div className="hd-article-toolbar">
                  <span className="hd-eyebrow">{page.group}</span>
                  <button
                    type="button"
                    className="hd-copy-link"
                    onClick={copyLink}
                  >
                    {copyState === "copied" ? (
                      <Check className="hd-icon" />
                    ) : (
                      <Copy className="hd-icon" />
                    )}
                    <span aria-live="polite">
                      {copyState === "copied"
                        ? "Link copied"
                        : copyState === "failed"
                          ? "Copy the address bar link"
                          : "Copy page link"}
                    </span>
                  </button>
                </div>
                <h1>{page.title}</h1>
                <p className="hd-description">{page.description}</p>
                <div className="hd-article-meta">
                  <span>
                    <Clock className="hd-icon" />
                    {page.readTime} min read
                  </span>
                  <span className="hd-meta-dot" />
                  Reviewed {DOCS_REVIEW_DATE}
                </div>
                <div className="hd-prose">
                  {page.sections.map(section => (
                    <section key={section.id} id={section.id}>
                      <h2>
                        <a href={`#${section.id}`}>
                          {section.title}
                          <span className="hd-anchor" aria-hidden>
                            #
                          </span>
                        </a>
                      </h2>
                      <Blocks blocks={section.blocks} />
                    </section>
                  ))}
                </div>
                <div
                  className="hd-page-nav"
                  aria-label="Previous and next chapters"
                >
                  {previous ? (
                    <Link
                      href={docHref(previous.slug)}
                      className="hd-page-nav-card"
                    >
                      <span>
                        <small>Previous</small>
                        <strong>{previous.title}</strong>
                      </span>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {next && (
                    <Link
                      href={docHref(next.slug)}
                      className="hd-page-nav-card hd-page-nav-next"
                    >
                      <span>
                        <small>Next</small>
                        <strong>{next.title}</strong>
                      </span>
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <div className="hd-not-found">
                <span className="hd-eyebrow">Documentation / 404</span>
                <h1>This chapter isn’t here.</h1>
                <p>
                  Follow a chapter in the sidebar or search the documentation to
                  find what you need.
                </p>
                <Link href="/docs" className="hd-open-app">
                  Back to the introduction
                </Link>
              </div>
            )}
            <footer className="hd-footer">
              <span>{SCOPE_LINE}</span>
              <Link href="/docs/manifesto">The Hylsia manifesto</Link>
            </footer>
          </main>
        </div>
        {page && (
          <aside className="hd-toc" aria-label="On this page">
            <div>
              <p>On this page</p>
              <nav>
                {page.sections.map(section => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    aria-current={
                      activeSection === section.id ? "location" : undefined
                    }
                    onClick={() => setActiveSection(section.id)}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className="hd-toc-note">
                Testnet documentation
                <p>
                  A local review is not a public release.{" "}
                  <Link href="/docs/security">See project status</Link>
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>
      <DocSearch
        dialogRef={searchRef}
        onClose={() => searchTrigger.current?.focus({ preventScroll: true })}
      />
    </div>
  );
}
