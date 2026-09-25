/**
 * A card's note, shown inside the app rather than handed to an editor (#51).
 *
 * The decisions, with no DOM and no filesystem: what the Markdown looks like
 * before it is rendered, and what to say when the card is no longer where the
 * last sync left it. Whether `o` means the viewer at all is the config's
 * `viewNotesInside` key (`host/config.ts`). The renderer imports
 * this file, so it must stay free of any runtime import that is not pure —
 * `parser` is, which is why the stamp's shape and the list marker come from
 * there rather than being written a second time.
 *
 * Rendering and sanitising are the renderer's (`renderer/note.ts`): they need
 * a DOM. See `docs/design/app.md`, "A note is user content".
 */

import { frontmatterEndOf, LIST_MARKER, readStamp, splitLines } from "../parser/index.js";

/**
 * The note's Markdown as the viewer renders it.
 *
 * - **Stamps come off every line.** `<!-- sr-… -->` is invisible in rendered
 *   HTML already, but it is ours rather than the user's, and a viewer that
 *   relied on the renderer to hide it would show it the day a card line lands
 *   inside something rendered literally.
 * - **Frontmatter comes off.** Rendered as Markdown it is a rule and a
 *   heading made of YAML, which is noise between the user and the card.
 * - **The card's line is wrapped in a `<mark>`** with `markerId`, after any
 *   list marker, so the renderer can scroll to it and draw it highlighted.
 *   That works because of the parser's skip list: a card is never read from
 *   a code block, a table, a blockquote, a heading or frontmatter, so its line
 *   is always paragraph or list-item text, where inline HTML is honoured.
 *
 * `line` is 1-based and is where the card was *found* on disk, not where the
 * last sync stored it (see `cardLineNote`); null marks nothing. Lines keep
 * their own terminators, so line numbers in and out are the same.
 */
export function noteMarkdown(text: string, line: number | null, markerId: string): string {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(markerId)) throw new Error(`not a marker id: ${markerId}`);
  const lines = splitLines(text);
  const frontmatter = frontmatterEndOf(lines);

  return lines
    .map((raw, i) => {
      const terminator = /\r?\n$/.exec(raw)?.[0] ?? "";
      if (i <= frontmatter) return terminator;
      let body = raw.slice(0, raw.length - terminator.length);
      const stamp = readStamp(body);
      if (stamp) body = stamp.rest.replace(/[ \t]+$/, "");
      if (line === null || i !== line - 1) return body + terminator;

      const indent = /^[ \t]*/.exec(body)![0];
      const rest = body.slice(indent.length);
      const marker = LIST_MARKER.exec(rest)?.[0] ?? "";
      const content = rest.slice(marker.length);
      return `${indent}${marker}<mark id="${markerId}">${content}</mark>${terminator}`;
    })
    .join("");
}

/**
 * What the viewer says about where the card is, or null when it is where the
 * last sync left it.
 *
 * The note on screen is read from disk now; the card came from the last sync.
 * If the note was edited in between, the stored line may hold something else,
 * and highlighting it would point at the wrong text with confidence. So the
 * card is found by its stamp, not by its line number, and:
 *
 * - found on another line → highlighted there, and this says it moved;
 * - not found → **nothing is highlighted**, and this says why.
 */
export function cardLineNote(stored: number | null, found: number | null): string | null {
  if (found === null) {
    return "This card is not in the note as it is now — it was edited or removed after the last sync, so nothing is highlighted.";
  }
  if (stored !== null && found !== stored) {
    return `The note has changed since the last sync: this card is now on line ${found}, not ${stored}.`;
  }
  return null;
}
