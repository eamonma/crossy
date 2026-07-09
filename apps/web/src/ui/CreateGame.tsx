// Create (?create=1): upload or paste an XWord Info JSON puzzle, then land in the game with a
// share link. Creating requires a full account (guests are join-only, DESIGN section 8), so a
// logged-out or guest visitor sees the gate first. Rejections from the ingestion ACL map to
// plain, specific sentences shown inline under the dropzone, never a toast and never an error
// code (audit voice). INV-6: the uploaded JSON carries solutions to the server, but this screen
// never renders a grid from local state; on success it navigates and the board arrives, solution
// stripped, over the WebSocket.
import { useRef, useState } from "react";
import { FileIcon, UploadIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import type { Navigate } from "../nav";
import { TopBar } from "./TopBar";
import { SignInButtons } from "./AuthBar";
import { Button, CapsLabel, Divider, Panel, cx } from "./primitives";

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

export function CreateGame({
  config,
  identity,
  navigate,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
}) {
  const session = identity.getSession();

  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar identity={identity} config={config} onHome={() => navigate("")} />
      <main className="flex-1 px-4 py-6 flex items-start justify-center">
        <div className="w-full max-w-[36rem]">
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
    <Panel className="p-6 enter">
      <h1 className="font-display text-7 font-medium m-0">Create a game</h1>
      <p className="mt-2 text-3 text-text-muted">
        {guest
          ? "Guests can join and solve, but creating a game needs a full account. Sign in to host."
          : "Sign in to upload a puzzle and start a room your friends can join."}
      </p>
      <div className="mt-6">
        <SignInButtons
          identity={identity}
          config={config}
          discordLabel="Sign in with Discord"
        />
      </div>
    </Panel>
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
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const apiOverride = new URLSearchParams(window.location.search).get("api");
  const apiBase = apiOverride ?? config.apiBase;

  async function ingestFile(file: File): Promise<void> {
    setPhase({ kind: "idle" });
    try {
      setRaw(await file.text());
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

      const gameRes = await fetch(`${apiBase}/games`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ puzzleId }),
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

      // The game name has no server field yet (gap noted in the report); carry the creator's
      // optional label on the invite link so everyone who opens it sees the same title.
      const label = name.trim();
      const suffix =
        label === "" ? "" : `&name=${encodeURIComponent(label.slice(0, 60))}`;
      navigate(`?game=${gameId}&code=${inviteCode}${suffix}`);
    } catch {
      setPhase({
        kind: "error",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  const creating = phase.kind === "creating";

  return (
    <Panel className="p-6 enter">
      <h1 className="font-display text-7 font-medium m-0">Create a game</h1>
      <p className="mt-2 text-3 text-text-muted">
        Upload an XWord Info JSON puzzle, or paste it below. You will land in
        the game with a link to share.
      </p>

      <div className="mt-6 flex flex-col gap-2">
        <CapsLabel>Puzzle name (optional)</CapsLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sunday themeless"
          maxLength={60}
          className={cx(
            "h-10 px-3 rounded-3 bg-panel border border-border text-3 text-text",
            "placeholder:text-text-subtle focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-focus-ring",
          )}
        />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <CapsLabel>Puzzle file</CapsLabel>
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
            "flex flex-col items-center justify-center gap-2 w-full py-7 px-4",
            "rounded-4 border border-dashed text-center transition-colors",
            dragging
              ? "border-solid bg-gold-3"
              : "border-border-dashed bg-panel hover:bg-sand-3",
          )}
        >
          <UploadIcon className="text-text-subtle" width={20} height={20} />
          <span className="text-3 text-text">
            Drop a <span className="font-mono text-2">.json</span> file here, or
            click to browse
          </span>
        </button>
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
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <FileIcon className="text-text-subtle" />
          <CapsLabel>Or paste the JSON</CapsLabel>
        </div>
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            if (phase.kind === "error") setPhase({ kind: "idle" });
          }}
          spellCheck={false}
          rows={7}
          placeholder='{ "size": { "rows": 15, "cols": 15 }, "grid": [ ... ], "clues": { ... } }'
          className={cx(
            "w-full p-3 rounded-3 bg-panel border border-border font-mono text-2 text-text",
            "placeholder:text-text-subtle resize-y focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-focus-ring",
          )}
        />
      </div>

      {phase.kind === "error" && (
        <div
          role="alert"
          className="mt-4 p-3 rounded-3 bg-danger-bg border border-danger-border/40 text-2 text-danger-text"
        >
          {phase.message}
        </div>
      )}

      <Divider className="my-5" />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("")}
          className="text-2 text-text-muted hover:text-text"
        >
          Cancel
        </button>
        <Button
          variant="solid"
          size="lg"
          onClick={() => void submit()}
          disabled={raw.trim() === "" || creating}
        >
          {creating ? "Creating..." : "Create game"}
        </Button>
      </div>
    </Panel>
  );
}
