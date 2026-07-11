// The completion moment: the one indulgence the system rations motion for. When the
// room fills the grid correctly the timer is already frozen (derived from completedAt);
// here the whole viewport gets a confetti drift in the room's own colors (the people's
// roster hues over the house golds) and a summary card in the panel language the rest
// of the app speaks: caps eyebrow, serif headline, dashed rules, a tabular stat row.
// Confetti is hand-written on a canvas (no animation library), analytic over elapsed
// time so it is frame-rate independent, and skipped entirely under
// prefers-reduced-motion, where the summary still lands.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, Link2Icon } from "@radix-ui/react-icons";
import type { Stats } from "@crossy/protocol";
import { Button } from "@/components/ui/button";
import { AvatarStack, CapsLabel, cx, Divider } from "./primitives";
import type { StackMember } from "./primitives";
import { celebrationPalette, completionCells } from "./completionStats";

/** How long the drift lasts, spawn stagger included. Long enough to feel like weather,
 * short enough that the card is the thing you are left with. */
const SPAWN_WINDOW_S = 0.9;
const FALL_MIN_S = 2.4;
const FALL_MAX_S = 3.6;

interface Fleck {
  x0: number; // spawn x, px
  drift: number; // horizontal drift, px/s
  delay: number; // s before this fleck enters
  fall: number; // s to cross the stage
  sway: number; // sway amplitude, px
  swayRate: number; // rad/s
  phase: number; // rad
  rot0: number; // rad
  spin: number; // rad/s
  size: number; // px
  color: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The viewport-wide drift. Position and alpha are pure functions of elapsed time
 * (no per-frame integration), so a dropped frame costs smoothness, never trajectory.
 * Flecks stagger in across the spawn window, sway as they fall, and fade out
 * individually over the last fifth of their own fall.
 */
function Confetti({ colors }: { colors: readonly string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const rand = (a: number, b: number): number => a + Math.random() * (b - a);
    // Density scales with the stage so a phone is not buried and a desktop is not
    // sparse; the clamp keeps both ends tasteful.
    const count = Math.min(240, Math.max(120, Math.round(w / 7)));
    const flecks: Fleck[] = Array.from({ length: count }, () => ({
      x0: rand(-20, w + 20),
      drift: rand(-14, 14),
      delay: rand(0, SPAWN_WINDOW_S),
      fall: rand(FALL_MIN_S, FALL_MAX_S),
      sway: rand(6, 26),
      swayRate: rand(1.6, 3.4),
      phase: rand(0, Math.PI * 2),
      rot0: rand(0, Math.PI * 2),
      spin: rand(-3, 3),
      size: rand(5, 10),
      color: colors[Math.floor(rand(0, colors.length))]!,
    }));
    const totalS = SPAWN_WINDOW_S + FALL_MAX_S;

    let raf = 0;
    const start = performance.now();
    const tick = (nowMs: number): void => {
      const elapsed = (nowMs - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (elapsed >= totalS) return;
      for (const f of flecks) {
        const t = elapsed - f.delay;
        if (t < 0 || t > f.fall) continue;
        const p = t / f.fall;
        // Ease-in fall: flecks gather speed as if gravity, no per-frame physics.
        const y = -24 + (h + 48) * (0.55 * p + 0.45 * p * p);
        const x =
          f.x0 + f.drift * t + f.sway * Math.sin(f.swayRate * t + f.phase);
        const alpha =
          Math.min(1, t / 0.25) * Math.max(0, Math.min(1, (1 - p) / 0.2));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(f.rot0 + f.spin * t);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = f.color;
        ctx.fillRect(-f.size / 2, -f.size * 0.3, f.size, f.size * 0.6);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [colors]);

  // No z-index: the canvas stacks by DOM order inside the dialog layer, above the
  // scrim it follows and below the card that follows it, so the drift fills the
  // viewport while the summary stays crisp.
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0"
    />
  );
}

/**
 * The summary card over a soft scrim; the finished board stays visible behind it and a
 * tap on the scrim dismisses the card to admire it. The card speaks the app's panel
 * language (Home, the party rail): caps eyebrow in gold, the room's name in the display
 * serif, the people as an avatar stack, then a dashed-rule stat row of exactly what the
 * wire carries (completionStats.ts), and the two honest actions.
 */
export function CompletionOverlay({
  stats,
  fallbackSeconds,
  title,
  members,
  selfId,
  shareUrl,
  onDismiss,
  onHome,
}: {
  /** The server's completion stats (PROTOCOL §4); null only while they are in flight. */
  stats: Stats | null;
  /** The derived timer, the time's stand-in until `stats` lands. */
  fallbackSeconds: number;
  /** The room's name, or the geometry fallback the toolbar already shows. */
  title: string;
  members: readonly StackMember[];
  selfId: string | null;
  shareUrl: string | null;
  /** Tap the scrim to hide the summary and admire the finished board. */
  onDismiss: () => void;
  /** Leave the game for home. */
  onHome: () => void;
}) {
  const cells = completionCells(stats, fallbackSeconds);
  const palette = useMemo(() => celebrationPalette(members), [members]);

  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Dismiss and view the board"
        onClick={onDismiss}
        className="absolute inset-0 bg-sand-12/25"
      />
      <Confetti colors={palette} />
      <section
        role="dialog"
        aria-label="Puzzle solved"
        className="enter relative w-full max-w-[26rem] overflow-hidden rounded-4 border border-border-strong bg-panel shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <CapsLabel className="text-gold-11">Solved together</CapsLabel>
            <h2 className="mt-1 truncate font-display text-6 font-medium text-text">
              {title}
            </h2>
          </div>
          <div className="shrink-0 pt-0.5">
            <AvatarStack members={members} selfId={selfId} />
          </div>
        </div>

        <Divider />

        <dl className="m-0 grid grid-cols-3">
          {cells.map((cell, i) => (
            <div
              key={cell.key}
              className={cx(
                "flex flex-col items-center gap-1 px-2 py-4",
                i > 0 && "border-l border-dashed border-border-dashed",
              )}
            >
              <dt>
                <CapsLabel className="text-text-subtle">{cell.label}</CapsLabel>
              </dt>
              <dd className="m-0 font-mono text-5 text-text tabular-nums">
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>

        <Divider />

        <div className="flex items-center justify-end gap-2 px-5 py-4">
          {shareUrl !== null && <CopyLink shareUrl={shareUrl} />}
          <Button variant="default" size="lg" onClick={onHome}>
            Back to home
          </Button>
        </div>
      </section>
    </div>
  );
}

function CopyLink({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button variant="secondary" size="lg" onClick={() => void copy()}>
      {copied ? <CheckIcon /> : <Link2Icon />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
