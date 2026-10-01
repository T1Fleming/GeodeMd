# RemNote flashcard types and the syntax that creates them

A research note for contributors: every flashcard type RemNote documents, and every documented way to create each one — inline delimiter, `/`-command, keyboard shortcut, menu, toolbar, import text. Researched on 2026-10-01 against primary sources only: RemNote's help centre (`help.remnote.com`), the plugin SDK documentation (`plugins.remnote.com`), and the published `@remnote/plugin-sdk` npm package (v0.0.46). Every claim cites its page. Where two official pages disagree, both versions are quoted and the conflict is listed under [Open questions](#open-questions--unverified). Practice and answer modes (type-in-answer, text-to-speech, scheduling) are out of scope, except where they affect how a card is created. RemNote's UI calls each outline item a "bullet"; its API calls it a "Rem". This note uses "bullet" except when quoting the SDK.

## Summary

| Card type | Syntax token(s) | Default direction | Answer source | Source |
|---|---|---|---|---|
| Basic | `>>` or `==` (forward); `<<` (backward); `<>` (both); `=-` / `>>-` / `>-` (disabled) | Forward only | Same line, after the delimiter | [CF], [IMP] |
| Concept | `::` (both); `:>` (forward); `:<` (backward); `:-` (disabled); also `Ctrl/Cmd+Alt/Opt+C`, `/tc` | **Both directions** | Same line (the definition) | [CF], [CD], [IMP] |
| Descriptor | `;;` (forward); `;<` (backward); `;<>` *or* `;;<` (both; pages disagree); `;-` (disabled); also `Ctrl/Cmd+Alt/Opt+D`, `/td` | Forward only | Same line | [CF], [CD], [IMP] |
| Multi-line "set" (all lines revealed at once) | Delimiter tripled (`>>>`, `:::`, `;;;`), or a delimiter followed by Enter; `<<<`, `<><` in import text; `/imlc`; `Ctrl/Cmd+Alt/Opt+R` on selected children | Same as the delimiter's card type | Child bullets | [ML], [KS], [IMP] |
| Multi-line "list" (list-answer, one item at a time) | Multi-line card whose children form a numbered list (`1.` on the first child); `>>1.`, `<<1.`, `<>1.`, `>-1.` in import text | Same as the delimiter's card type | Child bullets, numbered | [ML], [IMP] |
| Multiple choice | `==A)` typed after the question; `>>A)` / `>-A)` in import text | Forward (no other direction is documented) | Child bullets; the first one (A) is correct by default | [CF], [IMP] |
| Cloze | `{{text}}` while typing; select text and press `{`; cloze button on the toolbar | n/a (one card per cloze, or per group) | Hidden spans inside the bullet's own text | [CF], [KS], [IMP] |
| LaTeX cloze | Select part of an equation, then **Create Cloze**; Alt+click merges | n/a | Hidden parts of the equation | [LATEX] |
| Image occlusion | `Ctrl/Cmd+click` on an image; image flashcards button; `/ioc`; occlusion box or tape tools in the PDF reader and handwritten documents | n/a (one card per occlusion or merged group) | Hidden regions of the image | [IO], [PDF] |
| Table / property cards | Column header → Flashcards Configuration → Enable For This Column; property **Generate Card** option | Configured per column or property: forward, backward or both | Cell or property value | [TBL], [PROP] |
| AI-generated | **Create AI Cards** toolbar button; **AI Cards** on a PDF highlight; Guided Learn mode | Whatever card types it produces | Produces the types above | [AI], [PDF], [GL] |

## Basic cards

**At review time:** two sides, prompt and answer. RemNote creates one card in the forward direction by default (show the prompt, ask for the answer). You can instead create a backward card, cards in both directions, or none. ([CF])

**Creating one inline.** Type the prompt, then `>>` or `==`, then the response. RemNote turns `>>` into a right-pointing arrow. ([CF], [FB])

```
What is a covalent chemical bond? == One where a pair of electrons are shared.
```
([FB])

```
Question >> Answer
```
([IMP])

**Direction variants**, as documented:

| Token | Effect | Source |
|---|---|---|
| `>>` or `==` | Forward card | [CF], [IMP] |
| `<<` | Backward card only | [CF], [IMP], [KS] |
| `<>` | Cards in both directions | [CF], [IMP], [KS] |
| `=-` | No cards (disabled) — "type `<<`, `<>`, or `=-` to start with only a backwards card, cards in both directions, or no cards, respectively" | [CF] |
| `>>-` | Disabled Basic card. The rule is "Type `-` after you've created a flashcard, to immediately disable it (e.g., type `>>-` for a disabled Basic card)" | [CF] |
| `>-` | "to create a disabled flashcard" (import/paste page) | [IMP] |

**After creation.** Clicking the arrow lets you change the card type, choose the direction(s) — the arrow redraws to match — enable or disable the card, turn on Type in Answer, or delete the card. A preview button on the right shows the card as it will appear in practice. ([CF])

**Gotchas**
- **Ancestors are shown as context.** At review time a card shows every ancestor bullet. When an ancestor is a Basic or Descriptor card, its back side is shown too; when it is a Concept, it is not. ([CF], [ORDER])
- **Code blocks cannot share a bullet with a flashcard arrow.** To put code on the back, write the front, press Enter to make a multi-line card, and put the code block on the child line. To put code on the front, put the code block first and indent the question beneath it. ([CODE])
- **Tables.** Typing a delimiter such as `>>` in an Advanced Table's Name column adds a **Definition** column, which holds the card's back side. ([PROP])

## Concept cards

**At review time:** like a Basic card, but the prompt names a concept. Concepts are shown in **bold** and, unlike Basic cards, **generate cards in both directions by default**. ([CF], [CD])

**Creating one**
1. Inline: the concept's name, then `::`, then its definition. The name turns bold. ([CF], [CD])
   ```
   Mitochondria :: Organelles that produce ATP
   ```
   (Illustrative example. The help pages show their examples as screenshots.)
2. Keyboard: `Ctrl+Alt+C` (`Cmd+Opt+C` on a Mac) makes the current bullet a Concept without a definition. `Ctrl+Alt+Q` / `Cmd+Opt+Q` turns it back into a normal bullet. ([CD])
3. `/`-command: `/turn into concept` or `/tc`. Through the Omnibar it applies to several bullets at once. ([CD])

**Direction variants**

| Token | Effect | Source |
|---|---|---|
| `::` | Both directions | [CF], [CD], [IMP] |
| `:>` | Forward only (show the name, ask for the definition) | [CF], [CD], [IMP] |
| `:<` | Backward only (show the definition, ask for the name) | [CF], [CD], [IMP] |
| `:-` | Disabled | [IMP] |

**Gotchas**
- **A Concept's back side is hidden in context.** When a descendant card is practised, a Concept ancestor's definition is not shown. This is the stated reason to prefer a Concept when a Basic parent's back would give the answer away. ([CF], [CD], [ORDER])
- **A definition is optional.** A Concept with no back side, defined only by its Descriptors, is allowed. ([CD])
- By convention a Concept starts with an uppercase letter. RemNote does not enforce this. ([CF])
- Concepts rank higher in search results and get a lightbulb icon there. ([CD])

## Descriptor cards

**At review time:** a Descriptor describes one attribute of its parent Concept. Descriptors are shown in *italics*, should be indented under that Concept, and are **forward-only by default**. ([CF], [CD])

**Creating one**
1. Inline: the attribute's name, then `;;`, then its description. The name turns italic. ([CF], [CD])
   ```
   Personal Computer :: A computer designed for individual use
       abbreviation ;; PC
   ```
   (Illustrative example, modelled on the screenshot in [CD]; leading spaces stand for the outline's indentation.)
2. Keyboard: `Ctrl+Alt+D` (`Cmd+Opt+D` on a Mac). ([CD])
3. `/`-command: `/turn into descriptor` or `/td`. Works through the Omnibar. ([CD])

**Direction variants**

| Token | Effect | Source |
|---|---|---|
| `;;` | Forward | [CF], [CD], [IMP] |
| `;<` | Backward | [CF], [IMP] |
| `;<>` | Both directions (per *Creating Flashcards*) | [CF] |
| `;;<` | "Two way" (per the import page's table) | [IMP] |
| `;-` | A Descriptor with a back side but no cards | [CD], [IMP] |

**Backward Descriptor cards test the Concept, not the Descriptor.** A backward card shows the Descriptor's back side and asks for the *parent Concept*. For example, `abbreviation ;; PC` under *Personal Computer* asks "PC is the abbreviation of what?" and expects *Personal Computer*. ([CD])

**Related mechanisms that are not card types**
- *Universal Descriptors* are ordinary bullets kept under a `~` bullet, by convention written with a `~` prefix, such as `~Purpose`. One converted to a property with `/pr` "will automatically generate a flashcard when you reference it, without your needing to type `;;` or similar". ([UD])
- On a template, a tagged bullet acts as the Concept and each property as a Descriptor. See [Table and property cards](#table-and-property-cards). ([PROP])

## Multi-line cards (set and list)

**At review time:** the back side is a short list held in child bullets. A **Set** card reveals every item at once; a **List** card (a "List-Answer Card") reveals them one at a time, in order. Multi-line cards can be backward or bidirectional too: "In the backwards direction, you'll see all of the child items and be asked to supply the immediate parent item." ([ML])

**Creating one** (any one of these, per [ML] unless noted):
1. **Delimiter, then Enter.** Type any card delimiter (e.g. `>>`) and press Enter. The cursor moves to the first answer line.
2. **Tripled delimiter:** `>>>`, `:::` or `;;;`. *Creating Flashcards* says this works for "the first three types of cards" — Basic, Concept and Descriptor — and that `>>>` gives a forward multi-line Basic card. ([CF])
3. **From existing children.** Select the children, then choose **Multi-line Card Item** from the `/`-menu, or press `Ctrl+Alt+R` (`Cmd+Opt+R` on a Mac). The parent becomes the prompt of a Basic card, and the children become the answer. `/multi-line card item` is a toggle: running it on an existing line removes that line from the card.
4. **`/`-menu insert.** **Insert Multi-Line Flashcard**, shortcode `/imlc`. ([KS])
5. **Toolbar.** With child bullets selected, **Add to Back of Card** / **Remove from Back of Card** change the answer. You can also drag the grabber on the back side to set how far down the children the answer extends.

**Set vs. list.** Every method above makes a **Set** card. To get a **List** card, turn the children into a numbered list. Either type `1.` as soon as the cursor lands on the first line of a new multi-line card, or select the children and choose **List Item** from the Omnibar (`Ctrl/Cmd+K`). ([ML])

**Import / paste tokens** ([IMP]). The children nested under the bullet become the items:

| Kind | Forward | Backward | Both | Disabled |
|---|---|---|---|---|
| Basic multi-line (set) | `>>>` | `<<<` | `<><` | — |
| Basic list-answer | `>>1.` | `<<1.` | `<>1.` | `>-1.` |
| Concept multi-line | `;>>` *(sic)* | `:<<` | — | — |
| Descriptor multi-line | `;;>` | `;<<` | — | — |
| Concept list-answer | `;>>1.` *(sic)* | `:<<1.` | `::1.` | `:-1.` |
| Descriptor list-answer | `;;>1.` | `;<<1.` | `;;<1.` | `;-1.` |

"*(sic)*" marks a token that begins with `;` in a Concept row, contrary to the same page's rule that "concept cards will use a `:` (colon) and descriptors will use a `;` (semicolon)". These are reproduced exactly as published; see [Open questions](#open-questions--unverified).

Example, from the import page's description (the page shows it as a screenshot):

```
- Primary colours >>1.
  - Red
  - Yellow
  - Blue
```

**Gotchas**
- **Nesting is recursive.** A multi-line card's back can hold further multi-line cards. Each one generates its own card, and the top-level card shows only its direct children unless you expand them. RemNote remembers the expand/collapse state, separately for the queue and the editor. ([ML])
- **Partial cards.** RemNote tracks recall per item. When you forget items, it adds partial list/set cards that ask for just one item. ([ML])
- **Hints.** `/hint` adds a hint to the card, or to an individual item when that item is selected. ([HINT])
- **SDK.** A child that belongs to a card's answer is a "card item" (`Rem.isCardItem` / `setIsCardItem`, documented as "Set whether or not this Rem is a multiline item"). The numbered state is `isListItem` / `setIsListItem`. The built-in powerup codes include `MultiLineCard = "w"` and `List = "i"`. ([SDK-Rem], [SDK-pkg])

## Multiple-choice cards

**At review time:** the answers are shown in random order, and you pick the correct one(s) with the mouse or a number key. RemNote then pre-selects *Forgot* or *Recalled with effort*. ([CF])

**Creating one**
1. Inline: type the question, then `==A)`, then the answers. **Answer A is correct by default**; every other answer is treated as incorrect. ([CF]) The summary at the top of the same page puts it differently: "Type `A)` after creating a Basic card to create a Multiple-Choice card." ([CF])
2. Changing which answers are correct:
   - click the letters to change the correct answer or add more correct answers; ([CF])
   - `/mcr` or `/correct` marks an answer correct, and `/mcw` or `/incorrect` marks it incorrect. ([CF])
3. Import / paste ([IMP]): `>>A)` on the question bullet, with the options as children. **The first child is correct.** Further detail nested under an option is shown after answering.

```
- Which element is often used to fill party balloons? >>A)
  - Helium
  - Hydrogen
  - Xenon
  - Iron
```
(Illustrative; the question comes from [MCE], the layout follows the description in [IMP].)

| Kind | Forward | Disabled | Source |
|---|---|---|---|
| Basic | `>>A)` (import), `==A)` (typed) | `>-A)` | [IMP], [CF] |
| Concept | `;>>A)` *(sic)* | `:-A)` | [IMP] |
| Descriptor | `;;>A)` | `;-A)` | [IMP] |

No backward or bidirectional multiple-choice token is documented.

**Other ways to create one:** AI generation can produce a "Multiple-Choice Quiz". ([AI]) Guided Learn mode can detect exam-style questions in a source and "extract them directly as multiple-choice flashcards in your editor". ([GL])

**Explanations:** with *AI Multiple Choice Explanations* on, RemNote explains each choice. Extra Card Detail (`/extra` or `/ecd`, typed under one of the answers) adds your own explanation. ([CF])

**SDK:** `BuiltInPowerupCodes.MultipleChoice = "mc"` (in the npm package v0.0.46; not on the docs site's enum page). ([SDK-pkg])

## Cloze cards

**At review time:** parts of the bullet's own text are hidden, and you fill in the blanks. ([CF])

**Creating one**
1. While typing: `{{` to start a deletion and `}}` to end it. ([CF], [KS])
   ```
   {{Cloze 1}} and {{Cloze 2}}
   ```
   ([IMP])
2. With text selected: press `{`, or click the cloze button (a dotted-box icon) on the formatting toolbar. ([CF])

**Several clozes in one bullet.** A drop-down arrow appears next to each deletion, letting you hide all of them on one card or each on a separate card. ([CF]) When pasted or imported, each `{{…}}` is independent: "It is not currently possible to merge clozes prior to pasting them into RemNote." ([IMP])

**Hints**
- In the editor: `/hint`, typed near the cloze you want hinted; works per cloze. ([HINT])
- In import/paste text: `{({hint})}` immediately after the cloze ([IMP]):
  ```
  {{Cloze 1}}{({Hint 1})} and {{Cloze 2}}{({Hint 2})}
  ```

**Combining with other cards.** One bullet can generate a Basic/Concept/Descriptor card *and* cloze cards: create the Basic card, then occlude parts of it. ([CF])

**LaTeX clozes.** Inside an equation, select a part and click **Create Cloze**. Holding Alt while clicking hides several parts on the same card. The cloze IDs (the `1` in `c1::`) can be edited by hand, and deletions sharing an ID are hidden together. ([LATEX]) The full in-equation syntax appears only in a screenshot, so the exact text around `c1::` is unverified.

**SDK.** A card's type is `'forward' | 'backward' | { clozeId: string }`, so each cloze card is identified by its cloze ID. ([SDK-Rem], [SDK-pkg]) In rich text a cloze is the `cId` format, with `cloze-hint` as a separate element type. ([SDK-pkg])

## Image occlusion cards

**At review time:** parts of an image are covered by opaque boxes on the front and revealed on the back — "like cloze deletion, but for images". It is a Pro feature, with up to 5 images on the free plan. ([IO])

**Creating one**
- `Ctrl+click` (`Cmd+click` on a Mac) on an image in your notes, or click the image flashcards button at the image's top right on hover (tap on mobile). ([IO], [CF])
- `/ioc` ("insert image occlusion") adds an image from a URL and starts an occlusion in one step. ([IO])
- In the occlusion editor, drag to draw an occlusion. A rectangle is the default; other shapes are in the toolbar's occlusion tool, and the **image occlusion tape** draws freehand strokes. ([IO])
- **Generate Cards with AI** in the occlusion editor covers a diagram's labels automatically and costs AI credits. ([IO])
- **PDFs and handwritten documents:** the drawing toolbar's *Occlusion Box Flashcard* and *Occlusion Tape Flashcard* tools work directly on the page. "Each box becomes a flashcard." ([IO], [PDF])

**Grouping.** Each occlusion is its own card by default. Shift-click several and press **Merge** to hide them on one card; **Split** undoes it. Letters on the occlusions show which go together, one letter per card. ([IO])

**Other per-card options** ([IO])
- **Labels:** *Label Front of Card* or *Label Back of Card*. Tape occlusions cannot carry labels.
- **Rotation.**
- **Set Occlusion Area**, which crops what the card shows.
- **Enable Test In Sequence Card**, with three options: *Test boxes individually* (the default), *Test boxes in sequence* (one sequence card replaces the individual cards), or *Both*.
- **Hide All, Test One.**
- **Disable All Cards** / **Delete All Cards**.

**Imported from Anki:** native Anki image occlusions and Image Occlusion Enhanced notes are converted on import. ([ANKI])

## Table and property cards

**Tables** ([TBL])
- **Advanced Tables:** each Name-column value is a Concept, and every other column is a Descriptor of it.
- **Simple Tables:** the grey header column holds the Concepts, and every other column is a Descriptor.
- To enable cards for a column: click the column header → **Flashcards Configuration** → **Enable For This Column**. Then set **Card direction** — forward (show the Concept and column name, ask for the cell), backward (show the column name and cell value, ask for the Concept), or both. In Advanced Tables you can also hover the column header and click its flashcard icon.
- **Configure Cards** adds other columns to the front (Advanced Tables only) or the back of the card.
- **Show Entire Table** keeps the whole table visible while each cell is tested separately.
- A filtered Advanced Table view limits practice to the visible rows.

**Properties** ([PROP]). In a template, the tagged bullet is the Concept and each property is a Descriptor. Choose the directions with the property's **Generate Card** option. **Configure Cards** shows other properties on the front or back.

## AI-generated cards

These do not add new card types. Generation "will use the same types of flashcards explained below", reformatted from text you paste. ([CF]) The entry points:
- Select text, then click **Create AI Cards** on the toolbar. The configuration screen chooses standard flashcards or a Multiple-Choice Quiz, Level of Detail, Card Types, language, model, custom instructions, and *Add cards in a portal*. Generated cards land in *Need to Learn*. ([AI])
- In the PDF reader, **AI Cards** on a highlight, or the flashcard icon next to a summary point or heading. ([PDF])
- **Guided Learn mode** (PDFs, web pages, YouTube): *Generate flashcards* per section, plus extraction of multiple-choice questions. ([GL])
- Image occlusion's **Generate Cards with AI**. ([IO])
- From a keyboard shortcut in the shortcuts list, the flashcard button adds a ready-made card to *RemNote > Feature*. ([KS])

## Direction and enable controls (all card types)

- **Arrow menu:** click the card's arrow → **Flashcard Direction**: forward, backward, both, or not at all. The arrow redraws to match. ([CF], [ML])
- **Disable a card**:
  - untick **Enable Cards** in the preview (the arrow becomes an em-dash);
  - press `Ctrl+Alt+F` (`Cmd+Opt+F` on a Mac) to toggle;
  - type `-` immediately after the arrow.
  - To re-enable a card disabled with `-`, click the arrow and choose a direction. ([DIS])
- **While reviewing:** the … menu has *Disable this card* (`B`) and *Disable all N cards from this bullet* (`F`). ([DIS])
- **Many bullets at once:**
  - select them, then `/practice` or `/fp` → **Practice Flashcard Bidirectionally** toggles both directions; ([DIS])
  - in the Omnibar, **Practice Forward** / **Practice Backward**; ([DIR])
  - `Ctrl+Shift+G` / `Cmd+Shift+G` toggles forward practice, and `Ctrl+Shift+B` / `Cmd+Shift+B` toggles backward practice. Both can be rebound in Settings > Keyboard shortcuts. ([DIR])
- **Disable Descendant Cards** powerup (`/ddc`) disables every card in a subtree, except cards in portals. ([DIS])
- **SDK:** `Rem.setPracticeDirection('forward' | 'backward' | 'none' | 'both')`, `Rem.setEnablePractice(boolean)`, `Rem.setType(SetRemType.DEFAULT_TYPE | CONCEPT | DESCRIPTOR)`, `Rem.setBackText(...)`. `RemType` also lists `DEPRECATED_BASIC_CARD = 4`, which suggests "basic card" was once its own Rem type and is now a default-type Rem with a back side. That reading is an inference from the enum's name, not a documented statement. ([SDK-Rem], [SDK-pkg])

## Card modifiers (not card types)

- **Extra Card Detail:** `/extra` or `/ecd` on a child bullet shows it on the back of the parent's card. Pro feature. In import text, write `#[[Extra Card Detail]]` in the bullet. ([ECD], [IMP])
- **Hints:** `/hint`. On a two-way card, choose *Hint for backward card* or *Hint for front card*. Per-cloze and per-multi-line-item hints are also supported. ([HINT]) The SDK lists the rich-text element types `card-hint-front`, `card-hint-back`, `multiline-card-item-hint` and `cloze-hint`. ([SDK-pkg])
- **Card Cluster:** `/cluster` on a parent makes the cards under it appear together, with the earlier items shown in grey. ([CLU])
- **Type in Answer:** from the arrow menu, from the queue's … menu, or with the `/tia` powerup. Out of scope beyond creation. ([CF], [TIA])

## Import / paste: general rules

From [IMP]. These apply both to the Import feature and to plain paste:
- Lines starting with `-` become bullets. Indentation sets nesting; the number of spaces does not matter as long as each level is consistent.
- Children carry the answers of multi-line, list-answer and multiple-choice cards.
- The first character of a delimiter marks the family: `:` for Concept, `;` for Descriptor.

## Open questions / unverified

1. **Disabled Basic token.** *Creating Flashcards* gives both `=-` and `>>-` (the latter as "type `-` after you've created a flashcard"). The import page gives `>-`. Whether all three are accepted when typed in the editor, and when pasted, is not confirmed. ([CF], [IMP])
2. **Bidirectional Descriptor token.** `;<>` in [CF] versus `;;<` in [IMP]. Unclear whether both work, or whether one is a typo.
3. **Concept multi-line / list / MCQ forward tokens.** [IMP] gives `;>>`, `;>>1.` and `;>>A)` for *Concept* forward cards. Each starts with `;`, contradicting the same page's colon/semicolon rule; `:>>`, `:>>1.` and `:>>A)` look like the intended forms, but no official page confirms them. The Concept multi-line table also has no "both" column, though `:::` is documented as a Concept multi-line trigger in [ML]/[CF].
4. **`<><` for a two-way multi-line Basic card** comes from [IMP] only. It is asymmetric with `<>` + Enter and is not confirmed for typing in the editor.
5. **`==A)` vs `>>A)`.** Typing uses `==A)` ([CF]); import uses `>>A)` ([IMP]). Whether each works in the other context is not stated. No `==1.` list-answer form is documented. One web-search summary claimed it existed, and no official page supports that.
6. **Direction of multiple-choice cards.** Only forward and disabled tokens are documented. Whether the arrow menu offers backward for MCQ is not stated.
7. **Dedicated `/`-commands per card type.** The brief named `/basic`, `/concept`, `/cloze`, `/multiline`, `/list` and `/mcq`. Of these, no help page documents `/basic`, `/cloze`, `/list` or `/mcq`. The documented commands are `/tc`, `/td`, `/imlc`, `/multi-line card item`, `/ioc`, `/mcr`, `/mcw`, `/correct`, `/incorrect`, `/hint`, `/ecd`, `/extra`, `/fp`, `/practice`, `/ddc`, `/cluster`, `/tia` and `/pr`. The `/`-menu is fuzzy-searched by name ([KS]), so other names may match menu items, but they are not documented shortcodes.
8. **Cloze keyboard shortcut.** Only `{` (with text selected) and the toolbar button are documented. No `Ctrl/Cmd`-modifier cloze shortcut appears in the help centre. The in-app shortcuts list (`Ctrl+Alt+Shift+H`) may contain one; not checked.
9. **Whitespace around delimiters.** No official page says whether `>>`, `::`, `;;` etc. need surrounding spaces, or whether they trigger mid-word, e.g. inside `foo::bar`. The examples all use spaces. Also unstated: what happens when a delimiter appears twice on a line, and whether delimiters are recognised inside inline code.
10. **Exact LaTeX cloze syntax.** [LATEX] mentions `c1::` but shows the full form only in a screenshot.
11. **Official changelog.** `feedback.remnote.com/changelog` renders client-side and could not be read without a browser, so no feature announcements were checked. Nothing in this note depends on it.
12. **Example layouts.** Most of RemNote's examples are screenshots. The code blocks marked "illustrative" were reconstructed from the surrounding text, not copied.

## Sources

- [CF] Creating Flashcards — https://help.remnote.com/en/articles/6025481-creating-flashcards
- [FB] Flashcard Basics — https://help.remnote.com/en/articles/8663109-flashcard-basics
- [CD] Creating Concept/Descriptor Flashcards — https://help.remnote.com/en/articles/6751778-creating-concept-descriptor-flashcards
- [ML] Multi-Line (List & Set) Flashcards — https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards
- [IMP] How to Import Flashcards from Text — https://help.remnote.com/en/articles/9252072-how-to-import-flashcards-from-text
- [MCE] Using Multiple-Choice Flashcards Effectively — https://help.remnote.com/en/articles/8191873-using-multiple-choice-flashcards-effectively
- [IO] Image Occlusion Cards — https://help.remnote.com/en/articles/6511625-image-occlusion-cards
- [DIS] Setting Priorities and Disabling Flashcards — https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards
- [DIR] Changing the Direction of Multiple Flashcards — https://help.remnote.com/en/articles/14122363-changing-the-direction-of-multiple-flashcards
- [KS] Keyboard Shortcuts — https://help.remnote.com/en/articles/7893440-keyboard-shortcuts
- [HINT] Mastering Flashcards with Effective Hints — https://help.remnote.com/en/articles/9626898-mastering-flashcards-with-effective-hints
- [ECD] Extra Card Detail Power-Up — https://help.remnote.com/en/articles/6751966-extra-card-detail-power-up
- [LATEX] Writing Equations with LaTeX — https://help.remnote.com/en/articles/6565191-writing-equations-with-latex
- [TBL] Generating Flashcards from Tables — https://help.remnote.com/en/articles/13869879-generating-flashcards-from-tables
- [PROP] Properties — https://help.remnote.com/en/articles/8126585-properties
- [UD] Universal Descriptors — https://help.remnote.com/en/articles/6030778-universal-descriptors
- [CODE] Using Code Blocks on Flashcards — https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards
- [ORDER] Can I make my cards appear in a specific order? — https://help.remnote.com/en/articles/8038791-can-i-make-my-cards-appear-in-a-specific-order
- [AI] Generating Flashcards with AI — https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai
- [PDF] Learning from PDFs and Files with the RemNote Reader — https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader
- [GL] Guided Learn Mode — https://help.remnote.com/en/articles/15724936-guided-learn-mode
- [CLU] Card Clusters — https://help.remnote.com/en/articles/10104223-card-clusters
- [TIA] Typing in Answers — https://help.remnote.com/en/articles/7752298-typing-in-answers
- [ANKI] Importing from Anki — https://help.remnote.com/en/articles/6751471-importing-from-anki
- [SDK-Rem] RemNote plugin SDK, `Rem` class — https://plugins.remnote.com/api/classes/Rem (also https://plugins.remnote.com/api/enums/RemType, https://plugins.remnote.com/api/enums/BuiltInPowerupCodes, https://plugins.remnote.com/api/enums/QueueItemType)
- [SDK-pkg] `@remnote/plugin-sdk` 0.0.46 on npm, `dist/interfaces.d.ts` and `dist/name_spaces/{rem,card}.d.ts` — https://www.npmjs.com/package/@remnote/plugin-sdk

[CF]: https://help.remnote.com/en/articles/6025481-creating-flashcards
[FB]: https://help.remnote.com/en/articles/8663109-flashcard-basics
[CD]: https://help.remnote.com/en/articles/6751778-creating-concept-descriptor-flashcards
[ML]: https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards
[IMP]: https://help.remnote.com/en/articles/9252072-how-to-import-flashcards-from-text
[MCE]: https://help.remnote.com/en/articles/8191873-using-multiple-choice-flashcards-effectively
[IO]: https://help.remnote.com/en/articles/6511625-image-occlusion-cards
[DIS]: https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards
[DIR]: https://help.remnote.com/en/articles/14122363-changing-the-direction-of-multiple-flashcards
[KS]: https://help.remnote.com/en/articles/7893440-keyboard-shortcuts
[HINT]: https://help.remnote.com/en/articles/9626898-mastering-flashcards-with-effective-hints
[ECD]: https://help.remnote.com/en/articles/6751966-extra-card-detail-power-up
[LATEX]: https://help.remnote.com/en/articles/6565191-writing-equations-with-latex
[TBL]: https://help.remnote.com/en/articles/13869879-generating-flashcards-from-tables
[PROP]: https://help.remnote.com/en/articles/8126585-properties
[UD]: https://help.remnote.com/en/articles/6030778-universal-descriptors
[CODE]: https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards
[ORDER]: https://help.remnote.com/en/articles/8038791-can-i-make-my-cards-appear-in-a-specific-order
[AI]: https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai
[PDF]: https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader
[GL]: https://help.remnote.com/en/articles/15724936-guided-learn-mode
[CLU]: https://help.remnote.com/en/articles/10104223-card-clusters
[TIA]: https://help.remnote.com/en/articles/7752298-typing-in-answers
[ANKI]: https://help.remnote.com/en/articles/6751471-importing-from-anki
[SDK-Rem]: https://plugins.remnote.com/api/classes/Rem
[SDK-pkg]: https://www.npmjs.com/package/@remnote/plugin-sdk
