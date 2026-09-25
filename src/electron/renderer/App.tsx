/**
 * The shell: which screen is showing, and the one piece of state that outlives
 * a screen — the quiet note at the bottom.
 *
 * Everything it knows about the backend goes through `window.geode`, which is
 * the preload's bridge: the renderer imports no Node, no Electron and no
 * `core`.
 */

import { useCallback, useEffect, useState } from "react";
import type { DueCard } from "../../core/index.js";
import type { AppConfig, GeodeApi, VaultList } from "../ipc.js";
import { Help } from "./Help.js";
import { Review } from "./Review.js";
import { Setup } from "./Setup.js";
import { Stats } from "./Stats.js";
import { Sync } from "./Sync.js";
import type { Session } from "./model/session.js";
import { choose, leftNote, switcherOptions } from "./model/vaults.js";
import type { Scheduled } from "../../host/queue.js";
import { backlogCapped, rescheduledText } from "../../host/present.js";

declare global {
  interface Window {
    geode: GeodeApi;
  }
}

type Tab = "review" | "sync" | "stats" | "help";

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["review", "Review"],
  ["sync", "Sync"],
  ["stats", "Vault"],
  ["help", "Help"],
];

/**
 * What the app is doing before it is doing anything.
 *
 * `setup` and `repair` are told apart on purpose. Both arrive as "no usable
 * collection", and giving them the same screen would greet someone who has
 * used the app for a year as though they had just installed it — when all
 * that happened is an external drive is unplugged.
 *
 * `change` is the third way into the same sequence: a working config the user
 * has asked to point somewhere else (#43). `add` is the fourth: a new vault
 * beside the open one, whose first sync needs the same preview (ADR 0027).
 */
type Boot =
  | { at: "checking" }
  | { at: "setup" }
  | { at: "repair"; config: AppConfig }
  | { at: "change"; config: AppConfig }
  | { at: "add"; config: AppConfig }
  | { at: "ready"; config: AppConfig }
  | { at: "error"; message: string };

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("review");
  const [note, setNote] = useState<string | null>(null);
  const [boot, setBoot] = useState<Boot>({ at: "checking" });
  const [vaults, setVaults] = useState<VaultList | null>(null);

  const check = useCallback(async () => {
    setBoot({ at: "checking" });
    const c = await window.geode.configRead();
    // `no-config` is an ordinary first run, not a failure. Deciding that by
    // catching an error is how a disk problem eventually shows onboarding.
    if (!c.ok) {
      return setBoot(
        c.kind === "no-config" ? { at: "setup" } : { at: "error", message: c.message },
      );
    }
    if (c.value === null) return setBoot({ at: "setup" });
    const list = await window.geode.vaultsList();
    setVaults(list.ok ? list.value : null);

    // A config whose notesPath has gone is routine on a desktop — the folder
    // moved, or a drive is unmounted — and it is NOT a first run.
    const folder = await window.geode.setupInspect(c.value.notesPath);
    if (!folder.ok) return setBoot({ at: "error", message: folder.message });
    if (!folder.value.exists || !folder.value.isDirectory) {
      return setBoot({ at: "repair", config: c.value });
    }

    // Open the vault before any screen reads it. If the scheduler changed since
    // this database was last opened, every due date was just worked out again
    // (ADR 0028), and the user hears why before seeing a queue that moved.
    const opened = await window.geode.vaultsOpen();
    if (!opened.ok) setNote(opened.message);
    else if (opened.value.rescheduled) setNote(rescheduledText(opened.value.rescheduled));
    setBoot({ at: "ready", config: c.value });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Open another vault. Every screen is remounted by the re-check, so each
   * reads the new vault from scratch — nothing drawn for the old one
   * survives. A review in progress simply ends: every rating was recorded
   * when it was given, and main answers the end-of-session question for the
   * vault being left.
   */
  const switchTo = useCallback(
    async (id: string) => {
      const r = await window.geode.vaultsSwitch(id);
      if (!r.ok) return setNote(r.message);
      setNote(leftNote(r.value.left, vaults));
      await check();
    },
    [check, vaults],
  );

  const onVault = useCallback(
    (value: string) => {
      if (!vaults || boot.at === "checking" || boot.at === "setup" || boot.at === "error") return;
      const c = choose(vaults, value);
      if (c.kind === "switch") void switchTo(c.id);
      if (c.kind === "add") setBoot({ at: "add", config: boot.config });
    },
    [vaults, boot, switchTo],
  );

  if (boot.at === "checking") return <p className="muted">loading…</p>;
  if (boot.at === "error") return <p className="error">{boot.message}</p>;
  if (boot.at === "setup" || boot.at === "repair" || boot.at === "change" || boot.at === "add") {
    return (
      <div className="app">
        {/* A vault whose folder has gone must not trap the user in it: the
            other vaults are one choice away. Not offered mid-change or
            mid-add, where Cancel is the way out and puts things back. */}
        {boot.at === "repair" && vaults && vaults.vaults.length > 1 && (
          <nav className="tabs">
            <VaultMenu list={vaults} onChoose={onVault} allowAdd={false} />
          </nav>
        )}
        <Setup
          // A fresh sequence for each way in, never one carried across.
          key={boot.at === "setup" ? "setup" : `${boot.at}-${boot.config.id}`}
          from={
            boot.at === "setup"
              ? null
              : { reason: boot.at, notesPath: boot.config.notesPath, vault: boot.config.id }
          }
          onReady={() => {
            setTab("review");
            void check();
          }}
          // Re-read rather than restore the old state: the config was written
          // back on the way out, and reading it is how that gets confirmed.
          onCancel={() => void check()}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={id === tab ? "tab on" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        {vaults && <VaultMenu list={vaults} onChoose={onVault} allowAdd />}
      </nav>

      {/* Each screen is mounted only while it is showing, which is what makes
          the review screen's document-level key handler safe: it cannot still
          be listening while you are on another tab. It also means leaving
          review and coming back draws a fresh queue — no position is kept, and
          none needs to be, because every rating was recorded when it was
          given. */}
      {tab === "review" && <ReviewScreen onNote={setNote} />}
      {tab === "sync" && <Sync />}
      {tab === "stats" && vaults && (
        <Stats
          config={boot.config}
          vaults={vaults}
          onChangeFolder={() => setBoot({ at: "change", config: boot.config })}
          onAddVault={() => setBoot({ at: "add", config: boot.config })}
          onSwitch={(id) => void switchTo(id)}
          onVaults={setVaults}
        />
      )}
      {tab === "help" && <Help />}

      {note && (
        <div className="toast" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * The switcher: the open vault's name, always in the tab bar, and every other
 * vault one choice away. A plain `<select>`, blurred after each choice so the
 * review screen's document-level keys are not typed into it.
 */
function VaultMenu({
  list,
  onChoose,
  allowAdd,
}: {
  list: VaultList;
  onChoose: (value: string) => void;
  allowAdd: boolean;
}): React.JSX.Element {
  const options = switcherOptions(list).filter((o) => allowAdd || list.vaults.some((v) => v.id === o.value));
  return (
    <label className="vault-menu">
      <span className="label">Vault</span>
      <select
        value={list.active}
        onChange={(e) => {
          const value = e.target.value;
          e.target.blur();
          onChoose(value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type Screen =
  | { at: "loading" }
  | { at: "error"; message: string }
  | { at: "empty"; total: number }
  | { at: "review"; queue: DueCard[]; backlog: number; capped: boolean };

/**
 * How many cards one sitting materialises.
 *
 * A cap rather than a preference: the queue is fetched in full, and at a million
 * cards materialising the backlog would be the expensive part of the session
 * (see [review-flow](../../../docs/design/review-flow.md)). The CLI let you ask
 * for more with `-n 200`; what replaced it is the "review more" button on the
 * finished screen, which fetches the next batch instead of a bigger one.
 */
const LIMIT = 50;

function ReviewScreen({ onNote }: { onNote: (m: string) => void }): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ at: "loading" });
  /** Notes edited during the session. Null until the session ends. */
  const [stale, setStale] = useState<string[] | null>(null);
  /**
   * Bumped for each sitting, and used as the `Review` component's `key`.
   *
   * Without it a second sitting would draw against the first session's state:
   * `begin(queue)` runs in a `useState` initialiser, which React does not re-run
   * for a component it is reusing. The key is what makes "review more" a new
   * session rather than a new queue inside an old one.
   */
  const [sitting, setSitting] = useState(0);

  const load = useCallback(async () => {
    setScreen({ at: "loading" });
    setStale(null);
    setSitting((n) => n + 1);
    const [due, stats] = await Promise.all([
      window.geode.cardsDue(LIMIT),
      window.geode.statsRead(),
    ]);
    if (!due.ok) return setScreen({ at: "error", message: due.message });
    if (!stats.ok) return setScreen({ at: "error", message: stats.message });

    // A floor when the due count stopped at the cap (ADR 0024); the chip says so.
    const backlog = stats.value.dueNow + stats.value.newCards;
    if (due.value.length === 0) return setScreen({ at: "empty", total: stats.value.total });
    setScreen({ at: "review", queue: due.value, backlog, capped: backlogCapped(stats.value) });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Record a rating, and hand back what the scheduler decided.
   *
   * The return value is what lets the session honour FSRS's short-term steps
   * (ADR 0023): a new card rated anything but *easy* is due again in minutes
   * and comes back in this sitting. Null means the new state is not known —
   * the write failed, or the database was busy — and the card simply does not
   * return today. The rating itself is safe in the log either way.
   */
  const onRate = useCallback(
    async (cardId: string, rating: 1 | 2 | 3 | 4): Promise<Scheduled | null> => {
      const r = await window.geode.cardsReview(cardId, rating);
      if (!r.ok) {
        onNote(r.message);
        return null;
      }
      if (r.value.applied === "log-only") {
        // Not a failure: the rating is already fsynced to the log and the next
        // ingest reconciles the row. A dialog here would be a lie.
        onNote("saved — the database was busy and will catch up");
      }
      return r.value.next;
    },
    [onNote],
  );

  const onOpen = useCallback(
    async (card: DueCard) => {
      // Main does the spawn — detached, so the app is not held open by an
      // editor the user leaves running. Nothing here waits for it to close.
      const r = await window.geode.noteOpen(card.filePath, card.lineNo);
      // A failure is a dim note, not a dialog: not being able to open a note
      // is no reason to lose the session.
      if (!r.ok) onNote(r.message);
    },
    [onNote],
  );

  /**
   * At the end of the session, ask which of the opened notes actually changed.
   *
   * Once, at the end — not per card. Only a terminal editor holds the process
   * until you quit it; `code`, `subl` and every OS opener return in
   * milliseconds, so checking around the open would report nothing in exactly
   * the setup where the user is most likely to still be typing (ADR 0012).
   */
  const onDone = useCallback((s: Session) => {
    if (s.opened.length === 0) return setStale([]);
    void window.geode.noteChanged(s.opened).then((r) => {
      // Fall back to the paths that were opened: a failed check should still
      // say something, because the queue really is a snapshot either way.
      setStale(r.ok ? r.value : [...s.opened]);
    });
  }, []);

  if (screen.at === "loading") return <p className="muted">loading…</p>;
  if (screen.at === "error") return <p className="error">{screen.message}</p>;
  if (screen.at === "empty") {
    return (
      <main className="review done">
        <h2>Nothing due</h2>
        <p className="muted">
          {screen.total} cards in this vault. Sync after writing more.
        </p>
      </main>
    );
  }

  return (
    <Review
      key={sitting}
      queue={screen.queue}
      backlog={screen.backlog}
      backlogCapped={screen.capped}
      stale={stale}
      onRate={onRate}
      onOpen={onOpen}
      onDone={onDone}
      // Offered only when the collection holds more than this sitting served —
      // the same condition as the backlog chip, and the replacement for the
      // CLI's `-n` (ADR 0025).
      onMore={screen.backlog > screen.queue.length ? () => void load() : undefined}
    />
  );
}
