// The share card's data contract (design/post-game/SHARE.md). Everything arrives as
// data: colors for BOTH grounds resolved by the caller (the identity roster is not
// duplicated here), title copy already worded by the caller (the clients own the words,
// TITLES.md), the date already formatted (this package has no clock). The card is a pure
// function of this shape: same data, same SVG, byte for byte.
//
// Nothing letter-shaped can enter: owners are indices, stats are counts, and the only
// strings are display metadata (names, title copy, puzzle title/author, the date). The
// mosaic paints WHO, never WHAT (INV-6 in spirit; the wire analysis bundle this is built
// from carries no letters either).

/** One solver on the card, in caller order (the server ships titles ladder-ranked;
 * this package never sorts). */
export interface ShareCardSolver {
  readonly name: string;
  /** The identity-roster hex this solver wears on a light ground. */
  readonly colorLight: string;
  /** The identity-roster hex this solver wears on a dark ground. */
  readonly colorDark: string;
  /** The solver's post-game title for the credits block: the caps label ("The
   * saboteur") and the optional evidence line ("Overwrote 7 correct squares"). */
  readonly title?: {
    readonly label: string;
    readonly detail?: string;
  };
}

/** The solve's headline numbers, as the analysis bundle states them. */
export interface ShareCardStats {
  /** Active solve time in whole seconds (the D29 axis). */
  readonly activeSeconds: number;
  /** How many sittings; rendered as a sub-line only at 2 or more. */
  readonly sittingCount: number;
  readonly solverCount: number;
  readonly squareCount: number;
}

export interface ShareCardData {
  readonly rows: number;
  readonly cols: number;
  /** Block (black square) cell indices, row-major. */
  readonly blocks: readonly number[];
  /** White cell index -> index into `solvers`: who first solved each square. A white
   * cell absent here paints the bare card face (defensive; a completed grid owns all). */
  readonly ownersByCell: Readonly<Record<number, number>>;
  /** For the solo variant: white cell index -> fill order in [0, 1] (0 the first square,
   * 1 the last). Ignored by the owners variants. */
  readonly fillOrderByCell?: Readonly<Record<number, number>>;
  readonly solvers: readonly ShareCardSolver[];
  readonly stats: ShareCardStats;
  /** Display metadata, shown verbatim (truncated to the layout budgets, never
   * normalized): the puzzle's title and author, null when unknown. */
  readonly puzzle: {
    readonly title: string | null;
    readonly author: string | null;
  };
  /** Preformatted display date ("Jul 17, 2026") or null to omit; no clock here. */
  readonly solvedOn: string | null;
}

export interface ShareCardOptions {
  /** Which ground the card sits on: Studio (light) or Observatory (dark). */
  readonly ground: "light" | "dark";
  /**
   * portrait: the 1080x1620 flagship (mosaic, stats, film credits).
   * og: 1200x630, grid left and text right, credits compressed to titles only.
   * solo: portrait geometry, mosaic painted by fill order (a gold ramp) instead of
   * owners, a first/last ramp key instead of credits.
   */
  readonly variant: "portrait" | "og" | "solo";
  /** Optional @font-face CSS the caller injects (data-URI fonts); the card itself only
   * ever names family stacks. */
  readonly fontCss?: string;
}

export interface RenderedCard {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}
