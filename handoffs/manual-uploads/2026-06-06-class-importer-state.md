# Handoff — Class Importer (Mark & Build), state snapshot

**Date:** 2026-06-06 · **Branch:** `manual-uploads` · **Author:** Claude
**Supersedes** `2026-06-05-import-system-state.md` for the import system (that one covered the spell importer + window; this adds the whole **class importer**: parser, proficiency grid + auto-resolver, features panel + child-feature commit).

---

## TL;DR

The in-app importer at **`/compendium/import`** (admin) now imports **classes** end-to-end from a pasted write-up:

1. **Paste** a class write-up → click **Interpret**.
2. **Identity auto-fills**: name, hit die (dropdown), saving throws, equipment, a primary-ability hint.
3. **Proficiencies auto-fill the grid** (catalog-aware): "Simple weapons" → the Simple Weapon category, "Choose two from Arcana, Deception, …" → choiceCount 2 + the skill row ids, "None"/"All armor" handled.
4. **Features panel** is pre-organized: sub-headers folded into their parent; you **tick several rows and Merge** them into one feature, edit name/level, or re-route a row (Feature / Spellcasting / ASI / Subclass / Skip).
5. **Create** → writes the class through the editor's real `upsertDocument('classes',…)` + `queueRebake('class',…)`, **plus a child feature record per "Feature" row** through the editor's real `upsertFeature` + `queueRebake('feature',…)`. Spellcasting/ASI/Subclass rows feed class fields instead of becoming features.

Spells were the proof-of-concept; classes are now the second fully-working type. Everything below was verified live on the **Necromancer** write-up (the user's test case) against the real local catalog + D1.

---

## Branch state (CRITICAL)

- `manual-uploads` is **18 commits ahead / 12 behind `origin/main`**. **NOT pushed** (local only). `main` = production (auto-deploys). **Never push to main without explicit, in-conversation OK; show `git log origin/main..HEAD` first; rebase onto `origin/main` before any merge** (`git fetch origin && git rebase origin/main`).
- Working tree clean **except 4 untracked throwaway scripts** under `scripts/_*` (keep them OUT of commits — stage files explicitly, never `git add .`):
  - `scripts/_mint-token.mjs` — prints an admin JWT for browser testing (reads `.env`).
  - `scripts/_test-classparse.ts` — runs the class parser on the Necromancer text (`npx tsx scripts/_test-classparse.ts`).
  - `scripts/_test-profresolve.ts` — runs `resolveClassProficiencies` with mock catalogs.
  - `scripts/_test-profdisplay.ts` — checks the `buildGroupedProficiencyDisplayName` fix.
- **Commits ahead (newest first):**
  - `81a42f2` feat(import): auto-resolve class proficiencies from text
  - `169bfca` fix(proficiencies): resolve skills display name for identifier-keyed selections — **touches the SHARED `src/lib/proficiencySelection.ts`** (see Cross-branch).
  - `df44fbf` feat(import): class features panel — section grouping + child-feature commit
  - `145c923` feat(import): class text parser — identity fields + feature routing
  - `9e689ff` fix(import): emit full row ids for skills, not identifier codes
  - `69902fa` feat(import): proficiencies grid in class importer
  - `3d2b21b` docs(import): class/subclass editor field catalog (HTML draft)
  - `27b7f70` feat(import): class importer (descriptor + manual-entry path)
  - `40994a4`, `cc6e296`, `bdc3cf9`, `d49444f`, `43eaa35`, `3d75690`, `14f9d12`, `50d14a9` — earlier spell-importer + handoff/doc commits.
  - `44e0141`, `a05736b` — local-dev + auth docs (cherry-pick candidates for main; ask first).

---

## Architecture (how the import system works)

**Pure core `src/lib/import/`** — front-end-agnostic:
- `types.ts` — the `ImportDescriptor` contract + field/parse types. `ImportFieldKind` now includes `'source' | 'proficiencies' | 'features'` (the last two are rich controls the window renders). `ImportFieldDef.proficiencyTypes?` picks which prof sub-grids to show.
- `registry.ts` — `DESCRIPTORS` map (`spell`, `class`), `resolveEntity` (PURE preview → the exact payload `commit` writes), `commitEntity` (refuses on errors, else `descriptor.commit`), and pass-throughs (`canParseText`, `parseEntityText`, `getAssignTargets`, `assignFieldText`, `splitEntityBlocks`).
- `index.ts` — barrel. Exports types + registry + `FeatureDraft` type + `resolveClassProficiencies`.
- `spell.ts` / `spellParse.ts` — the spell descriptor + parser (reference implementation; unchanged this session).
- `clazz.ts` — the **class descriptor** (named `clazz` to dodge the reserved word).
- `classParse.ts` — the **class parser + proficiency resolver** (this session's core work).

**The window `src/pages/compendium/ImportMarkWindow.tsx`** (GENERIC; type-agnostic except a couple of spots):
- `EntityWorkspace` — annotated source (left, gold spans, select-to-assign) ↔ structured `fields` (right) with a Fields/Preview tab. Used by single + each batch candidate.
- `FieldControl` — renders one field by `kind`. Branches: boolean, **proficiencies** (renders the reusable `ProficienciesEditor`), **features** (renders `FeaturesPanel`), textarea, select, number, text. Reaches the proficiency catalogs via `ImportCatalogsContext` (a React context the window provides).
- `handleInterpret` — `parseToState` → applies parsed fields. **For `type === 'class'` with catalogs loaded, it ALSO runs `resolveClassProficiencies(text, catalogsValue)` and sets the `proficiencies` grid value** (catalog-bound, so it can't live in the pure parser).
- `handleManualEntry` — for parser-less types only (class now has a parser, so it uses Interpret). The "Enter details →" button shows only when `!hasParser`.
- Catalog loading: a `useEffect` loads `skills/armor/armorCategories/weapons/weaponCategories/tools/toolCategories/languages/languageCategories` (denormalized) when any descriptor has a `proficiencies` field, builds grouped-by-category maps, and exposes them via `catalogsValue` (a `ProfCatalogs`). **Skills are stripped of `identifier`** in the catalog (`dSkills`) so the grid emits row ids (see Skills-id saga).
- The whole return is wrapped in `<ImportCatalogsContext.Provider value={catalogsValue}>`.

---

## The class descriptor — `src/lib/import/clazz.ts`

**Fields** (camelCase keys = ClassEditor state keys; `buildPayload` emits snake_case `d1Data`):
`name`(req) · `identifier`(auto slug) · `sourceId`(source) · `category`(core/alternate/new) · `hitDie`(select d6/d8/d10/d12) · `primaryAbility`(text) · `savingThrows`(text) · `proficiencies`(kind `proficiencies`, types armor/weapons/skills/tools/languages — **savingThrows stays a text field, NOT in the grid**) · `description`/`preview`/`lore`(textarea) · `startingEquipment`/`wealth`/`multiclassing`(text/textarea) · `subclassTitle`(text) · `_features`(kind `features`, default `[]`).

**`buildPayload(f, ctx)`** — mirrors `ClassEditor.handleSave`'s inline `d1Data` (snake_case; `upsertDocument` is generic and JSON-stringifies objects/arrays). Key points:
- `proficiencies` = `buildProficiencyCollection(f.proficiencies, savingThrows)` — sanitizes the grid value into the EXACT `sanitizeProficiencyCollection` shape, with `savingThrows.fixedIds` seeded from the saves text field (the top-level `saving_throws` column and the proficiency sub-object stay in sync).
- `multiclass_proficiencies` = empty collection.
- `routeFeatures(f._features, primaryAbility[0])` produces overrides: **asi** rows → `asi_levels`; **subclass** rows → `subclass_title` + `subclass_feature_levels`; **spellcasting** rows → the `spellcasting` JSON (`buildSpellcastingConfig`: hasSpellcasting, ability from "X is your spellcasting ability" or the primary-ability hint, type known/prepared, isRitualCaster from "ritual", description = body, scaling-table ids left empty for manual pick); **feature** rows → carried as `__features` (a NON-column key).
- Default `advancements: []` (skeleton — author/initialize in the editor); `created_at` omitted (DB default).

**`commit(id, payload)`** — strips `__features`, then:
- `await upsertDocument('classes', id, classData); await queueRebake('class', id);`
- for each `__features` row: `crypto.randomUUID()` id, `await upsertFeature(fid, {name, identifier: slugify(name), parentId: id, parentType: 'class', featureType: 'class', level, description, createdAt, updatedAt}); await queueRebake('feature', fid);` — `upsertFeature` (from `../compendium`) runs `normalizeFeatureData` internally (the editor's real feature write path).

**`parseText: parseClassText`** (so the class type shows "Interpret").

---

## The class parser — `src/lib/import/classParse.ts`

All **PURE** except `resolveClassProficiencies` which takes catalogs as a param.

### `parseClassText(text): ParseResult`
Fills identity fields:
- `name` — from `/\bas an?\s+([A-Za-z'’ \-]+?),?\s+you\s+(?:have|gain|can)/i` → `normalizeClassName` (Capitalize every word — the user's "Capitals At The Start" rule).
- `hitDie` — `classifyHitDie`: `/hit\s*di(?:c?e|ce)\s*:?\s*\d*\s*d\s*(\d+)/i`.
- `savingThrows` — `grabLabel(/Saving Throws?/)`, normalized to "Constitution, Intelligence".
- `startingEquipment` — from the "Equipment" header / "You start with…" to **the next section header** (scans lines via `looksLikeHeader`, NOT blank lines — there usually aren't any).
- `primaryAbility` — low-confidence hint from "X is your spellcasting ability".
- `_features` — `groupClassFeatures(splitClassSections(text))` as `FeatureDraft[]`.
- `leftovers` — the parsed prof lines (informational) + a feature summary.

### `splitClassSections(text): ClassSection[]` + `groupClassFeatures(sections)`
- A **header** = a short (≤48 char), Title-Case line with no `.:=•,;()"` and ≤6 words (`looksLikeHeader`).
- **Level** comes from the body's opening prose: `firstLevel` = `/(?:starting at|beginning at|when you reach|also at|also beginning at|at)\s+(\d+)(?:st|nd|rd|th)\s+level/i`. `allLevels` (for asi/subclass) is **lenient** — every `\d+(?:st|nd|rd|th)` ordinal 1–20 (so "4th level, and again at 8th, 12th, 16th, and 19th level" → all five).
- **Routing** (`classifyKind`): `Class Features`→meta; `Hit Points/Dice|Proficiencies|Equipment`→identity (ignored); `Spellcasting`→spellcasting; **SPELLCASTING_SUB** regex (`cantrips|spell slots|spells known|spellcasting ability|ritual casting|spellcasting focus|preparing and casting|learning spells|…`)→subheader; `Ability Score Improvement`→asi; body matching `grants you (…)features at|detailed at the end of the class`→subclass; else has-level→feature; else→subheader.
- `groupClassFeatures` folds **subheaders into the preceding feature OR spellcasting block** (`[b]Name[/b]\nbody`); orphan subheaders become features; identity/meta dropped. So Cantrips/Spell Slots fold into Spellcasting; Animate/Commanding/Maximum Thralls fold into Thralls.
- **Verified routing of the Necromancer page:** Spellcasting→config · Charnel Touch L1 · Thralls L2 · Animate Dead L5 · Bag of Bones L2 · Grave Ambition→subclass [3,6,10,20] · Black Arcana L3 · ASI→[4,8,12,16,19] · Critical Spellcasting L5 (14th-level upgrade stays in its body) · Enthralling Presence L7 · Undying Servitude L18. = 8 features + 3 routings.

### `resolveClassProficiencies(text, catalogs): proficienciesObject`
Catalog-aware. `extractProficiencyLines` (via `grabLabel`) → `{armor, weapons, tools, languages, skills}`. Then:
- **Skills** (`resolveFlat`) → row **ids**. `parseChoose` ("Choose two from A, B" → `{choose:2, list}`), `splitTerms` (comma/and/or), `matchByName` (loose: lowercase, drop apostrophes + trailing plural `s`, exact then startsWith). `choose` → `choiceCount` + `optionIds`; else `fixedIds`.
- **Armor/weapons/tools/languages** (`resolveGrouped`) → category **ids** for category-name matches (+ "all X" → every category of that kind) and item **ids** for item-name matches → `categoryIds` / `fixedIds` (or `optionIds` under a choose). "None" → empty.
- Returns the full proficiency object (`savingThrows` left empty — filled from the saves text field at buildPayload).
- **Verified live:** "Simple weapons" → the real Simple Weapon category id; "Choose two from Arcana…Religion" → choiceCount 2 + 8 real skill ids, all 8 checked in the grid.

`ResolveCatalogs` type = `{allSkills, allArmor, allArmorCategories, allWeapons, allWeaponCategories, allTools, allToolCategories, allLanguages, allLanguageCategories}` — `catalogsValue` (ProfCatalogs) is structurally compatible.

---

## The proficiencies grid — `ProficienciesEditor` reuse

- New field kind `'proficiencies'`; `FieldControl` renders the reusable `src/components/compendium/ProficienciesEditor.tsx` (the SAME component the class editor uses) with `showDisplayNames={false}` and `types={['armor','weapons','skills','tools','languages']}`.
- The window loads + denormalizes the catalogs and builds grouped-by-category maps (`groupByCategory`), shares via `ImportCatalogsContext`.
- `buildProficiencyCollection` (in clazz.ts) sanitizes the grid value into the exact `sanitizeProficiencyCollection` output, seeding saves from the text field.

---

## The features panel — `FeaturesPanel` (in `ImportMarkWindow.tsx`)

- New field kind `'features'`. The value is `FeatureDraft[]` (`{id, kind, name, level, levels, body}`), produced by the parser.
- UI: per row → a **select checkbox** (for merge), a **kind `<select>`** (Feature/Spellcasting/ASI/Subclass/Skip), an editable **name**, an editable **level** (for feature kind) or `[levels]` display (asi/subclass), a 2-line body preview, and a remove ✕. Toolbar: **"Merge selected (N)"** (≥2 ticked → folds them into the first, concatenating bodies as `[b]name[/b]\nbody`) and **＋ Add**.
- `crypto.randomUUID()` for new-row ids. The panel uses local `useState` for the selection set.

---

## ⭐ The Skills id saga (READ THIS — it caused churn)

**Canonical:** class skills are keyed by the **full skill row id** (UUID like `HDkoJ5ymK7abBb0t82ar`). `ClassView` + `ClassPreviewPane` + `CharacterBuilder` + `classExport` all resolve skills via `allSkills.find(s => s.id === id)`. Real classes store full ids (Barbarian) — some legacy ones (Ranger) store full ids **plus** redundant identifier codes that the views drop.

- The shared `ProficienciesEditor`'s `idOf` returns `identifier || id`; skill rows have an `identifier` (the dnd5e key, e.g. `"acrobatics"`), so the grid would naturally emit **codes**, which the views can't resolve → "None".
- **Fix (importer-local, `9e689ff`):** the window's skills catalog is built with `identifier` **stripped** (`dSkills`), so `idOf` falls back to `id` and the grid emits full row ids. **DO NOT change the shared `idOf`** — I tried that, it was wrong, and I reverted it (the editor stores skills by identifier on purpose, for the Foundry export; the importer just needs ids for the views).
- The proficiency resolver also emits **row ids** for skills (consistent with the grid).
- Separately, `169bfca` fixed `buildGroupedProficiencyDisplayName` (in shared `proficiencySelection.ts`) to match items by **id OR identifier** (`isSelected`) so the **skills display name** resolves for both schemes — the class editor stores skills by identifier, so its Sync button + on-save fallback were producing a blank `skillsDisplayName`. The user diagnosed + provided that fix; the other branch reverted theirs, so ours is canonical.

**Net:** importer stores skills by **id** (renders in views); editor stores by **identifier** (for export); the display-name helper now tolerates both.

---

## Fidelity contract

`commit` MUST call the editor's real write fns with the editor-shape payload:
- class → `upsertDocument('classes', id, d1Data)` + `queueRebake('class', id)` (snake_case `d1Data` mirrors `ClassEditor.handleSave` exactly).
- feature → `upsertFeature(id, camelData)` (runs `normalizeFeatureData`) + `queueRebake('feature', id)`.
A class/feature created here is byte-identical to a hand-edited save. Verified by D1 queries at each step.

---

## Dev / test setup (how to resume)

- **Dev stack on :3003** — start with `preview_start("manual-uploads")` (`.claude/launch.json`). `serverId` changes each launch; the stack **drops periodically** (PC sleep, idle) — just `preview_start` again, then poll `curl :3003` until 200. App is **no-watch**: after a source edit, **reload the page** (navigate via `location.href`) to pick it up. Worker on **:8790**. NEVER `npm install` in the worktree (junctioned `node_modules`).
- **Auth for browser tests:** `node scripts/_mint-token.mjs` prints an admin JWT (HS256, sub `n65elKlUnDhN8lGAiI1MfETUsHO2`, signed with `.env`'s `AUTH_JWT_SECRET`). Inject: `localStorage.setItem('dauligor:authToken', <jwt>)` then reload. localStorage clears on PC restart → re-inject.
- **Query LOCAL D1:** `POST http://localhost:8790/query` with `Authorization: Bearer <API_SECRET from worker/.dev.vars>` and `{sql, params}`. API_SECRET = `q9nHN9H3Ny2ilWXWFlViQD5LBI63sc1KirhrwTyc` (local only). Use heredoc bodies (`--data @- <<'JSON'`) to avoid shell-escaping pain.
- **Query REMOTE D1 (read-only, user-permitted):** `npx wrangler d1 execute dauligor-db --remote --command "SELECT …" --config worker/wrangler.toml`. **NEVER `wrangler d1 migrations apply --remote`.** Read-only SELECTs are fine and the user invited them ("look at the remote database").
- **Pure-parser tests:** `npx tsx scripts/_test-classparse.ts` (parser), `_test-profresolve.ts` (resolver), `_test-profdisplay.ts` (display fix). Fast, no browser.
- **tsc:** `npx tsc --noEmit` — there are **6 known pre-existing errors** (`asChild` ×5 in CompendiumBrowserShell/SpellList/LoreEditor + `characterShared.ts:520`). A clean run = 6 total, 0 in import files.
- The local D1 is a **production-seed copy** (84 tables). It LACKS the `classes.content_hash` column (a later migration) — irrelevant to the importer. Skills table = 18 rows with random `id` + dnd5e `identifier` (matches remote).

### Driving the browser (gotchas)
- `preview_eval` is the reliable driver. **`preview_click` with a class selector can hit the wrong element** (e.g. a sidebar `.btn-gold-solid`) — click by text via eval: `[...document.querySelectorAll('button')].find(b=>/^Create Class$/.test(b.textContent.trim())).click()`.
- React controlled inputs: set value via the native setter then dispatch — `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true}))`. For `<select>` also dispatch `change`.
- **One mutation per eval** when toggling grid checkboxes / merging — React batches synchronous clicks and stale closures clobber each other; separate evals let React flush between.
- Read the resolved payload from the live preview: `JSON.parse(document.querySelector('details pre').textContent)` — this IS what `commit` will write.
- `preview_eval` async IIFEs can hit a 30s read timeout if they do many awaits; the mutations still apply — re-read state in a follow-up eval.

---

## Verified this session (live :3003 → local D1, + tsx)

- Parser: identity fields + the full Necromancer feature routing (8 features + spellcasting/asi/subclass) — both tsx and live.
- Proficiency grid: a manual selection (fixed Athletics + "choose 2" Insight/Persuasion + Light Armor category) persisted to D1 with full row ids; renders in `ClassView` ("Athletics; Choose 2 from: Insight, Persuasion" + "Light Armor").
- Proficiency auto-resolver: "Simple weapons" → category, "Choose two from …" → choiceCount 2 + 8 skill ids, grid shows all 8 checked.
- Features panel: **merge** (Charnel Touch + Thralls → one feature), kind routing.
- Full create: a class with asi_levels `[4,8,12,16,19]`, subclass_title "Grave Ambition" + levels `[3,6,10,20]`, spellcasting INT/known/ritual, and **2 child feature rows** — all confirmed in D1. (Test classes were deleted after.)
- `proficiencySelection` display-name fix: by-identifier selection now yields "Athletics; and 2 of your choice from Acrobatics, Perception" (was '').

---

## Open / next work

1. **Subclass importer** — the natural next type. Recipe: a `subclassDescriptor` (`src/lib/import/subclazz.ts`) mirroring `SubclassEditor.handleSave`'s `d1Data` (`upsertDocument('subclasses', id, d1Data)` + `queueRebake('subclass', id)`; needs `class_id` + `class_identifier` from a **parent-class picker** — add a `kind: 'classRef'` field or reuse the source-style picker, loading `fetchCollection('classes')`). Subclasses are mostly name + description + lore + **features** (parent_type='subclass') + optional spellcasting — the **feature pipeline + proficiency-less parser already exist**, so reuse `classParse`'s feature splitter (route features to `upsertFeature(..., parentType:'subclass')`). Source is REQUIRED on subclass save. See `docs/_drafts/class-subclass-importer-parts-2026-06-05.html` for the full field/routing decisions.
2. **Feature-panel polish** — inline body editing (currently a 2-line preview; edit via merge or in the editor after); surface **unmatched proficiency terms** as warnings (the resolver silently drops non-matches today).
3. **Proficiency resolver edge cases** — "thieves' tools", weapon-specific grants ("a longsword, shortbow"), "two languages of your choice"; multi-word tool names.
4. **Advancement base** (optional) — call `buildCanonicalBaseClassAdvancements` in clazz `buildPayload` so an imported class ships a populated base advancement tree instead of `[]` (HP/saves/profs/subclass/ASI auto-derived from the captured fields). Decided earlier to keep `[]` (editor's "Initialize Base Advancements") — revisit if desired.
5. **Then** feat/item importers (helper write paths), per the fidelity table.

---

## Cross-branch notes

- `169bfca` edits the SHARED `src/lib/proficiencySelection.ts` (the skills display-name fix). The user routed it to another branch first; **that branch reverted, so ours is the canonical fix.** It's behavior-preserving except fixing the blank `skillsDisplayName` (and it helps both editor-stored identifiers and importer-stored ids).
- The class editor / `ProficienciesEditor` / `ClassView` are shared with the compendium-editors domain. **Do not change shared editor internals on a hunch** — diff against `origin/main` and confirm the actual read/write convention first (this is what burned the `idOf` attempt). For api/_lib or the `/api/module` router or their :3000 server, write a request-handoff instead of editing.

---

## Pointers

- **Component guide + add-a-type recipe:** `docs/architecture/import-system.md`.
- **Field/routing catalog (rev 2, decisions folded in):** `docs/_drafts/class-subclass-importer-parts-2026-06-05.html`.
- **Reference type:** the spell descriptor (`spell.ts` / `spellParse.ts`) + spell branches in the window.
- **Memory:** `project_import_system` (⭐), `reference_style_guide`, `feedback_main_is_production_deploy`, `project_d1_remote_migration_apply`, `project_d1_local_seed_method`, `feedback_handoffs_folder`, `feedback_cross_branch_handoff`.
- Prior handoff: `handoffs/manual-uploads/2026-06-05-import-system-state.md` (spell importer + window internals).
