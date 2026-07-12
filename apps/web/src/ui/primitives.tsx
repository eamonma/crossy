// The small bespoke vocabulary that has no shadcn/ui equivalent: the dashed rule as a
// first-class Divider (the system's structural device, not a generic <hr>), the uppercase
// micro-label, the participant AvatarStack (built on shadcn's Avatar/AvatarFallback), and the
// wordmark. Buttons, panels/cards, badges, popovers, dialogs, and menus now live in
// src/components/ui/* (shadcn/ui, themed to Sand + Gold in styles.css); this file only keeps
// what shadcn does not provide.
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  /** The full display name, for anywhere the member is named: the roster rows, the kick
   * confirm, the chip tooltip. The stack's chip itself renders only `initial`. */
  name: string;
  initial: string;
  /**
   * The opaque avatar URL, or null (PROTOCOL.md §4). When present the chip renders the image; while
   * it loads, on a load error, or when null it falls back to the initial. Radix's Avatar.Image ->
   * Avatar.Fallback swap gives that behavior for free, so null never breaks the render.
   */
  avatarUrl: string | null;
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
            title={m.name}
            className={cx("ring-2 ring-panel", !m.connected && "opacity-55")}
          >
            {m.avatarUrl !== null && <AvatarImage src={m.avatarUrl} alt="" />}
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

/**
 * The Crossy mark: the 3x3 heart of the app icon's CROSSY crossword, blocks stepping
 * down the anti-diagonal to the one gold cell, the Y. Canonical geometry lives in
 * docs/design/logo/generate.py, which checks this component for drift; edit both.
 * Light draws ink (currentColor) blocks and grid lines, open cells transparent so the
 * page plays the paper. Dark flips to the identity's plate treatment (app icon,
 * favicon): the open cells glow as plates, the panel shows through as blocks and grid
 * lines. Lines run to the frame so the puzzle reads as continuing past the crop.
 * Gold is the token, never a baked hex.
 */
function CrosswordMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      className="w-full h-full block"
    >
      <g className="dark:hidden">
        <rect x="16" width="8" height="8" fill="currentColor" />
        <rect x="8" y="8" width="8" height="8" fill="currentColor" />
        <rect y="16" width="8" height="8" fill="currentColor" />
        <rect x="16" y="16" width="8" height="8" fill="var(--color-gold-9)" />
        <path
          d="M8 0v24M16 0v24M0 8h24M0 16h24"
          stroke="currentColor"
          strokeWidth="1.25"
        />
      </g>
      <g className="hidden dark:block">
        <rect width="7.375" height="7.375" fill="currentColor" />
        <rect x="8.625" width="6.75" height="7.375" fill="currentColor" />
        <rect y="8.625" width="7.375" height="6.75" fill="currentColor" />
        <rect
          x="16.625"
          y="8.625"
          width="7.375"
          height="6.75"
          fill="currentColor"
        />
        <rect
          x="8.625"
          y="16.625"
          width="6.75"
          height="7.375"
          fill="currentColor"
        />
        <rect
          x="16.625"
          y="16.625"
          width="7.375"
          height="7.375"
          fill="var(--color-gold-9)"
        />
      </g>
    </svg>
  );
}

/**
 * The brand lockup: the crossword mark, gap, serif wordmark. Mark holds still, wordmark
 * tucks. The canonical recipe (docs/design/logo): mark 24, gap 6, display serif
 * semibold at 18 (size * 0.75), tracking -0.00625em, boxes center-aligned.
 */
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
        className="inline-flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label="Crossy"
      >
        <CrosswordMark />
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
