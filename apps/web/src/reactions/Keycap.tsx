// The keyboard-teaching chip (Wave 7.3, owner-requested always-on affordance). It reads as quiet UI
// chrome, the register of a macOS menu's shortcut glyph, never a shouting badge: a hairline sand
// chip with a mono glyph. One recipe so the two direct-key hints in the tray, the tray's `/` hint,
// and every HUD slot label are the same object. Heights are rem literals on purpose (Radix spacing
// inflates a Tailwind control height in this app; see MEMORY radix-spacing-inflates-shadcn-heights).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Keycap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-1 border border-border-strong",
        "bg-sand-2 font-mono text-0 leading-none font-medium text-text-subtle",
        "shadow-xs select-none",
        className,
      )}
      style={{
        minWidth: "0.95rem",
        height: "0.95rem",
        paddingInline: "0.15rem",
      }}
    >
      {children}
    </kbd>
  );
}
