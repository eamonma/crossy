// Create (/new): drop in a crossword JSON file, watch its title and byline appear, and land
// in the game with a share link. Composed as v2's create dialog: one centered card where the
// puzzle leads (the dashed dropzone, or the loaded puzzle's preview), the room name beneath it
// (prefilled from the puzzle's own title the moment one loads, still fully editable), and a
// right-aligned Cancel / Create footer; pasting JSON is a quiet disclosure under the dropzone.
// Creating requires a full account (guests are join-only, DESIGN section 8), so a logged-out
// or guest visitor sees the gate first. Signed in, the card centers inside the sidebar shell's
// content frame (the "New chat" shape); signed out it keeps the standalone top-bar layout.
// Rejections from the ingestion ACL map to plain, specific sentences shown inline, never a
// toast and never an error code. INV-6: the uploaded JSON carries solutions to the server, but
// this screen reads only display metadata from it (puzzleMeta.ts) and never renders a grid
// from local state; on success it navigates and the board arrives, solution stripped, over
// the WebSocket.
import { useEffect, useMemo, useRef, useState } from "react";
import { Cross2Icon, FileTextIcon, UploadIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import type { Navigate } from "../nav";
import { gameHref, homeHref } from "../nav";
import { authedFetch } from "../net/authedFetch";
import { useBearer } from "./useResource";
import { TopBar } from "./TopBar";
import { SignInButtons } from "./AuthBar";
import { CapsLabel, cx, Divider } from "./primitives";
import { readPuzzleMeta } from "./puzzleMeta";
import type { PuzzleMeta } from "./puzzleMeta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Map an API rejection code to one calm, specific sentence in the product voice. */
function rejectionSentence(code: string): string {
  switch (code) {
    case "VALIDATION":
      return "That doesn't look like a crossword Crossy can read. Check the JSON and try again.";
    case "UNSOLVABLE_CELL":
      return "This puzzle has a square no letter can fill, so it can't be solved here.";
    case "REBUS_TOO_LONG":
      return "One answer is longer than Crossy supports. The cap is ten characters per square.";
    case "OVERSIZE_GRID":
      return "This grid is bigger than 25 by 25, which Crossy doesn't support yet.";
    case "AMBIGUOUS_SOLUTION":
      return "This puzzle has more than one answer per square, which Crossy can't represent yet.";
    case "DEGENERATE_GRID":
      return "This grid has no playable squares.";
    case "DIAGRAMLESS":
      return "This is a diagramless puzzle, which Crossy doesn't support yet.";
    case "FULL_ACCOUNT_REQUIRED":
      return "You need a full account to create a game.";
    case "UNAUTHORIZED":
      return "Your session expired. Continue to create a game.";
    default:
      return "Something went wrong creating the game. Give it another try.";
  }
}

interface Rejection {
  error?: string;
  message?: string;
}

/** The one dialog recipe: warm face, hairline, card radius, dialog elevation. Sections
 * bring their own gutters so the dashed rules between them run edge to edge. */
function DialogCard({ children }: { children: React.ReactNode }) {
  return <Card className="enter gap-0 p-0 shadow-xl">{children}</Card>;
}

/** The dialog's masthead: serif title over one quiet sentence, closed by the dashed rule. */
function DialogHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="px-5 pt-5 pb-4">
        <h1 className="m-0 font-display text-6">{title}</h1>
        <p className="mt-1 mb-0 text-2 text-text-muted">{children}</p>
      </div>
      <Divider className="m-0" />
    </>
  );
}

export function CreateGame({
  config,
  identity,
  navigate,
  params,
  inShell = false,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
  params: URLSearchParams;
  /** True when the Router mounted this inside the sidebar shell (signed in). */
  inShell?: boolean;
}) {
  // Re-render when the session changes, so the gate swaps to the form the moment sign-in
  // lands (the top bar already tracks this; the card must not lag behind it).
  const [, setAuthTick] = useState(0);
  useEffect(
    () => identity.onChange(() => setAuthTick((t) => t + 1)),
    [identity],
  );
  const session = identity.getSession();

  const card =
    session === null || session.isAnonymous ? (
      <CreateGate
        identity={identity}
        config={config}
        guest={session?.isAnonymous ?? false}
      />
    ) : (
      <CreateForm
        config={config}
        identity={identity}
        navigate={navigate}
        params={params}
      />
    );

  if (inShell) {
    return (
      <main className="relative h-full overflow-y-auto px-4 py-6 flex items-center justify-center">
        {/* The sidebar toggle, anchored top-left like the other in-shell surfaces. */}
        <div className="absolute left-3 top-3 hidden md:block">
          <SidebarTrigger className="text-text-subtle hover:text-text" />
        </div>
        <div className="w-full max-w-[28rem] pb-9">{card}</div>
      </main>
    );
  }
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar
        identity={identity}
        config={config}
        onHome={() => navigate(homeHref(params))}
      />
      <main className="flex-1 px-4 py-6 flex items-center justify-center">
        <div className="w-full max-w-[28rem] pb-9">{card}</div>
      </main>
    </div>
  );
}

function CreateGate({
  identity,
  config,
  guest,
}: {
  identity: Identity;
  config: AppConfig;
  guest: boolean;
}) {
  return (
    <DialogCard>
      <DialogHeader title="Create a game">
        {guest
          ? "Guests can watch but not host. Continue to create your own games."
          : "Upload a puzzle and share the link. Hosting takes an account."}
      </DialogHeader>
      {/* Guest sign-in is a dead end here (guests can't create), so the gate offers
          the account providers alone. */}
      <div className="px-5 py-5">
        <SignInButtons identity={identity} config={config} allowGuest={false} />
      </div>
    </DialogCard>
  );
}

type Phase =
  { kind: "idle" } | { kind: "creating" } | { kind: "error"; message: string };

/**
 * The loaded puzzle as a small dossier in the dropzone's place: the parsed title leads (the
 * file name stands in when the document is untitled), then the byline, then quiet fact chips
 * (geometry, day, clue count). All of it comes from readPuzzleMeta's display-only read; a
 * document with no metadata degrades to the file name and no chips, one recipe either way.
 */
function PuzzlePreview({
  meta,
  fileName,
  kb,
  onClear,
}: {
  meta: PuzzleMeta | null;
  fileName: string | null;
  kb: number;
  onClear: () => void;
}) {
  const title = meta?.title ?? fileName ?? "Pasted puzzle";
  const byline = [
    meta?.author !== undefined && meta.author !== null
      ? `By ${meta.author}`
      : null,
    meta?.editor !== undefined && meta.editor !== null
      ? `Edited by ${meta.editor}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const chips: string[] = [];
  if (meta?.rows != null && meta.cols != null) {
    chips.push(`${meta.cols} × ${meta.rows}`);
  }
  if (meta?.dayOfWeek != null) chips.push(meta.dayOfWeek);
  if (meta?.clueCount != null) chips.push(`${meta.clueCount} clues`);

  return (
    <div className="rounded-3 border border-dashed border-border-dashed px-3 py-2.5">
      <div className="flex items-start gap-2">
        <FileTextIcon className="mt-0.5 shrink-0 text-text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-2 font-medium text-text">{title}</div>
          {byline !== "" && (
            <div className="mt-0.5 truncate text-1 text-text-muted">
              {byline}
            </div>
          )}
          {chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {chips.map((c) => (
                <Badge key={c} variant="neutral" className="tabular-nums">
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-1 text-text-subtle tabular-nums">
          {kb} KB
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClear}
          aria-label="Remove puzzle"
        >
          <Cross2Icon />
        </Button>
      </div>
    </div>
  );
}

function CreateForm({
  config,
  identity,
  navigate,
  params,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
  params: URLSearchParams;
}) {
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  // True once the user has typed a name of their own; an auto-fill never overwrites that.
  // An emptied field counts as untouched again, so the next loaded puzzle can refill it.
  const [nameEdited, setNameEdited] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const apiBase = params.get("api") ?? config.apiBase;
  // The REST bearer (ui/useResource): the `?token=` dogfood override wins with a fixed token and
  // a no-op refresh; otherwise the identity port. Both creates ride the authedFetch seam through
  // it, so a stale access token gets one refresh-and-retry (INV-11) instead of a raw failure.
  const bearer = useBearer(identity, params.get("token"));

  // The display-metadata read (title, byline, geometry) over whatever is loaded or pasted.
  // Null means "not a JSON object", which is also the one shape the server rejects outright.
  const meta = useMemo(
    () => (raw.trim() === "" ? null : readPuzzleMeta(raw)),
    [raw],
  );

  // Prefill the room name from the puzzle's own title (capped at the server's 80-char bound)
  // whenever a titled puzzle is loaded and the user hasn't written a name themselves.
  useEffect(() => {
    if (nameEdited) return;
    if (meta?.title != null) setName(meta.title.slice(0, 80));
  }, [meta, nameEdited]);

  async function ingestFile(file: File): Promise<void> {
    setPhase({ kind: "idle" });
    try {
      const text = await file.text();
      setRaw(text);
      setFileName(file.name);
      // A file that isn't a JSON object will be rejected on create anyway; saying so now,
      // while the file is still in hand, beats saying it after the round trip.
      if (readPuzzleMeta(text) === null) {
        setPhase({ kind: "error", message: rejectionSentence("VALIDATION") });
      }
    } catch {
      setPhase({
        kind: "error",
        message: "That file couldn't be read. Try pasting the JSON instead.",
      });
    }
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void ingestFile(file);
  }

  function clearFile(): void {
    setRaw("");
    setFileName(null);
    setPhase({ kind: "idle" });
    if (!nameEdited) setName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(): Promise<void> {
    const text = raw.trim();
    if (text === "") return;

    // Parse only to confirm it is JSON and to send it as the body. The grid is never rendered
    // from this local object (INV-6); it is uploaded and then arrives stripped over the socket.
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      setPhase({ kind: "error", message: rejectionSentence("VALIDATION") });
      return;
    }

    if (apiBase === "") {
      setPhase({
        kind: "error",
        message: "No server is configured. Set API_BASE and reload.",
      });
      return;
    }

    setPhase({ kind: "creating" });
    // A true sign-out that raced the gate (getAccessToken is null iff no session, INV-11): keep
    // the specific session-expired sentence. The seam would throw on the null bearer otherwise,
    // landing in the generic network catch below with the wrong message.
    if ((await bearer.getToken()) === null) {
      setPhase({ kind: "error", message: rejectionSentence("UNAUTHORIZED") });
      return;
    }

    try {
      const puzzleRes = await authedFetch(bearer, `${apiBase}/puzzles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (!puzzleRes.ok) {
        const body = (await puzzleRes.json().catch(() => ({}))) as Rejection;
        setPhase({
          kind: "error",
          message: rejectionSentence(body.error ?? "INTERNAL"),
        });
        return;
      }
      const { puzzleId } = (await puzzleRes.json()) as { puzzleId: string };

      // The API owns the game name: send the creator's optional label so it persists and is
      // returned on the game view. The server trims and caps it too; we match its 80-char bound.
      const label = name.trim().slice(0, 80);
      const gameRes = await authedFetch(bearer, `${apiBase}/games`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          label === "" ? { puzzleId } : { puzzleId, name: label },
        ),
      });
      if (!gameRes.ok) {
        const body = (await gameRes.json().catch(() => ({}))) as Rejection;
        setPhase({
          kind: "error",
          message: rejectionSentence(body.error ?? "INTERNAL"),
        });
        return;
      }
      const { gameId, inviteCode } = (await gameRes.json()) as {
        gameId: string;
        inviteCode: string;
      };

      // The name no longer rides on the URL: LiveApp reads it from the game view (and still
      // falls back to a `?name=` param for links minted before this change). The invite code
      // stays in the link, since a new visitor needs it to self-join.
      navigate(gameHref(gameId, params, { code: inviteCode }));
    } catch {
      setPhase({
        kind: "error",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  const creating = phase.kind === "creating";
  const loaded = fileName !== null;

  return (
    <DialogCard>
      <DialogHeader title="Create a game">
        Upload a crossword and get one link your friends can join.
      </DialogHeader>

      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-col gap-2">
          <CapsLabel>Puzzle</CapsLabel>
          {loaded ? (
            <PuzzlePreview
              meta={meta}
              fileName={fileName}
              kb={Math.max(1, Math.round(raw.length / 1024))}
              onClear={clearFile}
            />
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cx(
                "group flex flex-col items-center justify-center gap-1 w-full py-6 px-4",
                "rounded-3 border border-dashed text-center transition-colors",
                dragging
                  ? "border-gold-8 bg-gold-3"
                  : "border-border-dashed hover:bg-sand-2",
              )}
            >
              <span
                className={cx(
                  "mb-1 flex size-6 items-center justify-center rounded-full transition-colors",
                  dragging
                    ? "bg-gold-4 text-gold-11"
                    : "bg-gold-3 text-gold-11 group-hover:bg-gold-4",
                )}
              >
                <UploadIcon width={16} height={16} />
              </span>
              <span className="text-2 font-medium text-text">
                Drop a crossword here, or browse
              </span>
              <span className="text-1 text-text-subtle">
                Crossword JSON files
              </span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingestFile(file);
            }}
          />
          {!loaded && (
            <div>
              <button
                type="button"
                onClick={() => setPasteOpen((v) => !v)}
                className="text-1 text-text-muted hover:text-text underline decoration-dashed underline-offset-4"
              >
                {pasteOpen ? "Hide the paste box" : "Or paste the JSON"}
              </button>
            </div>
          )}
          {!loaded && pasteOpen && (
            <>
              <textarea
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  if (phase.kind === "error") setPhase({ kind: "idle" });
                }}
                spellCheck={false}
                rows={6}
                placeholder='{ "size": { "rows": 15, "cols": 15 }, "grid": [ ... ], "clues": { ... } }'
                className="field w-full p-2 font-mono text-1 resize-y"
              />
              {meta !== null && (
                <PuzzlePreview
                  meta={meta}
                  fileName={null}
                  kb={Math.max(1, Math.round(raw.length / 1024))}
                  onClear={() => {
                    setRaw("");
                    if (!nameEdited) setName("");
                  }}
                />
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="game-name" className="w-fit">
            <CapsLabel>Game name</CapsLabel>
          </Label>
          <Input
            id="game-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(e.target.value.trim() !== "");
            }}
            placeholder="Optional. The puzzle's title fills in here."
            maxLength={80}
          />
        </div>

        {phase.kind === "error" && (
          <p role="alert" className="m-0 text-2 text-danger-text">
            {phase.message}
          </p>
        )}
      </div>

      {/* The action tray: page-toned, closed off by the dashed rule, echoing the ticket
          structure the sign-in gate uses. */}
      <div className="flex items-center justify-end gap-2 border-t border-dashed border-border-dashed bg-sand-2 px-5 py-3">
        <Button variant="ghost" onClick={() => navigate(homeHref(params))}>
          Cancel
        </Button>
        <Button
          variant="default"
          onClick={() => void submit()}
          disabled={raw.trim() === "" || creating}
        >
          {creating ? "Creating..." : "Create"}
        </Button>
      </div>
    </DialogCard>
  );
}
