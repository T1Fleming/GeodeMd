/**
 * What is in the collection, and what is waiting.
 *
 * Four numbers, and the split between two of them is the whole reason this
 * screen is not one number: `due` is an instant, so "due today" is ambiguous.
 * **Due now** is the actionable count and gets the emphasis; *before midnight*
 * is a forecast and is deliberately quieter.
 *
 * It also says which folder those numbers are about, and is where that folder
 * is changed (#43) — the one screen that is about the collection as a whole —
 * and which editor `o` opens a note in (#47), because that is the other
 * setting someone would otherwise have to hand-edit the config for.
 */

import { useCallback, useEffect, useState } from "react";
import { backlogCapped, countText } from "../../host/present.js";
import type { EditorChoices, Stats as StatsData } from "../ipc.js";
import { OTHER, SYSTEM_DEFAULT, editorView, onChoose } from "./model/editor.js";

export function Stats({
  notesPath,
  onChangeFolder,
}: {
  notesPath: string;
  onChangeFolder: () => void;
}): React.JSX.Element {
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await window.geode.statsRead();
    if (r.ok) setData(r.value);
    else setError(r.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-read after any run: a sync that added cards leaves these numbers stale,
  // and a screen showing yesterday's count with no sign of it is worse than a
  // spinner.
  useEffect(() => window.geode.onRunFinished(() => void load()), [load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">loading…</p>;

  return (
    <main className="screen">
      <h2>Collection</h2>
      <div className="tiles">
        {/* `10000+` when a count stopped at the cap (ADR 0024) — `countText` is
            host's, so a capped count reads the same wherever it is shown. The
            total is the one figure that is never capped. */}
        <Tile value={countText(data.dueNow)} label="due now" strong />
        <Tile value={countText(data.newCards)} label="new" strong />
        <Tile value={countText(data.dueBeforeMidnight)} label="due before midnight" />
        <Tile value={String(data.total)} label="cards in total" />
      </div>
      <p className="muted lead">
        {data.dueNow + data.newCards > 0
          ? `${countText(data.dueNow + data.newCards, backlogCapped(data))} waiting for you.`
          : "Nothing waiting. New cards appear here after a sync."}
      </p>
      <div className="folder">
        <p className="path">{notesPath}</p>
        <button onClick={onChangeFolder}>Change folder…</button>
        <EditorSetting />
      </div>
    </main>
  );
}

function Tile({
  value,
  label,
  strong = false,
}: {
  /** Text, not a number: a capped count reads `10000+`. */
  value: string;
  label: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className={strong ? "tile strong" : "tile"}>
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/**
 * Which program `o` opens a note in. Choosing an installed editor saves at
 * once; **Other…** waits for a command and a Save, because saving each
 * keystroke would write `c`, `co` and `cod` to the config on the way to `code`.
 */
function EditorSetting(): React.JSX.Element | null {
  const [choices, setChoices] = useState<EditorChoices | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((c: EditorChoices) => {
    const v = editorView(c);
    setChoices(c);
    setPicked(v.selected);
    setTyped(v.other);
    setError(null);
  }, []);

  useEffect(() => {
    void window.geode.editorsList().then((r) => (r.ok ? apply(r.value) : setError(r.message)));
  }, [apply]);

  const save = async (editor: string | null): Promise<void> => {
    const r = await window.geode.editorsSet(editor);
    if (r.ok) apply(r.value);
    else setError(r.message);
  };

  if (!choices || picked === null) return error ? <p className="error inline">{error}</p> : null;
  const view = editorView(choices);
  const saved = view.selected === picked && (picked !== OTHER || view.other === typed.trim());

  return (
    <div className="editor-setting">
      <label>
        <span className="label">Open notes in</span>
        <select
          value={picked}
          onChange={(e) => {
            const value = e.target.value;
            setPicked(value);
            const editor = onChoose(value);
            if (editor !== undefined) void save(editor);
          }}
        >
          {view.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {picked === OTHER && (
        <form
          className="other"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim() !== "") void save(typed);
          }}
        >
          <input
            type="text"
            value={typed}
            placeholder="a command, e.g. code -w"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" disabled={saved || typed.trim() === ""}>
            Save
          </button>
        </form>
      )}
      {error ? (
        <p className="error inline">{error}</p>
      ) : (
        <p className="blocker">
          {picked === SYSTEM_DEFAULT
            ? "o opens the note at the top, in whatever app opens .md files."
            : picked === OTHER
              ? "A terminal editor such as vim needs a terminal to run in — the app has none to give it."
              : "o opens the note at the card's line."}
        </p>
      )}
    </div>
  );
}
