/**
 * The Privacy Pools icon set — every glyph is a Font Awesome Free icon.
 *
 * Icons are exported as small React components that take a `className` (size
 * and colour come from Tailwind utilities, e.g. "h-4 w-4 text-primary"), so the
 * call sites stay library-agnostic. Add an icon by importing its definition
 * from @fortawesome/free-solid-svg-icons (or free-brands) and wrapping it with
 * `fa()` below.
 *
 * Font Awesome's base stylesheet is imported into the `base` cascade layer in
 * index.css, so Tailwind's size utilities always win over its 1em default.
 */
import type { CSSProperties } from "react";
import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon, type FontAwesomeIconProps } from "@fortawesome/react-fontawesome";
import { faEthereum, faXTwitter } from "@fortawesome/free-brands-svg-icons";
import {
  faAnglesLeft,
  faAnglesRight,
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowRightFromBracket,
  faArrowRightToBracket,
  faArrowsRotate,
  faArrowsUpDown,
  faArrowUp,
  faArrowUpRightFromSquare,
  faBars,
  faBookOpen,
  faBuildingColumns,
  faCalendarDays,
  faChartLine,
  faChartSimple,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCircleCheck,
  faCircleInfo,
  faCircleNotch,
  faCircleQuestion,
  faCircleXmark,
  faClock,
  faClockRotateLeft,
  faCoins,
  faCopy,
  faCube,
  faDiagramProject,
  faDoorOpen,
  faDownload,
  faEye,
  faEyeSlash,
  faFaucetDrip,
  faFileCircleCheck,
  faFileShield,
  faFingerprint,
  faFlask,
  faGasPump,
  faHashtag,
  faKey,
  faLayerGroup,
  faLink,
  faLock,
  faLockOpen,
  faMagnifyingGlass,
  faMicrochip,
  faMinus,
  faMoon,
  faPaperPlane,
  faPercent,
  faPlus,
  faRobot,
  faRotateLeft,
  faServer,
  faShieldHalved,
  faSliders,
  faSort,
  faSortDown,
  faSortUp,
  faSun,
  faTableColumns,
  faTerminal,
  faTrashCan,
  faTriangleExclamation,
  faUpload,
  faUsers,
  faUserSecret,
  faWallet,
  faWandMagicSparkles,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

// The stylesheet is bundled through index.css; do not let the library inject a second, unlayered copy.
config.autoAddCss = false;

export interface IconProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  title?: string;
  "aria-hidden"?: boolean | "true" | "false";
  /** Accepted for call-site compatibility with outline icon sets; solid glyphs have no stroke. */
  strokeWidth?: number;
}

export type IconType = (props: IconProps) => React.JSX.Element;

function fa(definition: IconDefinition): IconType {
  return function Icon({ className, style, title }: IconProps) {
    const css = style as FontAwesomeIconProps["style"];
    return title ? (
      <FontAwesomeIcon icon={definition} className={className} style={css} role="img" aria-label={title} />
    ) : (
      <FontAwesomeIcon icon={definition} className={className} style={css} aria-hidden />
    );
  };
}

// ─── Pool actions ─────────────────────────────────────────────────────────────

/** Deposit: value entering the pool. */
export const ArrowDownToLine = fa(faArrowRightToBracket);
/** Withdraw: value leaving the pool. */
export const ArrowUpFromLine = fa(faArrowRightFromBracket);
/** Ragequit: the public exit. */
export const DoorOpen = fa(faDoorOpen);
export const LogOut = fa(faDoorOpen);
export const Send = fa(faPaperPlane);
export const Undo2 = fa(faRotateLeft);

// ─── Privacy and proofs ───────────────────────────────────────────────────────

export const ShieldCheck = fa(faShieldHalved);
export const Lock = fa(faLock);
export const LockOpen = fa(faLockOpen);
export const KeyRound = fa(faKey);
export const Eye = fa(faEye);
export const EyeOff = fa(faEyeSlash);
export const Cpu = fa(faMicrochip);
export const Fingerprint = fa(faFingerprint);
export const UserSecret = fa(faUserSecret);
export const FileLock2 = fa(faFileShield);
export const FileCheck2 = fa(faFileCircleCheck);
export const Network = fa(faDiagramProject);
export const Link2 = fa(faLink);
export const Users = fa(faUsers);
export const FlaskConical = fa(faFlask);
export const Sparkles = fa(faWandMagicSparkles);

// ─── Chain and network ────────────────────────────────────────────────────────

export const Cube = fa(faCube);
export const Hashtag = fa(faHashtag);
export const GasPump = fa(faGasPump);
export const Server = fa(faServer);
export const Faucet = fa(faFaucetDrip);
export const Search = fa(faMagnifyingGlass);
export const Landmark = fa(faBuildingColumns);
export const Coins = fa(faCoins);
export const Percent = fa(faPercent);
export const Ethereum = fa(faEthereum);
export const XTwitter = fa(faXTwitter);

// ─── Status ───────────────────────────────────────────────────────────────────

export const Check = fa(faCheck);
export const CheckCircle2 = fa(faCircleCheck);
export const BadgeCheck = fa(faCircleCheck);
export const XCircle = fa(faCircleXmark);
export const AlertTriangle = fa(faTriangleExclamation);
export const Info = fa(faCircleInfo);
/** Spinner; pair with `animate-spin`. */
export const Loader2 = fa(faCircleNotch);
export const RefreshCw = fa(faArrowsRotate);
export const History = fa(faClockRotateLeft);

// ─── Navigation and chrome ────────────────────────────────────────────────────

export const ArrowRight = fa(faArrowRight);
export const ArrowLeft = fa(faArrowLeft);
export const ArrowDown = fa(faArrowDown);
/** "Back to top". */
export const ArrowUp = fa(faArrowUp);
export const ArrowUpRight = fa(faArrowUpRightFromSquare);
export const ExternalLink = fa(faArrowUpRightFromSquare);
export const ArrowUpDown = fa(faArrowsUpDown);
/** Column sort affordances: unsorted, ascending, descending. */
export const Sort = fa(faSort);
export const SortUp = fa(faSortUp);
export const SortDown = fa(faSortDown);
export const Clock = fa(faClock);
export const ChevronLeft = fa(faChevronLeft);
export const ChevronRight = fa(faChevronRight);
export const ChevronDown = fa(faChevronDown);
export const ChevronsLeft = fa(faAnglesLeft);
export const ChevronsRight = fa(faAnglesRight);
export const Menu = fa(faBars);
/** Close (a menu, a panel). */
export const X = fa(faXmark);
/** Expand / collapse affordances (accordions). */
export const Plus = fa(faPlus);
export const Minus = fa(faMinus);
/** Questions (FAQ). */
export const CircleQuestion = fa(faCircleQuestion);
export const Moon = fa(faMoon);
export const Sun = fa(faSun);

// ─── App ──────────────────────────────────────────────────────────────────────

export const Wallet = fa(faWallet);
export const WalletCards = fa(faWallet);
export const Layers = fa(faLayerGroup);
export const BarChart2 = fa(faChartSimple);
export const LineChart = fa(faChartLine);
export const Bot = fa(faRobot);
export const BookOpen = fa(faBookOpen);
export const Copy = fa(faCopy);
export const Download = fa(faDownload);
export const Upload = fa(faUpload);
export const Trash2 = fa(faTrashCan);
export const Columns3 = fa(faTableColumns);
export const SlidersHorizontal = fa(faSliders);
export const Terminal = fa(faTerminal);
export const CalendarDays = fa(faCalendarDays);
