import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import MascotFace from "@/components/MascotFace";
import {
  CloudBank,
  CrescentMoon,
  Ribbons,
  Sparkle,
  type Puff,
} from "@/components/landing/sky";

const TAIL_SRC = "/hypechan/fox-tail.webp";
const BODY_SRC = "/hypechan/fox-body.webp";

/**
 * Cloud puffs, in % of the cloud bank. They stay low under the paws and rise a
 * little at the sides.
 */
const CLOUD_PUFFS: Puff[] = [
  { left: 0, bottom: 26, width: 18, height: 66 },
  { left: 10, bottom: 18, width: 18, height: 62 },
  { left: 23, bottom: 8, width: 19, height: 58 },
  { left: 38, bottom: 4, width: 18, height: 56 },
  { left: 52, bottom: 6, width: 18, height: 56 },
  { left: 66, bottom: 10, width: 17, height: 60 },
  { left: 76, bottom: 20, width: 15, height: 62 },
  { left: 86, bottom: 24, width: 14, height: 56 },
  // smaller puffs heaped on the sides, clear of the paws
  { left: 5, bottom: 46, width: 11, height: 44 },
  { left: 15, bottom: 40, width: 9, height: 36 },
  { left: 80, bottom: 44, width: 10, height: 40 },
  { left: 89, bottom: 50, width: 8, height: 32 },
];

/** Sparkles around the mascot (% of the stage; size in px). */
const SPARKLES = [
  { left: 5, top: 15, size: 26, white: false, delay: 0 },
  { left: 87, top: 5, size: 32, white: false, delay: 1.4 },
  { left: 95, top: 40, size: 14, white: true, delay: 2.1 },
  { left: 1, top: 52, size: 12, white: true, delay: 0.7 },
  { left: 82, top: 63, size: 18, white: false, delay: 2.8 },
  { left: 31, top: 1, size: 11, white: true, delay: 3.3 },
  { left: 55, top: -3, size: 13, white: false, delay: 1.9 },
];

/** The body's slow breath; will-change only while it can run (sky.css drops it while idle). */
const FOX_CSS = `
  .fox-body {
    transform-origin: 56% 96%;
    animation: fox-breathe 4.4s ease-in-out infinite;
    will-change: transform;
  }
  @keyframes fox-breathe {
    0%, 100% { transform: scale(1, 1); }
    50% { transform: scale(1.005, 1.013); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fox-body { animation: none; will-change: auto; }
  }
`;

/**
 * The fox alone, for the v2 scenes (which bring their own sky, moon and
 * clouds): the tail (fox-tail.webp) behind the breathing body (fox-body.webp)
 * with the blinking face (MascotFace). Square box, 1233 × 1236 artwork; the
 * paws rest at about 96% of its height. Decorative by default (alt="").
 */
export function FoxFigure({ alt = "", className }: { alt?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <img
        src={TAIL_SRC}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      />
      <div className="fox-body relative">
        <img
          src={BODY_SRC}
          alt={alt}
          width={1233}
          height={1236}
          draggable={false}
          className="block h-auto w-full select-none"
        />
        <MascotFace />
      </div>
      <style>{FOX_CSS}</style>
    </div>
  );
}

/**
 * Hero mascot, staged like the artwork: a glowing crescent moon and ribbons of
 * light behind the fox, gold sparkles around it and a bank of clouds to sit in.
 *
 * The fox is two cut-out layers: the tail (fox-tail.webp) and the body
 * (fox-body.webp). The body breathes gently and the face blinks now and then
 * (MascotFace).
 *
 * With a mouse, the layers shift slightly with the pointer for depth.
 */
export default function HeroMascot() {
  const stageRef = useRef<HTMLDivElement>(null);

  // pointer parallax: eases --px / --py on the stage towards the pointer
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const step = () => {
      x += (tx - x) * 0.07;
      y += (ty - y) * 0.07;
      stage.style.setProperty("--px", x.toFixed(4));
      stage.style.setProperty("--py", y.toFixed(4));
      raf =
        Math.abs(tx - x) + Math.abs(ty - y) > 0.002
          ? requestAnimationFrame(step)
          : 0;
    };
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      tx = clamp((e.clientX - (r.left + r.width / 2)) / r.width);
      ty = clamp((e.clientY - (r.top + r.height / 2)) / r.height);
      if (!raf) raf = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className="fox-stage relative w-full max-w-[400px] sm:max-w-[480px] lg:max-w-[560px] xl:max-w-[620px]"
    >
      {/* moon, halo and sparkles: the far background */}
      <div
        className="sky-depth-far pointer-events-none absolute inset-0"
        aria-hidden
      >
        <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_24%,transparent),transparent)]" />
        <CrescentMoon className="absolute left-[21%] top-[1%] w-[72%]" />
        {SPARKLES.map(s => (
          <Sparkle
            key={`${s.left}-${s.top}`}
            className={cn(s.white && "is-white")}
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDelay: `-${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* ribbons of light drifting behind the fox */}
      <div
        className="sky-depth-mid pointer-events-none absolute inset-0"
        aria-hidden
      >
        <Ribbons className="absolute inset-0 h-full w-full" />
      </div>

      {/* the fox */}
      <div className="sky-depth-fox relative">
        <img
          src={TAIL_SRC}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
        />
        <div className="fox-body relative">
          <img
            src={BODY_SRC}
            alt="Hylsia, a white fox in a navy star cape"
            width={1233}
            height={1236}
            draggable={false}
            className="block h-auto w-full select-none"
          />
          <MascotFace />
        </div>
      </div>

      {/* cloud bank the mascot sits in */}
      <div
        className="sky-depth-near pointer-events-none absolute inset-0"
        aria-hidden
      >
        <CloudBank
          puffs={CLOUD_PUFFS}
          className="inset-x-[-8%] bottom-[-8%] h-[20%]"
        />
      </div>

      {/* will-change for the .fox-stage pointer layers lives in sky.css, gated to fine pointers with motion allowed */}
      <style>{FOX_CSS}</style>
    </div>
  );
}
