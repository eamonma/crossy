import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Control text sits one step below prose (text-1; lg, the gate CTAs, opts up to text-2)
  // so buttons read as controls, not sentences. Heights are rem literals, not h-N
  // utilities: this theme's Radix spacing steps make h-5..h-9 resolve to 24/32/40/48/64px,
  // so a stock shadcn h-7 quietly renders 40px. Targets: default 28, sm 24, xs 20, lg 36.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-1 font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        // The one gold CTA per screen. White glyph, no scale, darkens on hover (was
        // BUTTON_VARIANT.solid).
        default: "bg-primary text-primary-foreground hover:bg-solid-hover",
        // The strong ink CTA (sign-in): a dark face on light, a light face on dark, so it
        // flips with the theme and reads as the primary action without spending the gold.
        inverse: "bg-text text-background hover:bg-text/85",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        // The panel recipe as a control: warm face, hairline, quiet hover tint (was
        // BUTTON_VARIANT.soft).
        secondary:
          "border border-border bg-card text-card-foreground hover:bg-sand-3 aria-expanded:bg-sand-3",
        // Chromeless: nav, back, icon actions (was BUTTON_VARIANT.ghost).
        ghost:
          "text-muted-foreground hover:bg-sand-3 hover:text-foreground aria-expanded:bg-sand-3 aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[1.75rem] gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        xs: "h-[1.25rem] gap-1 rounded-[min(var(--radius-md),10px)] px-1.5 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[1.5rem] gap-1 rounded-[min(var(--radius-md),12px)] px-1.5 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1",
        lg: "h-[2.25rem] gap-1.5 px-3 text-2 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-[1.75rem]",
        "icon-xs":
          "size-[1.25rem] rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-[1.5rem] rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        // The one touch-first square (mobile clue-bar steppers): a thumb target, so the
        // icon scales up with it.
        "icon-lg": "size-[2.25rem] [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
