/**
 * "What stays private" (#privacy) — the fog scene of the night journey (v2).
 *
 * A pass-through scene (not pinned). Two public beacons stand on the summits
 * either side of a gorge, each with its record: "Deposit · public" on the left,
 * "Withdrawal · public" on the right. A dotted gold link joins the two lamps
 * and sags into the gorge; as the scene scrolls up, fog slides in from both
 * sides (groups at several depths, moving in opposite directions) and the
 * middle of the link fades into it, so only its two public ends stay in sight.
 * "Which deposit paid: not revealed" sits in the fog. Below the pass, a sea of
 * cloud carries two glass lists (hidden by the proof / still public) and the
 * two ways to undo it.
 *
 * Depth, back to front (art: scene/privacy-art.tsx):
 *   sky: night, vignette, stars · far: crescent moon, far range, haze · mid:
 *   near range, haze · at content speed (static vertically): fog behind the
 *   cliffs (slides right), cliffs, towers, the link, lamps, fog in front of the
 *   link (slides left), the cloud sea with mist on it (drifts left) · edge
 *   blends · copy, cards and lists (never transformed or faded).
 *
 * Every scroll range is constant per mount: the stage is keyed by tier and by
 * reduced motion. Reduced motion: a still stage (layers at rest, fog closed,
 * the link's middle hidden). Top and bottom edges blend into the page's night.
 */
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { useMotionValue } from "framer-motion";
import { Eye, EyeOff, GasPump, Link2 } from "@/components/icons";
import { useMedia, useMotionSafe, useSectionProgress } from "@/components/landing/parallax";
import { Container, SCENE_TYPE } from "@/components/landing/system";
import { SceneStage, Scrim } from "@/components/landing/scene";
import {
  PRIVACY_FOG_CLOSED,
  PRIVACY_VALLEY,
  PrivacyBackdrop,
  PrivacyValley,
  privacyLamp,
  type PrivacyTier,
} from "@/components/landing/scene/privacy-art";
import { cn } from "@/lib/utils";

// ─── Copy ─────────────────────────────────────────────────────────────────────

interface Row {
  label: string;
  value: string;
  /** an amount: value, shown in gold */
  amount?: boolean;
}

/** The page's running example (illustrative values; the figure says "Example"). */
const RECORDS = {
  deposit: {
    title: "Deposit",
    rows: [
      { label: "From", value: "0x7a3f…c21e" },
      { label: "Amount", value: "1.0 ETH", amount: true },
      { label: "Time", value: "14:02 UTC" },
    ],
  },
  withdrawal: {
    title: "Withdrawal",
    rows: [
      { label: "To", value: "fresh address" },
      { label: "Amount", value: "0.4 ETH", amount: true },
      { label: "Fee", value: "0.002 ETH" },
      { label: "Time", value: "19:47 UTC" },
    ],
  },
} satisfies Record<string, { title: string; rows: Row[] }>;

const HIDDEN = ["Which deposit a withdrawal spends", "Your note secrets", "The balance you keep"];
const PUBLIC = ["Deposit address, amount and time", "Withdrawal address, amount and fee", "Timing patterns"];
const CAUTIONS = [
  { text: "Same wallet in and out → linked again", Icon: Link2 },
  { text: "Paying your own gas → payer is visible", Icon: GasPump },
];

// ─── Header ───────────────────────────────────────────────────────────────────

function PrivacyHeader() {
  return (
    <header className="relative z-[4] mx-auto max-w-[62rem] text-center">
      {/* legibility while the far range passes behind the lead */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-[12%] -inset-y-[30%]">
        <Scrim side="center" />
      </div>
      <p className={cn("relative", SCENE_TYPE.eyebrow)}>What stays private</p>
      <h2 id="privacy-title" className={cn("relative mt-4 sm:mt-5", SCENE_TYPE.headline)}>
        <span className="sm:block">It hides one thing well:</span>{" "}
        <span className="scene-text-glow">which deposit paid.</span>
      </h2>
      <p className={cn("relative mx-auto mt-4 max-w-[30rem] sm:mt-6", SCENE_TYPE.lead)}>
        Addresses, amounts, fees and timing stay public. The proof hides only the link between them.
      </p>
    </header>
  );
}

// ─── The figure: two beacons and the fog ──────────────────────────────────────

/** A public record, the sign of its beacon. Static: never moved or faded. */
function BeaconCard({ kind, className, style }: { kind: keyof typeof RECORDS; className?: string; style?: CSSProperties }) {
  const record = RECORDS[kind];
  const rows: Row[] = record.rows;
  return (
    // decoration is painted as backgrounds and inset shadows (no clipped children), so the card
    // squashes into one compositing layer with the copy around it
    <div
      className={cn(
        "relative rounded-2xl border border-[color:rgb(174_180_255/0.26)] p-3.5 shadow-[0_28px_70px_-30px_rgb(2_3_18/0.95),inset_0_1px_0_rgb(214_216_255/0.22)] sm:p-5",
        // the beacon's light on the corner that faces it
        kind === "deposit"
          ? "bg-[radial-gradient(55%_75%_at_100%_0%,rgb(174_180_255/0.2),transparent_70%),linear-gradient(165deg,rgb(38_44_112/0.9),rgb(13_16_50/0.94)_62%)]"
          : "bg-[radial-gradient(55%_75%_at_0%_0%,rgb(174_180_255/0.2),transparent_70%),linear-gradient(195deg,rgb(38_44_112/0.9),rgb(13_16_50/0.94)_62%)]",
        className,
      )}
      style={style}
    >
      <div className="relative flex items-start justify-between gap-2">
        {/* phones: "public" on its own line; from sm one line, "Deposit · public" */}
        <p className="font-mono text-xs uppercase leading-5 tracking-[0.1em] text-[color:var(--ink)]">
          <span className="block sm:inline">{record.title}</span>
          <span className="hidden sm:inline"> · </span>
          <span className="text-[color:var(--lavender)]">public</span>
        </p>
        <Eye
          className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 text-[color:var(--lavender)] sm:block lg:hidden xl:block"
          aria-hidden
        />
      </div>
      <dl className="relative mt-3 grid gap-1.5 font-mono text-xs sm:text-[13px]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[color:rgb(201_204_255/0.76)]">{row.label}</dt>
            <dd className={row.amount ? "text-[color:var(--gold-hi)]" : "text-[color:var(--ink)]"}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The verdict, in the fog: static, on its own glass so it reads over any fog. */
function FogLabel({ style }: { style: CSSProperties }) {
  return (
    <div
      className="absolute left-1/2 z-[4] grid w-max max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 justify-items-center gap-2"
      style={style}
    >
      <p className="inline-flex items-center gap-2 rounded-full border border-[color:rgb(201_204_255/0.24)] bg-[rgb(10_12_42/0.78)] px-4 py-2 text-[13px] font-medium text-[color:var(--ink)] shadow-[0_12px_40px_-12px_rgb(4_5_26/0.9)] sm:text-sm">
        <EyeOff className="h-3.5 w-3.5 shrink-0 text-[color:var(--lavender)]" aria-hidden />
        <span>
          Which deposit paid: <span className="text-[color:var(--lavender)]">not revealed</span>
        </span>
      </p>
      <span className="rounded-full bg-[rgb(10_12_42/0.62)] px-2.5 py-0.5 text-xs text-[color:rgb(201_204_255/0.8)]">
        Example values
      </span>
    </div>
  );
}

/**
 * The scene's figure. Wide: the strip holds everything, each card beside its
 * beacon. Tablets and phones: the cards sit side by side above the strip and
 * the beacons stand below them. Keyed with the stage, so its ranges are fixed.
 */
function PrivacyFigure({ tier, still }: { tier: PrivacyTier; still: boolean }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const live = useSectionProgress(stripRef, "through");
  const frozen = useMotionValue(PRIVACY_FOG_CLOSED);
  const progress = still ? frozen : live;
  const wide = tier === "wide";
  const spec = PRIVACY_VALLEY[tier];
  const lamps = [privacyLamp(tier, 0), privacyLamp(tier, 1)];
  return (
    <figure className={cn("relative", wide ? "mt-2" : "mt-10 sm:mt-12")}>
      <figcaption className="sr-only">
        Example. A deposit of 1.0 ETH from 0x7a3f…c21e at 14:02 UTC and a withdrawal of 0.4 ETH to a fresh address
        at 19:47 UTC, with a 0.002 ETH fee, are both public records. The proof does not reveal which deposit paid
        for the withdrawal.
      </figcaption>
      {!wide && (
        <div className="relative z-[4] grid grid-cols-2 gap-2.5 sm:gap-5">
          <BeaconCard kind="deposit" />
          <BeaconCard kind="withdrawal" />
        </div>
      )}
      <div
        ref={stripRef}
        className={cn("relative", wide ? "h-[clamp(480px,58vh,640px)]" : tier === "tablet" ? "h-[330px]" : "h-[280px]")}
      >
        <PrivacyValley tier={tier} progress={progress} moving={!still} />
        {/* each beacon's light pooled on the cloud tops below it (static, at the copy's level: no extra layer) */}
        {lamps.map(([u], i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute z-[4] h-[24%] w-[36%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(201_204_255/0.17),rgb(174_180_255/0.06)_55%,transparent)]"
            style={{ left: `${u * 100}%`, top: `${(spec.sea + (wide ? 0.14 : 0.1)) * 100}%` }}
          />
        ))}
        {wide && (
          <>
            <BeaconCard
              kind="deposit"
              className="absolute left-[2%] z-[4] w-[22.5%] -translate-y-1/2"
              style={{ top: `${lamps[0][1] * 100}%` }}
            />
            <BeaconCard
              kind="withdrawal"
              className="absolute right-[2%] z-[4] w-[22.5%] -translate-y-1/2"
              style={{ top: `${lamps[1][1] * 100}%` }}
            />
          </>
        )}
        <FogLabel style={{ top: `${spec.label * 100}%` }} />
      </div>
    </figure>
  );
}

// ─── Lists ────────────────────────────────────────────────────────────────────

function ListCard({ kind }: { kind: "hidden" | "public" }) {
  const hidden = kind === "hidden";
  const items = hidden ? HIDDEN : PUBLIC;
  return (
    // glass on the cloud sea; the tint and the top highlight are backgrounds / inset shadows (no clipped children)
    <div
      className={cn(
        "relative h-full rounded-2xl border p-6 shadow-[0_30px_80px_-36px_rgb(2_3_18/0.95),inset_0_1px_0_rgb(214_216_255/0.16)] sm:p-7",
        hidden
          ? "border-[color:rgb(174_180_255/0.34)] bg-[radial-gradient(120%_90%_at_0%_0%,rgb(106_75_224/0.3),transparent_60%),linear-gradient(rgb(12_15_48/0.88),rgb(12_15_48/0.88))]"
          : "border-[color:rgb(255_255_255/0.13)] bg-[radial-gradient(120%_90%_at_0%_0%,rgb(174_180_255/0.1),transparent_60%),linear-gradient(rgb(12_15_48/0.88),rgb(12_15_48/0.88))]",
      )}
    >
      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
            hidden
              ? "bg-[rgb(139_108_246/0.22)] text-[color:var(--lavender)] ring-[color:rgb(174_180_255/0.38)]"
              : "bg-white/[0.06] text-[color:var(--mist)] ring-white/15",
          )}
        >
          {hidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </span>
        <h3 className="text-lg font-semibold leading-snug tracking-[-0.01em] text-[color:var(--ink)]">
          {hidden ? "Hidden by the proof" : "Still public"}
        </h3>
      </div>
      <ul className="relative mt-5 grid gap-3">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-3 text-[15px] leading-snug text-[color:rgb(224_226_255/0.9)]">
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                hidden ? "bg-[color:var(--lavender)]" : "bg-[color:rgb(201_204_255/0.55)]",
              )}
            />
            <span className="min-w-0 flex-1">{item}</span>
            {hidden ? (
              // a redaction bar: the value exists, nobody can read it
              <span
                aria-hidden
                className="hidden h-2.5 w-16 shrink-0 rounded-full bg-[linear-gradient(90deg,rgb(174_180_255/0.45),rgb(139_108_246/0.28))] sm:block"
              />
            ) : (
              <Eye className="hidden h-3.5 w-3.5 shrink-0 text-[color:rgb(201_204_255/0.55)] sm:block" aria-hidden />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrivacyLists() {
  return (
    <div className="relative z-[4] mx-auto mt-8 max-w-[64rem] sm:mt-10">
      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <ListCard kind="hidden" />
        <ListCard kind="public" />
      </div>
      <div className="mt-4 grid justify-items-center gap-3 rounded-2xl border border-[color:rgb(255_255_255/0.12)] bg-[rgb(10_12_42/0.8)] px-5 py-4 text-center shadow-[0_24px_60px_-32px_rgb(2_3_18/0.95)] sm:mt-5 lg:flex lg:items-center lg:justify-between lg:gap-6 lg:px-6 lg:text-left">
        <p className="text-sm leading-relaxed text-[color:rgb(201_204_255/0.86)]">
          <span className="font-semibold text-[color:var(--ink)]">Two ways to undo it.</span> The app warns before
          either.
        </p>
        <ul className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {CAUTIONS.map(({ text, Icon }) => (
            <li
              key={text}
              className="inline-flex items-center gap-2 rounded-full border border-[color:rgb(252_165_165/0.36)] bg-[rgb(252_165_165/0.07)] px-3.5 py-1.5 text-[13px] font-medium text-[#fecaca]"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

/**
 * Soft edges into the page's night (--night-1), above the art. They share the
 * copy's z-level (so all static paint above the art can merge into one layer)
 * without covering it: the top one is painted before the copy, and the bottom
 * one lies in the stage's bottom padding, which is taller than the blend.
 */
function EdgeBlend({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 z-[4] h-[16vh]",
        edge === "top"
          ? "top-0 bg-[linear-gradient(to_bottom,var(--night-1),rgb(10_12_42/0.62)_42%,rgb(10_12_42/0))]"
          : "bottom-0 bg-[linear-gradient(to_top,var(--night-1),rgb(10_12_42/0.62)_42%,rgb(10_12_42/0))]",
      )}
    />
  );
}

/**
 * Marks the stage `data-off` while it is out of view: scrolled past (only its
 * bottom night blend, at most 12% of a screen, still showing at the top) or
 * more than a third of a screen below it. Its moving art then keeps no
 * compositing layers (see OFF_WILL_CHANGE in privacy-art), which matters while
 * a neighbouring scene fills the screen: Landing's idle margin keeps this block
 * awake for half a screen either side, and the nav lands on #design with this
 * stage's last 80px still in view. Nothing visible changes (A/B measured): that
 * strip is the blend over the cloud sea, with no stars or loops in it; without
 * its layer the drifting sea only snaps to whole pixels. It wakes a third of a
 * screen before it scrolls in from below; scrolling back up, as its bottom
 * passes 12% of the screen.
 */
function useOffscreenRest(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const stage = ref.current?.closest<HTMLElement>("[data-scene]");
    if (!enabled || !stage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => stage.toggleAttribute("data-off", !entries[entries.length - 1].isIntersecting),
      // -12%: the stage's last strip (its bottom blend, under the nav at #design) counts as out of view
      { rootMargin: "-12% 0px 35% 0px" },
    );
    io.observe(stage);
    return () => {
      io.disconnect();
      stage.removeAttribute("data-off");
    };
  }, [ref, enabled]);
}

/** The stage. Keyed by tier and reduced motion in <Visibility>, so every range is fixed per mount. */
function PrivacyStage({ tier, still }: { tier: PrivacyTier; still: boolean }) {
  const inner = useRef<HTMLDivElement>(null);
  // still frames have no moving layers to rest
  useOffscreenRest(inner, !still);
  return (
    <SceneStage
      as="section"
      id="privacy"
      aria-labelledby="privacy-title"
      mode={still ? "static" : "through"}
      className="pb-[clamp(130px,18vh,200px)] pt-[clamp(80px,11vh,130px)]"
    >
      <PrivacyBackdrop tier={tier} still={still} />
      <EdgeBlend edge="top" />
      <div ref={inner} className="relative px-6 sm:px-10">
        {/*
          An invisible plate under the copy, first at its z-level. All the static paint above the
          moving art (edge blends, header, cards, label, lists) then merges into one compositing
          layer, instead of one layer per block (the blocks are too far apart to merge alone).
        */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[4] bg-[rgb(10_12_42/0.004)]" />
        <Container>
          <PrivacyHeader />
          <PrivacyFigure tier={tier} still={still} />
          <PrivacyLists />
        </Container>
      </div>
      <EdgeBlend edge="bottom" />
    </SceneStage>
  );
}

export default function Visibility() {
  const safe = useMotionSafe();
  const wide = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  const tier: PrivacyTier = wide ? "wide" : phone ? "phone" : "tablet";
  return <PrivacyStage key={`${tier}-${safe ? "live" : "still"}`} tier={tier} still={!safe} />;
}
