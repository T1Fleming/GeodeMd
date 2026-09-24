# Configuration

One JSON file, read in exactly one place — `src/host/config.ts`. `core` never reads the filesystem for config and never touches `process.env`.

## Location

```
~/Library/Application Support/GeodeMD/config.json   the config file, on macOS
~/.config/geodemd/config.json                       the config file, elsewhere
~/.local/share/geodemd/db.sqlite                    default database location, overridable
```

Setting `XDG_CONFIG_HOME` or `XDG_DATA_HOME` moves the config or the database default on every platform, macOS included. That is how to run the app against a scratch collection without touching your real one.

A Mac config at the old `~/.config/geodemd/config.json` is moved to Application Support the first time the app starts after updating, keeping your device name. See [ADR 0026](../decisions/0026-config-in-application-support-on-macos.md).

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
| `editor` | no | *(absent)* | What `o` opens a card's note in during review. Normally set from the app's Collection screen. |

`--notes` overrides `notesPath` for a single run.

### `device`

The random suffix exists because two machines both called `macbook-pro` would otherwise share a log filename and break the one-writer-per-file invariant the log layout rests on.

Only a config with **no** `device` mints one. `init --force` preserves it, because re-running `init` to fix a `notesPath` typo should not double as a way to change the machine's identity — regenerating `device` silently starts a second log file and scatters one machine's history across two names. Nothing is lost when that happens (ingest reads every `.jsonl`), but nothing is gained either.

### `editor`

The only optional key, and **first-run setup never writes one.** Absent means "fall through to `$VISUAL`, then `$EDITOR`, then the OS opener" — a better answer than any value setup could invent on a machine it knows nothing about.

It is normally set from **Open notes in** on the Collection screen, which lists the editors installed here and writes their plain command name — `"code"`, not a path. The name is looked up each time `o` is pressed: on your `PATH` first, then, on macOS, inside the editor's app bundle in `/Applications` or `~/Applications`. That second step is what makes it work in an app opened from Finder, which does not get your shell's `PATH`. A named editor that is found nowhere is reported as not found; it does not fall back to the OS opener.

The value is split on whitespace, so `"code -w"` works. It is deliberately **not** shell-parsed, and nothing spawned from it goes through a shell.

`--force` preserves it for the same reason it preserves `device`: re-running `init` should not silently discard a setting it never asked about.

Line-jumping is applied only for editors that are recognised — `vim +142`, `code --goto file:142`, `hx file:142` and similar. An unrecognised editor is handed the file alone, because passing an unknown program `+142` risks creating a file by that name.

**Set a GUI editor.** GeodeMD launches it and carries on rather than waiting for it to close, so you can keep reviewing with the note open beside you — but `"editor": "vim"` therefore starts a `vim` in a window you have no terminal to type into.

## Where the config comes from

There is no command to write it: the app's **first run** does, after showing you the folder it counted, the settings it proposes, and a preview of what the sync would change. Pointing GeodeMD at a different folder later offers to replace the config, and **preserves `device` and `editor`** when it does — re-pointing it should not silently discard a setting it never asked about.

