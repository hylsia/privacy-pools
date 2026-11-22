/**
 * Landing page — a night journey about Hylsia Privacy Pools, built for
 * Robinhood Chain Testnet (v2, "Immersive scenes"). Each chapter lives in
 * components/landing/sections; the illustrated scenes are built from the scene
 * kit (components/landing/scene: depth layers, sky, ridges, clouds, monoliths,
 * fog, overlays). Shared primitives are in components/landing (parallax.tsx
 * for motion, system.tsx for layout/type/surfaces and in-page navigation,
 * usePoolStatus.tsx for the deployment state, links.ts for URLs).
 *
 * Order: Hero · PoolScene · ProofScene · Visibility · Guarantees · Network ·
 * Faq · Cta. The old
 * #how-it-works anchor stays as a zero-height target at the top of the pool
 * scene so deep links and the Pools app's links keep landing there; #status is
 * the Pool status row inside Network.
 *
 * The root must not clip overflow: the pinned scenes use position: sticky.
 * It is `isolate`, so the fixed page sky (-z-10) paints above the root's own
 * background and below every section; a section with an opaque background
 * hides it. One static film-grain overlay (Grain) sits over everything but
 * the nav.
 */
import { useEffect, useRef, type RefObject } from "react";
import { MotionConfig, motion } from "framer-motion";
import { Footer, NavBar } from "@/components/landing/sections/Chrome";
import Cta from "@/components/landing/sections/Cta";
import Faq from "@/components/landing/sections/Faq";
import Guarantees from "@/components/landing/sections/Guarantees";
import Hero from "@/components/landing/sections/Hero";
import Network from "@/components/landing/sections/Network";
import PoolScene from "@/components/landing/sections/PoolScene";
import ProofScene from "@/components/landing/sections/ProofScene";
import Visibility from "@/components/landing/sections/Visibility";
import { useMotionSafe, usePageProgress, useRange } from "@/components/landing/parallax";
import { Grain } from "@/components/landing/scene";
import { Starfield } from "@/components/landing/sky";
import { useHashLanding } from "@/components/landing/system";

const DOCUMENT_TITLE = "Hylsia · Privacy Pools built for Robinhood Chain Testnet";

/**
 * The far plane behind every pass-through section: one calm starfield (one
 * twinkling layer) fixed to the viewport, drifting up 160px over the whole page.
 * Keyed by `safe` so its range is constant for the life of the mount. The
 * layer is 160px taller than needed so the drift never uncovers an edge.
 */
function PageSky({ safe }: { safe: boolean }) {
  const y = useRange(usePageProgress(), [0, 1], [0, safe ? -160 : 0]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        style={{ y }}
        className={
          safe
            ? "absolute inset-x-0 -top-[5%] h-[calc(110%+160px)] opacity-60 will-change-transform"
            : "absolute inset-x-0 -top-[5%] h-[calc(110%+160px)] opacity-60"
        }
      >
        <Starfield count={120} seed={29} twinkle="one" className="absolute inset-0 h-full w-full" />
      </motion.div>
    </div>
  );
}

/**
 * Marks each top-level block of <main> that is away from the screen with
 * `data-idle`: more than half a viewport below it, or more than 15% of a
 * viewport above it. While idle, sky.css / scene.css stop its looping
 * decorations (twinkles, sparkles, ribbons, the breathing fox) and drop its
 * will-change, so the compositor only keeps layers for what is on or near the
 * screen instead of for the whole page. A block wakes up half a viewport
 * before it scrolls in from below (15% of one when scrolling back up), so
 * nothing visible changes. The margin above is the smaller one so that, at a
 * hand-off, the section just scrolled past stops paying for its layers while
 * the next one is already awake. Blocks that remount are picked up again
 * (MutationObserver on main's children).
 */
const IDLE_MARGIN = "15% 0px 50% 0px";

function useIdleOffscreen(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const main = ref.current;
    if (!main || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.toggleAttribute("data-idle", !entry.isIntersecting);
      },
      { rootMargin: IDLE_MARGIN },
    );
    const observeAll = () => {
      io.disconnect();
      for (const block of Array.from(main.children)) io.observe(block);
    };
    observeAll();
    const mo = new MutationObserver(observeAll);
    mo.observe(main, { childList: true });
    return () => {
      mo.disconnect();
      io.disconnect();
      for (const block of Array.from(main.children)) block.removeAttribute("data-idle");
    };
  }, [ref]);
}

export default function Landing() {
  const safe = useMotionSafe();
  const mainRef = useRef<HTMLElement>(null);
  useHashLanding();
  useIdleOffscreen(mainRef);

  useEffect(() => {
    const previous = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div
        // `dark`: the landing is one night-sky journey in both themes (scenes and bands alike, the nav pill included);
        // the theme toggle still applies to the app pages (/pools, /pools/vault …).
        className="landing-root dark relative isolate min-h-screen bg-background text-foreground antialiased selection:bg-primary/20"
      >
        <PageSky key={safe ? "move" : "still"} safe={safe} />
        <NavBar />
        <main ref={mainRef} id="main" tabIndex={-1} className="outline-none">
          <Hero />
          {/* old "How it works" anchor: the pool scene now tells that story (lands flush, like a pinned scene) */}
          <div id="how-it-works" data-pinned="" className="h-0" />
          <PoolScene />
          <ProofScene />
          <Visibility />
          <Guarantees />
          <Network />
          <Faq />
          <Cta />
        </main>
        <Footer />
        <Grain />
      </div>
    </MotionConfig>
  );
}
