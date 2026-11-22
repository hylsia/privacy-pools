/**
 * Landing section "The network" (#network) — the chain in the night sky.
 *
 * A pass-through band. Above a sea of cloud, three lanes of glowing blocks
 * cross the sky at three depths and slide sideways with the scroll, each at
 * its own pace (far slow, near fast, all the same way). One public deposit
 * rides the middle lane and one public withdrawal the near lane, in different
 * blocks that never line up: "Public blocks ✦ Private link". Below, on the
 * dark cloud bank, the network itself: "Built for Robinhood Chain Testnet."
 * with the Robinhood Chain plate, compact fact cards and the pool status.
 *
 * Depth, back to front:
 *   sky 0.06    the band sky and the stars
 *   far 0.14    distant peaks
 *   mid 0.28    the cloud sea in their valleys, a band of mist
 *   near 0.6    a dark, backlit cloud bank under the facts
 *   lanes       the chain (aria-hidden): sideways only, far 14 · mid 30 ·
 *               near 56 vw per unit of progress, centred when the band is
 *               mid-screen; they ride with the copy vertically
 *   static      vignette, scrims, night blends at both edges, copy and glass
 *
 * The Robinhood Chain logo sits on its own plate in the header aside: static,
 * never moved, scaled or faded, and nothing it sits in moves either. The
 * status row reads usePoolStatus() (the page's one status request); it never
 * shows a figure unless the pool is live. A development build that serves
 * several networks (local chains) gets one status row per network, each
 * named; the normal build serves Robinhood Chain Testnet alone and shows the
 * single row. The stage is keyed by tier and reduced motion, so every range
 * is constant per mount; with reduced motion the band is the still
 * composition and the lanes rest centred.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { RobinhoodChainLogo } from "@/components/brand/RobinhoodChain";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Check,
  Copy,
  EyeOff,
  Faucet,
  GasPump,
  Hashtag,
  Search,
  Server,
  type IconType,
} from "@/components/icons";
import {
  CHAIN_ID,
  EXPLORER_URL,
  FAUCET_URL,
  POOL_PATH,
  ROBINHOOD_NETWORK,
  RPC_URL,
  WALLET_DOCS_URL,
  host,
  vaultPathFor,
} from "@/components/landing/links";
import { useMedia, useMotionSafe } from "@/components/landing/parallax";
import { Container, FOCUS_RING, SCENE_TYPE, SECTION_X } from "@/components/landing/system";
import {
  PoolStatePill,
  usePoolStatus,
  type NetworkRow,
  type NetworkRowState,
  type PoolState,
} from "@/components/landing/usePoolStatus";
import {
  CloudDeck,
  CloudWall,
  NEAR_BANDS,
  Ridge,
  SceneLayer,
  SceneStage,
  Starfield,
  Vignette,
  useScene,
} from "@/components/landing/scene";
import { BandSky, ChainLane, MistBand, NightBlend, SparkGlyph, layoutLane, type LaneDepth, type LaneMark } from "@/components/landing/scene/bands-art";
import { BAND_TYPE, GLASS, GLASS_HOVER, GlassLight, GlassPane, GlyphTile } from "@/components/landing/scene/bands-ui";
import { cn } from "@/lib/utils";
import { explorerAddressUrl } from "@/privacy/config";

const TITLE_ID = "network-title";

type Tier = "wide" | "tablet" | "phone";

/** Share of the spec's pass-through travel per tier (tall stacked layouts travel less). */
const FACTOR: Record<Tier, number> = { wide: 1, tablet: 0.6, phone: 0.3 };

// ─── The chain ────────────────────────────────────────────────────────────────

interface LaneSpec {
  depth: LaneDepth;
  count: number;
  /** vw per unit of progress at factor 1 */
  speed: number;
  /** top of the lane in the band, px */
  top: number;
  /** block offset from the centre block → the public transaction it carries */
  marks: Partial<Record<number, LaneMark>>;
}

/**
 * Lanes per tier: block scale, the band's height, when the band is mid-screen
 * (the lanes rest centred there), how fast the lanes slide and the lanes. Each
 * lane is long enough to cover the widest screen of its tier plus its travel.
 */
const CHAIN: Record<Tier, { scale: number; height: number; restAt: number; k: number; lanes: LaneSpec[] }> = {
  wide: {
    scale: 1,
    height: 236,
    restAt: 0.41,
    k: 1,
    lanes: [
      { depth: "far", count: 47, speed: 14, top: 0, marks: {} },
      { depth: "mid", count: 35, speed: 30, top: 50, marks: { [-3]: "deposit" } },
      { depth: "near", count: 27, speed: 56, top: 124, marks: { 2: "withdraw" } },
    ],
  },
  tablet: {
    scale: 0.82,
    height: 196,
    restAt: 0.34,
    k: 0.8,
    lanes: [
      { depth: "far", count: 25, speed: 14, top: 0, marks: {} },
      { depth: "mid", count: 19, speed: 30, top: 42, marks: { [-2]: "deposit" } },
      { depth: "near", count: 15, speed: 56, top: 104, marks: { 1: "withdraw" } },
    ],
  },
  phone: {
    scale: 0.6,
    height: 150,
    restAt: 0.27,
    k: 0.6,
    lanes: [
      { depth: "far", count: 21, speed: 14, top: 0, marks: {} },
      { depth: "mid", count: 15, speed: 30, top: 32, marks: { [-1]: "deposit" } },
      { depth: "near", count: 13, speed: 56, top: 80, marks: { 1: "withdraw" } },
    ],
  },
};

/**
 * The block stream, full bleed. Illustrative (the blocks are not live data):
 * aria-hidden, with the facts it shows written out in the legend below. The
 * edges fade with a mask on this static box, so the sliding lanes never show a
 * hard end.
 */
function ChainBand({ tier, moving }: { tier: Tier; moving: boolean }) {
  const { progress } = useScene();
  const chain = CHAIN[tier];
  const compact = tier === "phone";
  const layouts = useMemo(
    () => chain.lanes.map((l) => layoutLane(l.depth, l.count, chain.scale, l.marks, compact)),
    [chain, compact],
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none relative w-full [mask-image:linear-gradient(90deg,transparent,#000_11%,#000_89%,transparent)]"
      style={{ height: chain.height }}
    >
      {/* the light the chain throws on the sky, centred on the middle lane */}
      <div
        className="absolute inset-x-0 top-[8%] h-[84%]"
        style={{ background: "radial-gradient(60% 50% at 50% 55%, rgb(139 108 246 / 0.16), rgb(139 108 246 / 0.05) 55%, transparent 80%)" }}
      />
      {chain.lanes.map((l, i) => (
        <ChainLane
          key={l.depth}
          depth={l.depth}
          layout={layouts[i]}
          compact={compact}
          progress={progress}
          speed={moving ? l.speed * chain.k : 0}
          restAt={chain.restAt}
          top={`${l.top}px`}
        />
      ))}
    </div>
  );
}

/**
 * What the stream shows, in words: the accessible counterpart of the
 * aria-hidden lanes, and the honest tag that the blocks are an illustration.
 */
function ChainLegend() {
  return (
    <div className="grid justify-items-center gap-3">
      <ul className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-x-3 gap-y-2.5 sm:flex-row sm:flex-wrap">
        <LegendChip icon={ArrowDownToLine}>Deposit: public</LegendChip>
        <LegendChip icon={ArrowUpFromLine}>Withdrawal: public, in a different block</LegendChip>
        <LegendChip icon={EyeOff} accent>
          Which deposit paid: not on chain
        </LegendChip>
      </ul>
      <p className="rounded-full border border-white/12 px-2.5 py-0.5 text-xs leading-4 text-[color:rgb(201_204_255/0.78)]">Illustration</p>
    </div>
  );
}

function LegendChip({ icon: Icon, accent, children }: { icon: IconType; accent?: boolean; children: ReactNode }) {
  return (
    <li
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] leading-5",
        accent
          ? "border-[rgb(174_180_255/0.4)] bg-[rgb(106_75_224/0.28)] font-medium text-[color:var(--ink)]"
          : "border-white/12 bg-[rgb(10_12_42/0.6)] text-[color:rgb(201_204_255/0.88)]",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", accent ? "text-[color:var(--lavender)]" : "text-[color:rgb(174_180_255/0.8)]")} aria-hidden />
      {children}
    </li>
  );
}

// ─── Art ──────────────────────────────────────────────────────────────────────

/**
 * The sky the chain crosses, back to front. Full-bleed planes overhang the
 * sides by 32px and run on below the stage, so neither the scroll travel nor
 * pointer parallax uncovers an edge. The only twinkles are the two on the
 * marked blocks (each twinkling sparkle is a compositing layer).
 */
function ChainArt({ tier }: { tier: Tier }) {
  const wide = tier === "wide";
  const phone = tier === "phone";
  return (
    <>
      {/* sky: the band sky and the stars */}
      <SceneLayer depth="sky">
        <BandSky variant="chain" />
        <Starfield count={phone ? 70 : 130} seed={41} twinkle="none" className={cn("absolute -inset-x-4 top-0", wide ? "h-[52%]" : "h-[34%]")} />
      </SceneLayer>

      {/* far: the distant peaks, half lost in the haze (they pass behind the chain and the copy) */}
      <SceneLayer depth="far">
        <div className={cn("absolute -inset-x-8 -bottom-[40vh] opacity-55", wide ? "top-[30%]" : tier === "tablet" ? "top-[19%]" : "top-[17%]")}>
          <Ridge tier={0} seed={15} rimAt={0.86} edgeHeight={phone ? "16vh" : "0px"} className="absolute inset-0" />
        </div>
      </SceneLayer>

      {/* mid: the cloud sea filling their valleys, and a band of mist over it */}
      <SceneLayer depth="mid">
        <CloudDeck
          tone="dim"
          rows={3}
          seed={8}
          puff={phone ? "large" : "medium"}
          edgeHeight={phone ? "16vh" : "22vh"}
          className={cn("absolute -inset-x-8 -bottom-[50vh]", wide ? "top-[44%]" : tier === "tablet" ? "top-[29%]" : "top-[25%]")}
        />
        <MistBand top={wide ? "50%" : "33%"} height={wide ? "16%" : "10%"} alpha={0.1} tone="mist" />
      </SceneLayer>

      {/* near: a dark, backlit cloud bank the facts stand on */}
      <SceneLayer depth="near">
        <CloudWall
          bands={NEAR_BANDS}
          seed={21}
          tone="near"
          edgeHeight={phone ? "16vh" : "22vh"}
          className={cn("absolute -inset-x-8 -bottom-[80vh]", wide ? "top-[60%]" : tier === "tablet" ? "top-[44%]" : "top-[40%]")}
        />
      </SceneLayer>
    </>
  );
}

// ─── Header aside ─────────────────────────────────────────────────────────────

/**
 * Night glass under the mark's label and caption. The lit crest of the cloud
 * sea slides behind them on wide screens, so the 12px text gets its own
 * backing (≥ 4.5:1 over the brightest cloud). Static, and no backdrop-filter.
 */
const MARK_PILL = "rounded-full bg-[rgb(10_12_42/0.78)] py-1 ring-1 ring-white/10";

/** The network mark on its plate, with chain id and the wallet guide. Static: nothing here moves or fades. */
function NetworkMark() {
  return (
    <div className="grid justify-items-start gap-3 xl:justify-items-end">
      {/* the label's tracking leaves a trailing gap, so its right padding is that much smaller */}
      <p className={cn(BAND_TYPE.label, MARK_PILL, "pl-3 pr-2.5")}>Network</p>
      {/* grid, not inline: no line box (and its descender gap) around the plate */}
      <div className="grid">
        <RobinhoodChainLogo height={34} className="hidden sm:inline-flex" />
        <RobinhoodChainLogo height={26} className="sm:hidden" />
      </div>
      <p className={cn("flex flex-wrap items-center gap-x-2 px-3 text-xs text-[color:rgb(201_204_255/0.86)]", MARK_PILL)}>
        <span>Testnet</span>
        <span aria-hidden>·</span>
        <span>Chain ID {CHAIN_ID}</span>
        <span aria-hidden>·</span>
        <a
          href={WALLET_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "-my-3 inline-flex min-h-10 items-center gap-1 rounded-sm font-medium text-[color:var(--lavender)] underline-offset-4 hover:underline",
            FOCUS_RING,
          )}
        >
          Add to wallet
          <ArrowUpRight className="h-2.5 w-2.5" aria-hidden />
          <span className="sr-only"> (Robinhood Chain docs; choose Testnet, chain ID {CHAIN_ID}; opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}

// ─── Fact cards ───────────────────────────────────────────────────────────────

/** Small pill action on glass (Copy). No primary background or primary hover border: it is a <button>. */
const ACTION =
  "relative z-10 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 font-mono text-xs uppercase tracking-[0.08em] text-[color:rgb(201_204_255/0.9)] transition-colors hover:border-white/35 hover:bg-white/10 hover:text-[color:var(--ink)]";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the value is on screen and selectable */
    }
  };
  return (
    <>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className={cn(ACTION, FOCUS_RING)}>
        {copied ? <Check className="h-3 w-3 text-emerald-400" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      {/* outside the button: a button's children are presentational, so a live region inside it may go unannounced */}
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}

/** One network parameter on glass. */
function Fact({
  icon: Icon,
  label,
  value,
  hint,
  action,
  className,
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn(GLASS, "grid content-start p-5", className)}>
      <GlassLight />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <GlyphTile size="sm">
          <Icon className="h-4 w-4" />
        </GlyphTile>
        <p className={BAND_TYPE.label}>{label}</p>
        {action ?? <span />}
      </div>
      <div className="mt-4 min-w-0">{value}</div>
      {hint && <p className="mt-1.5 text-pretty text-[13px] leading-snug text-[color:rgb(201_204_255/0.76)]">{hint}</p>}
    </li>
  );
}

/** A host name that may wrap after its dots (never inside a label). */
function Breakable({ text }: { text: string }) {
  const parts = text.split(".");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              .<wbr />
            </>
          )}
        </span>
      ))}
    </>
  );
}

/** An external network link as a whole card (Explorer ↗, Faucet ↗). */
function FactLink({ icon: Icon, label, href, className }: { icon: IconType; label: string; href: string; className?: string }) {
  return (
    <li className={cn("grid", className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(GLASS, GLASS_HOVER, "group grid content-start p-5", FOCUS_RING)}
      >
        <GlassLight />
        <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <GlyphTile size="sm">
            <Icon className="h-4 w-4" />
          </GlyphTile>
          <span className={BAND_TYPE.label}>{label}</span>
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[color:var(--lavender)] transition-colors group-hover:border-white/35 group-hover:text-[color:var(--ink)]"
          >
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </span>
        <span className={cn("mt-4 block", BAND_TYPE.value)}>
          <Breakable text={host(href)} />
        </span>
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </li>
  );
}

// ─── Pool status ──────────────────────────────────────────────────────────────

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The pool contract, linked to its network's explorer when there is one. */
function PoolAddress({ chainId, address }: { chainId: number; address: string }) {
  const url = explorerAddressUrl(chainId, address);
  if (!url) return <span className="font-mono">{short(address)}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("rounded-sm font-mono font-medium text-[color:var(--lavender)] underline-offset-4 hover:underline", FOCUS_RING)}
    >
      {short(address)}
      <ArrowUpRight className="ml-0.5 inline h-2.5 w-2.5 align-baseline" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * One honest line per network: no figure unless its pool is live and could be read. An unfinished request never
 * claims the pool has not been deployed.
 */
function statusLine({ network, state, status }: NetworkRow): ReactNode {
  if (state === "live" && status?.configured) {
    return (
      <>
        Pool contract <PoolAddress chainId={network.chainId} address={status.pool} /> on chain {network.chainId} ·
        non-upgradeable. Everything here is public contract state.
      </>
    );
  }
  if (state === "unavailable" || state === "error") {
    return "Pool status is unavailable right now. Figures are only ever read from public contract state.";
  }
  if (state === "loading") return "Checking the pool's public contract status…";
  return (
    <>
      Built and tested <span className="whitespace-nowrap">end-to-end</span> on a local chain. The pool address appears here as
      soon as it is deployed to chain {network.chainId}.
    </>
  );
}

/** Keep loading, not deployed and unavailable distinct. */
const ROW_PILL: Record<NetworkRowState, PoolState> = {
  live: "live",
  pending: "pending",
  loading: "loading",
  unavailable: "error",
  error: "error",
};

/** The vault link, shown on a row whose pool is live. */
function VaultLink({ href, network, className }: { href: string; network?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 justify-self-start rounded-full px-1 text-sm font-semibold text-[color:var(--lavender)] underline-offset-4 hover:underline lg:justify-self-end",
        FOCUS_RING,
        className,
      )}
    >
      Open your vault
      {network && <span className="sr-only"> on {network}</span>}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/**
 * The pool status. It is the page's #status target (/#status and the FAQ's
 * "Pool status" links land on it 80px below the screen top, clear of the nav;
 * SectionLink focuses it, so it draws no outline of its own).
 *
 * The normal build serves Robinhood Chain Testnet alone: one row, the pool's
 * state and, once it is live, the vault. A development build that serves
 * several networks lists one named row per network instead.
 */
function PoolStatusRow() {
  const { networks } = usePoolStatus();
  if (networks.length > 1) return <PoolStatusList rows={networks} />;
  const row: NetworkRow = networks[0] ?? { network: ROBINHOOD_NETWORK, state: "pending", status: null };
  return (
    <GlassPane
      id="status"
      className="grid scroll-mt-20 gap-3 p-5 outline-none sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-x-6 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <div className="inline-flex flex-wrap items-center gap-3">
        <span className={BAND_TYPE.label}>Pool status</span>
        <PoolStatePill state={ROW_PILL[row.state]} />
      </div>
      <p className="text-pretty text-sm leading-relaxed text-[color:rgb(201_204_255/0.86)]">{statusLine(row)}</p>
      {/* the page's one primary action, shown here only when the pool is live */}
      {row.state === "live" && <VaultLink href={POOL_PATH} />}
    </GlassPane>
  );
}

/** Several served networks (development builds only): one named row each, the vault link opening that network. */
function PoolStatusList({ rows }: { rows: readonly NetworkRow[] }) {
  return (
    <GlassPane id="status" className="grid scroll-mt-20 gap-4 p-5 outline-none sm:px-6">
      <span className={BAND_TYPE.label}>Pool status</span>
      <ul className="grid divide-y divide-white/[0.08] border-t border-white/[0.08] pt-4">
        {rows.map((row) => (
          <li
            key={row.network.chainId}
            className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-6 lg:grid-cols-[13.5rem_minmax(0,1fr)_auto]"
          >
            <div className="grid justify-items-start gap-2">
              <span className="text-sm font-medium text-[color:var(--ink)]">{row.network.name}</span>
              <PoolStatePill state={ROW_PILL[row.state]} />
            </div>
            <p className="text-pretty text-sm leading-relaxed text-[color:rgb(201_204_255/0.86)]">{statusLine(row)}</p>
            {row.state === "live" && (
              <VaultLink href={vaultPathFor(row.network)} network={row.network.name} className="sm:col-start-2 lg:col-start-auto" />
            )}
          </li>
        ))}
      </ul>
    </GlassPane>
  );
}

// ─── Stage ────────────────────────────────────────────────────────────────────

const VALUE_BIG = "block font-mono text-[1.65rem] leading-none font-semibold tracking-tight text-[color:var(--ink)]";

function NetworkStage({ tier, still }: { tier: Tier; still: boolean }) {
  const wide = tier === "wide";
  return (
    <SceneStage
      as="section"
      id="network"
      aria-labelledby={TITLE_ID}
      mode={still ? "static" : "through"}
      factor={FACTOR[tier]}
      className="min-h-[120vh]"
    >
      <ChainArt tier={tier} />
      <Vignette strength={0.4} />
      {/* scrims: behind the band line, and behind the header on the cloud bank (static) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[6%] h-[26%]"
        style={{ background: "radial-gradient(50% 60% at 50% 50%, rgb(4 5 26 / 0.5), rgb(4 5 26 / 0.18) 60%, transparent 85%)" }}
      />
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0", wide ? "top-[44%] h-[30%]" : "top-[34%] h-[24%]")}
        style={{
          background: wide
            ? "radial-gradient(46% 62% at 26% 46%, rgb(4 5 26 / 0.6), rgb(4 5 26 / 0.26) 58%, transparent 85%)"
            : "linear-gradient(to bottom, transparent, rgb(4 5 26 / 0.5) 30%, rgb(4 5 26 / 0.4) 70%, transparent)",
        }}
      />
      <NightBlend edge="top" />
      <NightBlend edge="bottom" />

      {/* stacked layouts keep a shorter tail, so the night between this band and the FAQ stays well under 25vh */}
      <div className={cn("relative z-10 pt-[14vh]", wide ? "pb-[11vh]" : "pb-[6vh]")}>
        {/* the band: one line over the chain */}
        <div className={cn("text-center", SECTION_X)}>
          <p className={SCENE_TYPE.eyebrow}>The network</p>
          <p className={cn("mx-auto mt-4 max-w-[22ch] sm:max-w-none", BAND_TYPE.display)}>
            Public{" "}
            <span className="whitespace-nowrap">
              blocks <SparkGlyph className="mx-[0.08em]" />
            </span>{" "}
            <span className="scene-text-glow">Private link</span>
          </p>
        </div>
        <div className="mt-8 sm:mt-10">
          <ChainBand tier={tier} moving={!still} />
        </div>
        <div className={cn("mt-6", SECTION_X)}>
          <ChainLegend />
        </div>

        <div className={cn("mt-16 lg:mt-20", SECTION_X)}>
          <Container>
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end xl:gap-16">
              <div className="min-w-0 max-w-[56rem]">
                <h2 id={TITLE_ID} className={BAND_TYPE.title}>
                  Built for <span className="sm:whitespace-nowrap">Robinhood Chain</span> Testnet.
                </h2>
                <p className={cn("mt-5 max-w-[36rem]", SCENE_TYPE.lead)}>
                  An Ethereum-compatible Layer 2 where gas is paid in testnet ETH. Every deposit and every withdrawal is an
                  ordinary transaction that anyone can read on the explorer.
                </p>
              </div>
              <NetworkMark />
            </div>

            {/* one row of five from 1440px (90rem); two rows below (the hosts need the width) */}
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-4 lg:gap-5 min-[90rem]:grid-cols-12">
              <Fact
                className="min-[90rem]:col-span-2"
                icon={Hashtag}
                label="Chain ID"
                value={<span className={VALUE_BIG}>{CHAIN_ID}</span>}
                hint="Robinhood Chain Testnet"
              />
              <Fact
                className="min-[90rem]:col-span-2"
                icon={GasPump}
                label="Gas"
                value={<span className={VALUE_BIG}>{ROBINHOOD_NETWORK.chain.nativeCurrency.symbol}</span>}
                hint="Testnet ETH, no real-world value"
              />
              <Fact
                className="sm:col-span-2 min-[90rem]:col-span-4"
                icon={Server}
                label="RPC endpoint"
                value={
                  <span className={cn("block", BAND_TYPE.value)}>
                    <Breakable text={host(RPC_URL)} />
                  </span>
                }
                hint="Public endpoint, rate limited"
                action={<CopyButton text={RPC_URL} label="RPC endpoint" />}
              />
              <FactLink className="lg:col-span-2" icon={Search} label="Explorer" href={EXPLORER_URL} />
              <FactLink className="lg:col-span-2" icon={Faucet} label="Faucet" href={FAUCET_URL} />
            </ul>

            <div className="mt-4 lg:mt-5">
              <PoolStatusRow />
            </div>
          </Container>
        </div>
      </div>
    </SceneStage>
  );
}

export default function Network() {
  const wide = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  const safe = useMotionSafe();
  const tier: Tier = wide ? "wide" : phone ? "phone" : "tablet";
  return <NetworkStage key={`${tier}-${safe ? "move" : "still"}`} tier={tier} still={!safe} />;
}
