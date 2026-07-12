// Personal navigation preferences, per device and client-local (localStorage, the `crossy:`
// namespace the other client-local keys use). No wire call, no server state: these steer only
// where the local cursor lands after a keystroke. One provider owns the state so a change in
// Settings applies live everywhere (the game board reads the same context) without a reload.
// Storage failures (private mode, blocked storage) cost persistence only, never the in-memory
// choice, the same contract as useTheme.
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_NAV_PREFS,
  type EndOfWord,
  type NavPrefs,
} from "../input/prefs";

const SKIP_KEY = "crossy:nav:skip-filled";
const END_KEY = "crossy:nav:end-of-word";

interface NavPrefsValue {
  readonly prefs: NavPrefs;
  readonly setSkipFilledInWord: (on: boolean) => void;
  readonly setEndOfWord: (value: EndOfWord) => void;
}

function readStored(): NavPrefs {
  if (typeof window === "undefined") return DEFAULT_NAV_PREFS;
  let skipFilledInWord = DEFAULT_NAV_PREFS.skipFilledInWord;
  let endOfWord = DEFAULT_NAV_PREFS.endOfWord;
  try {
    const skip = window.localStorage.getItem(SKIP_KEY);
    if (skip === "0") skipFilledInWord = false;
    else if (skip === "1") skipFilledInWord = true;
    const end = window.localStorage.getItem(END_KEY);
    if (end === "next-clue" || end === "first-blank") endOfWord = end;
  } catch {
    // Blocked storage: fall back to the defaults, which reproduce today's behavior.
  }
  return { skipFilledInWord, endOfWord };
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: keep the in-memory choice, skip persistence.
  }
}

const NavPrefsContext = createContext<NavPrefsValue | null>(null);

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<NavPrefs>(readStored);

  const setSkipFilledInWord = useCallback((on: boolean) => {
    setPrefs((cur) => ({ ...cur, skipFilledInWord: on }));
    write(SKIP_KEY, on ? "1" : "0");
  }, []);

  const setEndOfWord = useCallback((value: EndOfWord) => {
    setPrefs((cur) => ({ ...cur, endOfWord: value }));
    write(END_KEY, value);
  }, []);

  return createElement(
    NavPrefsContext.Provider,
    { value: { prefs, setSkipFilledInWord, setEndOfWord } },
    children,
  );
}

/** Read the shared navigation prefs. Safe outside a provider: returns the defaults with no-op
 * setters, so a surface that renders without the provider still behaves exactly like today. */
export function useNavPrefs(): NavPrefsValue {
  return (
    useContext(NavPrefsContext) ?? {
      prefs: DEFAULT_NAV_PREFS,
      setSkipFilledInWord: () => {},
      setEndOfWord: () => {},
    }
  );
}
