import { cn } from "@/lib/utils";

/** The system's one skeleton recipe (styles.css): a quiet sand block with a slow shimmer
 * that stays static under prefers-reduced-motion. Replaces the CLI's animate-pulse gray. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton skeleton-shimmer", className)}
      {...props}
    />
  );
}

export { Skeleton };
