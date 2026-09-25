/**
 * What is in the open vault, and what is waiting.
 *
 * Four numbers, and the split between two of them is the whole reason this
 * screen is not one number: `due` is an instant, so "due today" is ambiguous.
 * **Due now** is the actionable count and gets the emphasis; *before midnight*
 * is a forecast and is deliberately quieter.
 *
 * It also says which vault and folder those numbers are about, and is where
 * that folder is changed (#43) — the one screen that is about the vault as a
 * whole — where the other vaults are listed, renamed and removed (ADR 0027),
 * and which editor `o` opens a note in (#47), because that is the other
 * setting someone would otherwise have to hand-edit the config for.
 */

import { useCallback, useEffect, useState } from "react";
import { backlogCapped, countText } from "../../host/present.js";
import type { AppConfig, EditorChoices, Stats as StatsData, VaultList } from "../ipc.js";
import { OTHER, SYSTEM_DEFAULT, editorView, onChoose } from "./model/editor.js";
import { cannotRemove } from "./model/vaults.js";

export function Stats({
  config,
  vaults,
  onChangeFolder,
  onAddVault,
  onSwitch,
  onVaults,
}: {
  config: AppConfig;
  vaults: VaultList;
  onChangeFolder: () => void;
  onAddVault: () => void;
  onSwitch: (id: string) => void;
  onVaults: (list: VaultList) => void;
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
      <h2>{vaults.vaults.find((v) => v.id === vaults.active)?.name ?? config.name}</h2>
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
        <p className="path">{config.notesPath}</p>
        <button onClick={onChangeFolder}>Change folder…</button>
        <p className="blocker">
          For when these notes have moved. To keep a second set of notes beside these, add a
          vault instead.
        </p>
        <Vaults list={vaults} onAdd={onAddVault} onSwitch={onSwitch} onVaults={onVaults} />
        <EditorSetting />
      </div>
    </main>
  );
}

/**
 * Every vault, and what can be done to each: open it, rename it, remove it.
 *
 * Removing asks first and says exactly what it does, because "remove" next to
 * a folder of notes reads as deleting them. It never touches the notes or the
 * log; the database is offered separately, and said to be a cache.
 */
function Vaults({
  list,
  onAdd,
  onSwitch,
  onVaults,
}: {
  list: VaultList;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onVaults: (list: VaultList) => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [dropDb, setDropDb] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rename = async (id: string): Promise<void> => {
    const r = await window.geode.vaultsRename(id, name);
    if (!r.ok) return setError(r.message);
    setError(null);
    setRenaming(null);
    onVaults(r.value);
  };

  const remove = async (id: string): Promise<void> => {
    const r = await window.geode.vaultsRemove(id, dropDb);
    if (!r.ok) return setError(r.message);
    setError(null);
    setRemoving(null);
    onVaults(r.value);
  };

  return (
    <div className="vaults">
      <h3>Vaults</h3>
      <ul>
        {list.vaults.map((v) => (
          <li key={v.id} className={v.id === list.active ? "vault on" : "vault"}>
            {renaming === v.id ? (
              <form
                className="rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename(v.id);
                }}
              >
                <input
                  type="text"
                  value={name}
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" disabled={name.trim() === ""}>
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="name">{v.name}</span>
                <span className="path small">{v.notesPath}</span>
                <span className="actions">
                  {v.id === list.active ? (
                    <span className="muted small">open</span>
                  ) : (
                    <button onClick={() => onSwitch(v.id)}>Open</button>
                  )}
                  <button
                    onClick={() => {
                      setName(v.name);
                      setRenaming(v.id);
                      setRemoving(null);
                    }}
                  >
                    Rename…
                  </button>
                  <button
                    disabled={cannotRemove(list, v.id) !== null}
                    title={cannotRemove(list, v.id) ?? ""}
                    onClick={() => {
                      setDropDb(true);
                      setRemoving(v.id);
                      setRenaming(null);
                    }}
                  >
                    Remove…
                  </button>
                </span>
              </>
            )}
            {removing === v.id && (
              <div className="confirm">
                <p>
                  Take “{v.name}” out of the list? Its notes and its review log stay exactly
                  where they are, in <code>{v.notesPath}</code> — adding the folder again later
                  brings the vault back with its history.
                </p>
                <label className="check">
                  <input type="checkbox" checked={dropDb} onChange={(e) => setDropDb(e.target.checked)} />
                  Also delete its database. It is a cache, rebuilt from the notes and the log
                  when the vault is added again.
                </label>
                <div className="controls">
                  <button className="primary" onClick={() => void remove(v.id)}>
                    Remove from list
                  </button>
                  <button onClick={() => setRemoving(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button onClick={onAdd}>Add vault…</button>
      {error && <p className="error inline">{error}</p>}
    </div>
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
 * Which program `o` opens a note in, and whether `o` shows it here first.
 * Choosing an installed editor saves at
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

  /**
   * The viewer (#51) is its own key, so turning it on leaves the editor
   * chosen above in place: that is what `e` opens from the note.
   */
  const viewInside = async (on: boolean): Promise<void> => {
    const r = await window.geode.editorsViewInside(on);
    if (r.ok) setChoices(r.value);
    else setError(r.message);
  };

  if (!choices || picked === null) return error ? <p className="error inline">{error}</p> : null;
  const view = editorView(choices);
  const opener = choices.viewNotesInside ? "e, from the note," : "o";
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
          {/* With the viewer on, the editor is reached with `e` from the note. */}
          {picked === SYSTEM_DEFAULT
            ? `${opener} opens the note at the top, in whatever app opens .md files.`
            : picked === OTHER
              ? "A terminal editor such as vim needs a terminal to run in — the app has none to give it."
              : `${opener} opens the note at the card's line.`}
        </p>
      )}
      <label className="check view-inside">
        <input
          type="checkbox"
          checked={choices.viewNotesInside}
          onChange={(e) => void viewInside(e.target.checked)}
        />
        Read notes inside GeodeMD first
      </label>
      <p className="blocker">
        {choices.viewNotesInside
          ? "o shows the note here, read-only, at the card's line. e from there opens it in the editor above."
          : "Off: o goes straight to the editor above."}
      </p>
    </div>
  );
}
