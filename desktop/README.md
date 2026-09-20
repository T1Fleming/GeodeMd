# desktop/

Holds **no source**. Its only jobs are to own the Electron runtime and an
Electron-ABI build of `better-sqlite3`, and to be the directory the app resolves
from.

## Why this exists at all

`better-sqlite3` is native. It resolves its binary from exactly one path —
`node_modules/better-sqlite3/build/Release/better_sqlite3.node` — and **an ABI
is not a version**, so npm has no mechanism to hold two. The CLI runs under
system Node; Electron ships its own V8 with a different `NODE_MODULE_VERSION`.
Rebuilding the single artifact on demand would flip it back and forth and break
`npm test` until you flipped it back, which is unacceptable in a repo that
treats its one-second suite as load-bearing.

So: a second `package.json`, deliberately **not** an npm workspace. The root has
no `workspaces` key, so root `npm install` never touches this directory and
`npm test` keeps running under system Node against the Node-ABI copy.

## Why the build output also lives here

This is the part that is not obvious, and it cost a failed run to learn.

Node resolves `node_modules` by walking **up** from the importing file. Compiled
output at `<repo>/dist/electron/worker/main.js` walks up to `<repo>/node_modules`
and finds the **Node-ABI** copy — the Electron process then dies with
`NODE_MODULE_VERSION 141 ... requires 130`. Putting the Electron build at
`desktop/dist/` makes the walk find `desktop/node_modules` first.

Hence two builds of the same source for two runtimes, which is the honest shape
of the problem rather than a workaround:

| build | output | resolves | runtime |
|---|---|---|---|
| `npm run build` | `dist/` | root `node_modules` | system Node — the `geode` CLI |
| `npm run build:desktop` | `desktop/dist/` | `desktop/node_modules` | Electron |

`src/cli/**` is excluded from the desktop build; the app is a peer of the CLI,
not a consumer of it (ADR 0013).

## The ABI rebuild runs itself

`postinstall` runs `electron-rebuild` after every install here, because the
failure mode of forgetting it is an error that reads like a code fault:

```
The module '.../better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 141. This version of Node.js
requires NODE_MODULE_VERSION 130.
```

It costs about a minute per install. That is the right trade against a
message that sends you looking in the wrong place — this is documented here
because I wrote this file telling myself to run the step, and then skipped it.

After changing the Electron version, `npm install --prefix desktop` is enough.
To force it by hand: `npm --prefix desktop run rebuild`.
