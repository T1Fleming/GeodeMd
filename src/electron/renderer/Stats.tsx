/**
 * What is in the collection, and what is waiting.
 *
 * Four numbers, and the split between two of them is the whole reason this
 * screen is not one number: `due` is an instant, so "due today" is ambiguous.
 * **Due now** is the actionable count and gets the emphasis; *before midnight*
 * is a forecast and is deliberately quieter.
 */

import { useCallback, useEffect, useState } from "react";
import { countText } from "../../host/present.js";
import type { Stats as StatsData } from "../ipc.js";

export function Stats(): React.JSX.Element {
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
            host's, so this screen and `geode stats` say it the same way. The
            total is the one figure that is never capped. */}
        <Tile value={countText(data.dueNow)} label="due now" strong />
        <Tile value={countText(data.newCards)} label="new" strong />
        <Tile value={countText(data.dueBeforeMidnight)} label="due before midnight" />
        <Tile value={String(data.total)} label="cards in total" />
      </div>
      <p className="muted lead">
        {data.dueNow + data.newCards > 0
          ? `${countText(data.dueNow + data.newCards, data.capped)} waiting for you.`
          : "Nothing waiting. New cards appear here after a sync."}
      </p>
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
