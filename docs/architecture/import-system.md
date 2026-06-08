# Import system (Mark & Build) — architecture & how to add a type

How the manual-upload / text-interpreting importer is built as **reusable components** so a new entity type (class, feat, item, …) is mostly a *descriptor* + an optional *parser* — the whole UI (mark-up workspace, batch, format templates, preview) comes for free.

> **When to read this doc:**
> - You're adding a new entity type to `/compendium/import` (e.g. the **class** importer).
> - You're touching `src/lib/import/*` or `src/pages/compendium/ImportMarkWindow.tsx`.
> - You want to understand why an imported row is identical to a hand-edited one.

> **Companion docs:**
> - [docs/ui/style-guide.md](../ui/style-guide.md) — the tokens/classes the window uses. Read before any UI edit.
> - [docs/architecture/compendium-editor-patterns.md](compendium-editor-patterns.md) — the editor write helpers (`upsertSpell`, `upsertDocument`, `queueRebake`) the importer delegates to.
> - `docs/_drafts/manual-uploads-import-system-2026-06-04.html` — the original design + the verified **per-type save-path** table.

---

## The big idea

```
                 ┌──────────────────────────────────────────┐
   pasted text → │  descriptor.parseText  (per-type, PURE)  │ → ParseResult
                 └──────────────────────────────────────────┘
                                  │ fields + confidence + spans
                                  ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  ImportMarkWindow / EntityWorkspace  (GENERIC — any descriptor) │
   │  mark-up · select-to-assign · batch · format templates · preview│
   └───────────────────────────────────────────────────────────────┘
                                  │ raw form values
                                  ▼
                 ┌──────────────────────────────────────────┐
   D1 row     ←  │ descriptor.buildPayload → descriptor.commit│  (PURE → SIDE-EFFECT)
                 └──────────────────────────────────────────┘
                          delegates to the editor's REAL write fn
```

The window never knows about spells. It renders whatever `fields` a descriptor declares, calls the descriptor's hooks, and writes through the descriptor's `commit`. **Add a descriptor → you have an importer.** Add a `parseText` → it also interprets pasted text. Everything else (highlighting, confidence flags, batch splitting, format templates) is driven by the descriptor's optional hooks.

---

## Components

### 1. The descriptor — `ImportDescriptor` (`src/lib/import/types.ts`)

One object per type. The contract:

| Member | Required? | Purpose |
|---|---|---|
| `type`, `label`, `collection`, `nameField`, `descriptionField?` | ✅ | identity + which form key is the name/description |
| `fields: ImportFieldDef[]` | ✅ | the editable fields the window renders (see [field model](#field-model)) |
| `buildPayload(fields, ctx)` | ✅ · PURE | raw form values → the **editor-shape payload** (a faithful mirror of the hand-editor's `handleSave`) |
| `commit(id, payload)` | ✅ · side-effect | persist via the editor's **REAL write call** — never reimplement the D1 layer |
| `parseText(text)` | optional · PURE | interpret pasted text → `ParseResult` (fields + confidence + spans). No parser ⇒ manual-entry only |
| `assignTargets` + `assignField(target, text)` | optional · PURE | "select a span → assign it to *Range*"; `assignField` re-runs the classifier so a selection becomes coded values |
| `splitBlocks(text)` | optional · PURE | split a multi-entity paste into per-entity block offsets → drives batch + the division editor |

The split is deliberate: a **PURE half** (`buildPayload`, `parseText`, `assignField`, `splitBlocks`) drives the live preview and runs anywhere with no I/O; a **side-effecting half** (`commit`) does the one real write.

### 2. The registry — `src/lib/import/registry.ts`

Holds the descriptor map and the thin wrappers the window calls so it stays type-agnostic:

- `listImportDescriptors()`, `getImportDescriptor(type)`
- `resolveEntity(type, fields)` — PURE: validates required fields, applies defaults, mints `id = existingId ?? crypto.randomUUID()` + `identifier`, emits warnings (incl. empty-source), returns the **exact** `payload` that will be written (this IS the preview).
- `commitEntity(resolved)` — refuses on errors, else calls `descriptor.commit`.
- `parseEntityText` / `canParseText` / `getAssignTargets` / `assignFieldText` / `splitEntityBlocks` — guarded pass-throughs to the optional hooks.

Register a new type by importing its descriptor and adding it to the `DESCRIPTORS` map. That's the only registry edit.

### 3. The per-type parser (e.g. `src/lib/import/spellParse.ts`)

Pure, deterministic, **modular** — one small classifier per concern so a new format/dialect is a one-function change. The spell parser is the reference:

- `parseSpellText(text): ParseResult` — the assembler.
- `parseLevelSchool`, `classifyCastingTime/Range/Components/Duration`, `classifyLevel/classifySchool`, `normalizeSpellName`, `reflowDescription`, `splitSpellBlocks` — the building blocks, **exported** so `assignField` re-uses the exact same logic when a human re-assigns a span.

Key conventions a parser follows:
- Emit a **`span: {start,end}`** per field (offsets into the input) → the window highlights where each value came from.
- Emit **`confidence`** (`high`/`low`/`none`) → only sub-`high` fields get flagged for a human.
- Never set fields it can't find to a stale value — set them explicitly (or omit) every run.
- Put recognized-but-unmappable text into `leftovers` (e.g. a class list, a reaction trigger) rather than dropping it.
- Tolerate inline BBCode tags (`[b]…[/b]`) so HTML→BBCode pastes still parse (see [HTML](#html--bbcode-capture)).

### 4. The window — `ImportMarkWindow.tsx` (GENERIC)

Everything here works for any descriptor; you rarely touch it to add a type. It contains:

- **`EntityWorkspace`** — the annotated source (left, gold-highlighted per span, hover-link, **select-to-assign** popover) ↔ the structured `fields` (right) with a **Fields / Preview** tab. Reused by single mode and each batch candidate's *Review*.
- **`DivisionEditor`** — batch mode's left panel: gold bars per block, `＋ split` on hover, `Merge up` per bar. Driven entirely by `splitBlocks` output + manual edits to the boundary list.
- **Format templates** — `Save as format` captures `target → line-index` from one marked-up entity into `localStorage['dauligor:importFormat:<type>:<source|default>']`; auto-applied over the heuristic parse on later interprets.
- **`renderPreview`** — the one **type-aware** spot in the window: it feeds a real detail-pane component (`SpellDetailPanel`) the resolved payload adapted to its row shape. New types add a branch here (see the recipe).

---

## Fidelity contract (CRITICAL)

`commit()` **must** call the same write function the hand-editor uses, with the verbatim editor-shape payload. This is why an imported row is byte-identical to a manual save — including derived columns (e.g. spells' materialized `activation/range/duration/shape` buckets that `upsertSpell` computes). Verified per-type paths (from the design draft's table):

| Type | `commit` calls |
|---|---|
| spell | `upsertSpell(id, payload)` |
| feat / item / feature | `upsertFeat` / `upsertItem` / `upsertFeature` (+ `queueRebake('feature', id)`) |
| class | `upsertDocument('classes', id, d1Data)` + `queueRebake('class', id)` + a child `upsertFeature` row per feature (`parentType: 'class'`, `+ queueRebake('feature', …)`) |
| subclass | `upsertDocument('subclasses', id, d1Data)` + `queueRebake('subclass', id)` + child `upsertFeature` rows (`parentType: 'subclass'`); `class_id` / `class_identifier` come from the required parent-class picker |
| options / species / background / facility / source / system pages / spell_rules | direct `upsertDocument(collection, id, payload)` (or `saveRule` / `saveSystemPage*`) |

Universal idioms: `id` is a **separate positional arg** = `existingId ?? crypto.randomUUID()`; `identifier = identifier.trim() || slugify(name)`; `tag` column is `tag_ids` for class/subclass, `tags` elsewhere; legacy tables are snake_case, `backgrounds`/`species`/`species_options`/`background_features` are camelCase.

> **Scope rule (like spells skip activities):** the importer captures the **skeleton + required/textual fields**, not the deep authored structure. Spells don't parse activities; the **class importer should capture identity + simple fields (name, identifier, description, hit die, primary ability, …), not the advancement tree** — that stays in the class editor. Keep `parseText` honest: flag what it can't find, leave the heavy authoring to the editor.

---

## Field model

`ImportFieldDef` kinds the window renders: `text`, `textarea`, `number`, `boolean`, `select` (needs `options`), and `source` (a persistent `<select>` from the `sources` table, rendered top-level and shared across creates). The class/subclass importers add richer kinds, each reusing the matching editor control: `markdown` (the `MarkdownEditor` TipTap editor — value carries site BBCode, handles rich paste), `abilities` (ability-pill toggles, value = UPPERCASE ability ids), `proficiencies` (the reusable `ProficienciesEditor` grid; value is the class proficiency object), `features` (the feature organizer — merge / collapse / re-route drafts), and `parentClass` (a `SingleSelectSearch` of existing classes for a subclass's parent; value is `{ id, identifier, name }` so `buildPayload` can fill both `class_id` and `class_identifier`). Group fields with `group` ("Identity", "Mechanics", …) → they render as `.config-fieldset` sections. `key` must match the camelCase form-state key `buildPayload` reads, so the payload stays a faithful mirror of the editor.

> The structured kinds (`proficiencies`, `parentClass`, …) need external catalogs (the skills/armor/… tables, the classes list). The window loads these once and shares them through `ImportCatalogsContext`; `FieldControl` reads the context. A `required` field whose value is an **object** (like `parentClass`'s `{id,…}`) is validated shape-aware in `resolveEntity` — blank when every value is falsy — so "no parent class chosen" still blocks the create.

## Interpreter model

`parseText` returns `ParseResult { fields: Record<key, ParsedField>, leftovers: string[] }`. A `ParsedField` is `{ value, confidence, span?, note? }` where `value` is already in the field control's shape (string for text/select/number, boolean for boolean). The window: applies every `value` to form state, flags every sub-`high` field (blood ring + `note`), draws a gold highlight for every `span`, and lists `leftovers` under the source.

## HTML / BBCode capture

A `<textarea>` only receives the clipboard's `text/plain`, so the window's `onPaste` grabs the `text/html` flavour and converts it the way the rich editor (`MarkdownEditor` → TipTap) does: parse with **`DOMParser`**, normalize the DOM (promote inline styles → `<em>/<strong>/<u>`, rename `<b>/<i>` → clean tags, strip noise attrs, drop `<o:p>`/`<style>`/comments), then the canonical `htmlToBbcode(cleanFoundryHtml(...))`. The stored description is BBCode (the site's format). Parsers therefore must tolerate inline BBCode tags around values/labels. PDFs put only plain text on the clipboard — formatting there is unrecoverable.

---

## Recipe — adding the **class** importer

1. **Descriptor** `src/lib/import/clazz.ts` (avoid the `class` reserved word):
   - `type: 'class'`, `label: 'Class'`, `collection: 'classes'`, `nameField: 'name'`, `descriptionField: 'description'`.
   - `fields`: name, identifier, source, plus the simple class fields (hit die `select`, primary ability, saving-throw proficiencies, description `textarea`, …). **Not** the advancement tree.
   - `buildPayload`: mirror `ClassEditor`'s save shape (read the editor to copy the exact keys; snake↔camel and `tag_ids` per the fidelity table).
   - `commit(id, payload)`: `await upsertDocument('classes', id, normalized); await queueRebake('class', id);` — exactly what `ClassEditor` does on direct save.
2. **Register** it in `registry.ts` (`DESCRIPTORS[clazzDescriptor.type] = clazzDescriptor`) and the barrel.
3. **(Optional) `parseText`** in `src/lib/import/classParse.ts` if class blocks have a parseable text format (hit die line, proficiency lists). Reuse the spell parser's modular shape: one classifier per line, emit spans + confidence + leftovers. Add `assignTargets`/`assignField` (re-using those classifiers) and `splitBlocks` for batch. Skip these and the type is still a perfectly good manual-entry importer.
4. **(Optional) preview** — add a `type === 'class'` branch to `renderPreview` in `ImportMarkWindow.tsx` that feeds a class detail component its row shape (mirror how the spell branch adapts the payload for `SpellDetailPanel`).
5. **Verify** like the spell type: `tsc` clean, create one live on `:3003`, and confirm the D1 row matches a `ClassEditor` save (same columns, same `queueRebake` side-effect).

That's it — steps 1–2 give a working class importer; 3–4 add interpretation + preview; the mark-up workspace, batch, division editor, and format templates all work the moment the optional hooks exist.

### Second worked type — subclass (`src/lib/import/subclazz.ts`)

The subclass importer is the class recipe again, with one structural difference and a few reuses:

- **Required parent class.** A `parentClass` field (`classRef`, value `{id, identifier, name}`) is the one thing a subclass needs that a class doesn't. `buildPayload` reads it for `class_id` / `class_identifier` (falling back to `slugify(name)`, like `SubclassEditor`). It's `required`, validated shape-aware (see [field model](#field-model)).
- **Reuses the class feature pipeline.** `parseSubclassText` (in `classParse.ts`) routes the body through the **same** `splitClassSections` / `groupClassFeatures` splitter — subclasses carry no identity stat block (hit die, saves, proficiencies all inherit from the parent), so it only organizes features + a note. `assignAppend` / `assignAppendMany` reuse `parseFeatureSpan` / `splitFeatures`.
- **Child features use `parentType: 'subclass'`** (`feature_type: 'class'`, matching every existing subclass feature). A `Spellcasting` section routes into the **subclass-shape** spellcasting config (note: `progression` + `level: 3` default — distinct from the class shape).
- **`advancements: []`** — the editor synthesizes the canonical subclass progression on first save (same skeleton-default rule as the class importer's advancement tree).
- **No preview** — there's no standalone subclass detail pane, so the window gates the Preview button to `type === 'class'`. The **Overwrite** picker is type-aware (it loads the current descriptor's `collection`, so subclass overwrites subclasses).

**Folded sub-headers render as flat headings, not bold.** When the feature pipeline folds a sub-section header (e.g. "Cantrips") into a feature body — during parse, or via the Features panel's merge / collapse — it emits `[h3]Name[/h3]` on its own line with a blank line after (a flat site heading via `bbcodeToHtml`, sitting in its own block so it can be re-tagged/edited), **not** `[b]…[/b]`. Route every folded header through the shared `subHeadingBBCode` helper + `SUBHEADING_SPLIT_RE` (exported from `classParse.ts`) so the merge ↔ split round-trip stays exact. `SUBHEADING_TAG` is the single knob for the level.

---

## Reference implementation

The spell type is the worked example to copy: `src/lib/import/spell.ts` (descriptor), `spellParse.ts` (parser + classifiers), and the spell branches in `ImportMarkWindow.tsx` (`renderPreview`). The window/registry/types are type-agnostic and should not need spell-specific edits when you add a type.
