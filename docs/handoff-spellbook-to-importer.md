# Handoff: Spellbook → Class Importer / Foundry Export

> **From:** `claude/kind-maxwell-bfa076` (Spellbook Manager domain)
> **To:** `claude/pedantic-antonelli-ce1c7f` (Class importer + advancement system + Foundry export)
> **Date:** 2026-05-09

The Spellbook Manager project is feature-complete through Layer 4. You can resume your
class importer + Foundry export work — the spell-side machinery you depend on is all
wired up. This note summarises what's available, what changed in shared files, and the
one open hand-back item.

---

## What landed

### Layer 1 — Per-class master spell list (compendium tooling)
- `class_spell_lists` table + `/compendium/spell-lists` admin page
- Standalone `spell_rules` + `spell_rule_applications` junction
- `/compendium/spell-rules` editor with filter editor + manual picker + applied-to management
- "Rebuild from rules" with preview dialog and live match counts
- Spell prerequisite columns (`required_tags`, `prerequisite_text`) on `spells`
- Descriptive tag picker on `SpellsEditor` (the column existed; UI was missing)

### Layer 2 — Spell grants
- New advancement types: `GrantSpells` and `ExtendSpellList`
- Both modes (`fixed` / `choice`) and both resolver kinds (`explicit` / `rule`) fully
  resolved on the builder side via [src/lib/spellGrants.ts](features/../../src/lib/spellGrants.ts)
- Rule resolver runs `spellMatchesRule` against the loaded spell catalog (lazy-loaded
  on first need)
- Choice mode opens a dedicated picker dialog; selections persist via the same
  `selectedOptionsMap` path as `ItemChoice`
- 6 source-attribution columns on `character_spells` (`granted_by_type`,
  `granted_by_id`, `granted_by_advancement_id`, `counts_as_class_id`,
  `doesnt_count_against_prepared`, `doesnt_count_against_known`)
- New `character_spell_list_extensions` table for `ExtendSpellList` writes

### Layer 3 — Spellbook Manager view (CharacterBuilder)
- "Spell Manager" rail step (renamed from "Spells")
- Per-class tabs, level-grouped browse, granted/extension status badges
- Filter shell (search + 8 facets) reusing `useSpellFilters` + `SpellFilterShell`
- Right-side `SpellDetailPanel` on click
- Cantrips/spells known caps (opt-in via class scaling columns named
  `Cantrips Known` / `Spells Known`)
- Character "effective tag set" via [src/lib/characterTags.ts](features/../../src/lib/characterTags.ts)
- Spell prerequisite gating: rows with unmet prereqs render as locked with
  missing-tag tooltip
- Sheet → Spells sub-tab gained Granted Spells, Spell List Extensions, Known Spells,
  Favourites, Watchlist, and Loadouts panels — all level-grouped where applicable

### Layer 4 — Spell Loadouts
- `character_spell_loadouts` table (id, character_id, name, size, is_active, sort_order)
- `loadout_membership` JSON column on `character_spells`
- Loadouts panel in the Spell Manager (create / rename / size / activate / delete)
- Per-row loadout-membership toggles (initial-letter chips next to the prepare button)
- Effective prepared = `is_always_prepared` ∪ `is_prepared` ∪ (member of any active loadout)

### Layer 3 Phase 4 — Favourites + watchlist
- 3 new columns on `character_spells`: `is_favourite`, `is_watchlist`, `watchlist_note`
- Star + bookmark per-row toggles (favourite a spell you don't even know yet —
  auto-creates a stub entry)
- Three filter pills: Favourites only / Watchlist only / Active loadouts only
- Header counters: ★ favourites · ◐ watchlist alongside Known + Prepared

---

## What you can now rely on

**The shape of `character_spells` rows is stable.** Every column the Foundry export
might want is present and round-tripped via `characterShared.ts`:

```ts
{
  id, sourceId, isPrepared, isAlwaysPrepared,
  // Layer 2 attribution
  grantedByType, grantedById, grantedByAdvancementId,
  countsAsClassId, doesntCountAgainstPrepared, doesntCountAgainstKnown,
  // Layer 3 Phase 4
  isFavourite, isWatchlist, watchlistNote,
  // Layer 4
  loadoutMembership: string[],
}
```

**The shape of `character_spell_list_extensions`:**

```ts
{ classId, spellId, grantedByType, grantedById, grantedByAdvancementId }
```

**The shape of `character_spell_loadouts`:**

```ts
{ id, name, size, isActive, sortOrder }
```

All three live on `progressionState.{ownedSpells, spellListExtensions, spellLoadouts}`.

**Choice resolution.** When a player picks spells via a `GrantSpells mode='choice'`
advancement, the selections persist via `character_selections` keyed by
`buildAdvancementSelectionKey({sourceScope, advancementId, level})` — same as
`ItemChoice`. The materialisation pipeline writes them into `character_spells` with
full attribution at level-up time, so the export side doesn't need to re-resolve them.

---

## Schema changes summary

Migrations applied to remote D1 in this work cycle:

| Migration | What it adds |
|---|---|
| `20260508-2300_class_spell_lists.sql` | `class_spell_lists` table |
| `20260509-0930_spell_prerequisites.sql` | `required_tags`, `prerequisite_text` on `spells` |
| `20260509-1000_spell_rules_restructure.sql` | `spell_rules` + `spell_rule_applications` junction |
| `20260509-1100_layer2_grant_spells_foundation.sql` | 6 attribution columns on `character_spells` + `character_spell_list_extensions` table |
| `20260509-1742_phase4_favourites_watchlist.sql` | `is_favourite`, `is_watchlist`, `watchlist_note` on `character_spells` |
| `20260509-1745_layer4_loadouts.sql` | `character_spell_loadouts` table + `loadout_membership` JSON column on `character_spells` |

Total table count: 63.

---

## The one open hand-back

**Foundry export round-trip for spells.** When `character_spells` rows are emitted into
the actor bundle, the export side currently doesn't surface:

- The 6 attribution columns (`granted_by_*`, `counts_as_class_id`, the two `doesnt_count_against_*`)
- `character_spell_list_extensions` rows (per-character class spell-list adjustments)
- `character_spell_loadouts` + `loadout_membership` (active prepared sets)

Map these to whatever shape your Foundry pairing module expects. The semantic
crosswalk for each:

- `granted_by_type` / `granted_by_id` — equivalent to Foundry's `flags.dauligor-pairing.sourceId`
  on the spell item; lets the module trace each spell back to the class/feature/feat that
  granted it for un-grant on level-down.
- `counts_as_class_id` — drives which class's spell-mod and DC apply when casting. If null,
  the character's primary spellcasting class wins.
- `doesnt_count_against_prepared` / `doesnt_count_against_known` — these should map to
  Foundry's `system.preparation.mode = 'always'` (for free-prepared) and to a custom flag
  for free-known (Foundry has no native concept; module decides).
- `loadout_membership` + active loadouts — the union should drive which spells get
  `system.preparation.prepared = true` on export. The hybrid prepared check is in
  `effectivePreparedSet` in [CharacterBuilder.tsx](features/../../src/pages/characters/CharacterBuilder.tsx).
- `character_spell_list_extensions` — extends the class's available pool for THIS
  character only. Foundry side: probably a per-character spell-list document or a flag on
  the actor's class item listing extra spell IDs the class can prepare.

---

## Files I touched in shared territory

Per AGENTS.md "Shared utility files" discipline, here's what I added (all
appended below your entries — should rebase mechanically):

- `src/lib/compendium.ts` — added `requiredTags`, `prerequisiteText`, the 6 attribution
  field mappings (already there from before this hand-off)
- `src/lib/d1Tables.ts` — added `classSpellLists`, `spellRules`, `spellRuleApplications`,
  `characterSpellListExtensions`, `character_spell_loadouts` (added to `characterSpellLoadouts` mapping)
- `src/components/compendium/AdvancementManager.tsx` — added `GrantSpells` and
  `ExtendSpellList` to the type union + dispatch (commented as cross-branch)
- `src/lib/advancementState.ts` — added the two types to `CanonicalAdvancementType` +
  `buildDefaultAdvancementConfiguration` cases
- `src/lib/characterShared.ts` — extended `rebuildCharacterFromSql`,
  `generateCharacterSaveQueries`, and `buildCharacterExport` for the new columns/tables
- `src/lib/characterLogic.ts` — added `spellListExtensions`, `spellLoadouts` to
  `buildEmptyProgressionState` + `normalizeProgressionState`

---

## Where to look first

1. [docs/features/spellbook-manager.md](features/spellbook-manager.md) — the canonical
   project doc. Top of file has the current status; Layer-by-Layer breakdowns below.
2. [src/lib/spellGrants.ts](features/../../src/lib/spellGrants.ts) — pure helper for the
   advancement → ownedSpells/extensions resolution
3. [src/lib/characterTags.ts](features/../../src/lib/characterTags.ts) — character
   effective tag set helper (used for prereq gating)
4. [src/pages/characters/CharacterBuilder.tsx](features/../../src/pages/characters/CharacterBuilder.tsx)
   `activeStep === "spells"` block — the Spell Manager view

When you're done with the export round-trip, please check the box in
`docs/features/spellbook-manager.md` → "Layer 5 — Foundry export round-trip" and update
the "Status" header. After that, this branch can merge cleanly into main.
