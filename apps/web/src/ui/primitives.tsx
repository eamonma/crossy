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

/** The soft status chip from v2: puzzle title, "Done", grid sizes. One quiet tint per job. */
export function Badge({
  tone = "neutral",
  pill = false,
  className,
  children,
}: {
  tone?: "neutral" | "gold" | "green";
  pill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-sand-3 text-sand-11",
    gold: "bg-gold-3 text-gold-11",
    green: "bg-green-3 text-success-text",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap px-2 py-[3px]",
        "font-sans font-medium text-1 leading-none",
        pill ? "rounded-full" : "rounded-2",
        tones[tone],
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
 * A participant chip: initial on a warm neutral face (v2's avatar recipe; sand for others,
 * gold for emphasis). Chrome stays inside the Sand + Gold system; a teammate's wire color
 * lives on their in-board cursor, never up here. `ring` draws the panel-colored halo the
 * stack uses to separate overlapping chips.
 */
export function Avatar({
  initial,
  tone = "neutral",
  size = "md",
  ring = false,
  dim = false,
  title,
}: {
  initial: string;
  tone?: "neutral" | "gold";
  size?: keyof typeof AVATAR_SIZE;
  ring?: boolean;
  dim?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center justify-center rounded-full font-sans font-medium shrink-0",
        tone === "gold" ? "bg-gold-4 text-gold-11" : "bg-sand-4 text-sand-11",
        AVATAR_SIZE[size],
        ring && "ring-2 ring-panel",
        dim && "opacity-55",
      )}
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

/** Overlapping chips for who is here, capped with a +N count. Self reads gold. */
export function AvatarStack({
  members,
  selfId = null,
  max = 4,
}: {
  members: readonly StackMember[];
  selfId?: string | null;
  max?: number;
}) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((m) => (
          <Avatar
            key={m.userId}
            initial={m.initial}
            tone={m.userId === selfId ? "gold" : "neutral"}
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
