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

export async function runSelfTest(): Promise<void> {
  try {
    // The app loads its queue over IPC, so wait for a card rather than a timer.
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
    await shot("review-03-done");

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
