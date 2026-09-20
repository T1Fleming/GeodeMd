# Design

How GeodeMD works **now**. These documents are living — when the code changes, they change with it.

Written for people **working on** GeodeMD. Users want [`docs/guides/`](../guides/) and [`docs/reference/`](../reference/) instead ([ADR 0018](../decisions/0018-user-docs-live-in-guides-and-reference.md)).

For *why* a decision went the way it did, and what it beat, see [`docs/decisions/`](../decisions/). The split is tense and mutability: an ADR is frozen at the moment of choosing, a design doc describes the present.

| Document | Covers |
|---|---|
| [module-map.md](module-map.md) | The six modules, what each owns, and how the boundaries are enforced |
| [parser.md](parser.md) | Card syntax, skipped contexts, stamps, line terminators, identity |
| [data-model.md](data-model.md) | The review log, the five tables, connection settings, rebuild |
| [sync.md](sync.md) | The seven sync steps, invariants, failure handling, `--dry-run` / `--full` |
| [review-flow.md](review-flow.md) | Queue construction, recording a review, the loop, stats |
| [testing.md](testing.md) | The five expensive places, the boundaries test, the scale harness |

Configuration is documented in [`docs/reference/configuration.md`](../reference/configuration.md).

## Reading source citations

Comments throughout `src/` cite the original design brief by section — `section 8 step 4`, `Section 6 rule 4`, `section 5`. That brief is [phase-1-brief.md](phase-1-brief.md), retired here and no longer maintained. Its section numbering still resolves, and this table maps it onto the documents above:

| Brief section | Now lives in |
|---|---|
| §1 Goals and non-goals | the brief (historical) |
| §2 Stack | the brief (historical) |
| §2a Configuration and paths | [reference/configuration.md](../reference/configuration.md) |
| §3 Card syntax | [parser.md](parser.md) |
| §4 Identity | [parser.md](parser.md), [ADR 0003](../decisions/0003-stamp-identity-into-the-note.md), [ADR 0004](../decisions/0004-twelve-character-ids.md) |
| §5 Data model | [data-model.md](data-model.md) |
| §5a The review log | [data-model.md](data-model.md), [ADR 0005](../decisions/0005-append-only-review-log.md) |
| §6 Module layout | [module-map.md](module-map.md) |
| §7 Scheduler interface | [data-model.md](data-model.md), [ADR 0007](../decisions/0007-pin-fsrs-parameters-in-source.md) |
| §8 Sync algorithm | [sync.md](sync.md) |
| §9 Review flow | [review-flow.md](review-flow.md) |
| §10 Testing | [testing.md](testing.md) |
| §10a Build sequence | the brief (historical — phase 1 has shipped) |
| §11 Phase 2 sketch | the brief (historical) |

New code should cite these documents rather than brief sections. Existing citations are left alone rather than rewritten across 19 files; they still resolve, and they migrate naturally as the code around them changes.
