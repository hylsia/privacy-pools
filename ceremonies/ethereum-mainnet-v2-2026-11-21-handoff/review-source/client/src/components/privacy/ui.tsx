/**
 * Shared look of the vault workspace (/pools/vault). It matches the Pools
 * dashboard and the pool page: dense rounded-xl cards, underline tabs, bordered
 * value boxes with the focus ring on the box, small status pills.
 *
 * index.css styles every input and every [role="tablist"] with unlayered
 * !important rules. Tailwind's important utilities (`bg-transparent!` …) live in
 * a cascade layer, and a layered !important beats an unlayered one, so the
 * classes below switch those globals off where the workspace draws its own.
 */
import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, ChevronRight, ExternalLink, Faucet, Layers, Terminal, type IconType } from "@/components/icons";
import { GlyphTile } from "@/components/landing/scene/bands-ui";
import { PoolStatePill } from "@/components/landing/usePoolStatus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRIVACY_NETWORKS } from "@/privacy/config";
import type { NetworkInfo, NetworkSlug } from "@shared/privacy/networks";

/** The pool avatar lives with the brand marks; re-exported here for the workspace strips. */
export { PoolMark } from "@/components/brand/PoolMark";

/** A workspace card (the same one as on My notes and the pool page). */
export const CARD = "rounded-xl border border-border/50 bg-card/60";
/** A block nested inside a card: a step, a sub-section, a note. */
export const INSET = "rounded-lg border border-border/50 bg-background/40";
/** Bordered value box that carries the focus ring; the input inside is transparent. */
export const FIELD_BOX =
  "flex h-11 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 transition-colors focus-within:border-primary/50";
export const FIELD_INPUT =
  "h-full w-full min-w-0 flex-1 bg-transparent! text-sm text-foreground placeholder:text-muted-foreground/60 focus:shadow-none! focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";
/** A file picker inside FIELD_BOX. */
export const FILE_INPUT =
  "w-full min-w-0 flex-1 bg-transparent! text-xs text-muted-foreground focus:shadow-none! focus:outline-none file:mr-3 file:h-7 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:text-xs file:font-medium file:text-foreground";
export const HINT = "mt-1.5 text-xs leading-relaxed text-muted-foreground";
/** Small mono buttons riding a field label (Max, Full). */
export const TOOL_BTN =
  "h-7 shrink-0 rounded-md px-2 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50";
/**
 * Text colour for filled (primary) <button>s. index.css paints every button with a bg-primary class in black,
 * which is fine on the dark theme's lavender but too weak on the light theme's indigo; the theme's own
 * foreground matches a filled link (Button asChild around a Link, which that rule does not reach).
 */
export const FILLED_TEXT = "text-primary-foreground!";
/**
 * Keyboard focus for filled (primary) buttons. The Button's focus ring is a box-shadow, and index.css gives every
 * <button> with a bg-primary class its own unlayered `box-shadow: … !important`, so the ring never shows. An outline
 * is untouched by that rule (and also survives forced-colors mode); the 2px offset keeps it apart from the fill.
 */
export const FILLED_FOCUS = "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
/** Everything a filled (primary) button in the workspace needs on top of the Button's own classes. */
export const FILLED = `${FILLED_TEXT} ${FILLED_FOCUS}`;
/** The side panel's main call to action (Create vault, Unlock, Deposit, Withdraw); always a filled button. Pill-shaped like the landing's CTAs. */
export const CTA = `h-12 w-full rounded-full text-base ${FILLED}`;
/** Secondary full-width form buttons (pill-shaped, like the landing's secondary CTA). */
export const CTA_SM = "h-10 w-full rounded-full";
/**
 * Hover for outline and ghost buttons, as on the landing's CTA_SECONDARY: the Button's own hover fills them with
 * --accent, which on the light theme is the indigo primary under navy text (about 2.4:1). Never a bg-primary class:
 * index.css paints such buttons' text black.
 */
export const QUIET_HOVER = "hover:bg-secondary hover:text-secondary-foreground dark:hover:bg-input/50 dark:hover:text-foreground";
/** Rose caution, like the landing's "linked again" / "payer is visible" chips: a box and its text. */
export const CAUTION_BOX = "border-red-700/30 bg-red-700/5 dark:border-destructive/30 dark:bg-destructive/5";
/**
 * Fill for a destructive button (variant="destructive") in the same rose shades as CAUTION_BOX and TONE_TEXT. The variant's own fill is
 * white on #EF4444 in light (3.8:1) and white on a 60% rose in dark (about 3:1); these are 6.5:1 and 10:1.
 */
export const DANGER_FILL =
  "bg-red-700 text-white hover:bg-red-700/90 dark:bg-destructive dark:text-destructive-foreground dark:hover:bg-destructive/90";

/** Switches off index.css's card look on [role="tablist"] (background, border, blur). */
const TABLIST_RESET = "bg-transparent! border-0! backdrop-filter-none!";

export function FieldLabel({ htmlFor, label, right }: { htmlFor?: string; label: ReactNode; right?: ReactNode }) {
  const cls = "text-[13px] font-medium text-muted-foreground";
  return (
    <div className="mb-1.5 flex min-h-6 items-center gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={cls}>
          {label}
        </label>
      ) : (
        <span className={cls}>{label}</span>
      )}
      {right && <div className="ml-auto flex items-center gap-0.5">{right}</div>}
    </div>
  );
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

export interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Underline tabs (the Pools toolbar style) with tab semantics:
 * arrow keys, Home and End move between the enabled tabs.
 */
export function UnderlineTabs<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  size = "md",
  trailing,
  className = "",
}: {
  id: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "md" | "lg";
  trailing?: ReactNode;
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = items.filter((i) => !i.disabled).map((i) => i.key);
    if (keys.length === 0) return;
    const at = Math.max(0, keys.indexOf(value));
    const to =
      e.key === "ArrowRight"
        ? keys[(at + 1) % keys.length]
        : e.key === "ArrowLeft"
          ? keys[(at - 1 + keys.length) % keys.length]
          : e.key === "Home"
            ? keys[0]
            : e.key === "End"
              ? keys[keys.length - 1]
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onChange(to);
    document.getElementById(`${id}-tab-${to}`)?.focus();
  };

  return (
    <div className={`flex min-w-0 items-end gap-3 border-b border-border/50 ${className}`}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex min-w-0 items-center gap-4 @md:gap-5 ${TABLIST_RESET}`}>
        {items.map((item) => {
          const on = item.key === value && !item.disabled;
          return (
            <button
              key={item.key}
              id={`${id}-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={on ? `${id}-panel` : undefined}
              tabIndex={on ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.key)}
              className={`-mb-px inline-flex h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-0.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 ${
                size === "lg" ? "text-base" : "text-sm"
              } ${on ? "border-primary text-foreground" : "border-transparent text-muted-foreground enabled:hover:text-foreground"}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {trailing && <span className="ml-auto min-w-0 truncate pb-2 text-xs text-muted-foreground">{trailing}</span>}
    </div>
  );
}

export function TabPanel({ id, value, className = "", children }: { id: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}

/** A small count after a tab label. */
export function TabCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="ml-1.5 rounded bg-muted px-1.5 py-px font-mono text-xs font-medium text-muted-foreground">{n}</span>;
}

// ─── strip pieces ─────────────────────────────────────────────────────────────

/** A figure in the vault's pool strip. `mark` sits before the label (the gold note diamond for "yours"). */
export function Figure({ label, value, sub, title, mark }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; mark?: ReactNode }) {
  return (
    <div className="shrink-0" title={title}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {mark}
        {label}
      </p>
      <p className="font-mono text-[15px] font-semibold leading-6 text-foreground">
        {value}
        {sub && <span className="ml-1.5 font-sans text-xs font-medium text-muted-foreground">{sub}</span>}
      </p>
    </div>
  );
}

/**
 * Status text colours that stay readable (4.5:1) on their own tints and on the cards. On the light theme the
 * profit and destructive tokens are too light for small text (2.4–3.6:1), so light mode uses darker shades of the
 * same hues. "warning" is the theme's lavender-tinted muted text (about 6:1 in both themes): the grey --warning
 * token appears nowhere on the website, and the caution that matters (a link risk) is rose, as on the landing.
 */
export const TONE_TEXT = {
  profit: "text-emerald-800 dark:text-profit",
  warning: "text-muted-foreground",
  destructive: "text-red-700 dark:text-destructive",
} as const;

const PILL_TONE = {
  muted: "bg-muted/70 text-muted-foreground",
  primary: "bg-primary/12 text-primary",
  profit: `bg-profit/15 ${TONE_TEXT.profit}`,
  warning: `bg-muted/70 ${TONE_TEXT.warning}`,
  destructive: `bg-destructive/15 ${TONE_TEXT.destructive}`,
} as const;
export type PillTone = keyof typeof PILL_TONE;

export function Pill({
  tone = "muted",
  icon: Icon,
  spin = false,
  small = false,
  title,
  children,
}: {
  tone?: PillTone;
  icon?: IconType;
  spin?: boolean;
  /** table-row size */
  small?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium ${small ? "h-[22px] px-1.5 text-xs" : "h-7 px-2 text-xs"} ${PILL_TONE[tone]}`}
    >
      {Icon && <Icon className={`h-3 w-3 ${spin ? "motion-safe:animate-spin" : ""}`} aria-hidden />}
      {children}
    </span>
  );
}

// ─── pool status ──────────────────────────────────────────────────────────────

/**
 * A pool's status, one pill everywhere (Pools table, quick view, pool page), drawn like the landing's
 * PoolStatePill: rounded-full, 6px dot, 12px. Emerald = open (the landing's "live" tone), muted = private withdrawals
 * wait for the association-set publisher, rose = deposits closed (withdrawals and ragequit still work).
 */
const POOL_STATUS = {
  open: { label: "Open", pill: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-600 dark:bg-emerald-400" },
  awaiting: { label: "Awaiting association set", pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  closed: { label: "Deposits closed", pill: "bg-red-700/8 text-red-700 dark:bg-destructive/12 dark:text-destructive", dot: "bg-red-700 dark:bg-destructive" },
} as const;

export type PoolStatus = keyof typeof POOL_STATUS;

/**
 * Open: deposits and private withdrawals work. A pool without an association-set root yet is open too (an empty one,
 * or one whose first root the server's publisher posts once a deposit has passed screening). It is "awaiting"
 * only while it has deposits, no published root, and a publisher that reports it cannot post one now (`aspCanPublish`
 * false; unknown counts as able).
 */
export function poolStatus(pool: { dead: boolean; aspRootPublished: boolean; deposits?: number; aspCanPublish?: boolean }): PoolStatus {
  if (pool.dead) return "closed";
  return !pool.aspRootPublished && (pool.deposits ?? 0) > 0 && pool.aspCanPublish === false ? "awaiting" : "open";
}

export function PoolStatusPill({ status, wrap = false, className }: { status: PoolStatus; /** dense tables: a long label may take two lines */ wrap?: boolean; className?: string }) {
  const s = POOL_STATUS[status];
  if (wrap) {
    // the dot flows inline, so a second line ("association set") gets the pill's full width; a fixed width, so a
    // squeezed table column never breaks it into three lines
    return (
      <span className={cn("inline-block w-[7.25rem] rounded-xl px-2.5 py-1 text-left text-xs font-medium leading-4", s.pill, className)}>
        <span aria-hidden className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", s.dot)} />
        {s.label}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-4", s.pill, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

// ─── deployment pending ───────────────────────────────────────────────────────

const DEV_CODE = "mt-1.5 overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-foreground";

/** A faucet in words. */
const FAUCET_WORDS: Partial<Record<NetworkSlug, { button: string; cta: string }>> = {
  "robinhood-testnet": { button: "Robinhood Chain Testnet faucet", cta: "Get testnet ETH" },
};

/** The button that opens a network's faucet ("Robinhood Chain Testnet faucet"). */
export const faucetButtonLabel = (n: NetworkInfo) => FAUCET_WORDS[n.slug]?.button ?? `${n.name} faucet`;
/** The deposit form's faucet link ("Get testnet ETH"). */
export const faucetLinkLabel = (n: NetworkInfo) => FAUCET_WORDS[n.slug]?.cta ?? "Get testnet ETH";

/**
 * The operator's deploy command for each network (package.json). A public testnet's command is a dry run until it is
 * given --broadcast (scripts/privacy/deploy.ts); the local one deploys to the local anvil at once. A network without
 * one here (none today) gets the README's pointer only.
 */
const DEPLOY_SCRIPT: Partial<Record<NetworkSlug, string>> = {
  "robinhood-testnet": "npm run zk:deploy:robinhood",
  "robinhood-mainnet": "npm run zk:deploy:robinhood-mainnet",
  "local-a": "npm run zk:deploy:local",
  "local-b": "npm run zk:deploy:local",
};
const deployScripts = (networks: readonly NetworkInfo[]): string[] => [
  ...new Set(networks.flatMap((n) => (DEPLOY_SCRIPT[n.slug] ? [DEPLOY_SCRIPT[n.slug]!] : []))),
];
/**
 * A dry run needs the deployer's address and nothing else (no key, no funds): forge only simulates. Without it
 * deploy.ts stops at "deploy: no signer" (scripts/privacy/deploy.ts; README, "Deploy ke testnet").
 */
const dryRunLine = (script: string) => `${script} -- --sender <0x…>`;
/**
 * A broadcast, as two shell lines that fit the box (a forge keystore account; deploy.ts also takes --ledger, see the
 * README): "<script> -- --broadcast \" and its signer arguments.
 */
const broadcastLines = (script: string) => [`${script} -- --broadcast \\`, "  --account <name> --sender <0x…>"];

/** Commands, one per line, in a scrollable code box (a long line scrolls inside the box, never the page). */
function DevCode({ lines }: { lines: readonly string[] }) {
  return (
    <pre className={DEV_CODE}>
      <code>
        {lines.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && "\n"}
            {s}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}

/** The build's networks that have no pool yet (a network with a configuration problem is unavailable, not pending). */
const pendingNetworks = (): NetworkInfo[] => PRIVACY_NETWORKS.filter((n) => !n.pool && !n.problem).map((n) => n.network);

/** "A or B", "A, B or C" */
const orList = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);

/**
 * The one "deployment pending" story every dashboard page tells while no network has a pool yet (/pools, My
 * notes, the vault), in the landing's words: the Deployment pending pill, the status sentence, then the next steps (How
 * it works on the landing, each network's faucet). The operator commands stay folded away under "For developers". No
 * figures, no errors. With one network (the `network` prop, or a build that offers one) it speaks of that pool alone.
 */
export function DeploymentPending({
  titleId,
  title,
  note,
  pill = true,
  network,
  className,
}: {
  titleId?: string;
  title?: string;
  /** one page-specific line under the status sentence */
  note?: ReactNode;
  /** false where a strip right above already carries the Deployment pending pill (the vault) */
  pill?: boolean;
  /** one network's pool only */
  network?: NetworkInfo;
  className?: string;
}) {
  const pending = pendingNetworks();
  const networks = network ? [network] : pending.length > 0 ? pending : PRIVACY_NETWORKS.map((n) => n.network);
  const one = networks.length === 1 ? networks[0] : null;
  const heading = title ?? (one ? `The ${one.name} pool is not deployed yet` : "The pools are not deployed yet");
  const faucets = networks.filter((n) => n.faucet);
  // The operator's steps: the circuits and proving keys are already built (client/public/zk), so they start at the
  // deploy scripts, with a dry run first. A circuit rebuild is never a step: each one is a new random setup, and a
  // pool deployed before it would reject the new proofs.
  const preparingMainnet = networks.some((n) => n.chain.testnet !== true);
  const publicScripts = deployScripts(networks.filter((n) => n.kind !== "local" && n.chain.testnet === true));
  const localScripts = deployScripts(networks.filter((n) => n.kind === "local"));
  const perNetwork = publicScripts.length > 1 ? " (one command per network)" : "";
  const devSteps: { text: ReactNode; lines?: string[] }[] = [
    ...(preparingMainnet ? [{ text: "Check mainnet readiness without a signer or transactions. Resolve the reported protocol blockers before deployment.", lines: ["npm run zk:mainnet:preflight"] }] : []),
    ...(publicScripts.length > 0
      ? [
          {
            text: `Check the deployment with a dry run from the deployer's address${perNetwork}. No key is needed and nothing is sent.`,
            lines: publicScripts.map(dryRunLine),
          },
          { text: "Deploy from your deployer account (testnet ETH only)", lines: publicScripts.flatMap(broadcastLines) },
        ]
      : []),
    ...(localScripts.length > 0 ? [{ text: "Deploy to the local chain (anvil)", lines: localScripts }] : []),
    {
      text: (
        <>
          Restart or rebuild the app. See <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground">docs/privacy-pools/README.md</code>.
        </>
      ),
    },
  ];
  return (
    <div className={cn("relative flex min-w-0 flex-col items-center overflow-hidden px-5 py-10 text-center sm:px-8", className)}>
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <GlyphTile className="relative">
        <Layers className="h-[18px] w-[18px]" />
      </GlyphTile>
      {pill && <PoolStatePill state="pending" className="relative mt-4" />}
      <h2
        id={titleId}
        className={cn("relative font-display text-xl font-semibold tracking-[-0.03em] text-foreground sm:text-2xl", pill ? "mt-3" : "mt-4")}
      >
        {heading}
      </h2>
      <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {/* the landing's words (Network, FAQ): npm run zk:e2e runs the whole flow on local anvil chains */}
        {preparingMainnet
          ? "Mainnet migration is in preparation. Deposits remain unavailable until the release blockers are resolved and a new mainnet pool is deployed. "
          : "Circuits, contracts and the app are built and tested end-to-end on a local chain. "}
        {one
          ? `The pool address will appear here as soon as it is deployed to ${one.name} (chain ${one.chainId}).`
          : `Each pool's address will appear here as soon as it is deployed to ${orList(networks.map((n) => n.name))}.`}
      </p>
      {note && <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{note}</p>}
      <div className="relative mt-5 flex flex-wrap justify-center gap-2">
        {/* the landing's step-by-step story (its "How it works" chapter); a filled link, so no FILLED_TEXT needed */}
        <Button asChild className={`h-10 rounded-full px-5 has-[>svg]:px-5 ${FILLED_FOCUS}`}>
          <Link href="/#how-it-works">
            How it works <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
        {faucets.map((n) => (
          <Button key={n.chainId} asChild variant="outline" className={`h-10 rounded-full border-border/60 bg-card/50 px-5 has-[>svg]:px-5 ${QUIET_HOVER}`}>
            <a href={n.faucet!.url} target="_blank" rel="noopener noreferrer">
              <Faucet className="size-3.5 text-muted-foreground" aria-hidden /> {faucetButtonLabel(n)}
              <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        ))}
      </div>

      <details className="group relative mt-7 w-full max-w-md text-left">
        <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <Terminal className="h-3.5 w-3.5" aria-hidden />
          For developers
          <ChevronRight className="h-3 w-3 motion-safe:transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className={`${INSET} mt-2 space-y-3 p-4 text-xs text-muted-foreground`}>
          <p className="leading-relaxed">
            {preparingMainnet
              ? "The active proving keys use a development trusted setup. Mainnet broadcast is blocked; the testnet pool and proving artifacts remain separate from the mainnet release."
              : <>The circuits and proving keys are already built. Deploy with them as they are
                  {publicScripts.length > 1 ? ", every network from this same build" : ""}: rebuilding the circuits makes a new random setup, and a pool
                  deployed before it would reject the new proofs.</>}
          </p>
          <ol className="space-y-3">
            {devSteps.map((s, i) => (
              <li key={i}>
                <p>
                  {i + 1}. {s.text}
                </p>
                {s.lines && <DevCode lines={s.lines} />}
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}

/** A calm, centred empty state inside a workspace card. */
export function EmptyState({ icon: Icon, title, children }: { icon: IconType; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-background/70">
        <Icon className="h-[18px] w-[18px] text-primary" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

// ─── panel pieces ─────────────────────────────────────────────────────────────

export interface Step {
  label: string;
  state: "done" | "current" | "todo";
}

/** "1 Create vault · 2 Verify backup · 3 Deposit": three columns, so it never wraps mid-step. */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className={`${INSET} grid px-1 py-2.5`} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.label} aria-current={s.state === "current" ? "step" : undefined} className="relative flex flex-col items-center gap-1.5 text-center">
          {i > 0 && (
            <span
              aria-hidden
              className={`absolute top-2.5 h-px ${steps[i - 1].state === "done" ? "bg-profit/50" : "bg-border"}`}
              style={{ left: "calc(-50% + 18px)", right: "calc(50% + 18px)" }}
            />
          )}
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
              s.state === "done" ? `bg-profit/15 ${TONE_TEXT.profit}` : s.state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {s.state === "done" ? <Check className="h-2.5 w-2.5" aria-hidden /> : i + 1}
          </span>
          <span className={`px-1 text-xs leading-tight ${s.state === "current" ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {s.label}
            {s.state === "done" && <span className="sr-only"> (done)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A calm explanatory note (replaces the page-level alerts inside the workspace). */
export function InfoNote({ icon: Icon, title, children }: { icon: IconType; title: string; children: ReactNode }) {
  return (
    <div className={`${INSET} flex gap-3 p-3`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** What still has to happen before an action is possible. */
export function Checklist({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`${INSET} px-3 py-2.5`}>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {items.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
      <span className="h-px flex-1 bg-border/60" aria-hidden />
      or
      <span className="h-px flex-1 bg-border/60" aria-hidden />
    </div>
  );
}
