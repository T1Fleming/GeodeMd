# Configuration

One JSON file, read in exactly one place — `src/cli/config.ts`. `core` never reads the filesystem for config and never touches `process.env`.

## Location

```
~/.config/geodemd/config.json      the config file
~/.local/share/geodemd/db.sqlite   default database location, overridable
```

XDG paths on **every** platform, macOS included. One less branch, and two string constants instead of an afternoon with `env-paths`.

The database goes outside the notes directory deliberately: it is a cache, and a live database file is the worst thing to place under a sync or backup tool, since it drags its `-wal` and `-shm` siblings along with it.

## Keys

```json
{
  "notesPath": "/Users/you/notes",
  "device": "mac-k3f9",
  "dbPath": "/Users/you/.local/share/geodemd/db.sqlite",
  "editor": "nvim"
}
```

| Key | Required | Default | Notes |
|---|---|---|---|
| `notesPath` | yes | — | The notes root. Every path stored anywhere is relative to it. A config whose `notesPath` is not a string is treated as unreadable. |
| `device` | no | slugified `os.hostname()` + a short random suffix | Fixed once at `init`. Names the log file and appears in each line; **never part of a review's identity**. |
| `dbPath` | no | `~/.local/share/geodemd/db.sqlite` | Created on first run if its directory does not exist. |
| `editor` | no | *(absent)* | What `o` opens a card's note in during review. |

`--notes` overrides `notesPath` for a single run.

### `device`

The random suffix exists because two machines both called `macbook-pro` would otherwise share a log filename and break the one-writer-per-file invariant the log layout rests on.

Only a config with **no** `device` mints one. `init --force` preserves it, because re-running `init` to fix a `notesPath` typo should not double as a way to change the machine's identity — regenerating `device` silently starts a second log file and scatters one machine's history across two names. Nothing is lost when that happens (ingest reads every `.jsonl`), but nothing is gained either.

### `editor`

The only optional key, and **`init` never writes one.** Absent means "fall through to `$VISUAL`, then `$EDITOR`, then the OS opener" — a better answer than any value `init` could invent on a machine it knows nothing about.

The value is split on whitespace, so `"code -w"` works. It is deliberately **not** shell-parsed, and nothing spawned from it goes through a shell.

`--force` preserves it for the same reason it preserves `device`: re-running `init` should not silently discard a setting it never asked about.

Line-jumping is applied only for editors that are recognised — `vim +142`, `code --goto file:142`, `hx file:142` and similar. An unrecognised editor is handed the file alone, because passing an unknown program `+142` risks creating a file by that name.

**The same key is used by both interfaces.** `o` in `geode review` and the app's **open** button run the same program with the same arguments. They differ in one respect you may notice: the CLI waits for the editor to exit, because a terminal editor has taken over the window, while the app launches it and carries on. So `"editor": "vim"` works in the terminal and, in the app, starts a `vim` you have no terminal to type into — set a GUI editor if you review in the app.

## `geode init`

```
geode init <notesPath> [--force]
```

Writes the config file, so a first run is not "hand-author some JSON". It **refuses to overwrite an existing config unless `--force`**, and preserves `device` and `editor` even then.

It prints two lines of advice before exiting: commit the notes directory first if it is under version control, then run `geode sync --dry-run`. The first real sync stamps every file holding a card, and that is much better learned from a dry run than from a diff.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — **including** a run that skipped unreadable files. A skip is a reported outcome, not a failure; making it non-zero would break every script the first time one note has bad permissions. |
| `1` | Configuration or usage error: no config, a `notesPath` that is missing or not a directory, `review` without a TTY. |
| `2` | Unexpected internal error. |

Partial failure is communicated in the run summary, not in the exit status.
