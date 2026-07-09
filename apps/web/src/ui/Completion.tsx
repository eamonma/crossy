// The completion moment: the one indulgence the system rations motion for. When the room fills
// the grid correctly the timer is already frozen (derived from completedAt); here we add a
// restrained confetti burst in gold and sand tints and a short serif summary in the feature-panel
// recipe. Confetti is hand-written on a canvas (no animation library) and is skipped entirely
// under prefers-reduced-motion, where the summary still lands.
import { useEffect, useRef, useState } from "react";
import { CheckIcon, Link2Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CapsLabel } from "./primitives";
import { formatDuration } from "./gameTime";

const CONFETTI_COLORS = ["#978365", "#b9a88d", "#cbc0a8", "#e1dccf", "#cfceca"];
const DURATION_MS = 1800;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function Confetti() {
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
    const particles: Particle[] = Array.from({ length: 130 }, () => ({
      x: rand(0, w),
      y: rand(-h * 0.4, 0),
      vx: rand(-0.6, 0.6),
      vy: rand(2, 5),
      size: rand(4, 9),
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.15, 0.15),
      color: CONFETTI_COLORS[Math.floor(rand(0, CONFETTI_COLORS.length))]!,
    }));

    let raf = 0;
    const start = performance.now();
    const tick = (t: number): void => {
      const elapsed = t - start;
      const fade = Math.max(0, 1 - elapsed / DURATION_MS);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = fade;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04; // gentle gravity
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (elapsed < DURATION_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[var(--z-overlay)]"
    />
  );
}

/** The summary card, a gold-cream feature panel, centered over a soft scrim; the board stays
 * visible behind it. Copy shares the invite link; done returns to the landing. */
export function CompletionOverlay({
  seconds,
  participantCount,
  shareUrl,
  onDismiss,
  onHome,
}: {
  seconds: number;
  participantCount: number | null;
  shareUrl: string | null;
  /** Tap the scrim to hide the summary and admire the finished board. */
  onDismiss: () => void;
  /** Leave the game for the landing. */
  onHome: () => void;
}) {
  const withText =
    participantCount !== null && participantCount > 1
      ? ` with ${participantCount} solvers`
      : "";

  return (
    <div className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center p-4">
      <Confetti />
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute inset-0 bg-sand-12/25"
      />
      <Card
        tone="feature"
        className="enter relative w-full max-w-[26rem] gap-0 p-6 text-center shadow-xl"
        role="dialog"
        aria-label="Puzzle complete"
      >
        <CapsLabel className="text-success-text">Complete</CapsLabel>
        <h2 className="mt-2 font-display text-8 font-medium text-gold-12">
          You solved it.
        </h2>
        <p className="mt-3 text-4 text-text-muted">
          Finished in{" "}
          <span className="font-mono text-text tabular-nums">
            {formatDuration(seconds)}
          </span>
          {withText}.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {shareUrl !== null && <ShareResult shareUrl={shareUrl} />}
          <Button variant="secondary" onClick={onHome}>
            Back to start
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ShareResult({ shareUrl }: { shareUrl: string }) {
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
    <Button variant="default" onClick={() => void copy()}>
      {copied ? <CheckIcon /> : <Link2Icon />}
      {copied ? "Copied" : "Share result"}
    </Button>
  );
}
