// Landing (/): the serif lockup as the one confident gesture (scale is the signal, not color
// or weight), each line left-padded and underlined with a dashed rule, then a single gold CTA.
// Sign-in state lives in the slim top bar. Mobile-first: the display clamp and the 10vw indent
// were tuned so "crosswords" clears a 375px viewport.
import { ArrowRightIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import { TopBar } from "./TopBar";
import { Button, Divider } from "./primitives";

function Line({
  children,
  accent = false,
}: {
  children: string;
  accent?: boolean;
}) {
  return (
    <div className="pl-[10vw]">
      <span className={accent ? "text-gold-12" : "text-text-muted"}>
        {children}
      </span>
      <Divider className="mt-2" />
    </div>
  );
}

export function Landing({
  identity,
  config,
  onCreate,
}: {
  identity: Identity;
  config: AppConfig;
  onCreate: () => void;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar identity={identity} config={config} />
      <main className="flex-1 px-4 pb-4 pt-4 flex">
        <section className="relative flex-1 flex flex-col justify-center overflow-hidden bg-panel-feature border border-border rounded-3 shadow-sm py-9">
          <h1 className="font-display font-medium tracking-[-0.02em] text-display-lg m-0">
            <Line>Solve</Line>
            <Line>crosswords</Line>
            <Line accent>together.</Line>
          </h1>

          <div className="pl-[10vw] mt-6 flex flex-col gap-4 max-w-[34rem]">
            <p className="text-4 text-text-muted font-sans">
              Bring your own puzzle, share one link, and watch every cursor move
              as your friends fill the grid with you.
            </p>
            <div>
              <Button variant="solid" size="lg" onClick={onCreate}>
                Create a game
                <ArrowRightIcon />
              </Button>
            </div>
          </div>
        </section>
      </main>
      <footer className="px-4 pb-5 pt-2">
        <p className="mx-auto max-w-[68rem] text-1 text-text-subtle">
          A room where a few friends solve one crossword together.
        </p>
      </footer>
    </div>
  );
}
