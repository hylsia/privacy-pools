/**
 * Landing section "FAQ" (#faq): short answers before the closing scene.
 *
 * Every answer restates facts the page already gives (Pool status, What stays
 * private, Built in not promised, Step by step, Inside the proof, The network),
 * or a limit the app's Privacy & trust tab and docs/privacy-pools/README.md
 * disclose (who runs the relayer and the association-set service and that they
 * see your IP, the anonymity set, what ragequitting a change note reveals);
 * nothing here adds a number, date, partner or promise. The first answer
 * follows the pool's deployment state from usePoolStatus().
 *
 * A calm night band: a big short headline on the left, the questions in one
 * glass panel on the right. Behind them a
 * faint constellation (nine stars in a loose question mark) draws itself as
 * the section scrolls in, over a sparse star field; both drift slower than the
 * page (a pass-through SceneStage, pointer parallax on fine pointers). The top
 * and bottom edges fade into the page's night, so the band joins its
 * neighbours without a line. The copy and the panel never move.
 *
 * The accordion is built directly on the Radix primitives (components/ui/
 * accordion imports lucide) with a Font Awesome chevron; answers open without
 * a height animation. Keyboard: Tab between questions, Enter/Space toggles.
 */
import type { ReactNode } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { Link } from "wouter";
import { DUPLICATE_NOTE_RISK, PUBLIC_VALIDATION_STATUS } from "@/privacy/safetyCopy";
import { ArrowUpRight, ChevronDown } from "@/components/icons";
import { Container, FOCUS_RING, SECTION_X, SCENE_TYPE, SectionLink } from "@/components/landing/system";
import { CHAIN_ID, FAUCET_URL, POOLS_PATH } from "@/components/landing/links";
import { useMedia, useMotionSafe, useRange } from "@/components/landing/parallax";
import { primaryCta, usePoolStatus, type PoolState } from "@/components/landing/usePoolStatus";
import {
  Constellation,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Starfield,
  useScene,
  type SceneSparkleSpec,
} from "@/components/landing/scene";
import { FAQ_FIELD, FAQ_LINKS, FAQ_STARS } from "@/components/landing/scene/closing-dawn";
import { FaqHorizonGlow, FaqHorizonRange } from "@/components/landing/scene/faq-horizon";
import { cn } from "@/lib/utils";

/**
 * Links inside an answer. They sit in running text, so they keep a faint
 * underline (not colour alone) that strengthens on hover.
 */
const LINK = cn(
  "rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary",
  FOCUS_RING,
);

/** The association set's screening policy, a page of the app (/pools/screening, in the privacy area). */
const SCREENING_POLICY_PATH = "/pools/screening";

interface Item {
  /** accordion value; also keeps the open state stable when the copy changes */
  id: string;
  question: string;
  answer: ReactNode;
}

/** Open on first paint: the one answer that follows the pool's deployment state. */
const FIRST_ID = "deployment";

/**
 * The questions, in reading order. Only the first answer depends on the state:
 * the live copy (Pool status) once the pool is live, otherwise the pending copy
 * (Pool status and the closing card). Its link is the page's one primary
 * action, so it never dead-ends: the vault when live, otherwise the app (Pools).
 */
function items(state: PoolState): Item[] {
  const cta = primaryCta(state);
  return [
    {
      id: FIRST_ID,
      question: "Is the pool live yet?",
      answer:
        state === "live" ? (
          <>
            A testnet pool is configured. Check{" "}
            <SectionLink to="status" className={LINK}>
              Pool status
            </SectionLink>{" "}
            for whether its public contract state can currently be read. {PUBLIC_VALIDATION_STATUS} The release remains blocked by a known note-reuse issue; it is not audited.{" "}
            <Link href="/docs/security" className={LINK}>Read Security &amp; status</Link>.{" "}
            <Link href={cta.href} className={LINK}>
              {cta.label}
            </Link>
            .
          </>
        ) : state === "pending" ? (
          <>
            Not yet. Circuits, contracts and the app are built and tested end-to-end on a local chain, and the pool
            address will appear under{" "}
            <SectionLink to="status" className={LINK}>
              Pool status
            </SectionLink>{" "}
            as soon as it is deployed to chain {CHAIN_ID}. Until then, you can{" "}
            <Link href={cta.href} className={LINK}>
              explore the app
            </Link>{" "}
            and get testnet ETH ready.
          </>
        ) : (
          <>
            {state === "loading" ? "The pool's live status is being checked." : "The pool's live status could not be checked right now."}{" "}
            See <SectionLink to="status" className={LINK}>Pool status</SectionLink> or{" "}
            <Link href={POOLS_PATH} className={LINK}>open the dashboard</Link> for the latest information.
            Testnet ETH only; the pool is not audited.
          </>
        ),
    },
    {
      id: "hidden",
      question: "What does the proof hide, and what stays public?",
      answer: (
        <>
          It hides which deposit a withdrawal spends, along with your note secrets, the proof witness and the balance
          you keep in the pool. Addresses, amounts, the relayer fee and timing stay as public as any other
          transaction. How well it hides depends on the anonymity set: the deposits a withdrawal could have come
          from. A quiet pool offers little cover, and{" "}
          <Link href={POOLS_PATH} className={LINK}>
            Pools
          </Link>{" "}
          shows each pool's Privacy health. Withdrawing to the wallet that deposited, or paying your own gas, links
          the two again, and the app warns before you do. More under{" "}
          <SectionLink to="privacy" className={LINK}>
            What stays private
          </SectionLink>
          .
        </>
      ),
    },
    {
      id: "custody",
      question: "Can anyone else spend or freeze my deposit?",
      answer: (
        <>
          No service in the path can spend your funds, and none receives your seed or note secrets: only proofs and
          public inputs. Hylsia runs the relayer and the association-set service on its server; like the RPC node,
          they can see your IP. The association-set service can delay a deposit or leave it out of the set, as its{" "}
          <Link href={SCREENING_POLICY_PATH} className={LINK}>
            screening policy
          </Link>{" "}
          explains. The public exit requires an unspent note, its proof, the original depositor wallet and gas.
          It does not repair the known duplicate-note issue. The owner can stop new deposits,
          set the minimum deposit, choose who publishes the association-set root and transfer ownership. It cannot
          move funds, pause withdrawals or upgrade the contracts.
        </>
      ),
    },
    {
      id: "exit",
      question: "What happens if the association-set service stops?",
      answer: (
        <>
          Newly eligible deposits cannot join the association set while publishing is stopped. A private withdrawal
          needs an accepted root that includes its deposit label. Ragequit does not require an association-set root;
          it requires an unspent note, a matching proof, the original depositor wallet and gas.
          {" "}{DUPLICATE_NOTE_RISK} Ragequitting a change note also reveals which deposit your earlier withdrawal spent.
        </>
      ),
    },
    {
      id: "recovery",
      question: "How do I recover my funds on a new device?",
      answer: (
        <>
          From your backup file. Your seed is created on your device and encrypted with your password, and
          your notes, spent status, change and recoverable balance are rebuilt from the backup plus public chain events.
          The backup does not include the complete local activity log. A wallet signature is never enough on its own, so you test recovery before your first
          deposit: deposits unlock only after you re-import the backup and prove it restores access.
        </>
      ),
    },
    {
      id: "relayer",
      question: "What does the relayer do, and what does it cost?",
      answer: (
        <>
          It submits your withdrawal so the recipient pays no gas, for a relayer fee that stays public like the
          amount. Recipient, relayer, fee and deadline are hashed into the proof: change any of them and the pool
          rejects the transaction, so the relayer can delay a withdrawal but never reroute it. Paying your own gas
          instead makes the payer visible.
        </>
      ),
    },
    {
      id: "partial",
      question: "Can I withdraw only part of a deposit?",
      answer: (
        <>
          Yes. The proof also shows that the amount is no larger than the note, and the remainder stays in the pool
          as a new commitment: your change note. The balance you keep stays hidden, and recovery rebuilds every
          change note.
        </>
      ),
    },
    {
      id: "network",
      question: "Which network, and is it audited?",
      answer: (
        <>
          Hylsia is built for Robinhood Chain Testnet (chain {CHAIN_ID}), an Ethereum-compatible Layer 2 where gas is
          paid in testnet ETH, which has no real-world value. It is tested, not audited: contracts run against real
          proofs in Foundry and the full flow runs end-to-end on a local chain. The Groth16 setup is a development
          setup, suitable for testnet only.{" "}
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            Get testnet ETH from the faucet
            <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </>
      ),
    },
  ];
}

// ─── Backdrop ─────────────────────────────────────────────────────────────────

/** The question-mark constellation; it draws itself as the section scrolls in (finished in a still frame). */
function QuestionStars({ className }: { className: string }) {
  const { progress, mode } = useScene();
  const draw = useRange<number>(progress, [0.2, 0.5], [0, 1]);
  return (
    <div className={cn("absolute", className)}>
      <Constellation nodes={FAQ_FIELD} links={[]} className="absolute inset-0 h-full w-full opacity-70" />
      <Constellation
        nodes={FAQ_STARS}
        links={FAQ_LINKS}
        draw={mode === "static" ? undefined : draw}
        stroke="#aeb4ff"
        className="absolute inset-0 h-full w-full opacity-60"
      />
    </div>
  );
}

/**
 * A few sparkles in the open night around the header and the panel. They ride
 * the far plane, which sits about 110px higher than at rest while the band
 * scrolls in, so none is placed where that would put it on the header copy.
 */
const SPARKLES_WIDE: SceneSparkleSpec[] = [
  { left: "37%", top: "18%", size: 13, tone: "gold", delay: 0.8 },
  { left: "96%", top: "9%", size: 9, tone: "white", delay: 2.6 },
  { left: "3%", top: "62%", size: 8, tone: "white", delay: 4.1 },
];
const SPARKLES_NARROW: SceneSparkleSpec[] = [
  { left: "88%", top: "4%", size: 11, tone: "gold", delay: 0.8 },
  { left: "6%", top: "2.5%", size: 8, tone: "white", delay: 2.6 },
];

/**
 * The night behind the band: stars and the glow on the horizon (sky), the
 * constellation and a far moonlit range with mist at its foot along the bottom
 * (far; faq-horizon.tsx), two faint nebula glows and the fades into the page's
 * night at both edges (static). The range foreshadows the closing's dawn
 * ranges, so the FAQ hands off to the dawn as one landscape. Keyed by layout
 * and motion, so its ranges are constant per mount.
 */
function FaqBackdrop({ wide, still }: { wide: boolean; still: boolean }) {
  return (
    <SceneStage mode={still ? "static" : "through"} factor={0.4} className="absolute inset-0 -z-10">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(42%_34%_at_78%_30%,rgb(139_108_246/0.11),transparent_72%),radial-gradient(40%_30%_at_14%_72%,rgb(106_75_224/0.1),transparent_70%)]"
      />
      <SceneLayer depth="sky">
        <FaqHorizonGlow tier={wide ? "wide" : "narrow"} />
        <Starfield count={wide ? 90 : 60} seed={63} twinkle="one" className="absolute -inset-x-4 inset-y-0 h-full" />
      </SceneLayer>
      <SceneLayer depth="far">
        <SceneSparkles items={wide ? SPARKLES_WIDE : SPARKLES_NARROW} />
        {/*
          the constellation only where the column under the header is empty (lg up). This plane lags the band, so
          the box is sized to clear the header while the band scrolls in and to keep the "?" dot above the range
        */}
        {wide && <QuestionStars className="left-[7%] top-[48%] h-[25%] w-[29%] max-w-[440px]" />}
        <FaqHorizonRange tier={wide ? "wide" : "narrow"} />
      </SceneLayer>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[16vh] bg-[linear-gradient(to_bottom,var(--night-1),transparent)]" />
      {/* short at the bottom: it takes the range's foot into the night where the closing scene begins */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[10vh] bg-[linear-gradient(to_top,var(--night-1),transparent)]" />
    </SceneStage>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/** The glass panel: a hairline, a lit top edge and a deep soft shadow. Static. */
const PANEL =
  "relative rounded-2xl border border-white/[0.09] bg-[linear-gradient(180deg,rgb(22_27_76/0.78),rgb(12_14_46/0.86)_40%,rgb(10_12_42/0.9))] shadow-[0_40px_90px_-50px_rgb(2_3_18/0.95),inset_0_1px_0_rgb(255_255_255/0.07)]";

/** Focus ring drawn inside the row, so it never spills past the panel's rounded edge. */
const ROW_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--lavender)]";

export default function Faq() {
  const { state } = usePoolStatus();
  const safe = useMotionSafe();
  const wide = useMedia("(min-width: 1024px)");
  const list = items(state);

  return (
    // the bottom padding is the strip of land under the panel (faq-horizon.tsx places the range's peaks just below it)
    <section id="faq" aria-labelledby="faq-title" className={cn("relative isolate pb-[20vh] pt-24 sm:pt-28 lg:pb-[22vh]", SECTION_X)}>
      <FaqBackdrop key={`${wide ? "w" : "n"}${safe ? "" : "-still"}`} wide={wide} still={!safe} />

      {/* 5/7 from lg. Not sticky: the constellation drifts through the empty column under the header */}
      <Container className="grid gap-y-10 md:gap-y-14 lg:grid-cols-12 lg:gap-x-10">
        <div className="lg:col-span-5">
          <p className={SCENE_TYPE.eyebrow}>FAQ</p>
          <h2
            id="faq-title"
            className="mt-4 text-balance font-display text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] text-[color:var(--ink)] [text-shadow:0_2px_32px_rgb(4_5_26/0.55)] sm:mt-5 sm:text-[3rem] lg:text-[2.5rem] xl:text-[3.5rem]"
          >
            Questions before you <span className="scene-text-glow">try it.</span>
          </h2>
          <p className={cn("mt-5 max-w-[30rem] sm:mt-6", SCENE_TYPE.lead, "xl:text-lg")}>
            Short answers on status, scope, and what the proof does and does not hide.
          </p>
          <p className={cn("mt-6 hidden font-mono text-xs uppercase tracking-[0.2em] text-[color:rgb(174_180_255/0.75)] lg:block")}>
            {String(list.length).padStart(2, "0")} answers
          </p>
        </div>

        <div className="lg:col-span-7">
          <Accordion.Root type="multiple" defaultValue={[FIRST_ID]} className={PANEL}>
            {/* a faint sheen along the panel's top edge */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(201_204_255/0.4),transparent)]"
            />
            {list.map((item, i) => (
              <Accordion.Item
                key={item.id}
                value={item.id}
                className="group/item relative border-b border-white/[0.07] transition-colors duration-300 first-of-type:rounded-t-2xl last:rounded-b-2xl last:border-b-0 data-[state=open]:bg-[linear-gradient(90deg,rgb(174_180_255/0.075),rgb(174_180_255/0.02)_55%,transparent)]"
              >
                {/* the open row's accent */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-5 left-0 top-5 w-[2px] rounded-full bg-[linear-gradient(to_bottom,var(--lavender),rgb(139_108_246/0.4))] opacity-0 transition-opacity duration-300 group-data-[state=open]/item:opacity-100"
                />
                <Accordion.Header className="flex">
                  <Accordion.Trigger
                    className={cn(
                      "group grid w-full grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-x-3 rounded-2xl px-5 py-5 text-left sm:grid-cols-[2.5rem_minmax(0,1fr)_2.25rem] sm:gap-x-4 sm:px-7",
                      ROW_FOCUS,
                    )}
                  >
                    <span className="font-mono text-xs tabular-nums tracking-[0.12em] text-[color:rgb(174_180_255/0.72)] transition-colors group-hover:text-[color:var(--lavender)] group-data-[state=open]:text-[color:var(--lavender)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[15px] font-medium leading-snug text-[color:rgb(244_243_255/0.9)] transition-colors group-hover:text-white group-data-[state=open]:text-white sm:text-base">
                      {item.question}
                    </span>
                    <span
                      aria-hidden
                      className="grid h-8 w-8 place-items-center justify-self-end rounded-full border border-white/[0.12] bg-white/[0.03] text-[color:var(--mist)] transition-colors duration-200 group-hover:border-white/25 group-data-[state=open]:border-[rgb(174_180_255/0.45)] group-data-[state=open]:bg-[rgb(174_180_255/0.14)] group-data-[state=open]:text-white sm:h-9 sm:w-9"
                    >
                      <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                    </span>
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="px-5 pb-6 sm:pb-7 sm:pl-[5.25rem] sm:pr-16">
                  <p className="max-w-[40rem] text-[15px] leading-relaxed text-[color:rgb(201_204_255/0.82)]">
                    {item.answer}
                  </p>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </div>
      </Container>
    </section>
  );
}
