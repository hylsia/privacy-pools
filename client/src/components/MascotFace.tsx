import { useEffect, useId, useRef } from "react";

/**
 * Small facial animation for the hero mascot, drawn over fox-body.webp in the
 * artwork's pixel space (1233 × 1236): the eyes blink now and then (sometimes
 * twice, sometimes a slow, content half-close) and a glint twinkles in the
 * near eye.
 *
 * Each eyelid is a patch of fur over the eye with the closed lash line along
 * its lower edge. It is scaled down from its top edge, so it sweeps down over
 * the open eye the way a lid does.
 */

/** Near (left) eye: fur over the lash and eye, closing on a soft curve. */
const NEAR_LID =
  "M596 429 C603 422 608 408 614 400 C632 394 652 390 668 384 C686 377 700 373 714 371 " +
  "C732 371 750 375 766 384 C774 390 779 398 776 405 C772 414 768 420 762 424 " +
  "C740 435 716 443 692 446 C668 448 642 444 620 438 C608 435 600 432 596 429 Z";
/** Closed lash: a tapered stroke with the artwork's little wing at the outer corner. */
const NEAR_LASH =
  "M586 424 C592 426 596 427 600 428 C626 437 654 442 682 441 C712 440 742 431 767 415 " +
  "C745 435 714 446 682 447 C652 448 624 443 599 433 C594 431 590 428 586 424 Z";
/** Far (right) eye: small, just above the nose, clear of the head's outline. */
const FAR_LID =
  "M829 415 C826 404 828 392 834 384 C839 377 847 374 855 374 C862 374 867 378 868 385 " +
  "C869 393 867 401 864 407 C859 412 851 415 842 416 C837 416 832 416 829 415 Z";
const FAR_LASH =
  "M831 410 C839 414 850 415 860 410 C863 408 865 406 866 403 " +
  "C865 408 862 412 858 414 C849 418 838 417 831 410 Z";

const LASH_COLOR = "#3d2a70";

export default function MascotFace() {
  const id = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lids = Array.from(svg.querySelectorAll<SVGGElement>("[data-lid]"));

    const closeTo = (
      amount: number,
      down: number,
      hold: number,
      up: number
    ) => {
      const total = down + hold + up;
      for (const lid of lids) {
        lid.animate(
          [
            { transform: "scaleY(0)", easing: "cubic-bezier(.5,0,.9,.6)" },
            {
              transform: `scaleY(${amount})`,
              offset: down / total,
              easing: "linear",
            },
            {
              transform: `scaleY(${amount})`,
              offset: (down + hold) / total,
              easing: "cubic-bezier(.2,.6,.4,1)",
            },
            { transform: "scaleY(0)" },
          ],
          { duration: total }
        );
      }
      return total;
    };
    const blink = () => closeTo(1, 85, 45, 150);

    let timer = 0;
    let count = 0;
    const next = () => {
      count++;
      let busy: number;
      if (count % 5 === 0) {
        // a slow, content half-close of the eyes
        busy = closeTo(0.5, 420, 1100, 520);
      } else {
        busy = blink();
        // now and then a quick double blink
        if (Math.random() < 0.3) {
          window.setTimeout(blink, busy + 120);
          busy += 120 + 280;
        }
      }
      timer = window.setTimeout(next, busy + 2400 + Math.random() * 3200);
    };
    timer = window.setTimeout(next, 1600);
    return () => window.clearTimeout(timer);
  }, []);

  const lid = (shape: string, lash: string, fill: string) => (
    <g
      data-lid
      style={{
        transform: "scaleY(0)",
        transformBox: "fill-box",
        transformOrigin: "50% 0%",
      }}
    >
      <path
        d={shape}
        fill={`url(#${id}-${fill})`}
        filter={`url(#${id}-soft)`}
      />
      <path d={lash} fill={LASH_COLOR} />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1233 1236"
      className="mascot-face pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        {/* fur colours sampled around each eye */}
        <linearGradient
          id={`${id}-near`}
          gradientUnits="userSpaceOnUse"
          x1="600"
          y1="380"
          x2="770"
          y2="448"
        >
          <stop offset="0" stopColor="#cbc5fb" />
          <stop offset="0.5" stopColor="#d1c8fc" />
          <stop offset="1" stopColor="#e3d9fd" />
        </linearGradient>
        <linearGradient
          id={`${id}-far`}
          gradientUnits="userSpaceOnUse"
          x1="834"
          y1="378"
          x2="860"
          y2="414"
        >
          <stop offset="0" stopColor="#d9cdfa" />
          <stop offset="1" stopColor="#ede4fc" />
        </linearGradient>
        {/* soft edge so the lid melts into the fur around it */}
        <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* glint in the near eye */}
      <path
        className="mascot-glint"
        d="M672 400 C673 408 676 411 684 412 C676 413 673 416 672 424 C671 416 668 413 660 412 C668 411 671 408 672 400 Z"
        fill="#ffffff"
      />

      {lid(NEAR_LID, NEAR_LASH, "near")}
      {lid(FAR_LID, FAR_LASH, "far")}

      <style>{`
        .mascot-glint {
          transform-box: fill-box;
          transform-origin: center;
          opacity: 0;
          animation: mascot-glint 5.2s ease-in-out infinite 1.2s;
        }
        @keyframes mascot-glint {
          0%, 62%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          74% { opacity: 0.95; transform: scale(1) rotate(45deg); }
          86% { opacity: 0; transform: scale(0.4) rotate(90deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mascot-glint { animation: none; }
        }
      `}</style>
    </svg>
  );
}
