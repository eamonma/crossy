// The clue panel's tab header, present only once a room is completed: [ Clues | Analysis ]. Two
// forms of the one control, both speaking the app's language (Schibsted caps, sand/gold, the dashed
// rule), never an off-the-shelf tab chrome:
//   - "rail": the desktop rail/dock header. Underline-style tabs on the dashed rule that closes the
//     clue strip, the gold-9 active underline the mock ratifies.
//   - "segment": the mobile sheet's segmented pill (sand-3 track, panel-face active thumb), the iOS
//     twin the mock shows at the sheet's head.
// Both are an aria tablist with roving arrow-key nav and a gold focus ring (--color-gold-8), so a
// keyboard reaches Analysis and back. The panels they switch live in the caller (ClueRail, ClueSheet,
// ClueDock); this owns only the header and the selection contract.
//
// The hard rule this serves: the Clues view is frozen. This header is ADDED above the untouched clue
// lists, and the active tab's panel cross-fades in the caller; the Clues lists never restyle.
import { useRef } from "react";
import { cx } from "./primitives";

export type PanelTab = "clues" | "analysis";

const TABS: readonly PanelTab[] = ["clues", "analysis"];
const LABEL: Record<PanelTab, string> = {
  clues: "Clues",
  analysis: "Analysis",
};

/** Move focus and selection with the arrow keys (roving tabindex, the WAI-ARIA tablist pattern), so a
 * keyboard user reaches Analysis and back; Home/End jump to the ends. Returns the tab to select, or
 * null when the key is not a navigation key (the caller lets it fall through). */
function arrowTarget(key: string, current: PanelTab): PanelTab | null {
  const i = TABS.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return TABS[(i + 1) % TABS.length] ?? null;
    case "ArrowLeft":
    case "ArrowUp":
      return TABS[(i - 1 + TABS.length) % TABS.length] ?? null;
    case "Home":
      return TABS[0] ?? null;
    case "End":
      return TABS[TABS.length - 1] ?? null;
    default:
      return null;
  }
}

export function PanelTabs({
  value,
  onChange,
  variant,
  idBase,
  className,
}: {
  value: PanelTab;
  onChange: (tab: PanelTab) => void;
  /** "rail" for the desktop underline header, "segment" for the mobile sheet pill. */
  variant: "rail" | "segment";
  /** Namespace for the tab/panel ids so aria-controls/aria-labelledby resolve uniquely per surface. */
  idBase: string;
  className?: string;
}) {
  const refs = useRef(new Map<PanelTab, HTMLButtonElement>());

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const next = arrowTarget(e.key, value);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    refs.current.get(next)?.focus();
  };

  if (variant === "segment") {
    return (
      <div
        role="tablist"
        aria-label="Clue panel view"
        onKeyDown={onKeyDown}
        className={cx("flex gap-0.5 rounded-3 bg-sand-3 p-0.5", className)}
      >
        {TABS.map((tab) => {
          const selected = tab === value;
          return (
            <button
              key={tab}
              ref={(el) => {
                if (el) refs.current.set(tab, el);
                else refs.current.delete(tab);
              }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab)}
              className={cx(
                "flex-1 rounded-2 px-3 py-1.5 text-2 font-medium transition-colors duration-[var(--duration-fast)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1",
                selected
                  ? "bg-panel text-text shadow-sm"
                  : "text-text-muted hover:text-text",
              )}
            >
              {LABEL[tab]}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Clue panel view"
      onKeyDown={onKeyDown}
      className={cx(
        "flex items-stretch gap-1 border-b border-dashed border-border-dashed px-2",
        className,
      )}
    >
      {TABS.map((tab) => {
        const selected = tab === value;
        return (
          <button
            key={tab}
            ref={(el) => {
              if (el) refs.current.set(tab, el);
              else refs.current.delete(tab);
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            className={cx(
              "relative inline-flex items-center gap-1.5 px-2.5 py-2 text-2 font-medium transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:rounded-2",
              selected ? "text-text" : "text-text-subtle hover:text-text",
            )}
          >
            {LABEL[tab]}
            {tab === "analysis" && !selected && (
              // A quiet gold dot: the reading is new the first time the panel opens on completion,
              // and marks Analysis while the player is reading the Clues.
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-gold-9"
              />
            )}
            {selected && (
              // The active underline sits on the dashed rule, gold-9, the mock's marker.
              <span
                aria-hidden
                className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-gold-9"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
