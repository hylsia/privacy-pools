/**
 * Names the network the way the landing footer does (Chrome.tsx, bottom bar): a 12px mono "Network" label, the full
 * Robinhood Chain logo on its approved plate, and the non-endorsement sentence. Hylsia is built for Robinhood Chain
 * Testnet only, so the plate stands alone: nothing beside it but the label.
 *
 * The plate is static: never faded, moved or transformed (see RobinhoodChain.tsx), so keep this out of animated
 * containers such as sheets and dialogs.
 */
import type { ReactNode } from "react";
import { RobinhoodChainLogo } from "@/components/brand/RobinhoodChain";
import { cn } from "@/lib/utils";

/** The non-endorsement sentence, the landing footer's and the dashboard's. */
export const NETWORK_TRADEMARK_LINE =
  "Hylsia is an independent project. Robinhood Chain and its logo are trademarks of their owner; their use here names the network and does not imply endorsement.";

export function NetworkAttribution({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-center md:gap-6", className)}>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">Network</span>
        <RobinhoodChainLogo height={20} />
      </div>
      <div className="min-w-0 space-y-1 text-xs leading-relaxed text-muted-foreground">
        {children}
        <p>{NETWORK_TRADEMARK_LINE}</p>
      </div>
    </div>
  );
}
