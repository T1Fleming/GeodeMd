/**
 * Loads a queue and hands it to the review screen. Everything it knows about
 * the backend goes through `window.geode`, which is the preload's bridge — the
 * renderer imports no Node, no Electron and no `core`.
 */

import { useCallback, useEffect, useState } from "react";
import type { DueCard } from "../../core/index.js";
import type { GeodeApi } from "../ipc.js";
import { Review } from "./Review.js";
import type { Session } from "./model/session.js";

declare global {
  interface Window {
    geode: GeodeApi;
  }
}

type Screen =
  | { at: "loading" }
  | { at: "error"; message: string }
  | { at: "empty"; total: number }
  | { at: "review"; queue: DueCard[]; backlog: number };

const LIMIT = 50;

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ at: "loading" });
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setScreen({ at: "loading" });
    const [due, stats] = await Promise.all([
      window.geode.cardsDue(LIMIT),
      window.geode.statsRead(),
    ]);
    if (!due.ok) return setScreen({ at: "error", message: due.message });
    if (!stats.ok) return setScreen({ at: "error", message: stats.message });

    const backlog = stats.value.dueNow + stats.value.newCards;
    if (due.value.length === 0) return setScreen({ at: "empty", total: stats.value.total });
    setScreen({ at: "review", queue: due.value, backlog });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRate = useCallback(async (cardId: string, rating: 1 | 2 | 3 | 4) => {
    const r = await window.geode.cardsReview(cardId, rating);
    if (r.ok && r.value.applied === "log-only") {
      // Not a failure: the rating is already fsynced to the log and the next
      // ingest reconciles the row. A dialog here would be a lie.
      setNote("saved — the database was busy and will catch up");
    } else if (!r.ok) {
      setNote(r.message);
    }
  }, []);

  const onOpen = useCallback((_card: DueCard) => {
    // Not wired yet: opening a note needs its own spawn in main, because the
    // CLI's uses stdio:"inherit" and a GUI must not.
    setNote("opening notes from the app is not wired up yet");
  }, []);

  const onDone = useCallback((_s: Session) => {}, []);

  return (
    <div className="app">
      {screen.at === "loading" && <p className="muted">loading…</p>}
      {screen.at === "error" && <p className="error">{screen.message}</p>}
      {screen.at === "empty" && (
        <main className="review done">
          <h2>Nothing due</h2>
          <p className="muted">
            {screen.total} cards in the collection. Run <code>geode sync</code> after writing more.
          </p>
        </main>
      )}
      {screen.at === "review" && (
        <Review
          queue={screen.queue}
          backlog={screen.backlog}
          onRate={onRate}
          onOpen={onOpen}
          onDone={onDone}
        />
      )}
      {note && (
        <div className="toast" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
    </div>
  );
}
