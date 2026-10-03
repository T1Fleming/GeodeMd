# 0038 — Exercises: schedule the skill, serve a different problem each time

- **Status:** Accepted. Not built yet: phase 1 (skills, pools, spot reviews) and phase 2 (solve reviews) are tracked in [#77](https://github.com/T1Fleming/GeodeMd/issues/77)
- **Date:** 2026-10-02

## Context

Every card is a fact you recall in seconds. Some things worth practising are not like that: a LeetCode problem, a system design question. What you practise one for is solving a problem you have **not** seen. Put on a card, such a problem fails three ways. You learn *that* problem's answer, so the card stops measuring the skill. Rating it measures familiarity (Kornell & Bjork 2008). And the answer is a page, not a line.

The research in #77 points one way. Practise on varied problems, not the same one repeated (Butler et al. 2017). Mix problem types so that choosing the method is part of the practice (Rohrer & Taylor 2007; Brunmair & Richter 2019). Math Academy applies this at scale: it schedules a topic and picks a problem from that topic's pool.

Until this is built, `docs/guides/reviewing.md` ("Practising problems, not facts") tells users to take a problem apart into ordinary cards about its method.

## Decision

### What is scheduled

- **A skill** has the schedule, e.g. `monotonic-stack`. It has **two FSRS states**, one per kind of review (spot and solve), because recognising what a problem calls for and carrying it out are different abilities.
- **An exercise** is one note: one problem.
- **A skill's pool** is every exercise tagged with it.
- When a skill comes due, GeodeMD serves an exercise from its pool, and the log records which one. The next review of that skill serves a different exercise.

The word is **skill**. "Concept" is reserved for RemNote's Concept card ([ADR 0031](0031-forward-cards-and-context.md)). "Pattern" and "technique" were also considered. "Skill" is the broadest, and it is used everywhere: property, tables, log lines, UI. The spot prompt is "Which skill does this call for?".

### How a note becomes an exercise

A note is an exercise when, and only when:
- it is a `.md` note sync already reads;
- it has a closed properties (frontmatter) block on line 1;
- that block has **`geode-skills`** holding a **non-empty list of strings**.

```yaml
---
form: exercise                         # the user's own; GeodeMD never reads it
geode-skills: [two-pointers, greedy]   # the only switch
source: https://leetcode.com/problems/container-with-most-water/
---
```

- **The properties are flat.** Obsidian's Properties panel does not support nested properties, so a nested `geode:` block could only be edited in source mode.
- **There is one switch.** GeodeMD ignores `form` and any other key, so a user's own `form: exercise` stays free for filtering. Requiring both would allow notes that contradict themselves.
- **`source` has no prefix**, because Obsidian Web Clipper's default template already writes it. GeodeMD shows it as a link and never acts on it.
- **The statement** runs from after the first `# ` heading to a **`## Solution`** heading. The heading text is matched case-insensitively, and trailing spaces are ignored. The title is that `# ` heading, or the filename.
- **A note with `geode-skills` but no `## Solution` heading is reported in the sync summary and left out of every pool.** If the whole body were treated as the statement, a spot review would show the solution.
- **Unreadable properties** (malformed YAML, or `geode-skills` not a list of strings) are a reported outcome, not an error. An empty list is not an exercise and is not reported.
- **Nothing is written into the note.** No stamp is minted, so the false-positive stamp the parser's skip list exists to prevent cannot happen. A skill is identified by its tag, and an exercise by its path.

### Two kinds of review, and what each rating means

|  | spot (~30 s, in the normal queue) | solve (Practice screen, one per sitting) |
|---|---|---|
| shown | title and statement, with no breadcrumb and no skills | the same, plus a running timer |
| revealed | all of the exercise's skills | the whole note, in the note viewer |
| `1` | wrong skill | couldn't solve it |
| `2` | right, after hesitating | solved with help (a hint or a peek) |
| `3` | right | solved on my own |
| `4` | right, at once | solved on my own, easily |

- **The labels are `host`'s**, beside `RATING_KEYS`.
- **There is no time box.** The user chooses between solve `3` and `4`. Two other designs were considered: a fixed 30-minute limit, and a per-note `geode-timebox`. The line between `2` and `3` is observable (you either needed help or you didn't). The line between `3` and `4` is the user's judgement. The time each solve took is logged as `took`, so this can be revisited with data.
- **Practice offers the most overdue solve**, which matches how cards are ordered.

### Which exercise is served

When a skill comes due for one kind, rank its pool:

1. **Not served today.** This counts any skill and either kind. "Today" is the local calendar day. `host` works out its start and passes it into `core`, the same way `now` is passed.
2. **Not yet served for this skill and kind.** A spot review shows no solution, so it doesn't use up the exercise for a solve review.
3. **Least recently served**, counting any skill.
4. **First by path.**

Step 1 exists because an exercise with two skills can be served by two schedules. Without it, you could be asked to spot an exercise for `monotonic-stack` an hour after solving it for `two-pointers`. [ADR 0033](0033-a-card-is-never-shown-early.md) stopped early re-shows of cards for the same reason. The length of the window is a judgement, not something a source gives.

### Exercises with several skills

- **Only the skill that came due is rated.** If credit to the exercise's other skills ever comes, it is a rule pinned in code and applied on replay. It is never extra log lines.
- **In a spot review, naming any of the exercise's skills is right.** The reveal shows them all. This weakens the test of each skill, and that is accepted. The guide must tell users to tag only skills the note genuinely uses.
- **A serve is a repeat** only when this skill has already served this exercise for this kind. A repeat is logged with `"repeat":true`, and the screen suggests adding an exercise to the pool. **A repeat's grade is not capped.**
- **After the reveal**, the screen lists the other exercises in the pool, and for each of the exercise's other skills, which exercises share it.

### Scheduling

- **A second pinned parameter set** ([ADR 0007](0007-pin-fsrs-parameters-in-source.md)): the same FSRS-6 weights as cards ([ADR 0028](0028-move-to-fsrs-6.md)), with no learning steps and `enable_short_term: false`. It has its own `meta` version key, so changing it re-derives `skill_state`.
- **A skill whose pool is empty is never due.** Its state is kept ([ADR 0010](0010-absence-is-not-deletion.md)).
- **Scheduling a skill rather than a fixed item is untested for FSRS.** Treat it as a first approximation, to be measured.

### Storage

The new tables live in the vault's one database ([ADR 0027](0027-vaults.md)), separate from `cards`:

- **`exercises`** (`path`, `title`, `statement`) and **`exercise_skills`** (`skill`, `path`): derived from the notes and pruned with their file.
- **`skill_state`** (`skill`, `kind`, plus `card_state`'s FSRS columns without `learning_steps`) and **`skill_reviews`** (`skill`, `kind`, `rated_at`, `rating`, `exercise`, `repeat`): replayed from the log.

Which exercise comes next is computed, never stored, so a rebuild reproduces the database exactly.

### The log

Skill reviews go in the same shards as card reviews:

```json
{"skill":"two-pointers","kind":"solve","exercise":"leetcode/trapping-rain-water.md","at":"2026-10-05T20:18:11.902Z","rating":2,"took":2280.4}
```

- `took` is in seconds, and written on solve reviews only.
- `repeat` is written only when true.
- Uniqueness is (`skill`, `kind`, `at`).
- The existing `elapsed` is in FSRS days and is no measure of solving time.

**When a database first meets a build that reads these lines, every log position is reset to the start.** `ingestLogs` skips a line without `card` but advances past it. Without the reset, a device that ingested another device's skill reviews before upgrading would never read them.

### Sync

- **Properties are read in the same pass as cards.** An unchanged note is still not opened ([ADR 0008](0008-incremental-sync-costs-what-changed.md)).
- **`EXERCISE_VERSION`** sits beside `SYNTAX_VERSION` and `CONTEXT_VERSION`, so every vault re-reads every note once. It changes no stamps, so it doesn't warn.
- **The summary gains:**
  - exercises found;
  - skills;
  - notes with unreadable properties;
  - exercises with no `## Solution`.
- **The YAML reader is `yaml`** (eemeli). It has no dependencies, is safe in the renderer bundle, and returns `null` on empty input. `js-yaml` v5 depends on `argparse`, has a separate browser entry, and throws on empty input.

## Alternatives

- **One `>>` card per problem.** It memorises the problem, and its answer doesn't fit on a line.
- **Scheduling each exercise note on its own** (Obsidian Spaced Repetition's `#review`). It repeats the same problem, and that plugin also writes scheduling into the note.
- **A new line token, such as `>>!`.** It mints stamps, with the false-positive risk, and the answer still has to live elsewhere.
- **A fresh LLM-generated variant on each review.** It isn't plain text, so a rebuild can't reproduce it.
- **A nested `geode:` block.** Obsidian can't edit it in the Properties panel.
- **`form: exercise` as the switch.** Two switches can contradict each other, and an unprefixed key would claim a name in every vault.
- **Obsidian's `tags: [skill/…]`.** The switch would be implicit, and `tags` is a reserved property type.
- **Skills as rows in `cards`.** There is no file, line, question or answer to fill. Two kinds would mean two fake cards, and every card query would special-case them.
- **A second database file.** It would split the sync pass, the log positions, the queue, rebuild and fresh start.
- **A time box deciding solve ratings.** Rejected for now in favour of the user's judgement, with `took` logged.
- **Capping a repeat's grade.** It would change FSRS's input on a guess. The `repeat` flag keeps the evidence instead.

## Consequences

- An exercise is the first thing GeodeMD reads from a note's properties, and the first parser input that isn't a line.
- **Deferred:** a separate rating table for system design. Use the same four keys, with "solved" meaning the note's rubric was covered. Revisit after real use.
- **Later, maybe:**
  - fading worked examples;
  - credit to prerequisite skills;
  - help writing new exercises.
- Each phase adds a guide section with its journey test, and new `describe` groups classified in `src/behaviours/areas.ts`.
