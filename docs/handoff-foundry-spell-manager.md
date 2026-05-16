# Handoff — Foundry Spell Preparation manager parity

> **Status:** all app-side spell work shipped; module-side parity is the
> next chunk. Branch `claude/pedantic-antonelli-ce1c7f`; origin/main at
> `92a773d` (docs commit) with `db37176..4c80d57` covering the editor
> polish before it. Layer 6 (Foundry export round-trip) is **complete**.
> This handoff is about the module-side UX/data work to bring the
> Foundry "Spell Preparation" manager up to parity with the app's
> "Spell Manager" step.

## Where we ended

The last working session closed with:

1. **Multi-clause spell rules** shipped end-to-end. Library
   (`RuleClauseRoot`, `matchAnyClause`, `getClauses`, the explainer
   trace) + editor (clause tab strip, `Add Clause` / `Remove Clause`,
   per-clause filter editing, both filter groups collapsed by default,
   compact `AxisFilterSection` / `TagGroupFilter` headings).
2. **Spell Manager rework on the character side**:
   - Per-class "Add Spells" picker modal (`AddSpellsModal` in
     `CharacterBuilder.tsx`) — choosing what's on the sheet.
   - Main sheet shows only known spells per class with prep toggle as
     the leading control.
   - Per-class attribution via `countsAsClassId`, three-tier resolution
     in `attributedClassForSpell`.
   - Per-class prepared-cap enforcement on `togglePrepared`.
3. **Spell-lists curator polish** (`/compendium/spell-lists`):
   - Viewport-anchored card sizing via `ResizeObserver` +
     `getBoundingClientRect().top`.
   - Detail pane gets the wide column (`520px_minmax(360px,1fr)`).
   - "Show Rule Match" disclosure inside the SpellDetailPanel's new
     `bottomSlot`, sibling of Show Tags.
   - Stale-detection bug fixed (`parseTimestampMs` parses both ISO
     and SQLite DATETIME shapes).
4. **CharacterBuilder layout** rebuilt per Hand-Off-2:
   - `h-screen flex-col → cb-page-scroll → cb-body-cols` (content +
     sticky right rail).
   - BookSpread verso/recto for the sheet step.
   - Top header band absorbed into the rail (Save + Settings popover).
5. **Class-step freeze fix** — `canonicalStringify` replacing
   key-order-sensitive `JSON.stringify` in two progressionState
   reconcile effects. Regression harness in
   `scripts/_repro_progression_loop.mjs`.
6. **Documentation refreshed** —
   `docs/features/character-builder.md` and
   `docs/features/spellbook-manager.md` both have "Recent rework"
   sections covering the above.

## What's next — Foundry module parity

The app exports nearly everything the module needs, but the module's
Spell Preparation manager doesn't yet consume the richer signals.
Audit summary:

| Feature | App ships it? | Module consumes it? | Module surfaces it? |
|---|---|---|---|
| `countsAsClassId` attribution | ✅ stamped on each spell | ✅ via `classIdentifier` flag | ❌ no manual reassign UI |
| Always-prepared / prepared / known | ✅ tri-state + free flags | ✅ flags present | partial (prep-cap not enforced) |
| Favourites | ✅ | ✅ flag set | ✅ |
| Watchlist + note | ✅ | ✅ flag set | ❌ no UI |
| Spell list extensions | ✅ in `progressionState.spellListExtensions` | ❌ NOT in `items[]` | ❌ |
| Spell loadouts | ✅ in `progressionState.spellLoadouts` | ❌ NOT in `items[]` | ❌ |
| Per-class prepared cap | ✅ enforced on toggle | – | ❌ no cap check on Foundry side |

### The four moves, in suggested order

#### 1. Surface spell list extensions in the actor bundle (recommended first)

**Why first.** All downstream UX (loadout swapping, "available to pick"
in the manager) needs the manager to see what features extend a
class's accessible spell pool. Right now the bundle drops the
extensions into `progressionState.spellListExtensions` and the
module's import never looks at that field.

**App side:**
- `src/lib/characterShared.ts` lines 581–684 — extend the actor
  bundle's payload with a top-level `spellListExtensions` array
  (mirror of the `character_spell_list_extensions` rows): `{ spellId,
  classId, classIdentifier, grantedByType, grantedById,
  grantedByAdvancementId }[]`. Keep `items[]` clean — extensions
  are metadata, not items to embed.

**Module side:**
- `module/dauligor-pairing/scripts/import-service.js` — read the new
  `spellListExtensions` array and stamp it onto the actor as
  `flags.dauligor-pairing.spellListExtensions`. (Don't create
  Item documents for extensions; they represent "available to
  pick" not "already on the actor".)
- `module/dauligor-pairing/scripts/spell-preparation-app.js` — when
  building the per-class available-spell pool, merge in any
  extensions whose `classIdentifier` matches the section's class.
  Render with a "via [feature]" badge so the user can tell where
  the spell came from.

**Estimated scope:** ~150 lines across `characterShared.ts` (export),
`import-service.js` (read + stamp), `spell-preparation-app.js` (merge
+ badge).

#### 2. Per-class prepared-cap enforcement on the module's toggle (~40 lines)

**Where:** `module/dauligor-pairing/scripts/spell-preparation-app.js`,
in the prepare/unprepare event handler (search for where the manager
flips `system.preparation.prepared`).

**Logic:**
```
known   = spells where level > 0
           AND classIdentifier === thisClass
           AND NOT always-prepared
           AND NOT freeKnown
prepared = spells where preparation.prepared >= 1
            AND classIdentifier === thisClass
            AND NOT always-prepared
            AND NOT freePrepared
if (prepared >= known) → silently no-op + notification
```

Mirrors `togglePrepared` in `CharacterBuilder.tsx` (search
`countsTowardsActiveClass` for the predicate shape).

#### 3. Loadout switching UI (~150–200 lines)

**Depends on:** #1 (export pipeline). Loadouts live in
`progressionState.spellLoadouts`; we need them on the actor too.

**App side:**
- `characterShared.ts` — export `spellLoadouts` as a top-level
  bundle field alongside `spellListExtensions`. Shape:
  `{ id, name, size, classId, classIdentifier, membership: string[] }[]`.

**Module side:**
- `import-service.js` — stamp as `flags.dauligor-pairing.spellLoadouts`.
- `spell-preparation-app.js` — toolbar dropdown showing each loadout
  with `prepared / size` ratio. On select: batch-update
  `system.preparation.prepared` to match the loadout's membership
  (set to 1 for members, 0 for non-members, ignoring always-prepared).

#### 4. Watchlist view + edit (pure UI, ~60 lines)

**Where:** `module/dauligor-pairing/scripts/spell-preparation-app.js`.

- Add a filter checkbox "Show watchlist only" (next to the existing
  favourites filter, line ~360-ish — confirm exact location).
- Detail panel: "Edit note" action that opens a modal/textarea,
  writes back to `flags.dauligor-pairing.watchlistNote`.
- Data is already present on every spell — flag was added in the
  Layer 5 export round-trip.

## Open todos (not blocking this work)

These were on the active todo list when the session ended. Most are
unrelated to the Foundry spell work and can stay parked:

- **Extend `buildGrantedItemLookups`** to index weapons/armor/equipment
  tables. Currently only indexes features + options, so granted-item
  IDs from the equipment side fall through to "Unresolved · <id>" on
  the FEATURES recto tab. Flagged in the spawn_task from the freeze
  investigation. (`src/pages/characters/CharacterBuilder.tsx`)
- **Memoize `classProgressionSummaries`** + the canonical
  `Owned*` arrays in `CharacterBuilder.tsx`. The class-step freeze
  fix (canonicalStringify) is sufficient for the cases the repro
  script covers; the diagnostic agent flagged cross-effect oscillation
  as a possible future cause. Stretch goal — only revisit if the
  freeze comes back.
- **Per-encounter feature use trackers** (Sorcery Points dots, Tides
  of Chaos, etc. on the recto FEATURES tab). Blocked on a
  `character.featureUses` data-model field that doesn't exist yet.
- **Class Step — kind-colored advancement row treatment** (cosmetic
  polish, parked).
- **Foundry importer: finalize `runEquipmentPlaceholderStep`** (this
  branch's original domain; pre-dates the spellbook work).
- **Auto-rebuild on Link/Unlink rule** (`SpellListManager` ergonomics).
- **Tier 2/3 filter polish** (spell-filter follow-ups documented in
  `docs/features/spellbook-manager.md` "Spell filter follow-ups"
  section).
- **Feature Manager triggers + tabs** (pre-existing item).

## File map — key locations

### App side
- `src/lib/characterShared.ts` — actor-bundle assembly (the JSON the
  module imports). Lines 581–684 are the spell-item export.
- `src/lib/characterExport.ts` — `exportCharacterJSON` entry point.
- `src/pages/characters/CharacterBuilder.tsx` — `togglePlayerKnown`,
  `togglePrepared`, `attributedClassForSpell` are the predicates the
  module should mirror.
- `src/lib/spellFilters.ts` — `RuleClauseRoot`, `matchAnyClause`,
  `getClauses`, `explainSpellAgainstRule`.
- `src/lib/spellRules.ts` — `SpellRule`, `spellMatchesRule`,
  `explainSpellMatch`.

### Module side
- `module/dauligor-pairing/scripts/import-service.js` — entry point
  for actor-bundle import (~206 lines). Currently passive on spells;
  this is where #1 lands a stamp.
- `module/dauligor-pairing/scripts/spell-preparation-app.js` — the
  manager UI (~750 lines). #1 #2 #3 #4 all touch this.
- `module/dauligor-pairing/docs/actor-spell-flag-schema.md` —
  authoritative schema for `flags.dauligor-pairing.*` on spell items.
- `module/dauligor-pairing/docs/spell-preparation-manager-guide.md` —
  target behavior for the manager.

### Docs
- `docs/features/character-builder.md` — has a "Recent rework"
  section covering layout + spell manager changes.
- `docs/features/spellbook-manager.md` — has a "Post-Layer-6 polish"
  section covering multi-clause rules + explainer + the Spell Manager
  Add-Spells model.
- `docs/handoff-foundry-spell-manager.md` — this file.

## Branch + remote state at handoff

```
HEAD            92a773d docs: capture recent rework — layout / spell manager / multi-clause rules / explainer
origin/main     92a773d (synced)
```

No uncommitted changes. Pre-existing TypeScript errors in
`CampaignEditor.tsx`, `SpellList.tsx`, `LoreEditor.tsx` (`asChild`
prop) are unrelated to this branch's work and predate the spellbook
project — leave them.

## Recommended next move

**Start with #1 (extensions in the bundle)** unless there's a
specific reason to pick a different one. It unblocks the most
downstream work and is a clean three-file change.
