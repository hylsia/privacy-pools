/**
 * The dashboard's network pickers, on a static Radix dropdown: the content never zooms, fades or slides (no
 * animate-in classes), so the Robinhood Chain feather inside it is never transformed or faded, and nothing in it is a
 * `disabled` item, because disabled items fade (ui/dropdown-menu.tsx). A network without a usable pool is a plain,
 * non-interactive row. Choosing a network only re-selects what this device already holds: it never sends a request.
 *
 *   - NetworkFilter: the Pools table and My notes. "All networks" or one network; hidden when the build offers only one.
 *   - NetworkSwitcher: the vault strip. Picks the active pool; while an operation runs it is a static chip, "locked".
 *
 * Marks follow NetworkMark (the feather for Robinhood Chain Testnet at 20px, a neutral monogram otherwise), always
 * with the network's name beside them, one network per row: never two marks in one badge.
 */
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "@/components/icons";
import { NetworkMark } from "@/components/brand/NetworkMark";
import { Button } from "@/components/ui/button";
import { QUIET_HOVER } from "@/components/privacy/ui";
import { cn } from "@/lib/utils";
import { poolDataUnavailable } from "@/privacy/publicData";
import type { NetworkInfo, PoolKey } from "@shared/privacy/networks";
import type { NetworkFilterValue } from "./prefs";

/** The menu surface: no animate-in / fade / zoom / slide classes, on purpose. */
const CONTENT =
  "z-50 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-xl max-h-(--radix-dropdown-menu-content-available-height)";
/** One choosable row; the highlight is a background, never an opacity change. */
const ITEM =
  "relative flex cursor-default select-none items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted/70";
/** A row that cannot be chosen (not deployed yet, unavailable): plain text, full-strength marks. */
const STATIC_ROW = "flex items-center gap-2.5 px-2 py-2 text-sm";
const FOOTER = "px-2 pb-1.5 pt-1 text-xs leading-relaxed text-muted-foreground";

/** "A and B", "A, B and C" */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function Picked() {
  return (
    <Menu.ItemIndicator className="ml-auto shrink-0">
      <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
    </Menu.ItemIndicator>
  );
}

function Separator() {
  return <Menu.Separator className="mx-1 my-1 h-px bg-border/60" />;
}

// ─── filter (Pools, My notes) ─────────────────────────────────────────────────

/**
 * "All networks" or one network. Trigger: "All networks", or the network's mark and name; aria-label
 * "Network: {label}". Renders nothing when fewer than two networks are offered.
 */
export function NetworkFilter({
  value,
  onChange,
  networks,
  className,
}: {
  value: NetworkFilterValue;
  onChange: (v: NetworkFilterValue) => void;
  /** the networks to offer, in registry order (Robinhood Chain Testnet first) */
  networks: readonly NetworkInfo[];
  /** the trigger's look (the caller's toolbar control) */
  className?: string;
}) {
  if (networks.length < 2) return null;
  const current = value === "all" ? null : (networks.find((n) => n.chainId === value) ?? null);
  const label = current ? current.name : "All networks";
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <Button variant="outline" className={cn("gap-2", className)} aria-label={`Network: ${label}`}>
          {current && <NetworkMark network={current} className="-ml-1" />}
          {label}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className={CONTENT}>
          <Menu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Network</Menu.Label>
          <Menu.RadioGroup value={String(value)} onValueChange={(v) => onChange(v === "all" ? "all" : Number(v))}>
            <Menu.RadioItem value="all" className={ITEM}>
              {/* the same width as a mark, so the names line up */}
              <span className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                All networks
                <span className="block text-xs text-muted-foreground">{namesList(networks.map((n) => n.name))}</span>
              </span>
              <Picked />
            </Menu.RadioItem>
            {networks.map((n) => (
              <Menu.RadioItem key={n.chainId} value={String(n.chainId)} className={ITEM}>
                <NetworkMark network={n} />
                <span className="min-w-0 flex-1">
                  {n.name}
                  <span className="block font-mono text-xs text-muted-foreground">Chain ID {n.chainId}</span>
                </span>
                <Picked />
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Separator />
          <p className={FOOTER}>Testnet ETH only · not audited · each network is its own crowd</p>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ─── switcher (the vault strip) ───────────────────────────────────────────────

export interface SwitcherOption {
  network: NetworkInfo;
  /** the pool to switch to; null for a network without a usable pool */
  key: PoolKey | null;
  /** live: choosable; pending: not deployed yet; unavailable: this build cannot use the pool it names */
  state: "live" | "pending" | "unavailable";
  /** while the vault is unlocked: this vault's notes in that pool (only once the pool was read) */
  notes?: number;
  /** the pool's public data could not be read: its row says so instead of a note count */
  unreadable?: boolean;
}

const notesWord = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "note" : "notes"}`;

/**
 * The active network, as the first segment of the strip's network chip (`[mark] {name} ▾ │ 0x12…ab ↗`; the caller
 * passes the address segment as `children`). With more than one network offered it opens the menu; while `locked`
 * (an operation in flight) it is a static chip with no chevron, never a disabled control, so the feather stays at
 * full strength. With a single network it is the static chip.
 */
export function NetworkSwitcher({
  options,
  active,
  activeKey,
  onSelect,
  locked,
  children,
}: {
  options: readonly SwitcherOption[];
  active: NetworkInfo;
  activeKey: PoolKey | null;
  onSelect: (key: PoolKey) => void;
  locked: boolean;
  children?: ReactNode;
}) {
  // the mark sits 4px from the chip's edge, as the feather did in the single-network strip
  const segment = "inline-flex min-w-0 items-center gap-1.5 pl-1 pr-2";
  const name = (
    <>
      <NetworkMark network={active} />
      <span className="truncate">{active.name}</span>
    </>
  );
  const choosable = options.length > 1;

  return (
    <span className="inline-flex h-7 min-w-0 max-w-full items-center divide-x divide-border/60 rounded-md border border-border/60 font-mono text-xs text-muted-foreground">
      {!choosable ? (
        <span className={segment}>{name}</span>
      ) : locked ? (
        <span className={segment}>
          {name}
          <span className="sr-only"> Network locked while a transaction is in progress</span>
        </span>
      ) : (
        <Menu.Root modal={false}>
          <Menu.Trigger asChild>
            <button
              type="button"
              aria-label={`Network: ${active.name}. Change network`}
              className={`${segment} h-full rounded-l-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${QUIET_HOVER}`}
            >
              {name}
              <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={6} className={CONTENT}>
              <Menu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Network</Menu.Label>
              <Menu.RadioGroup value={activeKey ?? ""} onValueChange={(v) => onSelect(v as PoolKey)}>
                {options.map((o) =>
                  o.state === "live" && o.key ? (
                    <Menu.RadioItem key={o.network.chainId} value={o.key} className={ITEM}>
                      <NetworkMark network={o.network} />
                      <span className="min-w-0 flex-1">
                        {o.network.name}
                        <span className="block font-mono text-xs text-muted-foreground">
                          Chain ID {o.network.chainId}
                          {o.notes !== undefined && ` · ${notesWord(o.notes)}`}
                        </span>
                        {o.unreadable && <span className="block text-xs text-muted-foreground">{poolDataUnavailable(o.network.name)}</span>}
                      </span>
                      <Picked />
                    </Menu.RadioItem>
                  ) : (
                    // not an item: nothing to choose, and a disabled item would fade the mark
                    <div key={o.network.chainId} className={STATIC_ROW}>
                      <NetworkMark network={o.network} />
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        <span className="text-foreground">{o.network.name}</span>
                        <span className="block text-xs">{o.state === "pending" ? "Not deployed yet" : "Unavailable"}</span>
                      </span>
                    </div>
                  ),
                )}
              </Menu.RadioGroup>
              <Separator />
              <p className={FOOTER}>Each network has its own pool and anonymity set. A note is withdrawn on the network it was deposited on.</p>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      {children}
    </span>
  );
}
