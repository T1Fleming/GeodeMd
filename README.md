# Geode

A spaced repetition system where **everything durable is plain text in an ordinary directory of Markdown files**. Notes hold card content, append-only JSONL logs hold review history, and a SQLite database outside that directory holds nothing but a rebuildable cache.

Write a card by typing one line in any note:

```markdown
Default Lambda timeout :: 3 seconds
```

Sync stamps it with an ID in an HTML comment — invisible in every Markdown renderer — and the card keeps the context it was written in: the reviewer shows you `aws/Lambda.md:142`. No editor-specific syntax anywhere. If this program disappears, the directory is still an ordinary folder of Markdown files.

## Status

Design only. No implementation yet.

Phase 1 is a TypeScript CLI (Node 20+, `ts-fsrs`, `better-sqlite3`, `vitest`) for a single machine, designed to stay correct and responsive up to roughly a million cards across a million files of mixed sizes. That target is what decides the ID length, the incremental sync, the monthly log shards, and the rule that a sync finding no changes writes nothing at all — none of them are defaults. A later phase is an Electron app, structured so that it is an interface swap rather than a rewrite. Cross-device sync is a possible phase after that; the append-only log layout deliberately does not foreclose it, but nothing in phase 1 is built for it.

## Where to start

[`plan.md`](./plan.md) is the build brief — card syntax, identity rules, data model, module boundaries, sync algorithm, and the test surface that matters. [`architecture.md`](./architecture.md) renders the same decisions as diagrams.
