# Releasing

How a packaged GeodeMD is built, and what has to be checked before one goes out.

> **Why this is not in `docs/guides/`.** Issue #25 asked for the smoke checklist to live there. It cannot any more: `guides/` and `reference/` are now **bundled into the app** and rendered in the Help window, so anything filed there is shipped to every user. A release checklist is contributor material ([ADR 0018](../decisions/0018-user-docs-live-in-guides-and-reference.md), [ADR 0020](../decisions/0020-ship-the-docs-inside-the-app.md)), so it belongs here.

## Building

```sh
npm run build:desktop            # tsc -> desktop/dist, then Vite, then the docs
npm --prefix desktop run package # -> desktop/release/*.dmg
```

`package:dir` produces an unpacked `.app` without the installer, which is what you want while iterating.

### Two things that will bite you

**`npm run package` leaves your dev build broken.** The macOS target builds both `arm64` and `x64`, and electron-builder rebuilds `better-sqlite3` in `desktop/node_modules` for each in turn — so afterwards it holds the **last** one, which is x64. `npm --prefix desktop start` then dies with `mach-o file, but is an incompatible architecture`. It looks like a code problem and is not.

```sh
npm --prefix desktop run rebuild   # puts your own architecture back
```

**The `files` glob has to cover all of `dist/`, not just `dist/electron/`.** `main/index.js` imports `core`, `host`, `files`, `store`, `parser` and `scheduler` by relative path. Package only `dist/electron/**/*` and you get a bundle whose main process resolves nothing, prints nothing, and never exits — a silent hang with no error anywhere. This is written down because it cost an hour to find and would cost it again.

## Signing and notarization

**Not configured, deliberately** — it needs credentials this repository does not have. The build is signing-*ready*: `hardenedRuntime` is on and `build/entitlements.mac.plist` carries the JIT entitlements V8 needs, without which a signed app launches and immediately dies.

To turn it on you need an Apple Developer account and:

```sh
export CSC_LINK=/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD=…
export APPLE_ID=…
export APPLE_APP_SPECIFIC_PASSWORD=…
export APPLE_TEAM_ID=…
```

Then add `"notarize": true` to the `mac` block. Without any of that, `electron-builder` prints `skipped macOS application code signing` and still produces a working unsigned `.dmg` — which Gatekeeper will refuse on another machine until the user right-clicks → Open.

The app is **not sandboxed**, and that is a decision rather than an omission: GeodeMD reads and writes a directory of the user's own notes, chosen at runtime, and possibly synced between machines by something else. The App Sandbox would require security-scoped bookmarks and would break that. Direct distribution allows it; the Mac App Store would not.

## Before a release goes out

### Automated

```sh
npm test                                    # the whole suite
npm run typecheck && npm run typecheck:renderer && npx tsc -p tsconfig.desktop.json --noEmit
npm run build:desktop
GEODE_SELFTEST=1 npx electron dist/electron/main/index.js      # from desktop/
```

The self-test also runs **against the packaged bundle**, which is the only way to catch a packaging fault — the `files` glob above passed every development check:

```sh
XDG_CONFIG_HOME=/tmp/smoke/config XDG_DATA_HOME=/tmp/smoke/data \
  GEODE_SELFTEST_FOLDER=/tmp/smoke/notes GEODE_SELFTEST=1 \
  desktop/release/mac-arm64/GeodeMD.app/Contents/MacOS/GeodeMD
```

With no config present and `GEODE_SELFTEST_FOLDER` set, that drives first-run, sync, review, stats and help in one pass. Point it at a **copy** — it performs a real first sync and stamps every card in the folder.

### By hand, on a clean machine

`GEODE_SELFTEST=1` covers the app in development and cannot cover a signed, packaged bundle on a machine that has never had a toolchain on it. Install the `.dmg`, point it at a copy of [`demo/`](../../demo/), and confirm:

- [ ] It launches at all — no Gatekeeper refusal you did not expect, no immediate crash
- [ ] First run: the folder picker opens, the Markdown count is right, the preview reports **3 notes would be edited** for `demo/`
- [ ] The real sync writes exactly those 3, and `git diff` in the copy shows only trailing `<!-- sr-… -->`
- [ ] Review: a card renders, a rating advances, `o` opens the note in your editor at the right line
- [ ] Sync screen: a second sync reports `0 new`, and rebuild asks before running
- [ ] Help: the guides render, and a link to something unbundled opens a browser
- [ ] Quit and relaunch — it goes straight to review, not to onboarding
- [ ] A second window, or a second copy of the app, against the same collection

The last one is not a formality. `SQLITE_BUSY` handling exists because two writers over one database is a state the design tolerates rather than prevents — it was written for the CLI-and-app case ([ADR 0025](../decisions/0025-the-app-is-the-only-interface.md) removed the CLI, not the handling), and two copies of the app reach it just as well.

## Before shipping to a large collection

[ADR 0017](../decisions/0017-core-runs-in-the-main-process.md) put `core` in the main process on a measurement taken at **20,000 cards and 8,000 reviews**, and explicitly did not extrapolate to the million-card design target. [ADR 0024](../decisions/0024-remeasure-the-main-process-stall.md) is that measurement taken again at 200,000 and 1,000,000, and records what was done about it.

Build a collection, then measure against it — the bench measures, it does not generate:

```sh
npm run build                                          # the generator runs under plain node
node dist/measure/vault.js /tmp/vault 1000000 400000   # cards, reviews
npm run build:desktop
npm --prefix desktop run measure -- /tmp/vault/config.json
```

Expect, at a million cards: `sync` under 10 ms, a rating burst around 120 ms a couple of times over 4,000 ratings, and `rebuild` around 160 ms across forty seconds — the last two are known and accepted, because a rebuild is modal and offers no cancel and a rating hitch lands between two cards. At 200,000 cards nothing should drop a frame at all. A **new** stall outside those, or one that has grown, is the signal: the seam is already in place, so the answer is to implement `protocol.ts` over a `MessagePort` into a `utilityProcess`. Do not guess; the whole point of both ADRs is that this question is answered by measuring.

The first `stats` call is the largest stall knowingly left in the app — 0.6 s at a million cards, 9 ms after that, all of it the one count that is not capped. Worth re-checking on the machine you are shipping to.
