// Live mode (`/game/<id>`): the real GameStore over a real WebSocket to the session service,
// through the same store, grid, and engine navigation the demo uses. This is the path the M1
// Playwright smoke drives (two browsers on one game).
//
// Entry flow (product decisions): a logged-out visitor on an invite link sees a minimal gate;
// after auth, an invite code self-joins as spectator; a spectator sees the same live board a
// solver sees, with one banner to upgrade in a tap. Token/api/ws keep their URL overrides so the
// smoke and dogfood links keep working. INV-6: the board only ever renders from the WS store.
//
// Shell placement: signed in, the game renders inside the sidebar shell's content frame
// (`inShell`), with the rail collapsed by default so the board keeps its room; the toolbar's
// left slot becomes the sidebar trigger on desktop and stays the back chevron on phones,
// where the game is full-bleed and no rail exists. Signed out (an invitee mid-gate), the
// same component owns the viewport as before.
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
import { ChevronLeftIcon } from "@radix-ui/react-icons";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./ui/CrosswordGrid";
import type { StackMember } from "./ui/primitives";
import { CapsLabel, Divider } from "./ui/primitives";
import { GameToolbar } from "./ui/GameToolbar";
import {
  ClueBar,
  ClueDock,
  ClueRail,
  ClueSheet,
  ClueStrip,
  clueOn,
} from "./ui/Clues";
import { SolvingNow } from "./ui/SolvingNow";
import { buildRoster, cluePresence } from "./ui/roster";
import { parseClueRefs } from "./ui/clueRefs";
import { Keyboard } from "./ui/Keyboard";
import { SpectateBanner } from "./ui/SpectateBanner";
import { PartyView } from "./ui/PartyView";
import { CompletionOverlay } from "./ui/Completion";
import { TopBar } from "./ui/TopBar";
import { SignInButtons } from "./ui/AuthBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useElapsedSeconds, formatDuration } from "./ui/gameTime";
import type { AppConfig } from "./config/config";
import type { Identity } from "./identity";
import type { Navigate } from "./nav";
import { homeHref, togglePartyHref } from "./nav";

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

/** Decode a claim off the token payload without a dependency, for both the identity session and
 * the smoke's `?token=` override. Best-effort: a malformed token yields an empty payload. */
function jwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return {};
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function jwtSub(token: string): string | null {
  const sub = jwtPayload(token)["sub"];
  return typeof sub === "string" ? sub : null;
}

/** The `is_anonymous` claim (guests). Same claim the server reads (packages/auth), so the client
 * gate matches the server's FULL_ACCOUNT_REQUIRED refusal instead of guessing. */
function jwtIsAnonymous(token: string): boolean {
  return jwtPayload(token)["is_anonymous"] === true;
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
  /** True for a guest: they can never hold solver or host (DESIGN.md section 8). */
  isAnonymous: boolean;
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
  gameId,
  params,
  config,
  identity,
  navigate,
  inShell = false,
  party = false,
}: {
  gameId: string;
  params: URLSearchParams;
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
  /** True when the Router mounted this inside the sidebar shell (signed in). */
  inShell?: boolean;
  /** True for the read-only projector screen (`?party=1`): reuse this loader, then render the
   * full-bleed PartyView instead of the interactive game once the store is ready. */
  party?: boolean;
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
      const game = gameId;
      const api = params.get("api") ?? config.apiBase;
      const code = params.get("code");
      const name = params.get("name");
      const tokenParam = params.get("token");
      const token = tokenParam ?? (await identity.getAccessToken());
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
      // Guest status: the identity session is authoritative when present (the real product path);
      // the `?token=` dogfood path has no session, so fall back to the token's own claim.
      const isAnonymous =
        identity.getSession()?.isAnonymous ?? jwtIsAnonymous(token);

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
      // Resolve a fresh token before every hello (reconnects included) so an expired
      // access token never wedges the reconnect loop. The ?token= override (smoke and
      // dogfood) has no identity session, so it feeds the fixed string straight back.
      const getToken: () => Promise<string | null> =
        tokenParam !== null
          ? () => Promise.resolve(tokenParam)
          : () => identity.getAccessToken();
      connection = connectToGame({ url: wsUrl, getToken });
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
          isAnonymous,
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
  }, [gameId, params, config, identity, authTick]);

  if (state.phase === "loading") {
    return <LoadingGameShell inShell={inShell} />;
  }
  if (state.phase === "needs-auth") {
    return (
      <GateLayout
        identity={identity}
        config={config}
        navigate={navigate}
        inShell={inShell}
      >
        {/* The gate reads as a ticket: the invitation on the gold-cream face, then the
            dashed rule (the system's structural device) as its perforation, then the
            actions on the plain panel tray. */}
        <Card tone="feature" className="enter gap-0 p-0 text-center">
          <div className="px-6 pt-6 pb-5">
            <CapsLabel className="text-text-accent">You're invited</CapsLabel>
            <h1 className="mt-2 font-display text-8 font-medium text-gold-12 text-balance">
              Solve this one together.
            </h1>
            <p className="mx-auto mt-3 mb-0 max-w-[24rem] text-2 text-text-muted text-balance">
              {state.invited
                ? "Your friends left this puzzle open. Sign in to solve with them, or watch as a guest."
                : "Sign in to open your game."}
            </p>
          </div>
          <Divider className="m-0" />
          <div className="bg-panel px-6 py-5">
            <div className="mx-auto max-w-[18rem]">
              <SignInButtons
                identity={identity}
                config={config}
                discordLabel="Sign in with Discord"
                appleLabel="Sign in with Apple"
                allowGuest={state.invited}
              />
            </div>
          </div>
        </Card>
      </GateLayout>
    );
  }
  if (state.phase === "error") {
    return (
      <GateLayout
        identity={identity}
        config={config}
        navigate={navigate}
        inShell={inShell}
      >
        <Card className="enter gap-0 p-6 text-center">
          <h1 className="font-display text-6 font-medium">
            This game won't open
          </h1>
          <p className="mt-2 text-3 text-text-muted">{state.message}</p>
          <div className="mt-5 flex justify-center">
            <Button
              variant="secondary"
              onClick={() => navigate(homeHref(params))}
            >
              Back to start
            </Button>
          </div>
        </Card>
      </GateLayout>
    );
  }
  // The projector screen shares the whole loader above (auth, self-join, the live store), then
  // renders read-only: no LiveGame, so there is no key handler, cursor relay, or upgrade path.
  if (party) {
    return (
      <PartyView
        store={state.ready.connection.store}
        puzzle={state.ready.puzzle}
        gameId={state.ready.gameId}
        code={state.ready.code}
        name={state.ready.name}
        // Leaving party mode drops ?party=1 and lands back on the interactive game, the exit
        // side of the same toggle the sidebar menu opens.
        onExit={() =>
          navigate(togglePartyHref(state.ready.gameId, params, false))
        }
      />
    );
  }
  return (
    <LiveGame
      ready={state.ready}
      identity={identity}
      navigate={navigate}
      inShell={inShell}
      params={params}
    />
  );
}

/** The gate frame. Standalone (signed out) it owns the viewport with the slim top bar; in
 * the shell the sidebar is the chrome, so the card just centers in the content frame. */
function GateLayout({
  identity,
  config,
  navigate,
  inShell,
  children,
}: {
  identity: Identity;
  config: AppConfig;
  navigate: Navigate;
  inShell: boolean;
  children: React.ReactNode;
}) {
  if (inShell) {
    return (
      <main className="relative h-full flex items-center justify-center px-4 py-6 overflow-y-auto">
        {/* The sidebar toggle, anchored top-left like the other in-shell surfaces. */}
        <div className="absolute left-3 top-3 hidden md:block">
          <SidebarTrigger className="text-text-subtle hover:text-text" />
        </div>
        <div className="w-full max-w-[28rem] pb-9">{children}</div>
      </main>
    );
  }
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar
        identity={identity}
        config={config}
        onHome={() => navigate("/")}
      />
      <main className="flex-1 px-4 py-6 flex items-center justify-center">
        <div className="w-full max-w-[28rem] pb-9">{children}</div>
      </main>
    </div>
  );
}

/** One quiet placeholder block: a sand fill with a subtle shimmer, still under
 * prefers-reduced-motion (the shimmer is defined only in a no-preference query). */
function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`skeleton skeleton-shimmer ${className}`} />
  );
}

/**
 * The pre-REST loading treatment (item 4): the same framed game shell the live game
 * uses (panel chrome, dashed clue rule, the board-and-rail split that widens the rail into
 * twin columns at the wide breakpoint), filled with
 * quiet placeholder blocks instead of a centered card. No geometry is known yet, so the
 * board area is a square shimmer; when REST lands, LiveGame renders the real grid at its
 * true geometry, so only the placeholders change, not the frame. No spinner. In the shell
 * it fills the same content frame the live game will, so nothing jumps when it settles.
 */
function LoadingGameShell({ inShell }: { inShell: boolean }) {
  const railList = (
    <>
      <Skeleton className="h-3.5 w-16 rounded-1" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-3.5 w-full max-w-[18rem] rounded-1" />
      ))}
    </>
  );
  // A dock region's placeholder: the caps label, then a handful of clue-height rows. Narrower
  // than the rail's so it reads as a newspaper column rather than a full-width row.
  const dockColumn = (
    <>
      <Skeleton className="h-3.5 w-16 rounded-1" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-3.5 w-full max-w-[14rem] rounded-1" />
      ))}
    </>
  );
  return (
    <div
      className={`${inShell ? "h-full md:p-3 md:pl-0" : "h-dvh md:p-4"} flex flex-col overflow-hidden bg-background`}
    >
      <div
        className="relative flex-1 min-h-0 flex flex-col bg-panel overflow-hidden md:border md:border-border-strong md:rounded-3 md:shadow-sm"
        aria-busy="true"
        aria-label="Opening the game"
      >
        <header className="flex items-center gap-2 px-2 sm:px-3 py-2">
          <Skeleton className="h-8 w-8 rounded-3" />
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Skeleton className="h-6 w-40 max-w-[45%] rounded-3" />
            <Skeleton className="h-4 w-12 rounded-2" />
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Skeleton className="h-7 w-16 rounded-3" />
            <Skeleton className="h-8 w-8 rounded-3" />
            <Skeleton className="h-8 w-20 rounded-3" />
          </div>
        </header>

        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-dashed border-border-dashed">
          <Skeleton className="h-4 w-8 rounded-2" />
          <Skeleton className="h-4 w-2/3 max-w-[24rem] rounded-2" />
        </div>

        <div className="flex-1 min-h-0 md:grid md:grid-cols-[minmax(0,4fr)_minmax(0,3fr)] wide:grid-cols-[minmax(0,1fr)_45rem] ultra:grid-cols-1 ultra:grid-rows-[minmax(0,1fr)_auto]">
          <div className="board-stage h-full min-h-0 overflow-hidden p-3 md:p-6 ultra:[--cell-cap:5.5rem] flex flex-col md:justify-center">
            <div className="board-fit" style={{ aspectRatio: "1 / 1" }}>
              <Skeleton className="w-full h-full rounded-2" />
            </div>
          </div>

          {/* The rail's placeholder below `ultra`; the dock's above it, so the frame the live
              game settles into is the same one the skeleton already drew (no geometry jump). */}
          <div className="hidden md:grid ultra:hidden grid-rows-2 wide:grid-rows-1 wide:grid-cols-2 min-h-0 h-full border-l border-dashed border-border-dashed">
            <div className="flex flex-col gap-2.5 p-4 border-b border-dashed border-border-dashed wide:border-b-0 wide:border-r">
              {railList}
            </div>
            <div className="flex flex-col gap-2.5 p-4">{railList}</div>
          </div>

          <div className="clue-dock hidden ultra:flex min-h-0 border-t border-dashed border-border-dashed">
            <div className="shrink-0 w-[20rem] flex flex-col gap-2.5 p-4 border-r border-dashed border-border-dashed">
              {dockColumn}
            </div>
            <div className="flex-1 flex flex-col gap-2.5 p-4 border-r border-dashed border-border-dashed">
              {dockColumn}
            </div>
            <div className="flex-1 flex flex-col gap-2.5 p-4">{dockColumn}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveGame({
  ready,
  identity,
  navigate,
  inShell,
  params,
}: {
  ready: Ready;
  identity: Identity;
  navigate: Navigate;
  inShell: boolean;
  params: URLSearchParams;
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
  // Guests can never hold solver (server FULL_ACCOUNT_REQUIRED). blockedByAccount also flips on
  // for a stale client the server refuses, so the sign-in gate replaces a raw error in that race.
  const [blockedByAccount, setBlockedByAccount] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedCompletion, setDismissedCompletion] = useState(false);
  const flashNonce = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  // Cursor relay throttle (PROTOCOL.md §9): a leading send plus one coalesced trailing send,
  // capped at 10/s. `selectionRef` carries the latest selection to a pending trailing send.
  const cursorLastSentRef = useRef(0);
  const cursorTrailRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionRef = useRef(selection);

  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const frozen = store.status !== "ongoing";
  // Post-REST, pre-welcome: the store is `connecting`, so the real grid renders at its
  // true geometry with empty cells but de-emphasized, and input is locked until the first
  // snapshot makes it live (item 3/4). `connecting` is only ever the pre-first-welcome
  // state, so this reads as "have we synced once"; a later drop goes `reconnecting`.
  const awaitingFirstSync = store.sync === "connecting";
  const isSpectator = role === "spectator";
  // A guest (or a client the server refused) cannot upgrade: show the sign-in deal, not the tap.
  const needsFullAccount = ready.isAnonymous || blockedByAccount;

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

  // Broadcast the local cursor to the room whenever the selection (cell or direction) changes in
  // the live game (PROTOCOL.md §9). Leading send plus a coalesced trailing send caps it at 10/s;
  // the store refuses it while `connecting`, and this is the live path only, so the demo boards
  // never send. Spectators have no cursor and never send one (PROTOCOL.md §5: spectator cursors
  // suppressed client-side by default); on an upgrade to solver the effect re-runs and the fresh
  // selection flushes at once. Cursors are ephemeral, so this never touches store or render state.
  useEffect(() => {
    selectionRef.current = selection;
    if (awaitingFirstSync || isSpectator) return;
    const CAP_MS = 100; // at most 10 moveCursor per second
    const flush = (): void => {
      cursorLastSentRef.current = Date.now();
      store.moveCursor(
        selectionRef.current.cell,
        selectionRef.current.direction,
      );
    };
    const since = Date.now() - cursorLastSentRef.current;
    if (since >= CAP_MS) {
      flush();
    } else if (cursorTrailRef.current === null) {
      cursorTrailRef.current = setTimeout(() => {
        cursorTrailRef.current = null;
        flush();
      }, CAP_MS - since);
    }
  }, [selection, awaitingFirstSync, isSpectator, store]);

  // Drop a pending trailing cursor send on unmount.
  useEffect(
    () => () => {
      if (cursorTrailRef.current !== null) clearTimeout(cursorTrailRef.current);
    },
    [],
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
        avatarUrl: participant?.avatarUrl ?? null,
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
      avatarUrl: p.avatarUrl,
      color: p.color,
      connected: p.connected,
      role: p.role,
    }));
  }, [store, version]);

  // The solving-now roster: teammates read from the store's best-effort cursors, self
  // from the local selection (fresher than the store's echo). Spectating self has no
  // cursor, so it contributes no row.
  const roster = useMemo(() => {
    void version;
    return buildRoster({
      participants: store.participants,
      cursors: store.cursors,
      selfUserId: store.selfUserId,
      selfSelection: isSpectator ? null : selection,
      across: puzzle.acrossClues,
      down: puzzle.downClues,
    });
  }, [store, version, isSpectator, selection, puzzle]);

  // Presence in the lists: the same roster, re-keyed by clue so each clue row can mark itself
  // with the teammates on it. Self is dropped (your row is already amber), so a solo game and a
  // room where only you have a resolvable cursor both yield an empty map and unchanged rows.
  const presenceByClue = useMemo(() => cluePresence(roster), [roster]);

  const handleKey = useCallback(
    (key: string, shift: boolean): boolean => {
      // Lock input until the first welcome: the store also refuses mutations while
      // `connecting` (defense in depth), but swallowing the key here keeps the selection
      // from advancing over a board that has no authoritative state yet.
      if (isSpectator || awaitingFirstSync) return false;
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
    [isSpectator, awaitingFirstSync, grid, filled, selection, frozen, store],
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
        return;
      }
      // Defense for stale clients and races: the server refuses a guest with
      // FULL_ACCOUNT_REQUIRED (403). Swap the banner to the sign-in deal, never a raw error.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 403 && body.error === "FULL_ACCOUNT_REQUIRED") {
        setBlockedByAccount(true);
      }
    } finally {
      setUpgrading(false);
    }
  }

  function startSignIn(): void {
    setSigningIn(true);
    void identity
      .signInWithProvider("discord")
      .catch(() => setSigningIn(false));
  }

  function startAppleSignIn(): void {
    setSigningIn(true);
    void identity.signInWithProvider("apple").catch(() => setSigningIn(false));
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

  // Clues the active clue names ("See 42-Down", "17, 20, and 49 across"), keyed
  // `${direction}-${number}` like the presence map so a list row looks itself up in O(1). The
  // parser reads intent only; here we filter to entries that actually exist in this puzzle, so a
  // reference to a clue this grid lacks (or the active clue naming itself) never lights a row.
  const referenced = useMemo(() => {
    const exists = new Set<string>();
    for (const c of puzzle.acrossClues) exists.add(`across-${c.number}`);
    for (const c of puzzle.downClues) exists.add(`down-${c.number}`);
    const marks = new Set<string>();
    for (const ref of parseClueRefs(activeClue?.text)) {
      const key = `${ref.direction}-${ref.number}`;
      if (
        exists.has(key) &&
        key !== `${activeClue?.direction}-${activeClue?.number}`
      ) {
        marks.add(key);
      }
    }
    return marks;
  }, [activeClue, puzzle]);

  const elapsed = useElapsedSeconds(store.firstFillAt, store.completedAt);
  // `name` and `code` are API-preferred with a URL-param fallback (resolved in the loader), so
  // the title and the share popover work without the current URL carrying `?name=`/`?code=`.
  const title = name ?? `${puzzle.cols} × ${puzzle.rows}`;
  const shareUrl = buildShareUrl({
    origin: window.location.origin,
    gameId,
    code,
    name,
  });

  const completed = store.status === "completed" && !dismissedCompletion;
  const goHome = (): void => navigate(homeHref(params));

  // In the shell the desktop toolbar leads with the sidebar trigger, anchored in the panel so
  // toggling never slides the control out from under the cursor (the rail carries no trigger).
  // Phones keep the back chevron because the game is full-bleed there and has no rail. The
  // trigger only mounts inShell, since useSidebar needs the provider the shell supplies.
  const leading = inShell ? (
    <>
      <SidebarTrigger className="hidden text-text-subtle hover:text-text md:inline-flex" />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={goHome}
        aria-label="Back to home"
        className="md:hidden"
      >
        <ChevronLeftIcon />
      </Button>
    </>
  ) : undefined;

  // The solve screen is one framed panel, v2's game screen: standalone it floats on the sand
  // background inside a 16px gutter; in the shell it sits flush at the rail edge with a 12px
  // gutter elsewhere, matching the sidebar's own padding so left and right read even and the
  // collapsed rail icon centers. On mobile it goes full bleed and the on-screen keyboard docks
  // at the bottom. Inside: chrome row, clue strip (or the mobile clue bar), then the board in
  // calm space with the clue rail to its right. The board always fits the viewport on desktop
  // (.board-fit resolves against both axes of its stage).
  return (
    <div
      className={`${inShell ? "h-full md:p-3 md:pl-0" : "h-dvh md:p-4"} flex flex-col overflow-hidden bg-background`}
    >
      <div className="relative flex-1 min-h-0 flex flex-col bg-panel overflow-hidden md:border md:border-border-strong md:rounded-3 md:shadow-sm">
        <GameToolbar
          title={title}
          timer={formatDuration(elapsed)}
          done={store.status === "completed"}
          members={members}
          selfId={ready.selfId}
          shareUrl={shareUrl}
          inviteCode={code}
          admin={{ apiBase, gameId, getToken: identity.getAccessToken }}
          onBack={goHome}
          leading={leading}
        />

        {isSpectator && (
          <SpectateBanner
            guest={needsFullAccount}
            onUpgrade={() => void upgrade()}
            onSignIn={startSignIn}
            onAppleSignIn={startAppleSignIn}
            upgrading={upgrading}
            signingIn={signingIn}
          />
        )}

        <ClueStrip clue={activeClue} />
        <ClueBar
          clue={activeClue}
          onOpen={() => setSheetOpen(true)}
          onPrev={() => stepClue("backward")}
          onNext={() => stepClue("forward")}
        />

        {/* At `ultra` the twin-column grid rotates to a stacked one: the board takes the top
            row and grows toward its raised cap, the full-width ClueDock takes the bottom.
            ClueRail hides at `ultra` and ClueDock hides below it, so exactly one is ever laid
            out and the board-stage sibling is shared. */}
        <div className="flex-1 min-h-0 md:grid md:grid-cols-[minmax(0,4fr)_minmax(0,3fr)] wide:grid-cols-[minmax(0,1fr)_45rem] ultra:grid-cols-1 ultra:grid-rows-[minmax(0,1fr)_auto]">
          <div
            className="board-stage h-full min-h-0 overflow-auto md:overflow-hidden p-3 md:p-6 ultra:[--cell-cap:5.5rem] flex flex-col md:justify-center"
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
                className={`board-wrap outline-none transition-opacity duration-300 motion-reduce:transition-none${
                  awaitingFirstSync ? " opacity-45" : ""
                }`}
                data-testid="grid"
                ref={gridRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                aria-label="Crossword grid"
                aria-busy={awaitingFirstSync}
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
            filled={filled}
            presence={presenceByClue}
            referenced={referenced}
            solvingNow={<SolvingNow roster={roster} />}
            onJump={jumpToClue}
          />

          <ClueDock
            across={puzzle.acrossClues}
            down={puzzle.downClues}
            activeAcross={activeAcross}
            activeDown={activeDown}
            currentDirection={selection.direction}
            filled={filled}
            presence={presenceByClue}
            referenced={referenced}
            solvingNow={<SolvingNow roster={roster} />}
            onJump={jumpToClue}
          />
        </div>

        {!isSpectator && (
          <Keyboard
            onKey={(key) => handleKey(key, false)}
            disabled={frozen || awaitingFirstSync}
          />
        )}

        {/* The status pill speaks only to a lost-then-recovering connection: `resyncing`
            (a gap) and `reconnecting` (a post-drop backoff). The honest first connect is
            `connecting`, covered by the pre-welcome de-emphasis above, so it never shows
            the pill (item 3). */}
        {(store.sync === "resyncing" || store.sync === "reconnecting") && (
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
        filled={filled}
        presence={presenceByClue}
        referenced={referenced}
        onJump={jumpToClue}
      />

      {completed && (
        <CompletionOverlay
          seconds={store.stats?.solveTimeSeconds ?? elapsed}
          participantCount={store.stats?.participantCount ?? null}
          shareUrl={shareUrl}
          onDismiss={() => setDismissedCompletion(true)}
          onHome={goHome}
        />
      )}
    </div>
  );
}
