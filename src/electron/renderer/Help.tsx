/**
 * The documentation, inside the app.
 *
 * [ADR 0018](../../../docs/decisions/0018-user-docs-live-in-guides-and-reference.md)
 * chose plain Markdown in the repository and named the gap it did not close:
 * someone who installs a `.app` has no reason to ever visit GitHub and no way
 * to find out what `::` means. This closes it **without a second copy** — the
 * files rendered here are `docs/guides/` and `docs/reference/` verbatim,
 * copied into the bundle at build time. One source, two surfaces.
 *
 * Only the user-facing sets are bundled. `design/` and `decisions/` are
 * contributor material, and shipping them here is how a Help window becomes
 * something nobody reads.
 */

import { useCallback, useEffect, useState } from "react";
import { marked } from "marked";

interface Entry {
  set: string;
  file: string;
  title: string;
}

export function Help(): React.JSX.Element {
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("./docs/index.json")
      .then((r) => r.json() as Promise<Entry[]>)
      // The README is the index of the guides directory; in here the list on
      // the left IS that index, so showing it too would be the same thing twice.
      .then((all) => setIndex(all.filter((e) => !e.file.endsWith("README.md"))))
      .catch(() => setError("The documentation did not ship with this build."));
  }, []);

  const show = useCallback(async (file: string) => {
    setOpen(file);
    const body = await fetch(`./docs/${file}`).then((r) => r.text());
    setHtml(await marked.parse(body, { gfm: true }));
  }, []);

  useEffect(() => {
    if (index && index.length > 0 && open === null) void show(index[0]!.file);
  }, [index, open, show]);

  /**
   * Links, which the Markdown was written for GitHub rather than for here.
   *
   * Intercepted at the container rather than rewritten in the HTML: a relative
   * link to a doc that IS bundled navigates inside this window, and anything
   * else — an ADR, a design doc, a real URL — opens in the browser. Left
   * alone, a relative link would try to navigate the `app://` page away from
   * the renderer and leave the user in a broken window with no way back.
   */
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      e.preventDefault();

      if (href.startsWith("#")) return; // an in-page anchor; let it be

      const internal = index?.find((entry) => href.endsWith(entry.file.split("-").slice(1).join("-")));
      if (internal && !href.startsWith("http")) {
        void show(internal.file);
        return;
      }
      void window.geode.linkOpen(href);
    },
    [index, show],
  );

  if (error) return <p className="error">{error}</p>;
  if (!index) return <p className="muted">loading…</p>;

  return (
    <main className="screen help">
      <nav className="doclist">
        {index.map((e) => (
          <button
            key={e.file}
            className={e.file === open ? "doclink on" : "doclink"}
            onClick={() => void show(e.file)}
          >
            {e.title}
          </button>
        ))}
      </nav>
      {/*
        The Markdown is ours, shipped in the bundle — not user content — so
        this is not an injection surface. If a note's text is ever rendered
        this way that stops being true, and it would need sanitizing first.
      */}
      <article className="doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
