// Design-system primitives (Track B). The small, reused vocabulary every screen composes:
// one Button with three restraint-first variants (no scale on hover, per the audit), the
// single elevation recipe as Panel, the dashed rule as a first-class Divider, deterministic
// Avatars and their Stack, the wordmark, and a minimal click-outside Popover. Everything is
// Tailwind utilities over the @theme tokens; nothing here invents a color outside Sand + Gold.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/** Join class names, dropping falsy entries. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "solid" | "soft" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 font-sans font-medium " +
  "whitespace-nowrap rounded-3 cursor-pointer select-none transition-colors " +
  "duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)] disabled:opacity-50 " +
  "disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-focus-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // The one gold CTA per screen. White glyph, no scale, darkens on hover.
  solid: "bg-solid text-white hover:bg-solid-hover border border-transparent",
  // The panel recipe as a control: warm face, hairline, quiet hover tint.
  soft: "bg-panel text-text border border-border hover:bg-sand-3",
  // Chromeless: nav, back, icon actions.
  ghost:
    "bg-transparent text-text-muted hover:bg-sand-3 border border-transparent",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-2",
  md: "h-10 px-4 text-3",
  lg: "h-12 px-5 text-4",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "soft",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}

/** An icon-only button, square, same variants. */
export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const square = size === "sm" ? "w-8" : size === "lg" ? "w-12" : "w-10";
  return (
    <button
      type={type}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        "px-0",
        square,
        className,
      )}
      {...rest}
    />
  );
}

/**
 * The one elevation recipe, reused everywhere: warm face, 1px hairline, 8px radius, the
 * workhorse shadow. `feature` swaps to the gold-cream face for hero and completion.
 */
export function Panel({
  feature = false,
  className,
  children,
}: {
  feature?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        feature ? "bg-panel-feature" : "bg-panel",
        "border border-border rounded-4 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
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

/** Uppercase micro-label with the caps tracking token (ACROSS / DOWN, section headers). */
export function CapsLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "text-1 font-semibold uppercase text-text-muted",
        "tracking-[var(--tracking-caps)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

const AVATAR_SIZE = {
  sm: "w-6 h-6 text-1",
  md: "w-8 h-8 text-2",
} as const;

/**
 * A participant avatar: initial on the participant's deterministic color (DESIGN section 8
 * hashes user_id to a stable color; it arrives on the wire). `ring` draws the panel-colored
 * halo the stack uses to separate overlapping avatars.
 */
export function Avatar({
  initial,
  color,
  size = "md",
  ring = false,
  dim = false,
  title,
}: {
  initial: string;
  color: string;
  size?: keyof typeof AVATAR_SIZE;
  ring?: boolean;
  dim?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center justify-center rounded-full font-sans font-semibold",
        "text-white shrink-0",
        AVATAR_SIZE[size],
        ring && "ring-2 ring-panel",
        dim && "opacity-60",
      )}
      style={{ background: color }}
    >
      {initial.toUpperCase().slice(0, 1)}
    </span>
  );
}

export interface StackMember {
  userId: string;
  initial: string;
  color: string;
  connected: boolean;
}

/** Overlapping avatars for who is here, most-connected first, capped with a +N count. */
export function AvatarStack({
  members,
  max = 4,
}: {
  members: readonly StackMember[];
  max?: number;
}) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <Avatar
            key={m.userId}
            initial={m.initial}
            color={m.color}
            size="sm"
            ring
            dim={!m.connected}
            title={m.initial}
          />
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

/** The wordmark: a tiny 2x2 grid mark plus the serif name. Restrained, one gold cell. */
export function Logo({
  size = 22,
  withName = true,
}: {
  size?: number;
  withName?: boolean;
}) {
  const c = size / 2;
  return (
    <span className="inline-flex items-center gap-2 text-text">
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        role="img"
        aria-label="Crossy"
        className="shrink-0"
      >
        <rect
          x="0.5"
          y="0.5"
          width="19"
          height="19"
          rx="3"
          fill="none"
          stroke="var(--color-border-strong)"
        />
        <line
          x1="10"
          y1="1"
          x2="10"
          y2="19"
          stroke="var(--color-border)"
          strokeDasharray="2 2"
        />
        <line
          x1="1"
          y1="10"
          x2="19"
          y2="10"
          stroke="var(--color-border)"
          strokeDasharray="2 2"
        />
        <rect
          x="10.5"
          y="1"
          width="8.5"
          height="8.5"
          fill="var(--color-gold-9)"
          opacity="0.9"
        />
        <text
          x={c + 5.25}
          y={c - 3.5}
          fontSize="7"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontFamily="var(--font-mono)"
        >
          A
        </text>
      </svg>
      {withName && (
        <span className="font-display text-5 font-medium leading-none tracking-[-0.01em]">
          Crossy
        </span>
      )}
    </span>
  );
}

/**
 * A minimal popover: a trigger and a floating panel that closes on outside click or Escape.
 * Depth escalates to shadow-lg because it is a true overlay (audit: one recipe for panels,
 * more only for overlays). No animation library; a quiet fade-rise via the enter utility.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  width = "18rem",
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      {/* The trigger renders its own focusable control (a Button/IconButton); this wrapper
          only toggles on the bubbled click, so there is no nested-button. */}
      <span onClick={() => setOpen((v) => !v)} className="contents">
        {trigger(open)}
      </span>
      {open && (
        <div
          id={id}
          role="dialog"
          className={cx(
            "absolute top-[calc(100%+8px)] z-[var(--z-dropdown)] enter",
            "bg-panel border border-border rounded-4 shadow-lg p-4",
            align === "end" ? "right-0" : "left-0",
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
