# 0041 — An exercise has an id, written into its properties

- **Status:** Accepted. Supersedes parts of [ADR 0038](0038-exercises.md), named below. How it works now is in [`design/exercises.md`](../design/exercises.md)
- **Date:** 2026-10-03

## Context

ADR 0038 identified an exercise by its path, and wrote nothing into an exercise note: "No stamp is minted, so the false-positive stamp the parser's skip list exists to prevent cannot happen. A skill is identified by its tag, and an exercise by its path."

A path is not stable. Moving or renaming a note is ordinary housekeeping, and an exercise's history (which skills served it, and whether it was solved) is what the serving rule ranks by. After a move, the note loses that history: a problem already solved is served as new, which undoes ADR 0039's "a solved exercise is used up". Cards don't have this problem, because their stamp travels with the line, which is how sync tells a moved card from a new one.

The false-positive worry doesn't apply here. An exercise is opted in by an explicit `geode-skills` property, so there's no guessing about which notes are exercises.

## Decision

### The id

- **A `geode-id` property** in the note's properties, holding an id in the cards' format: `sr-` and twelve letters or digits, minted by the same generator.
- **Prefixed like `geode-skills`**, so it claims no name a user might want, and Obsidian's Properties panel shows it as an ordinary text property.
- **Minted by sync, once,** for a note that is a servable exercise (`geode-skills` and a `## Solution`). A note that is unreadable or has no solution gets no id until it's fixed.
- **Written as a line, never by re-serialising the YAML.** An existing `geode-id:` line has its value replaced. Otherwise a new line goes just before the closing `---`, with the block's own line ending. The rest of the block is left byte for byte, so your formatting, comments and key order survive.
- **The same safety rules as a card stamp:**
  - never within the two-second deferral window;
  - written only if the file is unchanged since it was read;
  - counted in the preview's "notes would be edited".
- **A copy is re-minted.** When two notes carry one id, the one whose stored path still holds it keeps it, and the copy gets a fresh one, as for cards.
- **A hand-edited invalid value** (`geode-id: foo`) is replaced with a fresh id rather than reported. The id is GeodeMD's to manage, and a second `geode-id` key would make the YAML unreadable.

### What it identifies

Supersedes ADR 0038's "an exercise by its path".

- **New log lines carry the id** as `exercise`. The path is still how the note is opened, and the database keeps both.
- **Old log lines carry a path.** They stay as written: the log is append-only and is never rewritten. An old line matches an exercise while the note is still at that path. A note moved before its first id-bearing review loses the history in those old lines, which is the old behaviour, now limited to history from before this change.
- **Matching happens when the pool is ranked, not at ingest.** A path in an old line is never resolved to an id and stored. If it were, a rebuild after the note moved would resolve it differently from the database it rebuilt, and the rebuild would no longer be exact.

### The first sync after upgrading

Every existing exercise note gets an id, which is a write into the user's notes. As with a change of card syntax ([ADR 0031](0031-forward-cards-and-context.md)), the app says so when it opens a vault whose exercises have no ids yet, and takes the user to Sync to preview it first. `EXERCISE_VERSION` goes to `3`, so that sync reads every note.

### Skills are still identified by their tag

Renaming a skill (`queue-decoupling` to `queues`) still starts a new skill with no history, and leaves the old one's schedule kept but never due. That's accepted. Adding and removing tags, the common case, works as before: a removed tag takes the note out of that pool, and a skill whose pool empties keeps its schedule ([ADR 0010](0010-absence-is-not-deletion.md)) until a note names it again. The guide says so. Aliases for renamed skills can come later if renaming turns out to matter.

## Alternatives

- **Keep paths, and document "don't move exercise notes".** It leaves a trap that undoes the used-up rule silently.
- **Detect a move by content**, matching title and statement across paths. It's a guess: editing the statement and moving the note in one go would lose the history anyway, and two similar problems could be confused.
- **An id in an HTML comment**, like a card's stamp. An exercise's identity belongs to the note, not to a line, and the properties block is where a note says things about itself. Obsidian shows it there and keeps it out of the rendered note.
- **Resolve old path lines to ids at ingest.** Not reproducible by a rebuild once a note has moved; see above.
- **Skill aliases now** (`geode-skills-was`). Deferred: renaming skills looks rare next to adding and removing them.

## Consequences

- An exercise note is the first note GeodeMD edits outside a card line, and only inside the properties block, by one line.
- `exercises` gains an `id` column; `skill_reviews.exercise` holds an id or, for old lines, a path.
- Moving or renaming an exercise note keeps its history from the first id-bearing review on.
