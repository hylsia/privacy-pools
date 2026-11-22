import { cn } from "@/lib/utils";

/** Loading placeholder. Muted, like the landing's loading pill: this theme's --accent is the primary, which made loading rows the loudest thing on the page. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
