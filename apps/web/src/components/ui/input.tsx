import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 32px tall (rem literal: the theme's Radix spacing steps would make h-8 render
        // 48px). text-3 on touch viewports keeps iOS from zooming the focused field.
        "h-[2rem] w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-3 transition-colors outline-none file:inline-flex file:h-[1.5rem] file:border-0 file:bg-transparent file:text-2 file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-2 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
