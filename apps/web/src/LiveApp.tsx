// Live mode (`?game=<id>`): the real GameStore over a real WebSocket to the session service,
// through the same store, grid, and engine navigation the demo uses. This is the path the M1
// Playwright smoke drives (two browsers on one game).
//
// Entry flow (product decisions): a logged-out visitor on an invite link sees a minimal gate;
// after auth, an invite code self-joins as spectator; a spectator sees the same live board a
// solver sees, with one banner to upgrade in a tap. Token/api/ws keep their URL overrides so the
// smoke and dogfood links keep working. INV-6: the board only ever renders from the WS store.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Grid } from "@crossy/engine";
import { tabTarget } from "@crossy/engine";
import { connectToGame } from "./net/connect";
import type { GameConnection } from "./net/connect";
import { computeLayout } from "./domain/layout";
import { buildShareUrl, resolveInviteField } from "./domain/invite";
import type { Clue, Puzzle } from "./domain/types";
import {
  cellClick,
  clueClick,
  initialSelection,
  keyEffect,
} from "./input/actions";
import type { Selection } from "./input/actions";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./ui/CrosswordGrid";
import type { StackMember } from "./ui/primitives";
import { CapsLabel } from "./ui/primitives";
import { GameToolbar } from "./ui/GameToolbar";
import { ClueBar, ClueRail, ClueSheet, ClueStrip, clueOn } from "./ui/Clues";
import { Keyboard } from "./ui/Keyboard";
import { SpectateBanner } from "./ui/SpectateBanner";
import { CompletionOverlay } from "./ui/Completion";
import { TopBar } from "./ui/TopBar";
import { SignInButtons } from "./ui/AuthBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useElapsedSeconds, formatDuration } from "./ui/gameTime";
import type { AppConfig } from "./config/config";
import type { Identity } from "./identity";
import type { Navigate } from "./nav";

type Role = "host" | "solver" | "spectator";

/** A structured clue on the ClientPuzzle (PROTOCOL puzzle model): number, prose, cell run. */
interface ClientClue {
  number: number;
  text: string;
  cellIndices: readonly number[];
}

/** The solution-stripped puzzle facts the game view carries (ClientPuzzle, PROTOCOL.md §12). */
interface ClientPuzzleView {
  rows: number;
  cols: number;
  blocks: readonly number[];
  circles?: readonly number[];
  clues?: { across: readonly ClientClue[]; down: readonly ClientClue[] };
}

interface GameMember {
  userId: string;
  role: Role;
  joinedAt: string;
}

interface GameView {
  puzzle: ClientPuzzleView;
  members: readonly GameMember[];
  session: { ws: string };
  // Optional, added by the api PR that retired the URL-param stopgaps (ROADMAP Phase 4). The
  // client prefers these and falls back to the URL query params, so old invite links still work.
  name?: string | null;
  inviteCode?: string;
}

/** Attach clue prose (from the payload) to the geometry-derived runs; numbering comes from the
 * grid, which is authoritative and matches ingestion. Absent text renders as an em dash later. */
function toPuzzle(cp: ClientPuzzleView): Puzzle {
  const blocks = new Set(cp.blocks);
  const { numbers, acrossClues, downClues } = computeLayout(
    cp.cols,
    cp.rows,
    blocks,
  );
  const textOf = (
    list: readonly ClientClue[] | undefined,
    number: number,
  ): string | undefined => list?.find((c) => c.number === number)?.text;

  const withText = (
    clues: Clue[],
    list: readonly ClientClue[] | undefined,
  ): Clue[] =>
    clues.map((c) => {
      const text = textOf(list, c.number);
      return text === undefined ? c : { ...c, text };
    });

  return {
    cols: cp.cols,
    rows: cp.rows,
    blocks,
    numbers,
    circles: new Set(cp.circles ?? []),
    wrong: new Set(),
    acrossClues: withText(acrossClues, cp.clues?.across),
    downClues: withText(downClues, cp.clues?.down),
  };
}

/** Decode the token subject (the user id) without a dependency, for both the identity session
 * and the smoke's `?token=` override. Best-effort: a malformed token yields null. */
function jwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const json = JSON.parse(decoded) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

interface Ready {
  connection: GameConnection;
  puzzle: Puzzle;
  role: Role;
  gameId: string;
  code: string | null;
  name: string | null;
  apiBase: string;
  selfId: string | null;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "needs-auth"; invited: boolean }
  | { phase: "error"; message: string }
  | { phase: "ready"; ready: Ready };

/** Turn a REST join rejection into a plain sentence; never surface a code. */
function joinError(
  status: number,
  errorCode: string | undefined,
  message: string,
): string {
  if (errorCode === "DENIED") {
    return message.includes("removed")
      ? "You've been removed from this game."
      : "That invite link isn't valid anymore.";
  }
  if (status === 404)
    return "We couldn't find that game. The link may be wrong.";
  return "We couldn't open that game. Give the link another try.";
}

export function LiveApp({
  params,
  config,
  identity,
  navigate,
}: {
  params: URLSearchParams;
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [authTick, setAuthTick] = useState(0);
  useEffect(
    () => identity.onChange(() => setAuthTick((t) => t + 1)),
    [identity],
  );

  useEffect(() => {
    let cancelled = false;
    let connection: GameConnection | null = null;

    void (async () => {
      const game = params.get("game");
      const api = params.get("api") ?? config.apiBase;
      const code = params.get("code");
      const name = params.get("name");
      const token = params.get("token") ?? (await identity.getAccessToken());
      if (game === null) {
        setState({
          phase: "error",
          message: "This game link is missing its id.",
        });
        return;
      }
      // Auth gate first: a logged-out invitee sees the sign-in gate before any server concern,
      // so the invite experience never leaks a deploy detail (audit voice: no error codes).
      if (token === null) {
        setState({ phase: "needs-auth", invited: code !== null });
        return;
      }
      if (api === "") {
        setState({
          phase: "error",
          message: "No server is configured for this app.",
        });
        return;
      }

      const auth = { authorization: `Bearer ${token}` };
      const selfId = jwtSub(token);

      // Fetch the game view. A non-member gets 403; with an invite code we self-join as a
      // spectator (DESIGN section 8), then read the view again.
      let res = await fetch(`${api}/games/${game}`, { headers: auth });
      if (res.status === 401) {
        setState({ phase: "needs-auth", invited: code !== null });
        return;
      }
      if (res.status === 403) {
        if (code === null) {
          setState({
            phase: "error",
            message: "You need an invite link to join this game.",
          });
          return;
        }
        const joinRes = await fetch(`${api}/games/${game}/join`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!joinRes.ok) {
          const body = (await joinRes.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          setState({
            phase: "error",
            message: joinError(joinRes.status, body.error, body.message ?? ""),
          });
          return;
        }
        res = await fetch(`${api}/games/${game}`, { headers: auth });
      }
      if (!res.ok) {
        setState({
          phase: "error",
          message: "We couldn't find that game. The link may be wrong.",
        });
        return;
      }

      const view = (await res.json()) as GameView;
      const role: Role =
        view.members.find((m) => m.userId === selfId)?.role ?? "spectator";
      const wsUrl = params.get("ws") ?? view.session.ws;
      const puzzle = toPuzzle(view.puzzle);
      // Prefer the fields the API now returns (member-only invite code, game name), and fall
      // back to the URL query params so old invite links keep working (expand/contract).
      const resolvedCode = resolveInviteField(view.inviteCode, code);
      const resolvedName = resolveInviteField(view.name, name);
      connection = connectToGame({ url: wsUrl, token });
      if (cancelled) {
        connection.close();
        return;
      }
      // Smoke-test hooks: read convergence and drop the socket mid-word from the page.
      (window as unknown as Record<string, unknown>)["__crossy"] = {
        store: connection.store,
        drop: () => connection?.transport.simulateDrop(),
      };
      setState({
        phase: "ready",
        ready: {
          connection,
          puzzle,
          role,
          gameId: game,
          code: resolvedCode,
          name: resolvedName,
          apiBase: api,
          selfId,
        },
      });
    })().catch(() => {
      if (!cancelled) {
        setState({
          phase: "error",
          message: "Something went wrong reaching the game.",
        });
      }
    });

    return () => {
      cancelled = true;
      connection?.close();
    };
  }, [params, config, identity, authTick]);

  if (state.phase === "loading") {
    return (
      <GateLayout identity={identity} config={config} navigate={navigate}>
        <Card className="enter gap-0 p-6 text-center">
          <p className="text-3 text-text-muted">Opening the game...</p>
        </Card>
      </GateLayout>
    );
  }
  if (state.phase === "needs-auth") {
    return (
      <GateLayout identity={identity} config={config} navigate={navigate}>
        <Card tone="feature" className="enter gap-0 p-6 text-center">
          <CapsLabel className="text-text-accent">You're invited</CapsLabel>
          <h1 className="mt-2 font-display text-8 font-medium text-gold-12">
            Solve this one together.
          </h1>
          <p className="mt-3 text-3 text-text-muted">
            {state.invited
              ? "Sign in to join. You'll land as a spectator and can start solving with one tap."
              : "Sign in to join this game."}
          </p>
          <div className="mt-6 max-w-[20rem] mx-auto">
            <SignInButtons
              identity={identity}
              config={config}
              discordLabel="Sign in with Discord"
            />
          </div>
        </Card>
      </GateLayout>
    );
  }
  if (state.phase === "error") {
    return (
      <GateLayout identity={identity} config={config} navigate={navigate}>
        <Card className="enter gap-0 p-6 text-center">
          <h1 className="font-display text-6 font-medium">
            This game won't open
          </h1>
          <p className="mt-2 text-3 text-text-muted">{state.message}</p>
          <div className="mt-5 flex justify-center">
            <Button variant="secondary" onClick={() => navigate("")}>
              Back to start
            </Button>
          </div>
        </Card>
      </GateLayout>
    );
  }
  return (
    <LiveGame ready={state.ready} identity={identity} navigate={navigate} />
  );
}

function GateLayout({
  identity,
  config,
  navigate,
  children,
}: {
  identity: Identity;
  config: AppConfig;
  navigate: Navigate;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar identity={identity} config={config} onHome={() => navigate("")} />
      <main className="flex-1 px-4 py-6 flex items-center justify-center">
        <div className="w-full max-w-[28rem] pb-9">{children}</div>
      </main>
    </div>
  );
}

function LiveGame({
  ready,
  identity,
  navigate,
}: {
  ready: Ready;
  identity: Identity;
  navigate: Navigate;
}) {
  const { connection, puzzle, apiBase, gameId, code, name } = ready;
  const store = connection.store;
  const grid: Grid = useMemo(
    () => ({ cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks }),
    [puzzle],
  );

  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(grid),
  );
  const [flashes, setFlashes] = useState<ReadonlyMap<number, FlashEntry>>(
    new Map(),
  );
  const [role, setRole] = useState<Role>(ready.role);
  const [upgrading, setUpgrading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedCompletion, setDismissedCompletion] = useState(false);
  const flashNonce = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const frozen = store.status !== "ongoing";
  const isSpectator = role === "spectator";

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  useEffect(
    () =>
      store.subscribeFlash(({ cell, by }) => {
        const color =
          store.participants.find((p) => p.userId === by)?.color ?? "#3e63dd";
        flashNonce.current += 1;
        const nonce = flashNonce.current;
        setFlashes((prev) => new Map(prev).set(cell, { color, nonce }));
      }),
    [store],
  );

  const onFlashEnd = useCallback((cell: number, nonce: number) => {
    setFlashes((prev) => {
      if (prev.get(cell)?.nonce !== nonce) return prev;
      const next = new Map(prev);
      next.delete(cell);
      return next;
    });
  }, []);

  const fills = useMemo(() => {
    void version;
    const map = new Map<number, string>();
    for (let cell = 0; cell < puzzle.cols * puzzle.rows; cell += 1) {
      const value = store.renderValue(cell);
      if (value !== null) map.set(cell, value);
    }
    return map;
  }, [store, version, puzzle]);

  const filled = useMemo(() => new Set(fills.keys()), [fills]);

  const presence = useMemo(() => {
    void version;
    const byCell = new Map<number, PresenceEntry[]>();
    for (const cursor of store.cursors.values()) {
      if (cursor.userId === store.selfUserId) continue;
      const participant = store.participants.find(
        (p) => p.userId === cursor.userId,
      );
      const entry: PresenceEntry = {
        userId: cursor.userId,
        initial: participant?.displayName.charAt(0) ?? "?",
        color: participant?.color ?? "#3e63dd",
        direction: cursor.direction,
      };
      const list = byCell.get(cursor.cell);
      if (list === undefined) byCell.set(cursor.cell, [entry]);
      else list.push(entry);
    }
    return byCell;
  }, [store, version]);

  const members: StackMember[] = useMemo(() => {
    void version;
    return store.participants.map((p) => ({
      userId: p.userId,
      initial: p.displayName.charAt(0) || "?",
      color: p.color,
      connected: p.connected,
    }));
  }, [store, version]);

  const handleKey = useCallback(
    (key: string, shift: boolean): boolean => {
      if (isSpectator) return false;
      const effect = keyEffect({ grid, filled, selection, frozen }, key, shift);
      if (effect === null) return false;
      for (const mutation of effect.mutations) {
        if (mutation.type === "placeLetter") {
          store.placeLetter(mutation.cell, mutation.value);
        } else {
          store.clearCell(mutation.cell);
        }
      }
      setSelection(effect.selection);
      return true;
    },
    [isSpectator, grid, filled, selection, frozen, store],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (handleKey(e.key, e.shiftKey)) e.preventDefault();
  }

  function onCellClick(cell: number): void {
    gridRef.current?.focus();
    const next = cellClick(grid, selection, cell);
    if (next !== null) setSelection(next);
  }

  function stepClue(direction: "forward" | "backward"): void {
    const target = tabTarget(
      grid,
      selection.direction,
      selection.cell,
      direction,
      filled,
    );
    setSelection({ cell: target.cell, direction: target.direction });
    gridRef.current?.focus();
  }

  function jumpToClue(clue: Clue): void {
    setSelection(clueClick(clue));
    gridRef.current?.focus();
  }

  async function upgrade(): Promise<void> {
    const token = await identity.getAccessToken();
    if (token === null) return;
    setUpgrading(true);
    try {
      const res = await fetch(`${apiBase}/games/${gameId}/role`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "solver" }),
      });
      if (res.ok) {
        setRole("solver");
        gridRef.current?.focus();
      }
    } finally {
      setUpgrading(false);
    }
  }

  const activeClue = clueOn(
    [...puzzle.acrossClues, ...puzzle.downClues],
    selection.direction,
    selection.cell,
  );
  const activeAcross =
    clueOn(puzzle.acrossClues, "across", selection.cell)?.number ?? null;
  const activeDown =
    clueOn(puzzle.downClues, "down", selection.cell)?.number ?? null;

  const elapsed = useElapsedSeconds(store.firstFillAt, store.completedAt);
  // `name` and `code` are API-preferred with a URL-param fallback (resolved in the loader), so
  // the title and the share popover work without the current URL carrying `?name=`/`?code=`.
  const title = name ?? `${puzzle.cols} × ${puzzle.rows}`;
  const shareUrl = buildShareUrl({
    origin: window.location.origin,
    pathname: window.location.pathname,
    gameId,
    code,
    name,
  });

  const completed = store.status === "completed" && !dismissedCompletion;

  // The solve screen is one framed panel, v2's game screen: on desktop it floats on the
  // sand background inside a 16px gutter; on mobile it goes full bleed and the on-screen
  // keyboard docks at the bottom. Inside: chrome row, clue strip (or the mobile clue bar),
  // then the board in calm space with the clue rail to its right. The board always fits
  // the viewport on desktop (.board-fit resolves against both axes of its stage).
  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-background md:p-4">
      <div className="relative flex-1 min-h-0 flex flex-col bg-panel overflow-hidden md:border md:border-border-strong md:rounded-3 md:shadow-sm">
        <GameToolbar
          title={title}
          timer={formatDuration(elapsed)}
          done={store.status === "completed"}
          members={members}
          selfId={ready.selfId}
          shareUrl={shareUrl}
          onBack={() => navigate("")}
        />

        {isSpectator && (
          <SpectateBanner
            onUpgrade={() => void upgrade()}
            upgrading={upgrading}
          />
        )}

        <ClueStrip clue={activeClue} />
        <ClueBar
          clue={activeClue}
          onOpen={() => setSheetOpen(true)}
          onPrev={() => stepClue("backward")}
          onNext={() => stepClue("forward")}
        />

        <div className="flex-1 min-h-0 md:grid md:grid-cols-[minmax(0,4fr)_minmax(0,3fr)]">
          <div
            className="board-stage h-full min-h-0 overflow-auto md:overflow-hidden p-3 md:p-6 flex flex-col md:justify-center"
            style={{
              ["--board-cols" as string]: puzzle.cols,
              ["--board-aspect" as string]: `${puzzle.cols} / ${puzzle.rows}`,
            }}
          >
            <div
              className="board-fit board-scroll"
              style={{ aspectRatio: `${puzzle.cols} / ${puzzle.rows}` }}
            >
              <div
                className="board-wrap outline-none"
                data-testid="grid"
                ref={gridRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                aria-label="Crossword grid"
              >
                <CrosswordGrid
                  puzzle={puzzle}
                  fills={fills}
                  selection={selection}
                  presence={presence}
                  flashes={flashes}
                  onCellClick={onCellClick}
                  onFlashEnd={onFlashEnd}
                />
              </div>
            </div>
          </div>

          <ClueRail
            across={puzzle.acrossClues}
            down={puzzle.downClues}
            activeAcross={activeAcross}
            activeDown={activeDown}
            currentDirection={selection.direction}
            onJump={jumpToClue}
          />
        </div>

        {!isSpectator && (
          <Keyboard onKey={(key) => handleKey(key, false)} disabled={frozen} />
        )}

        {store.sync !== "live" && (
          <div
            className="absolute top-12 inset-x-0 flex justify-center z-[var(--z-toast)] pointer-events-none"
            aria-live="polite"
          >
            <span className="inline-block px-3 py-0.5 rounded-full border border-border bg-panel shadow-md text-text-muted text-1 font-semibold">
              {store.sync === "resyncing" ? "Resyncing..." : "Reconnecting..."}
            </span>
          </div>
        )}
      </div>

      <ClueSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        across={puzzle.acrossClues}
        down={puzzle.downClues}
        activeAcross={activeAcross}
        activeDown={activeDown}
        currentDirection={selection.direction}
        onJump={jumpToClue}
      />

      {completed && (
        <CompletionOverlay
          seconds={store.stats?.solveTimeSeconds ?? elapsed}
          participantCount={store.stats?.participantCount ?? null}
          shareUrl={shareUrl}
          onDismiss={() => setDismissedCompletion(true)}
          onHome={() => navigate("")}
        />
      )}
    </div>
  );
}
