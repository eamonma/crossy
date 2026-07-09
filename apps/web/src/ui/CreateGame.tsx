// Create (?create=1): upload or paste an XWord Info JSON puzzle, then land in the game with
// a share link. Composed as v2's create dialog: one centered card with a name field, the
// dashed dropzone, and a right-aligned Cancel / Create footer; pasting JSON is a quiet
// disclosure under the dropzone. Creating requires a full account (guests are join-only,
// DESIGN section 8), so a logged-out or guest visitor sees the gate first. Rejections from
// the ingestion ACL map to plain, specific sentences shown inline, never a toast and never
// an error code. INV-6: the uploaded JSON carries solutions to the server, but this screen
// never renders a grid from local state; on success it navigates and the board arrives,
// solution stripped, over the WebSocket.
import { useEffect, useRef, useState } from "react";
import { Cross2Icon, FileTextIcon, UploadIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import type { Navigate } from "../nav";
import { TopBar } from "./TopBar";
import { SignInButtons } from "./AuthBar";
import { Button, cx } from "./primitives";

/** Map an API rejection code to one calm, specific sentence in the product voice. */
function rejectionSentence(code: string): string {
  switch (code) {
    case "VALIDATION":
      return "That doesn't look like an XWord Info puzzle. Check the JSON and try again.";
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
      return "Your session expired. Sign in again to create a game.";
    default:
      return "Something went wrong creating the game. Give it another try.";
  }
}

interface Rejection {
  error?: string;
  message?: string;
}

/** The one dialog recipe: warm face, hairline, card radius, dialog elevation. */
function DialogCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="enter bg-panel border border-border rounded-4 shadow-xl p-5">
      {children}
    </div>
  );
}

export function CreateGame({
  config,
  identity,
  navigate,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
}) {
  // Re-render when the session changes, so the gate swaps to the form the moment sign-in
  // lands (the top bar already tracks this; the card must not lag behind it).
  const [, setAuthTick] = useState(0);
  useEffect(
    () => identity.onChange(() => setAuthTick((t) => t + 1)),
    [identity],
  );
  const session = identity.getSession();

  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar identity={identity} config={config} onHome={() => navigate("")} />
      <main className="flex-1 px-4 py-6 flex items-center justify-center">
        <div className="w-full max-w-[28rem] pb-9">
          {session === null || session.isAnonymous ? (
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
            />
          )}
        </div>
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
      <h1 className="font-display text-6 font-semibold m-0">Create a game</h1>
      <p className="mt-1.5 text-2 text-text-muted">
        {guest
          ? "Guests can join and solve, but creating a game needs a full account. Sign in to host."
          : "Sign in to upload a puzzle and start a room your friends can join."}
      </p>
      <div className="mt-5">
        <SignInButtons
          identity={identity}
          config={config}
          discordLabel="Sign in with Discord"
        />
      </div>
    </DialogCard>
  );
}

type Phase =
  { kind: "idle" } | { kind: "creating" } | { kind: "error"; message: string };

function CreateForm({
  config,
  identity,
  navigate,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
}) {
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const apiOverride = new URLSearchParams(window.location.search).get("api");
  const apiBase = apiOverride ?? config.apiBase;

  async function ingestFile(file: File): Promise<void> {
    setPhase({ kind: "idle" });
    try {
      setRaw(await file.text());
      setFileName(file.name);
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
    const token = await identity.getAccessToken();
    if (token === null) {
      setPhase({ kind: "error", message: rejectionSentence("UNAUTHORIZED") });
      return;
    }
    const auth = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    try {
      const puzzleRes = await fetch(`${apiBase}/puzzles`, {
        method: "POST",
        headers: auth,
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
      const gameRes = await fetch(`${apiBase}/games`, {
        method: "POST",
        headers: auth,
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
      navigate(`?game=${gameId}&code=${inviteCode}`);
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
      <h1 className="font-display text-6 font-semibold m-0">Create a game</h1>
      <p className="mt-1.5 text-2 text-text-muted">
        Upload an XWord Info JSON puzzle. You'll land in the game with a link to
        share.
      </p>

      <div className="mt-4 flex flex-col gap-1.5">
        <label
          htmlFor="game-name"
          className="text-2 font-medium text-text-muted"
        >
          Name
        </label>
        <input
          id="game-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sunday themeless"
          maxLength={80}
          className="field h-10 px-3 text-3 w-full"
        />
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-2 font-medium text-text-muted">Puzzle</span>
        {loaded ? (
          <div className="flex items-center gap-2 border border-dashed border-border-dashed rounded-3 px-3 py-2.5">
            <FileTextIcon className="shrink-0 text-text-accent" />
            <span className="min-w-0 truncate text-2 text-text">
              {fileName}
            </span>
            <span className="ml-auto shrink-0 text-1 text-text-subtle tabular-nums">
              {Math.max(1, Math.round(raw.length / 1024))} KB
            </span>
            <button
              type="button"
              onClick={clearFile}
              aria-label="Remove file"
              className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-2 text-text-subtle hover:text-text hover:bg-sand-3"
            >
              <Cross2Icon />
            </button>
          </div>
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
              "flex flex-col items-center justify-center gap-1.5 w-full py-6 px-4",
              "rounded-3 border border-dashed text-center transition-colors",
              dragging
                ? "border-gold-8 bg-gold-3"
                : "border-border-dashed hover:bg-sand-2",
            )}
          >
            <UploadIcon className="text-text-subtle" width={18} height={18} />
            <span className="text-2 text-text-subtle">
              Drop a puzzle file here, or click to browse
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
          <textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              if (phase.kind === "error") setPhase({ kind: "idle" });
            }}
            spellCheck={false}
            rows={6}
            placeholder='{ "size": { "rows": 15, "cols": 15 }, "grid": [ ... ], "clues": { ... } }'
            className="field w-full p-3 font-mono text-1 resize-y"
          />
        )}
      </div>

      {phase.kind === "error" && (
        <p role="alert" className="mt-3 text-2 text-danger-text">
          {phase.message}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="soft" size="sm" onClick={() => navigate("")}>
          Cancel
        </Button>
        <Button
          variant="solid"
          size="sm"
          onClick={() => void submit()}
          disabled={raw.trim() === "" || creating}
        >
          {creating ? "Creating..." : "Create"}
        </Button>
      </div>
    </DialogCard>
  );
}
