// Landing (/): v2's hero, the one confident gesture per screen. The oversized serif lockup
// sits on the gold-cream feature panel, each line left-padded 10vw and closed by a dashed
// rule, then one gold CTA. Everything else stays out of its way; sign-in state lives in the
// slim top bar. The display clamp keeps "crosswords" clear of a 375px viewport.
import { ArrowRightIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import { TopBar } from "./TopBar";
import { Divider } from "./primitives";
import { Button } from "@/components/ui/button";

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
      <Divider className="m-0" />
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
      <main className="flex-1 p-4 flex">
        <section className="relative flex-1 flex flex-col justify-center overflow-hidden bg-panel-feature border border-border-strong rounded-3 shadow-sm py-9">
          <h1 className="font-display font-medium tracking-[-0.02em] text-display-lg m-0">
            <Line>Solve</Line>
            <Line>crosswords</Line>
            <Line accent>together.</Line>
          </h1>

          <div className="pl-[10vw] mt-6 flex flex-col gap-5 max-w-[36rem]">
            <p className="text-3 text-text-muted pr-6">
              Upload a puzzle, share one link, and solve it with your friends.
            </p>
            <div>
              <Button variant="default" onClick={onCreate}>
                Create a game
                <ArrowRightIcon />
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
