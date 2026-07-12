// The mosaic demo mount: the real ContributionMosaic component rendered in its three static
// frames (INK, FIELD, WASH), the static plate for a share/projector still, and a running reveal
// with a replay control and beat indicator. It lives in the demo surface (App.tsx's `?demo=1`),
// deliberately plain chrome, so the reveal arc and the wash/plate strengths can be reviewed on the
// real tokens without a live game.
//
// Ultimate mount: the reveal belongs behind the live completion state (LiveApp's `completed`), as
// a treatment of the solved board once the CompletionOverlay is dismissed. That surface is
// entangled with the `dismissedCompletion` dance and the confetti motion, so this demo is where it
// proves out first; the wiring note is in the report.
import { useCallback, useState } from "react";
import { ContributionMosaic } from "../ui/ContributionMosaic";
import {
  MOSAIC_LETTERS,
  MOSAIC_OWNER_MAP,
  MOSAIC_PUZZLE,
  MOSAIC_ROSTER,
  SOLVERS,
} from "./mosaicFixture";

const BEAT_LABELS = ["Solved", "Bloom", "Settled"] as const;

function Roster() {
  const order = [...SOLVERS].sort((a, b) => b.squares - a.squares);
  return (
    <div className="flex flex-col gap-2.5">
      {order.map((s, i) => (
        <div
          key={s.id}
          className="grid grid-cols-[13px_1fr_auto] items-center gap-2.5"
        >
          <span
            className="h-3 w-3 rounded-1"
            style={{ background: s.color }}
            aria-hidden
          />
          <span className="text-2 font-medium text-text">
            {s.name}
            {i === 0 && (
              <span className="ml-1.5 text-1 font-semibold text-text-accent">
                HOST
              </span>
            )}
          </span>
          <span className="font-mono text-1 tabular-nums text-text-muted">
            {s.squares} squares
          </span>
        </div>
      ))}
    </div>
  );
}

/** One labelled board in the dial, framed like the plate-study thumbnails. */
function DialFigure({
  n,
  step,
  title,
  desc,
  children,
}: {
  n: string;
  step: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0">
      <div className="rounded-4 border border-border bg-panel p-3">
        <div className="overflow-hidden rounded-1">{children}</div>
      </div>
      <figcaption className="mt-4">
        <div className="flex items-baseline gap-2 text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text-accent">
          <span className="font-mono text-gold-9">{n}</span>
          {step}
        </div>
        <div className="mt-1 font-display text-4">{title}</div>
        <div className="mt-1 text-2 text-text-muted">{desc}</div>
      </figcaption>
    </figure>
  );
}

export function MosaicDemo() {
  const [beat, setBeat] = useState<0 | 1 | 2>(0);
  // Bumping the key re-mounts the reveal board, re-arming the arc from INK.
  const [replayKey, setReplayKey] = useState(0);
  const onBeat = useCallback((b: 0 | 1 | 2) => setBeat(b), []);
  const replay = useCallback(() => {
    setBeat(0);
    setReplayKey((k) => k + 1);
  }, []);

  const shared = {
    puzzle: MOSAIC_PUZZLE,
    letters: MOSAIC_LETTERS,
    ownerMap: MOSAIC_OWNER_MAP,
    roster: MOSAIC_ROSTER,
  };

  return (
    <section className="mt-12">
      <header className="max-w-[62ch]">
        <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text-accent">
          Post-game surface &middot; the reveal
        </div>
        <h2 className="mt-1 font-display text-7 font-medium">
          The contribution mosaic
        </h2>
        <p className="mt-2 max-w-[46ch] text-3 text-text-muted">
          The solved board blooms into a wall of pure color, letters gone, one
          held breath. Then it settles into the quiet wash you keep. The plate
          is the crescendo; the wash is where it lands.
        </p>
      </header>

      {/* Hero: the running reveal beside the roster and controls. */}
      <div className="mt-8 grid items-center gap-8 md:grid-cols-[minmax(0,1.3fr)_minmax(220px,0.9fr)]">
        <div
          className="rounded-5 bg-panel p-4"
          style={{
            boxShadow:
              "0 16px 48px -18px rgb(30 27 20 / 0.24), 0 2px 8px -3px rgb(30 27 20 / 0.10)",
          }}
        >
          <div className="overflow-hidden rounded-1">
            <ContributionMosaic
              key={replayKey}
              {...shared}
              behavior={{ kind: "reveal", replayKey }}
              onBeat={onBeat}
              ariaLabel="The contribution mosaic reveal, solved to color field to wash"
            />
          </div>
        </div>
        <div>
          <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text-accent">
            Solved together
          </div>
          <h3 className="mb-3 mt-1 font-display text-5 font-medium">
            Five hands &middot; one grid
          </h3>
          <Roster />
          <div className="mt-6 flex items-center gap-3">
            {BEAT_LABELS.map((label, i) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1.5 text-1 ${
                  beat === i ? "text-text" : "text-text-muted"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background:
                      beat === i
                        ? "var(--color-gold-11)"
                        : "var(--color-sand-6)",
                  }}
                  aria-hidden
                />
                {label}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={replay}
              className="rounded-full border border-border bg-panel px-4 py-2 text-2 font-medium text-text transition-colors hover:border-sand-11 hover:bg-sand-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            >
              Play the reveal
            </button>
          </div>
        </div>
      </div>

      {/* The dial: the three static frames the reveal moves through. */}
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        <DialFigure
          n="01"
          step="Solved"
          title="Ink on paper"
          desc="The plain solved board. Who did what is still invisible."
        >
          <ContributionMosaic
            {...shared}
            behavior={{ kind: "static", state: "ink" }}
            ariaLabel="Solved board, no attribution color"
          />
        </DialFigure>
        <DialFigure
          n="02"
          step="Bloom &middot; the peak"
          title="Pure color, no letters"
          desc="The saturated field, a held breath. Boldest instant, and spoiler-safe."
        >
          <ContributionMosaic
            {...shared}
            behavior={{ kind: "static", state: "field" }}
            ariaLabel="The peak: each cell its owner's color, letters hidden"
          />
        </DialFigure>
        <DialFigure
          n="03"
          step="Settled"
          title="The quiet record"
          desc="Color drops to a low wash, letters fade back in. A solved board first."
        >
          <ContributionMosaic
            {...shared}
            behavior={{ kind: "static", state: "wash" }}
            ariaLabel="The settled wash: ink letters over a quiet owner tint"
          />
        </DialFigure>
      </div>

      {/* The plate: the fuller-saturation still for a share or projector rendering. */}
      <div className="mt-14 max-w-[520px]">
        <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text-accent">
          The plate
        </div>
        <h3 className="mb-3 mt-1 font-display text-5 font-medium">
          The share still
        </h3>
        <p className="mb-4 max-w-[46ch] text-2 text-text-muted">
          The peak held still, letters off so it leaves the room spoiler-safe.
          The same textless field is the crescendo and the card you can post.
        </p>
        <div className="rounded-4 border border-border bg-panel p-3">
          <div className="overflow-hidden rounded-1">
            <ContributionMosaic
              {...shared}
              behavior={{ kind: "static", state: "plate" }}
              ariaLabel="The plate: the color field as a share still"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
