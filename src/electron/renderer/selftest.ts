/**
 * Drives the review screen the way a person does — real keydown events on the
 * real document — and photographs each state.
 *
 * Calling `window.geode` directly proves the contract and nothing about the
 * UI: a key handler bound to the wrong thing, or a card that renders blank,
 * passes every channel-level check. `main/runs.test.ts` already covers the
 * contract; this covers what it cannot see.
 *
 * Run with `GEODE_SELFTEST=1`. It reports through the console, which main
 * forwards to stdout and acts on.
 */

const results: string[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  results.push(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Ask main for a PNG. The only way to find out whether anything rendered. */
async function shot(name: string): Promise<void> {
  console.log(`SHOT ${name}`);
  await settle(300);
}

/** A real keypress on the document, not a call into the model. */
async function key(k: string): Promise<void> {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  await settle();
}

const text = (sel: string): string => document.querySelector(sel)?.textContent?.trim() ?? "";
const exists = (sel: string): boolean => document.querySelector(sel) !== null;
const all = (sel: string): string[] =>
  Array.from(document.querySelectorAll(sel)).map((e) => e.textContent?.trim() ?? "");

/** A real click on the element whose text matches — the way a person does it. */
async function click(sel: string, label: string): Promise<void> {
  const el = Array.from(document.querySelectorAll(sel)).find((e) =>
    (e.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
  );
  if (!el) throw new Error(`no ${sel} matching "${label}"`);
  (el as HTMLElement).click();
  await settle();
}

/** Wait for something to appear rather than for a timer. */
async function until(sel: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries && !exists(sel); i++) await settle(50);
  return exists(sel);
}

export async function runSelfTest(): Promise<void> {
  try {
    // Either the first-run sequence or the review screen, depending on whether
    // a config exists. Both are driven: onboarding ENDS on review, so running
    // it first simply means the review checks below start from a collection
    // this harness set up itself.
    for (let i = 0; i < 100; i++) {
      if (exists(".setup") || exists(".question") || exists(".done")) break;
      await settle(50);
    }
    if (exists(".setup")) await runSetupChecks();

    for (let i = 0; i < 100 && !exists(".question") && !exists(".done"); i++) await settle(50);

    check("the review screen renders a card", exists(".question"), text(".question"));
    check("the answer starts hidden", !exists(".answer") && exists(".prompt"));
    check("the locator is shown", text(".meta .locator").includes(".md"), text(".meta .locator"));
    await shot("review-01-question");

    const first = text(".question");
    await key(" ");
    check("any key reveals the answer", exists(".answer"), text(".answer"));
    check("the question stays visible beside it", text(".question") === first);
    await shot("review-02-revealed");

    // The legend must offer every rating, and the words must travel with the
    // numbers — they are not guessable.
    const ratings = Array.from(document.querySelectorAll(".legend .rating")).map((b) =>
      b.textContent?.trim(),
    );
    check("all four ratings are offered, named", ratings.length === 4, ratings.join(" / "));

    // The legend must advertise every action key the loop honours. The first
    // version of this screen hand-wrote the open button and silently dropped
    // quit, which no channel-level check could have seen.
    const actions = Array.from(document.querySelectorAll('.legend .action')).map((b) =>
      b.textContent?.trim(),
    );
    check('every action key is advertised', actions.length === 2, actions.join(' / '));
    check('open is one of them', actions.some((a) => a?.includes('open')), actions.join(' / '));

    // Press `o` for real.
    //
    // What this CAN check is that the app does not blow up and does not lose
    // the card — the handler is async and crosses IPC, so a broken one used to
    // surface as a dead screen rather than an error. What it CANNOT check is
    // that an editor opened: main spawns detached and deliberately does not
    // wait, and a headless CI machine has no editor to spawn anyway. In that
    // environment `o` fails and shows a toast, which is itself the evidence
    // that the channel is wired rather than still a stub.
    const before = text(".question");
    await key("o");
    await settle(400);
    check("o does not throw or lose the card", text(".question") === before, text(".question"));
    check(
      "o reaches the open channel rather than the old stub",
      !text(".toast").includes("not wired up"),
      text(".toast"),
    );

    await key("3");
    await settle(200);
    check("rating advances to the next card", text(".question") !== first, text(".question"));
    check("and hides the answer again", !exists(".answer"));
    check("the counter advanced", text(".meta").startsWith("2 /"), text(".meta"));

    // A digit before the reveal must not record a rating for an answer the
    // user has not seen.
    const second = text(".question");
    await key("3");
    check("a rating before the reveal only reveals", exists(".answer") && text(".question") === second);

    await key("q");
    await settle(200);
    check("q ends the session", exists(".done"), text(".done h2"));
    check("the tally counts only answered cards", text(".done h2").startsWith("1 reviewed"), text(".done h2"));

    // The end-of-session check is an IPC round trip that stats every opened
    // note, so the screen renders before the answer arrives. Wait for it
    // rather than for a timer — and note this only has anything to report
    // because the self-test's stand-in editor really does touch the file.
    for (let i = 0; i < 40 && !exists(".stale"); i++) await settle(50);
    check(
      "a note edited during the session is named at the end",
      text(".stale").includes(".md") && text(".stale").includes("geode sync"),
      text(".stale"),
    );
    await shot("review-03-done");

    await runSyncChecks();
    await runStatsChecks();
    await runHelpChecks();

    const failed = results.some((r) => r.includes("FAIL"));
    console.log(["SELFTEST", ...results].join("\n"));
    console.log(`SELFTEST done — ${failed ? "FAIL" : "all ok"}`);
  } catch (err) {
    // Without this the whole run rejects silently and presents as a hang,
    // which is how this harness has failed before.
    console.log(["SELFTEST", ...results].join("\n"));
    console.log(`SELFTEST done — FAIL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The sync screen.
 *
 * A five-file collection syncs in milliseconds, so the bar itself is gone
 * before a screenshot could catch it — which is exactly why the interesting
 * check here is not the bar but the RECONCILIATION: leaving the screen and
 * coming back has to find the finished run through `run/status`, because the
 * event that announced it is long gone.
 */
async function runSyncChecks(): Promise<void> {
  await click(".tabs .tab", "Sync");
  check("the sync screen opens", exists(".screen") && exists(".rebuild"), text(".screen h2"));

  // Preview first — the button says Preview rather than "dry run" because the
  // number that matters is how many of the user's notes this would edit.
  await click(".controls button", "Preview");
  check("a preview reports back", await until(".summary"), "");
  check("and says plainly that nothing was written", exists(".dry"), text(".dry"));
  check("the counts are shown", all(".field dd").length >= 6, all(".field dd").join(" / "));
  await shot("sync-01-preview");

  await click(".controls button", "Sync");
  check("a real sync reports back", await until(".summary"), "");
  for (let i = 0; i < 40 && exists(".dry"); i++) await settle(50);
  check("and is not labelled a preview", !exists(".dry"), text(".summary"));
  await shot("sync-02-done");

  // Leave and come back. The finish event fired while this screen was mounted
  // the FIRST time; finding the result again can only happen by asking.
  await click(".tabs .tab", "Collection");
  await click(".tabs .tab", "Sync");
  check(
    "a remounted screen recovers the result it did not witness",
    await until(".summary"),
    text(".summary .field dd"),
  );

  // Rebuild is deliberately two clicks and a sentence. The confirmation is
  // asserted; the rebuild itself is NOT run, because on a real collection it
  // is minutes and a harness that takes minutes stops being run.
  await click(".rebuild button", "Rebuild");
  check("rebuild asks first", exists(".confirm"), text(".confirm p"));
  check(
    "and says what it costs and what it does not",
    text(".confirm p").includes("Nothing durable is lost") &&
      text(".confirm p").includes("minutes"),
    text(".confirm p"),
  );
  await shot("sync-03-rebuild-confirm");
  await click(".confirm button", "Cancel");
  check("and can be backed out of", !exists(".confirm"));

  // There is no cancel button on a running job, deliberately: core takes no
  // AbortSignal, so a cancel would either lie or corrupt.
  check("no cancel button is offered for a run", !all("button").some((b) => b === "Cancel"));
}

/** The collection screen. Four numbers, two of which are deliberately quieter. */
async function runStatsChecks(): Promise<void> {
  await click(".tabs .tab", "Collection");
  check("the collection screen opens", await until(".tiles"), text(".screen h2"));

  const labels = all(".tile .label");
  check("all four counts are shown", labels.length === 4, labels.join(" / "));
  // `due` is an instant, so "due today" is ambiguous — due now is the
  // actionable number and the forecast is a separate line.
  check(
    "due now and the midnight forecast are separate",
    labels.includes("due now") && labels.includes("due before midnight"),
    labels.join(" / "),
  );
  check(
    "the numbers are numbers",
    all(".tile .value").every((v) => /^\d+$/.test(v)),
    all(".tile .value").join(" / "),
  );
  await shot("stats-01");
}

/**
 * The first-run sequence.
 *
 * Runs only when there is no config, and it really does write one and really
 * does sync — which is the point: the sequence exists to make an irreversible
 * step visible before it happens, and a harness that stops short of the step
 * would not be checking the thing that matters.
 *
 * The folder picker is substituted (a native modal has no DOM to click); every
 * screen after it is driven for real.
 */
async function runSetupChecks(): Promise<void> {
  // Two ways in, and they must not look the same: a first run, and a config
  // whose notesPath has gone. Greeting a year-old user with "GeodeMD —
  // spaced repetition over your own Markdown notes" because a drive is
  // unplugged is the bug this branch exists to prevent.
  const repairing = text(".setup h2").includes("Where did your notes go");
  if (repairing) {
    check("a missing notes folder is a repair, not a first run", true, text(".setup h2"));
    check(
      "and says where they used to be",
      text(".setup").includes("not there any more"),
      text(".setup .lead"),
    );
    check("without claiming anything was lost", text(".setup").includes("Nothing has been lost"));
    await shot("repair-01");
  } else {
    check("onboarding is shown when there is no config", exists(".setup"), text(".setup h2"));
    await shot("setup-01-welcome");
  }

  await click(".setup button", "folder");
  check("choosing a folder reports what is in it", await until(".tiles"), text(".path"));
  check(
    "including the markdown count, which is the check the CLI cannot make",
    all(".tile .label").some((l) => l.includes("Markdown")),
    all(".tile .value").join(" / "),
  );
  check("and whether it is version controlled", text(".tiles").includes("git"), text(".tiles"));
  await shot("setup-02-folder");

  await click(".controls.wizard button", "Continue");
  check("the settings are shown before they are written", await until(".settings"), "");
  check(
    "including the device name and where the database goes",
    all(".settings dt").length === 3,
    all(".settings dt").join(" / "),
  );
  await shot("setup-03-settings");

  // Only when there is a config to replace — a genuine first run has none.
  // This is where `InitRefused` becomes a choice instead of an error, and it
  // is reached by ASKING before writing rather than by catching a throw.
  if (exists(".choice")) {
    check("an existing config is a choice, not an error", true, text(".choice p"));
    check(
      "and the app says what it keeps, rather than keeping it silently",
      // "is kept" / "are kept" depending on whether an editor is set too, so
      // the assertion matches the claim rather than one of its two phrasings.
      text(".choice").includes("device name") && /\b(is|are) kept\b/.test(text(".choice")),
      text(".choice .small"),
    );
    const blockedByChoice = document.querySelector(
      ".controls.wizard button.primary",
    ) as HTMLButtonElement;
    check("which must be answered before continuing", blockedByChoice?.disabled === true);
    await shot("repair-02-choice");
    await click(".choice button", "Use the new folder");
  }

  await click(".controls.wizard button", "Continue");
  check("version control is raised before anything is written", exists(".check.big"), text("h2"));
  check(
    "and the warning says notes will be edited",
    text(".setup").includes("id comment into every line"),
    "",
  );

  // The gate. One explicit acknowledgement, and Continue must not work first.
  const blocked = document.querySelector(".controls.wizard button.primary") as HTMLButtonElement;
  check("continuing is blocked until it is acknowledged", blocked?.disabled === true);
  check("and says why", exists(".blocker"), text(".blocker"));
  await shot("setup-04-version-control");

  (document.querySelector(".check.big input") as HTMLInputElement).click();
  await settle();
  await click(".controls.wizard button", "Continue");
  check("the preview step is reached", text("h2").includes("What would change"), text("h2"));

  // THE rule this sequence exists for: the real sync is unreachable until a
  // preview has said what it would do.
  const real = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sync for real"),
    );
  check("the real sync is not even offered before a preview", real() === undefined);

  await click(".setup button", "Preview");
  check("a preview reports back", await until("strong"), "");
  check(
    "and leads with how many NOTES would be edited, not how many cards",
    text(".setup").includes("would be edited"),
    text("strong"),
  );
  check("only then is the real sync offered", real() !== undefined);
  await shot("setup-05-preview");

  real()!.click();
  // The real sync writes a stamp into every file holding a card, then the app
  // lands on review.
  check("running it lands on the review screen", await until(".question", 200), text(".question"));
}

/**
 * The Help screen.
 *
 * ADR 0018 named this gap: a packaged app is the one place a user cannot
 * reach the documentation. What is worth asserting is not that a panel
 * exists, but that it is showing the REPOSITORY'S Markdown — the whole point
 * is one source and two surfaces, and a Help window that silently shipped a
 * stale copy would look identical.
 */
async function runHelpChecks(): Promise<void> {
  await click(".tabs .tab", "Help");
  check("the documentation ships with the app", await until(".doclist"), "");

  const titles = all(".doclink");
  check("the guides and the reference are both there", titles.length >= 4, titles.join(" / "));
  check(
    "including the one about the first sync, which is the one that matters",
    titles.some((x) => x.toLowerCase().includes("first sync")),
    titles.join(" / "),
  );

  check("a document renders as prose, not as raw markdown", exists(".doc h1"), text(".doc h1"));
  check("it is not showing the markdown source", !text(".doc").includes("## "), "");
  // The thing a packaged user cannot otherwise find out.
  check(
    "and it explains the card syntax",
    text(".doc").includes("::"),
    text(".doc h1"),
  );
  await shot("help-01");

  // Moving between documents, which is the other half of it being usable.
  const second = document.querySelectorAll(".doclink")[1] as HTMLElement;
  const firstTitle = text(".doc h1");
  second.click();
  await settle(250);
  check("another document opens", text(".doc h1") !== firstTitle, text(".doc h1"));
  check("and the list marks which one you are reading", exists(".doclink.on"), "");
  await shot("help-02");
}
