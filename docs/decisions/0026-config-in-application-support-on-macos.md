# 0026 — On macOS the config lives in Application Support

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The original brief put the config at `~/.config/geodemd/config.json` on every platform, macOS included: "One less branch, and two string constants instead of an afternoon with `env-paths`." No ADR recorded that, because it was a small call and GeodeMD was a CLI at the time. For a command-line tool on a Mac, `~/.config` is an ordinary place to look.

[ADR 0025](0025-the-app-is-the-only-interface.md) removed the CLI. GeodeMD is now a Mac app, and Mac users look for an app's settings in `~/Library/Application Support`, not in a hidden folder in their home directory. The branch that line was avoiding costs one `if`.

## Decision

With no `XDG_CONFIG_HOME` set, the config lives at `~/Library/Application Support/GeodeMD/config.json` on macOS. It stays at `~/.config/geodemd/config.json` elsewhere. `configPath` in `src/host/config.ts` is still the only place that knows this.

**An explicit `XDG_CONFIG_HOME` still wins on every platform, macOS included.** The self-test, the release smoke test and every demo in `docs/design/app.md` set it to keep off the config that points at real notes. If macOS ignored it, those runs would quietly repoint a live collection, and nothing would refuse, because a replace keeps `device`.

**An existing Mac config is moved at startup, once** (`settleConfigPath`). Without the move, every existing install would open to first-run setup after updating. Setup mints a new `device`, which splits one machine's review history across two log shards. The move follows one rule: it never answers with an empty path while a config exists.
- A config already at the new path wins, and the old one is left untouched.
- The copy goes through a temp file and a rename, so the new path never holds a partial config.
- The old file is removed only after the new one is in place.
- If any step fails, the app uses the old file for that session and tries the move again at the next launch.

**The database default does not move.** It stays at `~/.local/share/geodemd/db.sqlite`. Its path is written into the config at setup, so moving the default would not move any existing database. It would only split new installs from old ones, over a file the user never opens.

## Consequences

- The Mac config is where a Mac user would look for it.
- The move can be deleted once no install is older than this change. Until then, it runs a few `stat` calls at each startup and does nothing more.
- The config and the database now sit in different trees on macOS. The database is a rebuildable cache, so that has no practical cost. If it ever matters, it is a separate decision.
