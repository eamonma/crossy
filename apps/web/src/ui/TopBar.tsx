// The slim top bar for the landing and gate surfaces: the wordmark, a theme toggle, and the
// auth chip. It is the panel recipe (hairline, radius, shadow-sm), the same face reused across
// the system. Kept understated so nothing competes with the one gold CTA per screen.
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import { AuthBar } from "./AuthBar";
import { IconButton, Logo } from "./primitives";
import { useTheme } from "./useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <IconButton
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      title="Theme"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </IconButton>
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
    <header className="w-full">
      <div className="mx-auto max-w-[68rem] px-4 pt-4">
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
            <ThemeToggle />
            <AuthBar identity={identity} config={config} />
          </div>
        </div>
      </div>
    </header>
  );
}
