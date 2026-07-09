// App-wide theme, stamped as data-theme on <html> (the mechanism the grid tokens and the dark
// @custom-variant both key off). One provider owns the state so a toggle on any surface (top
// bar, game toolbar) stays in sync; persisted so a returning solver keeps their choice, and it
// defaults to the OS preference on first visit. Display concern only.
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

interface ThemeValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const KEY = "crossy-theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      // Private mode or blocked storage: keep the in-memory choice, skip persistence.
    }
  }, []);

  const toggle = useCallback(
    () => setThemeState((cur) => nextAndStore(cur)),
    [],
  );

  return createElement(
    ThemeContext.Provider,
    { value: { theme, setTheme, toggle } },
    children,
  );
}

function nextAndStore(cur: Theme): Theme {
  const next: Theme = cur === "dark" ? "light" : "dark";
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // ignore blocked storage
  }
  return next;
}

/** Read the shared theme. Safe outside a provider (returns a no-op light default). */
export function useTheme(): ThemeValue {
  return (
    useContext(ThemeContext) ?? {
      theme: "light",
      setTheme: () => {},
      toggle: () => {},
    }
  );
}
