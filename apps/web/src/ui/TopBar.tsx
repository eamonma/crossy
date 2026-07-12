// The slim top bar for the landing and gate surfaces: the wordmark, a theme toggle, and the
// auth chip. It is the panel recipe (hairline, radius, shadow-sm), the same face reused across
// the system. Kept understated so nothing competes with the one gold CTA per screen.
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import { AuthBar } from "./AuthBar";
import { Logo } from "./primitives";
import { Button } from "@/components/ui/button";
import { useTheme } from "./useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      title="Theme"
      // A 44px-tall hit box on the 24px toggle, visual size unchanged; height-only so it never
      // collides with a neighbor in a packed row (hit-target-y, styles.css).
      className="hit-target-y"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

export function TopBar({
  identity,
  config,
  onHome,
}: {
  identity: Identity;
  config: AppConfig;
  onHome?: () => void;
}) {
  return (
    <header className="w-full px-4 pt-4">
      <div className="flex items-center justify-between h-12 px-4 bg-panel border border-border rounded-3">
        <button
          type="button"
          onClick={onHome}
          className="inline-flex items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="Crossy home"
        >
          <Logo />
        </button>
        <div className="flex items-center gap-3">
          <a
            href="/terms"
            className="text-1 text-text-subtle hover:text-text-muted hidden sm:inline"
          >
            Terms
          </a>
          <a
            href="/privacy"
            className="text-1 text-text-subtle hover:text-text-muted hidden sm:inline"
          >
            Privacy Policy
          </a>
          <ThemeToggle />
          {/* Signed in, the avatar menu; signed out, nothing, since every signed-out surface
              carries its own inline sign-in. */}
          <AuthBar identity={identity} config={config} />
        </div>
      </div>
    </header>
  );
}
