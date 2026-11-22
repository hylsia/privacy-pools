/**
 * Sky art for the scenes: the full-bleed night gradient with its nebula glows,
 * a large moon with halo rings, and gold / white sparkles whose glow is drawn
 * in the SVG (no CSS filter). All aria-hidden, deterministic and cheap: the sky
 * is one painted background, the moon one static SVG.
 */
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { rng } from "./geometry";

// ─── Night sky ────────────────────────────────────────────────────────────────

export type NightSkyVariant = "deep" | "horizon" | "dawn";

/**
 * The scene's backdrop: night-0 at the top down to the night-3 horizon, with
 * violet / lavender nebula glows (8–14%). "horizon" brightens the horizon;
 * "dawn" adds a warm lavender and gold glow along it. Static: put it first in
 * the stage, outside any SceneLayer.
 */
export function NightSky({
  variant = "deep",
  className,
  children,
}: {
  variant?: NightSkyVariant;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div aria-hidden className={cn("scene-sky absolute inset-0", `scene-sky--${variant}`, className)}>
      {children}
    </div>
  );
}

// ─── Moon ─────────────────────────────────────────────────────────────────────

export interface MoonProps {
  /** "full": a lit disc with soft maria; "crescent": a lit limb on the right, the rest in earthshine */
  phase?: "full" | "crescent";
  /** soft halo with two faint rings around the disc (default true) */
  halo?: boolean;
  /** seed for the maria (default 3) */
  seed?: number;
  /**
   * Size and place it with className / style. The box includes the halo: the
   * disc is half the box's width (box 52vw → a 26vw moon).
   */
  className?: string;
  style?: CSSProperties;
}

/** A large moon with halo rings, drawn with gradients only (viewBox 400, disc r = 100). */
export function Moon({ phase = "full", halo = true, seed = 3, className, style }: MoonProps) {
  const id = useId().replace(/:/g, "");
  const maria = useMemo(() => {
    const rand = rng(seed);
    return Array.from({ length: 9 }, (_, i) => {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 66;
      const big = i < 3;
      return {
        cx: 200 + Math.cos(a) * d,
        cy: 200 + Math.sin(a) * d,
        rx: big ? 16 + rand() * 14 : 5 + rand() * 7,
        ry: big ? 11 + rand() * 10 : 4 + rand() * 6,
        rot: rand() * 180,
      };
    });
  }, [seed]);

  return (
    <svg viewBox="0 0 400 400" className={cn("scene-moon", className)} style={style} aria-hidden>
      <defs>
        <radialGradient id={`${id}-halo`} cx="200" cy="200" r="200" gradientUnits="userSpaceOnUse">
          <stop offset="0.49" stopColor="#eceaff" stopOpacity="0.5" />
          <stop offset="0.53" stopColor="#d4d6ff" stopOpacity="0.26" />
          <stop offset="0.6" stopColor="#b9bdff" stopOpacity="0.13" />
          <stop offset="0.68" stopColor="#aeb4ff" stopOpacity="0.075" />
          <stop offset="0.72" stopColor="#c9ccff" stopOpacity="0.1" />
          <stop offset="0.76" stopColor="#aeb4ff" stopOpacity="0.055" />
          <stop offset="0.86" stopColor="#8b6cf6" stopOpacity="0.035" />
          <stop offset="0.92" stopColor="#c9ccff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-disc`} cx="0.4" cy="0.36" r="0.74">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.48" stopColor="#f5f3ff" />
          <stop offset="0.8" stopColor="#e0ddff" />
          <stop offset="1" stopColor="#c4c0f6" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0.18" y1="0.12" x2="0.86" y2="0.96">
          <stop offset="0.42" stopColor="#5b53c9" stopOpacity="0" />
          <stop offset="1" stopColor="#5b53c9" stopOpacity="0.34" />
        </linearGradient>
        <radialGradient id={`${id}-mare`}>
          <stop offset="0" stopColor="#a8a2e8" stopOpacity="0.24" />
          <stop offset="0.6" stopColor="#a8a2e8" stopOpacity="0.14" />
          <stop offset="1" stopColor="#a8a2e8" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="200" cy="200" r="100" />
        </clipPath>
        {phase === "crescent" && (
          <mask id={`${id}-cut`}>
            <rect width="400" height="400" fill="#fff" />
            <circle cx="172" cy="188" r="94" fill="#000" />
          </mask>
        )}
      </defs>

      {halo && <circle cx="200" cy="200" r="200" fill={`url(#${id}-halo)`} />}

      {phase === "crescent" ? (
        <>
          {/* earthshine on the unlit part, then the lit limb */}
          <circle cx="200" cy="200" r="100" fill="#aeb4ff" fillOpacity="0.1" />
          <circle cx="200" cy="200" r="99.4" fill="none" stroke="#c9ccff" strokeOpacity="0.22" strokeWidth="0.8" />
          <g mask={`url(#${id}-cut)`}>
            <circle cx="200" cy="200" r="100" fill={`url(#${id}-disc)`} />
          </g>
        </>
      ) : (
        <>
          <circle cx="200" cy="200" r="100" fill={`url(#${id}-disc)`} />
          <g clipPath={`url(#${id}-clip)`}>
            {maria.map((m, i) => (
              <ellipse
                key={i}
                cx={m.cx.toFixed(1)}
                cy={m.cy.toFixed(1)}
                rx={m.rx.toFixed(1)}
                ry={m.ry.toFixed(1)}
                transform={`rotate(${m.rot.toFixed(0)} ${m.cx.toFixed(1)} ${m.cy.toFixed(1)})`}
                fill={`url(#${id}-mare)`}
              />
            ))}
            <circle cx="200" cy="200" r="100" fill={`url(#${id}-shade)`} />
          </g>
          <circle cx="200" cy="200" r="99.3" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.1" />
        </>
      )}
    </svg>
  );
}

// ─── Sparkles ─────────────────────────────────────────────────────────────────

/** Four-point sparkle with concave sides (the artwork's sparkle), in a 24-unit box. */
const SPARKLE_PATH =
  "M12 0C12.9 7.3 16.7 11.1 24 12C16.7 12.9 12.9 16.7 12 24C11.1 16.7 7.3 12.9 0 12C7.3 11.1 11.1 7.3 12 0Z";

export interface SceneSparkleSpec {
  /** centre of the sparkle, as CSS lengths (e.g. "62%") */
  left: string;
  top: string;
  /** star size in px (its glow reaches twice as far) */
  size: number;
  tone?: "gold" | "white";
  /** seconds into the 6s twinkle (default 0) */
  delay?: number;
  /** visibility classes, e.g. "hidden sm:block" */
  className?: string;
}

/**
 * Twinkling sparkles: each is a small SVG with its glow drawn as a radial
 * gradient (no filter), animated with transform/opacity only. They stop while
 * their block is idle and under reduced motion.
 */
export function SceneSparkles({ items, className }: { items: readonly SceneSparkleSpec[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {items.map((s, i) => {
        const gold = (s.tone ?? "gold") === "gold";
        const box = s.size * 2;
        return (
          <svg
            key={`${s.left}-${s.top}`}
            viewBox="-12 -12 48 48"
            className={cn("scene-sparkle", s.className)}
            style={{
              left: `calc(${s.left} - ${box / 2}px)`,
              top: `calc(${s.top} - ${box / 2}px)`,
              width: box,
              height: box,
              animationDelay: `-${s.delay ?? 0}s`,
            }}
          >
            <defs>
              <radialGradient id={`${id}-g${i}`}>
                <stop offset="0" stopColor={gold ? "#f5d58a" : "#dfe1ff"} stopOpacity="0.55" />
                <stop offset="0.35" stopColor={gold ? "#d4ac4e" : "#aeb4ff"} stopOpacity="0.2" />
                <stop offset="1" stopColor={gold ? "#d4ac4e" : "#aeb4ff"} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="12" cy="12" r="22" fill={`url(#${id}-g${i})`} />
            <path d={SPARKLE_PATH} fill={gold ? "#f5d58a" : "#f4f3ff"} />
          </svg>
        );
      })}
    </div>
  );
}
