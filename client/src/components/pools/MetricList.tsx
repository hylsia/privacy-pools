import type { ReactNode } from "react";
import { Info } from "@/components/icons";
import { NoteDiamond } from "@/components/brand/NoteDiamond";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CARD } from "@/components/privacy/ui";

/** Dashboard figures read as one list, with a shared label/value alignment. */
export function MetricList({
  children,
  label,
  className = "",
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={`${CARD} divide-y divide-border/40 ${className}`}
    >
      {children}
    </dl>
  );
}

export function MetricRow({
  label,
  value,
  sub,
  hint,
  note = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
  note?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5">
      <dt className="flex min-w-0 items-center gap-2 text-sm font-medium leading-6 text-muted-foreground">
        {note && <NoteDiamond />}
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${label}`}
                className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{hint}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd className="min-w-0 sm:max-w-[60%] sm:text-right">
        <p className="break-words font-mono text-lg font-semibold leading-6 text-foreground">
          {value}
        </p>
        {sub && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {sub}
          </p>
        )}
      </dd>
    </div>
  );
}
