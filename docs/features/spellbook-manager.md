# Spellbook Manager (Project)

> **Status:** All layers shipped, including the Foundry export round-trip
> (Layer 5). Layer 1 (per-class master spell list + rules), Layer 2
> (GrantSpells / ExtendSpellList in both modes × both resolver kinds),
> Layer 3 (Spell Manager + Sheet panels + caps + character effective tag
> set + prereq gating + favourites + watchlist), Layer 4 (sized,
> multi-active Spell Loadouts), and Layer 5 (Foundry actor export of
> spells, loadouts, and spell-list extensions per
> [actor-spell-flag-schema.md](../../module/dauligor-pairing/docs/actor-spell-flag-schema.md))
> all complete. Branch ready to merge.

## Active work resume point

> **For the next session — read this first.** Resume here if work is being picked up after a
> conversation compaction.

### Where we are

Layer 2 builder-side resolution is functionally complete for **both** resolver kinds in **all**
mode/scope combinations:

- `GrantSpells mode='fixed' resolver.kind='explicit'` — auto-applied. Shipped.
- `GrantSpells mode='fixed' resolver.kind='rule'` — auto-applied; rule matches all 5k spells
  evaluated client-side via `spellMatchesRule`. Shipped.
- `GrantSpells mode='choice' resolver.kind='explicit'` — `spell-choice` card → picker dialog with
  the explicit pool. Shipped.
- `GrantSpells mode='choice' resolver.kind='rule'` — `spell-choice` card → picker dialog with the
  rule's matched spells as the pool. Shipped.
- `ExtendSpellList resolver.kind='explicit'` — auto-applied across all three scopes
  (`'self'` / `'all-spellcasting'` / `'specific'`). Shipped.
- `ExtendSpellList resolver.kind='rule'` — auto-applied across all scopes; matched spell IDs
  feed the extension table. Shipped.

Layer 3 starter exists: Spell Manager step in the builder rail (renamed from "Spells")
shows per-class spell pools with extensions merged, granted spells locked, known/prepared
toggles. Sheet → Spells sub-tab shows what the character has (Granted Spells +
Spell List Extensions panels alongside the existing casting metadata).

### Next concrete step

The Spellbook Manager project is feature-complete on the app side. The only open
work is the **Foundry export round-trip**, handed off to
`claude/pedantic-antonelli-ce1c7f` via
[../handoff-spellbook-to-importer.md](../handoff-spellbook-to-importer.md).

Once that lands, this branch is ready to merge.

Future polish (durable, no blocker):
- Migrate `SpellList` + `SpellListManager` to the shared `useSpellFilters` + `SpellFilterShell`
- Inline rule rename, per-rule expand/collapse, "save current filters as a rule" shortcut
- Spell grants on feats / backgrounds (mechanism works; needs editor exposure)
- Other prerequisite shapes (level requirement, ability score, "knows other spell") if
  tag-based prereqs prove insufficient
- Foundry-side filter follow-ups (damage type, save ability, range/duration sub-buckets)
  documented in the "Spell filter follow-ups" section below

**Note on caps**: caps are detected from class scaling columns named `Cantrips Known` /
`Spells Known` (case-insensitive). If a class lacks those columns, no cap is enforced — the
player sees a raw count. To enforce caps for a known caster like Bard or Sorcerer, author the
two scaling columns in the class editor with per-level values. Rule-of-thumb in 5e: those
columns are exactly the published "Spells Known" / "Cantrips Known" tables.

**Note on tag accumulation**: the effective tag set currently pulls from classes, subclasses,
features, and chosen option items. Feats and backgrounds are NOT yet in the calculation —
characters don't carry feats in the model today, and backgrounds don't have a tag column.
When those data shapes catch up, extend [characterTags.ts](../../src/lib/characterTags.ts)
to include them.

### What's done (don't redo)

- **Schema:** migration `20260509-1100_layer2_grant_spells_foundation.sql` applied to remote D1.
  Adds 6 columns to `character_spells` + new `character_spell_list_extensions` table.
- **Persistence layer:** [src/lib/characterShared.ts](../../src/lib/characterShared.ts) reads/writes
  all 12 character_spells columns + the extensions table. `progressionState.spellListExtensions`
  is the canonical client shape.
- **Editor side:** `GrantSpells` and `ExtendSpellList` advancement types are fully authorable in
  `ClassEditor` / `SubclassEditor` / `FeatEditor` etc. via `AdvancementManager`. Editor sub-components
  live in [src/components/compendium/SpellAdvancementEditors.tsx](../../src/components/compendium/SpellAdvancementEditors.tsx).
- **Builder side resolution:** [src/lib/spellGrants.ts](../../src/lib/spellGrants.ts) with helpers
  hooked into `classProgressionSummaries` in [CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx).
  Fixed-mode auto-applies; choice-mode emits a `spell-choice` card → opens picker dialog;
  ExtendSpellList auto-applies across all scopes. Both `explicit` and `rule` resolver kinds
  supported via the `resolveAdvancementSpellPool` helper + `resolveRulePool` callback.
- **Rule resolver runtime:** CharacterBuilder lazy-loads all rules + the slim spell catalog
  (`fetchAllRules` + `fetchSpellSummaries`) the first time a rule-resolver advancement appears
  in the visible progression. Memoised `ruleResolvedSpellIds` evaluates each rule against the
  catalog once via `spellMatchesRule`. Uses session-cached `spells` table (PERSISTENT_TABLES)
  so the cost is one fetch per session.
- **Spell Manager step:** `activeStep === "spells"` in CharacterBuilder. Per-class tab strip,
  per-class pool browse with extensions merged, status badges, known/prepared toggles, locks
  on granted spells. Filter shell (search, source, level, school, tag, casting time, range,
  duration, properties) reuses `useSpellFilters` + `SpellFilterShell`. Right-side `SpellDetailPanel`
  on click (sticky on `lg:`, mobile-collapsible). Header strip shows live "Known: N · Prepared: M"
  for the active class.
- **Sheet → Spells sub-tab:** Granted Spells panel (emerald, with prep flag chips and source
  attribution) + Spell List Extensions panel (cyan, "added to X list · from Y").
- **Foundation:** `<EntityPicker>` extracted at [src/components/ui/EntityPicker.tsx](../../src/components/ui/EntityPicker.tsx)
  — used by SpellAdvancementEditors for spell/rule/class pickers.
- **Layer 1 v1.1:** standalone `spell_rules` + `spell_rule_applications` junction; `/compendium/spell-rules`
  page; Linked Rules panel on `SpellListManager`; pre-rebuild preview dialog; last-rebuild timestamp.
- **Spell prerequisites:** `required_tags` + `prerequisite_text` columns on spells; captured in
  `SpellsEditor`; displayed in `SpellDetailPanel`. **Character-level enforcement still pending.**
- **Multi-agent rebase complete** (against origin/main 726d3152). Migrations renamed to
  `YYYYMMDD-HHMM_*.sql` convention. Other agent's additions to shared files (`compendium.ts`, `d1.ts`,
  `AdvancementManager.tsx`) are intact below mine.

### Multi-agent state

- **Other agent:** `claude/pedantic-antonelli-ce1c7f` (option groups + class importer + advancement
  system). Still paused. Once Layer 2 rule-resolver lands they can resume.
- **Domains per AGENTS.md "Multi-agent coordination":** I own `Spell*`, `EntityPicker`, `useSpellFilters`,
  `classSpellLists`, `spellRules`, `spellFilters`, `spellSummary`, `spellGrants`. They own
  `AdvancementManager`, `UniqueOptionGroup*`, class importer, class-export. My touches into
  `AdvancementManager` are small + additive + commented as cross-branch.

### Specific design decisions already locked in (don't re-litigate)

- **Three primitives** for spell access (not one): `GrantSpells` (writes `character_spells`),
  `ExtendSpellList` (writes `character_spell_list_extensions`), and the rule infrastructure both feed off.
- **`countsAsClassId`:** nullable. null = uses character's active spellcasting class for ability/DC.
  Set explicitly = attributes the spell to that class (Cleric domain → Cleric; Magic Initiate → player choice).
- **Three independent prep flags** on GrantSpells: `alwaysPrepared`, `doesntCountAgainstPrepared`,
  `doesntCountAgainstKnown`. Covers Light Domain, Magic Initiate, Chronomancy, Divine Magic affinity.
- **`ExtendSpellList.scope`:** `'self'` (parent class only — Divine Soul → Sorcerer) | `'all-spellcasting'`
  (every spellcasting class — Chronomancy Initiate) | `'specific'` (with `scopeClassId`).
- **No `school` resolver kind.** Use `rule:<spell-school-rule-id>` instead.
- **Source attribution columns** on `character_spells`: `granted_by_type` / `granted_by_id` /
  `granted_by_advancement_id` / `counts_as_class_id` / `doesnt_count_against_prepared` /
  `doesnt_count_against_known`. Enables clean reverse-resolution when a class/feat/etc. is removed.
- **Choices persist via existing `character_selections`** table — same pattern as ItemChoice.
  Lookup via `selectedOptionsMap[buildAdvancementSelectionKey(...)]`.
- **Spellcasting detection:** `class.spellcasting.hasSpellcasting` boolean (NOT
  `spellcasting.progression` — that's a legacy string-only path; modern records carry
  `progressionId` pointing at a spellcasting-type document).
- **Manual vs granted reconciliation:** the state-sync useEffect distinguishes by
  `grantedByAdvancementId`. Grants replace their persisted counterpart but inherit
  `isPrepared` so player toggles survive recomputes. Manual entries (no `grantedByAdvancementId`)
  pass through untouched.
- **Replace-on-level-up** (Chronomancy/Magic Initiate "you can replace one spell on level up") is
  UI behavior, not stored shape. Defer to Layer 3.

### Phase plan from here

| Phase | Scope | Status |
|---|---|---|
| 1a | Schema + EntityPicker | ✅ done |
| 1b editor | GrantSpells + ExtendSpellList authoring UI | ✅ done |
| 1b.5a | Builder-side resolution: explicit resolver, fixed + choice modes | ✅ done |
| 1b.5b | Builder-side resolution: rule resolver | ✅ done |
| 2a | Spell Manager polish: filters + detail pane + counters | ✅ done |
| 2b | Spell Manager: caps enforcement (opt-in via class scaling columns) | ✅ done |
| 2c | Sheet panels grouped by level | ✅ done |
| 3 | Character "effective tag set" + tag-based prereq enforcement | ✅ done |
| 4 | Spell Manager: favourites + watchlist | ✅ done |
| 5 | Layer 4: Spell Loadouts | ✅ done |
| 6 | Foundry export round-trip | ✅ done (`claude/pedantic-antonelli-ce1c7f`, [c02e00a](https://github.com/JeanPaulSR/Dauligor/commit/c02e00a)) |

### Uncommitted state warning

Many modified + untracked files across this session's Layer 2/3 work. Nothing committed unless
the user asks. **Consider committing in chunks before significant new work.**


A new view inside `CharacterBuilder` for managing a character's spells, plus the upstream
compendium machinery needed to make per-class spell lists work — including non-standard
casters whose spell access is built modularly out of schools, themes, or other tagged groupings.

## Goal

Give players (and the builder logic) a single place to:
- See every spell available to their character, organised by class.
- Pick prepared spells, favourite spells, and spells they're "watching for later".
- Sort and filter by mechanical properties (range, duration, casting time, components, level, school).
- Save and swap between **spell loadouts** (named prepared-spell sets).

And give the compendium side what's needed to make that work for unusual casters
(Thaumaturge, alternate Wizard, theme-based casters, subclass spell expansions, feat spell grants).

## Scope summary

### In scope
- Saved per-class master spell lists (snapshot, not live tag query).
- A tag-query / school / theme rule that *populates* those snapshots, plus manual add/remove on top.
- A new "grant spells" mechanism reusable across classes, subclasses, feats, and backgrounds.
- A Spellbook Manager view inside CharacterBuilder.
- Spell Loadouts (saved prepared-spell sets per character).
- Watchlist / favourites at the character level.

### Out of scope (for this project)
- Anything inside `module/dauligor-pairing/` or the FoundryVTT export pipeline.
  Module-side impact is **flagged** in [Module-side handshake](#module-side-handshake) and handed off,
  not silently changed here.
- Spell-casting *resolution* during play (slot consumption, recharge, etc.) — that's a separate sheet/play feature.
- Re-architecting how spells themselves are stored. The existing `spells` table is the source of truth.

## Existing infrastructure to leverage

Don't duplicate — reference. These already exist and the spellbook layer should sit on top of them.

| Thing | Where | What it gives us |
|---|---|---|
| Spells table + summary projection | [compendium-spells.md](compendium-spells.md) | `level`, `school`, components, `tags` JSON, range/duration via `foundry_data` |
| Tag system | [compendium-options.md](compendium-options.md) → "Tags" section | `tag_groups` with `classifications`, three-state filter UI |
| Spell tag classification | TagManager `SYSTEM_CLASSIFICATIONS` includes `spell` | Source/theme/function tags can already attach to spells |
| Character spells table | [../database/structure/characters.md](../database/structure/characters.md) → `character_spells` | `spell_id`, `source_id`, `is_prepared`, `is_always_prepared` |
| Class progression / advancements | [compendium-classes.md](compendium-classes.md) | `ItemChoice` / `ItemGrant` patterns to mirror for `GrantSpells` |
| Unique option groups | [compendium-options.md](compendium-options.md) → "Unique option groups" | Pattern for modular choice UIs (Metamagic, Invocations, …) |
| `progressionState.ownedSpells` | [character-builder.md](character-builder.md) → "`progressionState`" | Reserved slot in the canonical model — the spellbook will fill it in |
| Filter shell | [FilterBar](../../src/components/compendium/FilterBar.tsx) | 3-state include/exclude/ignore + AND/OR/XOR, reuse for spellbook filters |

## What's new

Four pieces to build, in dependency order. Each piece lists the data shape and the open design questions
that need a decision before it gets built.

### Layer 1 — Class master spell list (compendium tooling)

Per-class **saved snapshot** of which spells that class can ever prepare/learn. Saved (not live-queried)
for fast load and predictable behaviour.

**Why a snapshot:** decided. Live queries against tags would change every list any time a spell got
re-tagged — too unpredictable for casters whose list is a deliberate choice.

**Proposed data:**

| Table | Columns | Notes |
|---|---|---|
| `class_spell_lists` | `id` PK, `class_id` FK, `spell_id` FK, `source` enum, `added_at` | One row per (class, spell) pair |
| `class_spell_list_rules` | `id` PK, `class_id` FK, `name`, `query` JSON, `updated_at` | The saved tag-query rules that populate the snapshot |

`source` enum:
- `manual` — hand-added in the editor
- `rule:<rule_id>` — populated by a saved rule (so rebuild is non-destructive to manual entries)

`query` JSON shape (proposal — confirm during build):
```jsonc
{
  "schools": ["evocation", "abjuration"],          // OR within
  "tagsAll": ["arcane"],                            // AND across groups
  "tagsAny": ["holy", "mortal"],                    // OR within group
  "tagsNone": ["demonic"],
  "levelMin": 0,
  "levelMax": 9
}
```

**Editor UI** — admin-only page at `/compendium/spell-lists` (decided):
- Lives **inside the Compendium nav**, in the existing admin-only sub-section alongside Feats and Items (peer with `/compendium/feats`, `/compendium/items` — all hidden behind `isAdmin` in `Sidebar.tsx`).
- Page-level `isAdmin` gate at the top of the component, matching `SpellsEditor`'s pattern. Direct-URL access is rejected for non-admins, not just hidden in nav.
- Class picker / class tabs along the top — focus on one class's list at a time.
- Left pane: virtualised list of spells currently on the selected class's list.
- Right pane: search + add controls (manual CRUD in v1; rule editor in v1.1).
- Rule editor (v1.1) mirrors the existing shared `FilterBar` 3-state include/exclude/ignore + AND/OR/XOR vocabulary, then "Save as named rule".
- "Rebuild from rules" button (v1.1; preserves `source = manual` rows).
- **Direct link from `ClassEditor`** to that class's list page — so authors editing a class can jump straight to managing its spells.

**Public-side surfaces (read-only, not editable):**
- `SpellList` (`/compendium/spells`) — the spell detail pane shows **which classes have this spell on their list** (e.g., "On the spell list for: Cleric, Paladin"). Could also become a filter facet later.
- `ClassView` (`/compendium/classes/:id`) — gains a **Spell List tab** showing the class's full spell list, browsable like the main `SpellList` page but pre-filtered. (Note: there's an existing `spells` tab on `ClassView` — likely the slots table. Disambiguate during build.)

**"Orphan spells" view** (low priority — tracked, not blocking):
A view inside the admin spell-list manager that surfaces spells **not on any class's spell list**, so authors can spot
spells that were imported but never attached anywhere.

**Open questions:**
1. Are subclasses ever the owner of an "expansion list" of their own, or do they only grant *additions* via Layer 2? *Default proposal: subclasses only grant via Layer 2; the master list is class-scoped.*

### Layer 2 — Spell grants (compendium tooling)

A new mechanism that adds spells onto a character's available pool from sources other than
the class master list. Used by:
- Subclass domain spells (5 specific spells at fixed levels)
- Thaumaturge / alternate Wizard "pick a school" — grants the entire school
- Feats and backgrounds that grant cantrips or specific spells
- Items in `unique_option_groups` that grant spells (e.g., a chosen invocation gives a spell)

**Proposed: a new advancement type `GrantSpells`** (parallel to `ItemGrant` / `ItemChoice`).

`GrantSpells` payload (proposal):
```jsonc
{
  "type": "GrantSpells",
  "level": 1,
  "mode": "fixed" | "choice",
  "resolver": {
    "kind": "explicit" | "tagQuery" | "school" | "spellList",
    // if explicit:    spellIds: string[]
    // if tagQuery:    query: <same shape as Layer 1 rule>
    // if school:      school: "evocation"
    // if spellList:   listRef: <id of a saved spell-list document>
  },
  "count": 1,                       // if mode = "choice"
  "alwaysPrepared": false,          // domain-spells style
  "preparationMode": "spell" | "pact" | "always" | "innate" | "ritual",
  "scopeKey": "subclass:lightDomain"  // for character-side scoping
}
```

Same payload usable from **any** advancement-host: classes, subclasses, features, option items,
feats, backgrounds. The host that grants it is the `source_id` written into `character_spells`
when the grant resolves.

**Open questions:**
1. Do we need a standalone "spell pool" entity (so multiple subclasses can share a pool), or is it
   always inlined per-grant? *Default proposal: inline first; introduce a `spell_pools` table only
   if duplication becomes painful.*
2. Should `tagQuery` here reuse the *same* JSON shape as Layer 1 rules, or is grant-side filtering
   simpler? *Default proposal: reuse — one query parser for both.*
3. How does `GrantSpells` interact with the existing `unique_option_items` editor? — likely a new
   "Spells granted" panel inside the item editor that produces an embedded `GrantSpells` payload.

### Layer 3 — Spell Manager view (CharacterBuilder)

**Two surfaces, distinct purposes:**

- **Sheet → Spells sub-tab** = the *spellbook*. Read-mostly view of what the character has:
  casting metadata (level, sources, slot table) + Granted Spells panel + Spell List Extensions
  panel. Lives at `sheetSection === "spells"` inside `activeStep === "sheet"`.
- **Spell Manager step** (rail icon, renamed from "Spells") = where *selection happens*.
  Lives at `activeStep === "spells"`. Per-class tab strip → per-class pool browse →
  known/prepared toggles. Granted spells render locked.

The original Layer 3 sketch below is the *long-term* shape; the current shipment is a starter
covering per-class pool browse + known/prepared marking. Filter chips, spell detail pane,
favourites, watchlist, and loadouts are still future.



New sub-view in `CharacterBuilder.tsx`. **The existing "Spells" sub-tab on the sheet stays as-is** —
it holds general spellcasting info (slots, spellcasting type, mana). The Spellbook Manager is a
*separate* surface that owns the per-class spell lists, prepared marking, favourites, watchlist,
and loadouts. Exact placement (new sub-tab next to Spells, or its own builder step) decided
during Layer 3 design.

**Layout sketch (proposal):**
- **Left rail**: class tabs (one per class on the character; "All" tab for combined view)
- **Top toolbar**: search; filters (level, school, components, ritual, concentration, casting time,
  range, duration, prepared-only, favourites-only, watchlist-only); current loadout switcher
- **Main pane**: virtualised spell table or grid — toggleable
- **Right pane**: selected spell detail (reuse `SpellArtPreview` and the right-pane shape from
  `SpellList` for consistency)
- **Per-row controls**: prepare toggle, favourite, watchlist (with optional "by level X" note)

**Per-character data additions** (proposal — these can extend `character_spells` rather than make new tables):

| Column | Type | Meaning |
|---|---|---|
| `is_favourite` | BOOLEAN | User starred |
| `is_watchlist` | BOOLEAN | "Want this later" |
| `watchlist_note` | TEXT | Free-text, optional, e.g., "at level 5" |
| `loadout_membership` | TEXT JSON | `["combat", "social"]` — which loadouts include this row |

The `character_spells` row should exist for *any spell the character can interact with* — available,
prepared, favourited, or watchlisted — not just prepared. This matches how the manager wants to render
state across the full available pool.

**Sort options** (must support all of these):
- Name, level, school, casting time, range, duration, components, prepared, source class, ritual,
  concentration. Range/duration/casting time live inside `foundry_data` today — exposing them as
  derived columns may be needed for performant sort.

**Open questions:**
1. Placement — new sub-tab next to the existing `Spells` sub-tab, or its own top-level builder step
   (peer with Identity / Class progression / Sheet)? *Decide during Layer 3 design. The existing
   Spells sub-tab is staying; this is a separate surface either way.*
2. The "available pool" calculation — class master list **plus** all resolved `GrantSpells` payloads
   for this character — needs to live in shared logic ([characterShared.ts](../../src/lib/characterShared.ts)?)
   so both builder and exporter agree.
3. Multiclass: per-class tabs are clear. What about a feat-granted cantrip whose source isn't a class
   level — does it get its own "Other" tab, or attach to the granting class? *Default proposal: "Other" tab when there's no class source.*

### Layer 4 — Spell Loadouts

Named **sized** prepared-spell sets that a character can compose modularly. A loadout is "N spells".
A character can have many loadouts and **multiple loadouts can be active at once** — letting players
build a base loadout (e.g., 5 spells they always want) plus swappable add-ons (a 3-spell combat pack,
a 2-spell social pack, etc.). Total prepared = sum of active loadouts' sizes.

**Proposed data:**

| Table | Columns | Notes |
|---|---|---|
| `character_spell_loadouts` | `id` PK, `character_id` FK, `name`, `size` INT, `is_active` BOOLEAN, `sort_order`, `created_at` | One row per loadout per character; `size` is the number of spells the loadout holds |

Per-spell loadout membership lives on `character_spells.loadout_membership` (Layer 3) — a JSON array
of loadout IDs, since one spell can sit in multiple loadouts.

**Effective prepared set:** union of `character_spells` rows that are members of any currently-active
loadout, plus rows where `is_always_prepared = true` (which ignore loadouts entirely). The active set
is what the rest of the system reads as "prepared".

**UI implications for Layer 3:**
- A loadout switcher panel — toggle individual loadouts on/off (not single-select)
- When viewing a loadout, show "X / size" prepared count
- A loadout is "full" when its picks equal its size; over-stuffing should be blocked or warned

**Open questions:**
1. Loadouts vs. preparation cap — does the *sum* of active loadout sizes have to fit under the
   character's per-day prepared-spell cap, or is the cap purely informational? *Default proposal:
   warn but don't block — let the player decide.*
2. Are loadouts shareable / templatable across characters of the same class? *Default proposal:
   per-character only for v1.*
3. Does an always-prepared spell (e.g., domain spells) count against any loadout's size?
   *Default proposal: no — `is_always_prepared` rows are entirely outside the loadout system.*

## Feature inventory (accountability checklist)

Every feature the user has called out, mapped to its layer. Use this to verify nothing is being missed.

**Layer 1 — Class master spell list**
- [x] Per-class master spell list (snapshot table `class_spell_lists`) — admin page at `/compendium/spell-lists`
- [x] Manual add/remove of spells with optimistic toggle + undo
- [x] Multi-select + bulk Add/Remove
- [x] Multi-axis tagging support (uses existing tag system)
- [x] Filter by source / level / school / tag / casting time / range / duration / properties (FilterBar modal + active-chip bar)
- [x] Search by spell name AND by tag name, with match highlights
- [x] Right-side spell detail pane (shared `SpellDetailPanel` used by manager + public `SpellList`)
- [x] "Also on: X, Y" badge per row showing other classes that carry the spell
- [x] Public read-only Spell List tab on `ClassView`
- [x] "On the spell list for: …" line in `SpellList`'s detail pane
- [x] Deep-link button on `ClassEditor` → manager (pre-selects the class)
- [x] Capture parity in `SpellsEditor` manual editor — casting time / range / duration form fields, merged into `foundry_data` on save without clobbering Foundry-imported fields
- [x] **Descriptive tag picker on `SpellsEditor`** — separate from `requiredTags` (prereqs). Authors set `spells.tags` (e.g. "fire", "divine") which is what spell rules + class spell list rules query against. The column existed but the editor never exposed it, so spell tagging only worked for Foundry-imported spells until now.
- [x] **Spell Rules as standalone entities** — `spell_rules` table + `spell_rule_applications` junction (migration 0022). A rule pairs a tag query with a manual list and can be applied to any consumer (class today; subclass / feat / feature / background / item / option-item supported by the schema)
- [x] **Dedicated `/compendium/spell-rules` admin page** — author rules with name + description + filter editor + manual-spell picker + "Applied to" management
- [x] **Linked Rules panel on `SpellListManager`** — replaces the old per-class rule editor. Shows rules currently linked to the class with match counts, Unlink button, "Link Rule" picker dialog, "Manage Rules →" link to the editor
- [x] **"Rebuild from Rules"** — wipes `source LIKE 'rule:%'` rows for the class, re-inserts spells matching each linked rule's query OR manual list (manual entries on the class preserved)
- [x] **Live match-count badges** per rule on both surfaces (rules editor + linked rules panel)
- [x] **Per-rule manual additions** — explicit spell IDs that always match alongside the query
- [x] **Spells caching one-liner** — `spells` added to `PERSISTENT_TABLES` so the catalogue persists across page navigation + reload (1-hour session cache). Slim summary projection deferred until needed at 5000-spell scale.
- [x] Orphan-spells view — "Show orphans" toggle (uses bulk-loaded class memberships, zero new queries)

**Layer 2 — Spell grants** *(in progress, fixed-mode + choice-mode shipped)*
- [x] **Schema** — migration `20260509-1100_layer2_grant_spells_foundation.sql`. Adds 6 source-attribution columns (`granted_by_type`, `granted_by_id`, `granted_by_advancement_id`, `counts_as_class_id`, `doesnt_count_against_prepared`, `doesnt_count_against_known`) to `character_spells`, and creates `character_spell_list_extensions` table.
- [x] **Editor side** — `GrantSpells` and `ExtendSpellList` advancement types fully authorable in `AdvancementManager` via [SpellAdvancementEditors.tsx](../../src/components/compendium/SpellAdvancementEditors.tsx).
- [x] **Builder side: fixed-mode resolution** — auto-grants resolve from class/subclass/feature/subclass-feature advancements via [spellGrants.ts](../../src/lib/spellGrants.ts). Materialised into `progressionState.ownedSpells` with full attribution; reconciler preserves player edits (`isPrepared` toggles).
- [x] **Builder side: ExtendSpellList resolution** — all three scopes (`'self'` / `'all-spellcasting'` / `'specific'`). Materialised into `progressionState.spellListExtensions`. Merged into the per-character pool in the Spell Manager.
- [x] **Builder side: choice-mode picker** — `mode='choice'` advancements emit a `spell-choice` card with a "Choose Spells" button → opens dedicated picker dialog. Selections persist via the same `selectedOptionsMap` path as `ItemChoice`. Pool comes from explicit spellIds OR resolved rule matches.
- [x] **Builder side: rule resolver** — `resolver.kind === 'rule'` evaluates the named rule against the spell catalog via `spellMatchesRule`. Lazy-loads `fetchAllRules()` + `fetchSpellSummaries()` on first need; results memoised per ruleId. Info cards show "Rule: X · N matches"; choice-mode picker uses the matches as the pool.
- [x] **Persistence** — full 12-column read/write in `characterShared.ts`; `character_spell_list_extensions` round-trips via `progressionState.spellListExtensions`.
- [x] **Per-level info cards on the class step** — chip strip showing granted/extended spell names + prep flags + counts-as. Rule-based grants show first 12 matches with "+N more" tail.
- [ ] Spell grants on feats and backgrounds — same mechanism, just needs the feat/background editors to expose the advancement type (currently class/subclass/feature only).

**Spell prerequisites** *(gating shipped — tag-based)*
- [x] `required_tags` (JSON array) + `prerequisite_text` (free text) columns on `spells` (migration 0021)
- [x] Capture in `SpellsEditor` manual editor — grouped tag picker + free-text field
- [x] Display in `SpellDetailPanel` — "Requires tags: …" + free-text fallback in a blood-bordered card
- [x] **Character "effective tag set"** — [src/lib/characterTags.ts](../../src/lib/characterTags.ts) aggregates tags from progression classes (`tagIds`), subclasses (`tagIds`), accessible features (`tags`), and chosen option items (`tags`). Returns a Map<tagId, attribution> so the UI can show "from feature X". Used wherever the character's tag set matters (currently the Spell Manager).
- [x] **Character-level enforcement in Spell Manager** — every row checks its `required_tags` against the effective set. Failing rows render with a blood-tinted background, a "Locked" badge whose tooltip names the missing tags, and a disabled checkbox. Adding via `togglePlayerKnown` short-circuits if prereqs aren't met. Granted/extension spells bypass the check (the advancement made the choice for the player).
- [x] **Effective tag panel on Spell Manager** — collapsible `<details>` strip after the class tabs shows every accumulated tag with a chip; hover gives the source ("from feature: Knowledge Domain"). Hidden when the set is empty.
- [ ] Other prerequisite shapes (level requirement, ability score, "knows other spell") — defer until tag-based prereqs prove insufficient

**Layer 3 — Spellbook Manager view in CharacterBuilder** *(filters + detail pane shipped)*
- [x] **Spell Manager step** in the builder rail (renamed from "Spells"). `activeStep === "spells"` in [CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx).
- [x] **Per-class tab strip** — one tab per spellcasting class on the character (`spellcasting.hasSpellcasting`).
- [x] **Per-class pool** — `class_spell_lists` for the active class, merged with this character's `spellListExtensions`. Grouped by spell level (Cantrips first).
- [x] **Known / Prepared toggles** — checkbox to mark known, badge to toggle prepared. Granted spells render locked (emerald).
- [x] **Status badges** — `Granted` (auto-applied via advancement) and `Extension` (added via `ExtendSpellList`).
- [x] **Sheet → Spells sub-tab** — Granted Spells panel + Spell List Extensions panel showing what the character has and where each came from.
- [x] **Filter chips** — reuses `useSpellFilters` + `SpellFilterShell` (search, source, level, school, tag, casting time, range, duration, properties). Sources/tags/tag groups loaded once on first entry to the step. Active-filter chip strip + Reset all built in.
- [x] **Spell detail pane** — right-side panel using `SpellDetailPanel`; clicking any row selects it. Sticky on `lg:` viewports, collapses to a below-list pane on mobile with explicit Close.
- [x] **Known/Prepared counters** — header strip shows live "Known: N · Prepared: M" for the active class. Counts respect `countsAsClassId`.
- [x] **Pool back-fill from facet-enriched catalog** — extension-only pool entries (those not on the master list) get filter facets back-filled from `facetEnrichedSpellSummaries` so filters apply uniformly.
- [x] **Sheet panels grouped by level** — Known / Granted / Extensions panels on Sheet → Spells sub-tab now group spells by level (Cantrips first), matching the Spell Manager browse layout.
- [x] **Cantrips known + spells known caps** — opt-in detection: any class scaling column whose name matches `^cantrips\s*(known)?$` or `^spells\s*known$` (case-insensitive) drives the cap. Header strip shows "Cantrips: N / cap" + "Spells: N / cap" (red when at cap), checkbox disables on rows that would push over. Caps respect `doesntCountAgainstKnown`; granted spells with that flag (Magic Initiate, Chronomancy Initiate) don't consume cap. Classes without those scaling columns simply show the raw "Known" count with no cap (current behaviour preserved).
- [ ] Favourite spells
- [ ] Watchlist for "later level" interest
- [ ] Sort options beyond level / name
- [ ] `character_spells` extended for `is_favourite`, `is_watchlist`, `watchlist_note`, `loadout_membership`
- [ ] Shared "available pool" logic so builder + exporter agree (currently computed client-side only in the Spell Manager)
- [ ] Honour spell prerequisites when computing the available pool (see Spell prerequisites section)

**Layer 4 — Spell Loadouts** *(shipped)*
- [x] `character_spell_loadouts` table (id, character_id, name, size, is_active, sort_order) + `loadout_membership` JSON column on `character_spells` — migration `20260509-1745_layer4_loadouts.sql`
- [x] Loadouts panel in the Spell Manager — create / rename / size / activate / delete
- [x] Per-row loadout-membership chips (initial-letter buttons next to the prepare badge)
- [x] **Effective prepared = `is_always_prepared` ∪ `is_prepared` ∪ (member of any active loadout)**. The "Prepare" badge on rows reflects this hybrid; the Sheet's prepared count uses the same set
- [x] Sheet → Spells sub-tab gained a Loadouts panel showing per-loadout member counts and active state
- [x] "Active loadouts only" filter pill on the Spell Manager
- [x] Watchlist note column wired (UI for editing it deferred — set via DB or future inline editor)

## Build order

1. **Layer 1 first**, in two passes:
   - **v1 — manual CRUD only.** `class_spell_lists` table; admin page at `/admin/spell-lists` to add/remove spells per class; `ClassView` "Spell List" tab; `SpellList` detail-pane "used by classes" line; deep-link from `ClassEditor`.
   - **v1.1 — tag-rule auto-populate.** `class_spell_list_rules` table; rule editor that mirrors `FilterBar`; "Rebuild from rules" button; orphan-spells view.
2. **Layer 2.** Once master lists exist, `GrantSpells` is what makes non-standard casters work.
3. **Layer 3.** Spellbook Manager UI consumes both.
4. **Layer 4.** Loadouts sit on top of the manager's prepared/favourite state.

Each layer (and each pass of Layer 1) should be independently shippable.

## UI follow-ups (deferred from the manager polish pass)

These are durable polish items that survive the rule restructure but were deferred to keep the
manager from being a moving target. Pick up during a "second polish pass" once the rest of Layer
1 / 2 / 3 settles.

- [ ] **Migrate `SpellList` + `SpellListManager` to use the shared `useSpellFilters` hook + `SpellFilterShell` component** (already used by `ClassView`'s Spell List tab). Removes duplicated filter state + chip-bar code from two places. No behavior change.
- [ ] **Inline rule rename** — click the rule name in the editor list to rename in place, instead of going through the dialog
- [ ] **Editing flow consolidation** — when editing a rule, the FilterBar modal's "Apply & Close" button could become "Update Rule" so save + modal stay together (today: configure in modal, click Save Changes from the page header)
- [ ] **Per-rule expand/collapse** in the linked-rules panel — click to expand a rule and see its actual filter chips rendered, not just the summary count
- [ ] **Rules-as-tab restructure** — the inline Linked Rules panel could move into a `Spells | Rules` tab pair on the manager so they share vertical space instead of stacking
- [ ] **Apply filters as ad-hoc → Save as Rule shortcut** — currently you go to `/compendium/spell-rules` to author a rule from scratch. A small button on the manager could pre-populate a new rule with the current filter state ("save current filters as a rule")
- [ ] **Compendium-wide "available rules" picker** — when authoring on `/compendium/spell-rules`, show the consumer types pickable in the "Apply To…" dialog (currently only classes; subclass / feat / feature / background / item / option_item are schema-supported but unpickable until Layer 2)

## Spell filter follow-ups (Foundry-side)

The spell list manager filters by data extracted from `foundry_data.system.*` on each spell row.
Several filter improvements are blocked or limited by how that source data is structured today.

### What works now (Layer 1 v1.1)
- **Casting Time** — bucketed by `system.activation.type` (Action / Bonus / Reaction / Minute / Hour / Special).
- **Range** — bucketed by `system.range` (Self / Touch / 5 / 30 / 60 / 120 ft / Long / Other).
- **Duration** — bucketed by `system.duration.units` (Inst / Round / Minute / Hour / Day / Perm / Special).
- **Properties** — `concentration`, `ritual`, `vocal`, `somatic`, `material` from `system.properties`.

### Wanted — needs Foundry-side work

These all require either richer parsing of the `activities` JSON array on each spell, or adding new
denormalised columns to the `spells` table when the importer runs.

1. **Damage type filter** (Fire / Cold / Necrotic / etc.) — damage types live inside each activity's
   `damage.parts[]` entries. A spell can have multiple damage parts on one or more activities. Needs:
   - A pre-extraction pass during spell import that surfaces a flat `damage_types: string[]` field on
     the spell row, OR
   - Client-side parse-on-load of the `activities` JSON column (cheap for ~300 spells, no schema work).

2. **Save ability filter** (DEX save / WIS save / etc.) — the save ability is on `save` activities at
   `activity.save.ability`. Same options apply (denormalise vs. parse).

3. **Attack-vs-save discriminator** — "spells that require an attack roll" vs. "spells that force a
   save". This is a function of which activity types are present (`attack` vs `save`). Useful as a
   quick mode filter for builds.

4. **Spells with healing** — spells that have a `heal` activity. Same shape as #3.

5. **Range — fine-grained chips** — the current `Other` bucket lumps 10 / 15 / 90 ft and a few oddballs
   together. If users want to filter for "spells with 90 ft range" specifically, add 10/15/90/150/300/mi
   chips. Trade-off: more chips = more chrome.

6. **Duration — length tiers** — the current `Minute` chip matches both "1 minute" and "10 minutes".
   5etools splits these. Worth doing if users curate "short ≤1 minute" vs "long" loadouts.

7. **Casting Time — long-cast distinction** — minute/hour buckets don't distinguish "1 minute (ritual
   prep window)" from "10 minutes" or "1 hour (long divination)". Could split if relevant to play.

8. **Material component cost** — spells with consumed material components (e.g., 100gp diamond for
   Revivify). `system.materials.consumed` and `system.materials.cost` are already on the row but not
   surfaced as a filter.

9. **Sight / Unlimited range** — currently hidden in `Other`. Few spells use these but a dedicated chip
   would help (Telepathy, Sending, Scrying).

### Not blocked, just deferred

- **Save outcome (half on success / negates)** — needs activity-level inspection.
- **Targeting shape (cube / sphere / line / cone)** — `system.target.template.type`. Add a chip section
  if shape-based filtering becomes a common workflow.

## Module-side handshake

Per the [guardian protocol](../README.md), changes that affect the app↔module contract get **flagged**
here, not silently propagated:

- **`GrantSpells` advancement type** — likely needs a corresponding entry in
  `module/dauligor-pairing/docs/class-import-contract.md` and probably `class-feature-activity-contract.md`
  if features can carry it. **Flag for module agent when Layer 2 lands.**
- **`class_spell_lists` exports** — if Foundry needs to know a class's spell list, this becomes a new
  export contract section. **Flag for module agent when Layer 1 ships.** May not be needed at all
  if Foundry derives this from native class items.
- **Loadouts** — character-scoped state, very likely **not** module-relevant. Confirm before exporting.

## Out-of-scope reminders

- Don't touch `module/dauligor-pairing/` or `api/module*` / `src/lib/classExport.ts` — another agent
  owns the export pipeline and the Foundry pairing module right now.
- Don't reintroduce `firebase/firestore` imports anywhere (per `AGENTS.md`).

## Related docs

- [compendium-spells.md](compendium-spells.md) — spell row shape and importer
- [compendium-options.md](compendium-options.md) — tag system and option groups (the patterns this project leans on)
- [compendium-classes.md](compendium-classes.md) — class data model and advancement types
- [character-builder.md](character-builder.md) — where the manager view will live
- [character-sheet.md](character-sheet.md) — current spells sub-tab being superseded
- [../database/structure/characters.md](../database/structure/characters.md) — `character_spells` schema
- [../database/structure/tags.md](../database/structure/tags.md) — tag schema
