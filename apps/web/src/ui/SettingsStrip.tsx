// The settings strip. The two open decisions (SP6 divergences 2 and 3) live here as
// visible toggles so the owner can A/B them instantly. Both default to v2 behavior.
import type { BackspaceMode, ShiftTabMode } from "../domain/types";

type Theme = "light" | "dark";

interface Option<T> {
  value: T;
  label: string;
}

interface Props {
  boardId: string;
  boards: readonly { id: string; label: string }[];
  onBoard: (id: string) => void;
  shiftTabMode: ShiftTabMode;
  onShiftTab: (m: ShiftTabMode) => void;
  backspaceMode: BackspaceMode;
  onBackspace: (m: BackspaceMode) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings__group">
      <span className="settings__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsStrip({
  boardId,
  boards,
  onBoard,
  shiftTabMode,
  onShiftTab,
  backspaceMode,
  onBackspace,
  theme,
  onTheme,
}: Props) {
  return (
    <div className="settings">
      <Segmented
        label="Board"
        value={boardId}
        options={boards.map((b) => ({ value: b.id, label: b.label }))}
        onChange={onBoard}
      />
      <Segmented<ShiftTabMode>
        label="Shift+Tab lands on"
        value={shiftTabMode}
        options={[
          { value: "v2-asymmetric", label: "Word start or end (v2)" },
          { value: "symmetric-first-empty", label: "First empty cell" },
        ]}
        onChange={onShiftTab}
      />
      <Segmented<BackspaceMode>
        label="Backspace on an empty cell"
        value={backspaceMode}
        options={[
          { value: "v2-cross-block", label: "Crosses the block (v2)" },
          { value: "clamp-to-word", label: "Stays in this word" },
        ]}
        onChange={onBackspace}
      />
      <Segmented<Theme>
        label="Theme"
        value={theme}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={onTheme}
      />
    </div>
  );
}
