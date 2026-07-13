import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// The shadcn Switch (Radix Switch), themed to Sand + Gold. Sizes are explicit rem, not
// the h-5/w-9 the shadcn preset ships: this theme's Radix spacing scale makes w-9 resolve
// to 64px and h-5 to 24px (the Button file's warning), which would strand the thumb. Track
// 36x20, thumb 16, and NO border (a border would offset the thumb's translate origin and
// strand it 1px off the trailing edge); the thumb rests a symmetric 2px from each end.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.25rem] w-[2.25rem] shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-sand-6",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
          "data-[state=unchecked]:translate-x-[0.125rem] data-[state=checked]:translate-x-[1.125rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
