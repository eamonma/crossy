// The small bespoke vocabulary that has no shadcn/ui equivalent: the dashed rule as a
// first-class Divider (the system's structural device, not a generic <hr>), the uppercase
// micro-label, the participant AvatarStack (built on shadcn's Avatar/AvatarFallback), and the
// wordmark. Buttons, panels/cards, badges, popovers, dialogs, and menus now live in
// src/components/ui/* (shadcn/ui, themed to Sand + Gold in styles.css); this file only keeps
// what shadcn does not provide.
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Join class names, dropping falsy entries. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The dashed rule: the system's primary structural device (audit section 2). */
export function Divider({
  variant = "dashed",
  className,
}: {
  variant?: "dashed" | "solid";
  className?: string;
}) {
  return (
    <hr
      className={cx(
        "border-0 border-t w-full",
        variant === "dashed"
          ? "border-dashed border-border-dashed"
          : "border-border",
        className,
      )}
    />
  );
}

/**
 * Uppercase micro-label with the caps tracking token: the one eyebrow/caption recipe (ACROSS /
 * DOWN, "You're invited", "Complete"). One size, one weight, tinted per context via className
 * (uses cn/tailwind-merge so a color override cleanly replaces the default, never competes
 * with it).
 */
export function CapsLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-1 font-semibold uppercase text-text-muted",
        "tracking-[var(--tracking-caps)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface StackMember {
  userId: string;
  initial: string;
  color: string;
  connected: boolean;
  role: "host" | "solver" | "spectator";
}

/**
 * Overlapping chips for who is here, capped with a +N count. Self reads gold; each chip
 * carries the panel-colored ring that separates it from its neighbors (not shadcn's
 * AvatarGroup default of ring-background: the stack sits on the panel face, not the page).
 *
 * Display rule: connected members always show; a disconnected member shows (dimmed) only when
 * it holds host or solver, so historical guest spectators do not pile up as permanent ghosts.
 * Self is always kept, connected or not. The remainder past `max` collapses into a quiet +N.
 */
export function AvatarStack({
  members,
  selfId = null,
  max = 5,
}: {
  members: readonly StackMember[];
  selfId?: string | null;
  max?: number;
}) {
  const visible = members.filter(
    (m) =>
      m.connected ||
      m.role === "host" ||
      m.role === "solver" ||
      m.userId === selfId,
  );
  const shown = visible.slice(0, max);
  const extra = visible.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((m) => (
          <Avatar
            key={m.userId}
            size="sm"
            title={m.initial}
            className={cx("ring-2 ring-panel", !m.connected && "opacity-55")}
          >
            <AvatarFallback
              className={
                m.userId === selfId
                  ? "bg-gold-4 text-gold-11"
                  : "bg-sand-4 text-sand-11"
              }
            >
              {m.initial.toUpperCase().slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-1 font-medium text-text-muted tabular-nums">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** The product's real monogram: a "C" whose descender sweeps into a "y". Never redrawn. */
function Monogram() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1080 1080"
      fill="none"
      className="w-full h-full block"
    >
      <path
        fill="currentColor"
        d="M714.413 679.414L737.363 720.724C654.743 770.296 576.713 807.016 493.175 807.016C334.361 807.016 194.825 696.856 194.825 494.896C194.825 274.576 356.393 153.4 527.141 153.4C591.401 153.4 656.579 170.842 714.413 205.726V352.606L670.349 361.786L636.383 265.396C588.647 228.676 540.911 209.398 493.175 209.398C390.359 209.398 332.525 292.018 332.525 454.504C332.525 631.678 419.735 733.576 543.665 733.576C596.909 733.576 640.973 713.38 714.413 679.414ZM595.266 941.044L649.428 796L470.418 424.21C466.746 415.948 462.156 410.44 453.894 407.686L411.666 394.834L420.846 350.77H654.936L649.428 393.916L587.922 405.85L700.836 666.562L782.538 436.144C785.292 428.8 787.128 421.456 787.128 417.784C787.128 411.358 784.375 407.686 777.949 405.85L726.54 393.916L733.884 350.77H908.304L901.879 394.834L858.733 405.85L676.05 878.62C644.838 959.404 591.594 992.452 528.252 992.452C475.926 992.452 430.944 966.748 430.944 925.438C430.944 891.472 452.976 865.768 491.532 865.768H532.842V938.29C542.94 944.716 553.956 948.388 564.054 948.388C574.152 948.388 584.25 945.634 595.266 941.044Z"
      />
    </svg>
  );
}

/** The brand lockup exactly as v2 ships it: the monogram in a gold disc, serif wordmark. */
export function Logo({
  size = 24,
  withName = true,
}: {
  size?: number;
  withName?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text">
      <span
        className="inline-flex items-center justify-center rounded-full bg-gold-9 text-white p-[2px] shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label="Crossy"
      >
        <Monogram />
      </span>
      {withName && (
        <span
          className="font-display font-semibold leading-none tracking-[-0.00625em]"
          style={{ fontSize: size * 0.75 }}
        >
          Crossy
        </span>
      )}
    </span>
  );
}
