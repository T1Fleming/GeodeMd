# Configuration

One JSON file, read in exactly one place — `src/host/config.ts`. `core` never reads the filesystem for config and never touches `process.env`.

## Location

```
~/Library/Application Support/GeodeMD/config.json   the config file, on macOS
~/.config/geodemd/config.json                       the config file, elsewhere
~/.local/share/geodemd/db.sqlite                    the first vault's database
~/.local/share/geodemd/vaults/<id>/db.sqlite        the database of each vault added after it
```

Setting `XDG_CONFIG_HOME` or `XDG_DATA_HOME` moves the config or the database defaults on every platform, macOS included. That is how to run the app against a scratch vault without touching your real one.

A Mac config at the old `~/.config/geodemd/config.json` is moved to Application Support the first time the app starts after updating, keeping your device name. See [ADR 0026](../decisions/0026-config-in-application-support-on-macos.md).

The database goes outside the notes directory deliberately: it is a cache, and a live database file is the worst thing to place under a sync or backup tool, since it drags its `-wal` and `-shm` siblings along with it.

## Keys

A **vault** is a notes folder together with its own database ([ADR 0027](../decisions/0027-vaults.md)). The config lists the vaults, names the one that is open, and holds the two keys that belong to the machine rather than to any vault.

```json
{
  "device": "mac-k3f9",
  "active": "k2m9x0qa",
  "vaults": [
    {
      "id": "k2m9x0qa",
      "name": "notes",
      "notesPath": "/Users/you/notes",
      "dbPath": "/Users/you/.local/share/geodemd/db.sqlite"
    },
    {
      "id": "p81dhw3c",
      "name": "work",
      "notesPath": "/Users/you/work-notes",
      "dbPath": "/Users/you/.local/share/geodemd/vaults/p81dhw3c/db.sqlite"
    }
  ],
  "editor": "code"
}
```

| Key | Required | Default | Notes |
|---|---|---|---|
| `device` | no | slugified `os.hostname()` + a short random suffix | Machine-wide. Fixed once, at first run. Names this machine's log file in every vault and appears in each line; **never part of a review's identity**. |
| `active` | no | the first vault | The `id` of the open vault. |
| `vaults` | yes | — | At least one. A config with no usable vault is treated as unreadable. |
| `editor` | no | *(absent)* | Machine-wide. What `o` opens a card's note in during review. Normally set from the app's Vault screen. |

Each vault:

| Key | Required | Default | Notes |
|---|---|---|---|
| `id` | no | 8 random characters | Never changes; the switcher and the database path refer to it. |
| `name` | no | the folder's name | What the switcher shows. Change it with **Rename…**. |
| `notesPath` | yes | — | The vault's notes folder. Every path stored in its database is relative to it. May not be inside another vault's `notesPath`, nor contain one. |
| `dbPath` | no | `~/.local/share/geodemd/vaults/<id>/db.sqlite` | Created on first use if its directory does not exist. The first vault on a machine uses `~/.local/share/geodemd/db.sqlite`. |

### A config from before vaults

A config with a top-level `notesPath` — every install before vaults — is converted into one vault the first time the app reads it: same folder, same `dbPath`, same `device`, same `editor`. The file is replaced in one step, so it is never half converted; if it cannot be written, the app runs on the converted config for that session and tries again next time. Older versions of the app cannot read the new shape.

### `device`

The random suffix exists because two machines both called `macbook-pro` would otherwise share a log filename and break the one-writer-per-file invariant the log layout rests on.

Only a config with **no** `device` mints one. Adding a vault does not, converting an old config does not, and re-pointing a vault preserves it, because fixing a `notesPath` should not double as a way to change the machine's identity — regenerating `device` silently starts a second log file and scatters one machine's history across two names. Nothing is lost when that happens (ingest reads every `.jsonl`), but nothing is gained either.

### `editor`

The only optional key, and **first-run setup never writes one.** Absent means "fall through to `$VISUAL`, then `$EDITOR`, then the OS opener" — a better answer than any value setup could invent on a machine it knows nothing about.

It is normally set from **Open notes in** on the Vault screen, which lists the editors installed here and writes their plain command name — `"code"`, not a path. The name is looked up each time `o` is pressed: on your `PATH` first, then, on macOS, inside the editor's app bundle in `/Applications` or `~/Applications`. That second step is what makes it work in an app opened from Finder, which does not get your shell's `PATH`. A named editor that is found nowhere is reported as not found; it does not fall back to the OS opener.

The value is split on whitespace, so `"code -w"` works. It is deliberately **not** shell-parsed, and nothing spawned from it goes through a shell.

Re-pointing a vault preserves it for the same reason it preserves `device`: fixing a path should not silently discard a setting it never asked about.

Line-jumping is applied only for editors that are recognised — `vim +142`, `code --goto file:142`, `hx file:142` and similar. An unrecognised editor is handed the file alone, because passing an unknown program `+142` risks creating a file by that name.

**Set a GUI editor.** GeodeMD launches it and carries on rather than waiting for it to close, so you can keep reviewing with the note open beside you — but `"editor": "vim"` therefore starts a `vim` in a window you have no terminal to type into.

## Where the config comes from

There is no command to write it: the app's **first run** does, after showing you the folder it counted, the settings it proposes, and a preview of what the sync would change. After that:

- **Add vault…** appends a vault, through the same preview, and opens it.
- **Change folder…** re-points the open vault, keeping its `id`, its database, and — since they are machine-wide — `device` and `editor`.
- Choosing a vault in the switcher changes `active` and nothing else.
- **Remove…** deletes a vault's entry, and optionally its database. Never its notes or its log.

