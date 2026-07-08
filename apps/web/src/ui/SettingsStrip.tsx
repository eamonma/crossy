// The settings strip: board and theme. The Wave 1.1h A/B toggles (Shift+Tab landing,
// backspace-across-blocks) are gone: both decisions are settled and pinned by the
// navigation vectors, and all cursor movement now goes through @crossy/engine
// (ROADMAP "Playground reconciliation").

type Theme = "light" | "dark";

interface Option<T> {
  value: T;
  label: string;
}

interface Props {
  boardId: string;
  boards: readonly { id: string; label: string }[];
  onBoard: (id: string) => void;
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
