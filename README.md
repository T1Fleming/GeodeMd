# Vault SR

A spaced repetition system where **everything durable is plain text inside the Obsidian vault**. Notes hold card content, per-device JSONL logs hold review history, and a SQLite database outside the vault holds nothing but a rebuildable cache.

Write a card by typing one line in any note:

```markdown
Default Lambda timeout :: 3 seconds
```

Sync stamps it with an Obsidian block ID, so the card stays addressable as `[[Some Note#^sr-a7Kd9mQ2]]` and keeps the context it was written in. If this program disappears, the vault is still a normal vault.

## Status

Design only. No implementation yet.

Phase 1 is a TypeScript CLI (Node 20+, `ts-fsrs`, `better-sqlite3`, `vitest`). A later phase is an Electron app, structured so that it is an interface swap rather than a rewrite.

## Where to start

[`plan.md`](./plan.md) is the build brief — card syntax, identity rules, data model, module boundaries, sync algorithm, and the test surface that matters.
