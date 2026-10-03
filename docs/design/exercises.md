# Exercises

An **exercise** is a note opted in by a `geode-skills` property. A **skill** is what gets a schedule. When a skill comes due, the review asks it with an exercise from its **pool** (every exercise tagged with it), and a different one each time. The decisions and the alternatives are in [ADR 0038](../decisions/0038-exercises.md); the user's side is in [the reviewing guide](../guides/reviewing.md#exercises-a-different-problem-each-time). This page covers how it works now.

Built so far:
- **phase 1**: spot reviews ("which skill does this problem call for?"), served in the normal review queue;
- **phase 2**: solve reviews, one per visit to the Practice tab, timed.

## Reading a note: `parser/exercise.ts`

`parseExercise(text)` is pure, like the rest of the parser. It returns one of four results:

| kind | when | sync does |
|---|---|---|
| `none` | no properties block, no `geode-skills`, or an empty list | nothing, or removes a row the note used to have |
| `exercise` | a list of non-blank strings, and a `## Solution` heading | puts the note in every pool it names |
| `unreadable` | the YAML does not parse, or `geode-skills` is not a list of strings | reports it, and keeps it out of every pool |
| `no-solution` | tagged, but no `## Solution` heading | the same. A spot review would otherwise show the solution |

Details worth knowing:

- **The properties block** is the existing `frontmatterEndOf`: `---` on line 1, closed by a later `---`.
- **Most notes with properties are not exercises.** If the block doesn't contain the text `geode-skills`, the YAML is never parsed. That keeps sync's cost where it was, and keeps a malformed block in an unrelated note from being reported.
- **The YAML library is `yaml`** (eemeli), pinned exactly. It has no dependencies, is safe in the renderer bundle, and doesn't execute custom tags.
- **The title** is the first `# ` heading, or the file name when there is none.
- **The statement** is everything after the title up to the first **spoiler heading**: `## Solution`, `## Intuition`, `## Approach`, `## Hint`, `## Hints` or `## Explanation` ([ADR 0039](../decisions/0039-exercises-after-first-use.md)). Headings are matched case-insensitively, with optional closing `#`s. Headings inside a fenced block don't count. A note still needs `## Solution` itself; a spoiler heading alone is `no-solution`.
- **Nothing is ever written into an exercise note.** No stamp is minted, which is why the card parser's skip list has nothing to guard here.

`EXERCISE_VERSION` works like `CONTEXT_VERSION`. A database recorded under another version makes the next sync read every note once, with no warning, because nothing can be stamped.

## Sync

Each note that sync reads in step 3 is also read as an exercise (`Core.readExercise`). This sits beside steps 4–5, not inside them: there is nothing to defer and no write guard. The note's `exercises` row and its `exercise_skills` rows are replaced whole.

**Most notes cost no write.** If a note isn't an exercise and has no row from before, there's no write and no transaction. One indexed read decides that.

When a file disappears, its exercise rows are pruned with its cards in step 6.

**The summary** gains:
- `exercisesFound`;
- `exercisesUnreadable` and `exercisesWithoutSolution`, with up to ten paths in `exerciseProblemsAt`.

`host`'s `summaryFields` shows them only when non-zero, and `exerciseReason` turns the problems into a sentence with the fix.

## The tables

See [the schema](data-model.md#the-schema):
- `exercises` and `exercise_skills` are derived from the notes;
- `skill_state` and `skill_reviews` are derived from the log.

They are separate from `cards` because a skill has nothing to put in that table's columns: no file, no line, no question or answer, an id that isn't a stamp, and two kinds of review.

**`skill_state` keeps a `learning_steps` column**, so it can use `card_state`'s `CardState` type and the same `fold`. With the skill parameters it is always `0`.

**A skill whose pool is empty is never due.** The due query checks that `exercise_skills` holds the skill, and the schedule is kept, as a card's is ([ADR 0010](../decisions/0010-absence-is-not-deletion.md)).

## The log

Skill reviews go in the same shards as card reviews:

```json
{"skill":"greedy","kind":"spot","exercise":"leetcode/jump-game.md","at":"2026-11-02T08:09:40.551Z","rating":4,"repeat":true}
```

- `repeat` is written only when true. `took` is a solve's length in seconds, and only solve reviews carry it. It is recorded for later analysis, and no rating depends on it: there is no time box.
- Uniqueness is `(skill, kind, at)`.
- Ingest tells the two kinds of line apart by `card` versus `skill`. A line that is neither is a skipped line, as before.
- Replaying skills follows the same two rules as cards: which skills to replay is decided by insertion, and how to replay them is free. The difference is that no row has to exist first.

**The read-position reset.** Ingest skips a line it cannot read and still moves its read position past it. A device on an older build therefore skips another device's skill reviews for good. The `log-reader` key in `meta` names which lines a database's ingest understands. When it differs, every `log_files` row is deleted, so each shard is read once more. `INSERT OR IGNORE` makes the re-read harmless.

## Scheduling

`SKILL_FSRS_PARAMS` is the second pinned parameter set: the cards' FSRS-6 weights with `enable_short_term: false` and no learning or relearning steps. A skill rated anything comes back in days, never in this sitting, so `host/queue.ts` drops it once rated, the same way it drops a graduated card.

`SKILL_SCHEDULER_VERSION` is recorded under `skill-scheduler` in `meta`. A different one makes `adoptScheduler` re-derive every `skill_state` row from its history, in one transaction and with no notice.

## Serving

`Core.getSpotReviews(now, dayStart, limit)` takes the skills due for a spot review: those whose schedule has come due, oldest first, then those never reviewed, by name. For each one, `chooseExercise` ranks the pool:

1. **not served today**, counting any skill and either kind (`last_any >= dayStart`, or chosen earlier in this same call);
2. **still new** (`seen` is 0): not served for this skill and kind, and **not solved for any skill**. A solve shows the solution, so the problem is no longer new to any skill it is tagged with ([ADR 0039](../decisions/0039-exercises-after-first-use.md));
3. **least recently served**, counting any skill, with never-served exercises first;
4. **first by path**.

`chooseExercise` is pure and exported. `store.poolOf` supplies `last_any` and `seen` per exercise. The choice is computed every time and never stored, so a rebuild reproduces it.

`dayStart` is `host`'s `startOfDay(now)`, the start of the local day. `core` reads no timezone.

`Core.getReviewItems` builds a sitting:
1. due cards, with spot reviews mixed in among them;
2. new cards.

**`mixIn`** places them ([ADR 0039](../decisions/0039-exercises-after-first-use.md)). Spot reviews are ordered by a hash of the skill and `dayStart`, and spread evenly through the due cards. In name order, the first spot review of a sitting was always the alphabetically first skill, and the last could be answered by elimination. The hash is FNV-1a, so the order is the same on every machine and every rebuild, and different each day. It reads no randomness, so a sitting is still testable at a given `now`. Which skills are in the sitting, and which exercise each gets, is decided first, exactly as before. Only the order changes.

`limit` applies to the three together. Spot reviews are due, like the first group, and exercises are something the user opted into, unlike a backlog of new cards.

## The review screen

A `SpotReview` sits in the same session as a card, as `ReviewItem = DueCard | SpotReview`, keyed `spot:<skill>`. What differs:

- **What is shown:** the title, the statement rendered as Markdown (sanitised like the note viewer), and `SPOT_PROMPT`. There is no path line, and `locatorFor` hides the note's path until the reveal, because a folder can name the skill.
- **The reveal** puts every skill the exercise names where the `?` was. The rating words are `SPOT_RATING_KEYS`.
- **No annotation:** an annotation is a file named by a card's stamp. `actionsAt(stage, spot)` drops `a`, the session ignores it, and the reveal fetches nothing.
- **`o`** opens the exercise's note. The viewer shows it whole, with no line to find (`Viewer.whole`).
- **Rating** goes over `skills/review`, not `cards/review`, and carries the exercise and the repeat flag. `Rated.next` is the skill's new schedule, which is never inside this sitting.
- **A repeat** shows `repeatText(skill)` on the reveal.

- **After the reveal**, `relatedLines` lists the rest of the pool and, for each of the exercise's other skills, the exercises that share it. Spot reviews and solves both carry these as `related`, worked out when the review is built.
- **The finished screen's tally** counts spot reviews apart (`spotCounts`) and names them in their own words (`sessionBreakdown`).

## The Practice tab

`Core.getSolveReview(now, dayStart)` returns one `SolveReview`: the skill whose solve is most overdue (never-solved skills after those, by name), asked with the exercise `chooseExercise` picks for `solve`. It returns null when no skill is due for a solve. Spot and solve schedules are separate. A spot review shows no solution, so having spotted an exercise doesn't use it up for a solve; having solved it uses it up for everything.

The screen's decisions are in `renderer/model/practice.ts`, a pure state machine:
- **`solving`**: the clock runs from the offer.
- **`solved`**: Space or Enter stopped the clock, and the note was read with `note/read`.
- **`saving`**, then **`done`**: a rating was sent over `skills/review` with `kind: "solve"` and `took`. After that, nothing more is offered until the next visit.
- **`left`**: `q` was pressed, and nothing was recorded.

**A solve outlives the screen.** Each screen is mounted only while it shows, so the model is held by `App` (`heldSolve`), tagged with its vault, and `resumable` decides whether returning to the tab picks it up: yes while `solving`, `solved` or `saving`, no once `done` or `left`. The clock runs from the offer, so time spent on another tab counts, which is right: it measures the solve, not the screen. A note or a rating that arrives after the tab changed lands in the held model. One that arrives after a vault switch finds nothing held for it and is dropped (#81).

**Escape does nothing on Practice.** It is the key a hand reaches for without thinking, and here it would discard the solve. Leaving takes `q`.

A failed rating goes back to `solved`, so it can be given again. The keys and their stages are `host`'s `PRACTICE_KEYS` and `interpretPracticeKey`, and the words are `SOLVE_RATING_KEYS`, `clockText` and `nextSolveText`.

**The clock redraws every second**, which is the one exception to the app's no-timer habit. It is safe for the reason `IdleCheck`'s is: nothing it draws changes what is on screen, and `took` is read on the keypress, not from the drawing.

Stats shows "skills to solve" beside "skills to spot" when either is non-zero. Solves are left out of the review backlog, because they are offered one at a time.

The self-test checks all of this whenever the folder it drives holds an exercise. Without one, these checks report as skipped.
