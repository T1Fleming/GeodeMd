/**
 * Vaults that must not share a card ([ADR 0027](../../docs/decisions/0027-vaults.md)).
 *
 * A vault is a notes folder together with its own database. Two vaults whose
 * folders nest — either way round — would put the same stamped cards in two
 * databases. A review in one is logged in that vault's `.sr/log/`, which the
 * other never reads, so one card's history splits in two and nothing says so.
 * This is the check that refuses it, when a vault is added and when one is
 * re-pointed.
 *
 * Pure apart from `realpath`, which is injected: comparing the paths as typed
 * would let a symlink get round the check, and resolving them is the one part
 * that needs a filesystem.
 */

import * as path from "node:path";

export interface Placed {
  id: string;
  name: string;
  notesPath: string;
}

export type RealPath = (p: string) => Promise<string>;

/**
 * The real path of a folder — or, when it does not exist, the real path of
 * its nearest ancestor that does, with the rest appended.
 *
 * A missing folder is ordinary: a vault on an unplugged drive, or one about to
 * be created. It still counts, because plugging the drive back in brings its
 * cards back. Resolving the ancestor rather than giving up matters more than
 * it looks: on macOS `/var` is a link to `/private/var`, so a missing folder
 * left unresolved never matches a real one beside it.
 */
async function real(p: string, realpath: RealPath): Promise<string> {
  const rest: string[] = [];
  let at = path.resolve(p);
  for (;;) {
    try {
      return path.join(await realpath(at), ...rest.reverse());
    } catch {
      const up = path.dirname(at);
      if (up === at) return path.resolve(p);
      rest.push(path.basename(at));
      at = up;
    }
  }
}

/** Whether `inner` is somewhere under `outer`. A shared prefix is not enough. */
function within(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export interface Overlap<T extends Placed = Placed> {
  vault: T;
  /** Where the candidate sits relative to `vault`, compared as real paths. */
  relation: "same" | "inside" | "contains";
}

/**
 * The first vault that `candidate` would overlap, or null when it overlaps none.
 *
 * `except` is the vault being re-pointed: moving a vault into a folder inside
 * its own old one is not an overlap, because the old one stops being a vault.
 */
export async function findOverlap<T extends Placed>(
  candidate: string,
  vaults: readonly T[],
  realpath: RealPath,
  except: string | null = null,
): Promise<Overlap<T> | null> {
  const mine = await real(candidate, realpath);
  for (const v of vaults) {
    if (v.id === except) continue;
    const theirs = await real(v.notesPath, realpath);
    if (mine === theirs) return { vault: v, relation: "same" };
    if (within(mine, theirs)) return { vault: v, relation: "inside" };
    if (within(theirs, mine)) return { vault: v, relation: "contains" };
  }
  return null;
}

const HOW = { same: "is already", inside: "is inside", contains: "contains" } as const;

/** What a refusal says. One sentence, so every place that refuses says the same thing. */
export function overlapMessage(folder: string, o: Overlap): string {
  return (
    `${path.resolve(folder)} ${HOW[o.relation]} the vault “${o.vault.name}” (${o.vault.notesPath}). ` +
    "Two vaults cannot share notes, or a card's review history would split between them."
  );
}
