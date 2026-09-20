/**
 * What is in the collection, and what is waiting.
 *
 * Four numbers, and the split between two of them is the whole reason this
 * screen is not one number: `due` is an instant, so "due today" is ambiguous.
 * **Due now** is the actionable count and gets the emphasis; *before midnight*
 * is a forecast and is deliberately quieter.
 */

import { useCallback, useEffect, useState } from "react";
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
        <Tile value={data.dueNow} label="due now" strong />
        <Tile value={data.newCards} label="new" strong />
        <Tile value={data.dueBeforeMidnight} label="due before midnight" />
        <Tile value={data.total} label="cards in total" />
      </div>
      <p className="muted lead">
        {data.dueNow + data.newCards > 0
          ? `${data.dueNow + data.newCards} waiting for you.`
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
  value: number;
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
