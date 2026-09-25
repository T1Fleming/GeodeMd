/**
 * A note, rendered for the viewer — and sanitised, because a note is user
 * content and this is the one place the window draws HTML it did not write
 * (#51).
 *
 * `Help.tsx` renders Markdown unsanitised, and says why that is safe: the
 * input is our own documentation, shipped in the bundle. A note is not. A
 * notes folder is often synced or shared, so a note can hold anything anyone
 * with write access to that folder put there. Three locks, each enough on its
 * own for the obvious attacks, so a gap in one is not a hole:
 *
 * 1. **DOMPurify** over `marked`'s output, before it reaches the DOM: no
 *    `<script>`, no `on*` attribute, no `javascript:` URL, no `<style>` or
 *    `style=` (which could draw over the app's own controls), no `<form>`
 *    and no `<button>`, which a note has no use for and which could pass for
 *    one of the app's own.
 * 2. **The CSP** in `index.html`, `default-src 'self'`, unchanged: an inline
 *    script or handler that got through would still not run.
 * 3. **Main refuses navigation** (`will-navigate`, `setWindowOpenHandler`):
 *    a link is opened through `link/open`, which hands only http(s) to the
 *    shell, and never by navigating the window.
 */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { noteMarkdown } from "../../host/note.js";

const PURIFY = {
  // HTML only: no SVG or MathML, which a note has no use for and which have
  // their own history of sanitiser bypasses.
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "form", "button"],
  FORBID_ATTR: ["style"],
};

export interface RenderedNote {
  /** Sanitised. Safe for `dangerouslySetInnerHTML`. */
  html: string;
  /** The id of the card's `<mark>`, to scroll to; absent from `html` when `line` was null. */
  markerId: string;
}

/**
 * Render a note's text, marking the card's `line` (1-based; null for none).
 *
 * `breaks: true` because a note that lists cards one per line is the common
 * case, and without it consecutive card lines join into one paragraph and the
 * highlight lands in the middle of a run of text. Obsidian renders a single
 * newline the same way by default.
 *
 * The marker id carries a random part so a note cannot plant an element with
 * the same id ahead of the card and take the scroll.
 */
export function renderNote(text: string, line: number | null): RenderedNote {
  const markerId = `geode-card-${Math.random().toString(36).slice(2, 10)}`;
  const markdown = noteMarkdown(text, line, markerId);
  const raw = marked.parse(markdown, { gfm: true, breaks: true, async: false }) as string;
  return { html: DOMPurify.sanitize(raw, PURIFY), markerId };
}

/**
 * What a click on a link in a note does: an http(s) link opens in the
 * browser, and anything else does nothing. `link/open` would resolve a
 * relative link against the documentation's repository, which is right for
 * Help and meaningless for a note.
 */
export function linkTarget(href: string | null): string | null {
  if (href === null) return null;
  return /^https?:\/\//i.test(href) ? href : null;
}
