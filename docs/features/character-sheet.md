# Character Sheet

The sheet view inside [CharacterBuilder.tsx](../../src/pages/characters/CharacterBuilder.tsx). Read-mostly surface; edits in the builder are the source of truth.

## Layout

The sheet has three sub-tabs (introduced inside the **Character Sheet** tab of the builder):

1. **Character Info** — vitals, ability scores, saves, skills, traits, identity
2. **Features** — granted features, granted items, scale values, selected advancement options
3. **Spells** — multiclass-aware spell table

The upper sheet (header) stays visible across sub-tabs; only the lower content pane swaps.

## Character Info sub-tab

### Ability Score Rail
Six bold cards across the top: STR / DEX / CON / INT / WIS / CHA with modifier prominently displayed and base score below.

### Vital Hub
Central section combining:
- Portrait (`characters.image_url` via R2)
- Hit points (current / max with temp HP overlay)
- Defence (AC)
- Initiative
- Speed
- Proficiency bonus (derived from total level — never trusted from `proficiencyBonus`)

### Saving Throws
One row per ability with proficiency-toggled modifier. Cycles None → Proficient → Expertise → Half.

### Three-column detail
Below the vital hub:

| Column | Contains |
|---|---|
| **Skills & Knowledge** | Vertical list of all 18 skills with proficiency cycle (None / Proficient / Expertise / Half) and dynamic ability override (e.g. Strength-based Intimidation) |
| **Sensory Traits & Defenses** | Passive perception / investigation / insight, languages, resistances, immunities |
| **Identity & Proficiency Stack** | Race, background, biological type, armour proficiencies, weapon proficiencies, tool proficiencies |

Styling: `bg-card/50` + `border-gold/20` panels, gold-themed nav. See [../ui/style-guide.md](../ui/style-guide.md).

## Features sub-tab

Reads from `progressionState.ownedFeatures` and `progressionState.ownedItems` (preferred) — only falls back to reconstructing from raw class data if those blobs are missing.

Sections per active class:
- Class header (name, level, subclass summary if any)
- **Granted features** at each level with description preview
- **Granted items** as a separate section (no fuzzy-attachment to features)
- **Scale values** (cantrip damage, sneak attack dice, etc.) at the character's current level
- **Selected advancement options** (Metamagic picks, Invocations, etc.)

Names rehydrate from the shared feature/option caches before rendering, so reloading doesn't show raw IDs.

A "Jump to class step" link returns to the class progression for editing.

## Spells sub-tab

Multiclass-aware computation:
- Active spellcasting class+subclass contributors are summed using their `spellcasting.formula`.
- The `multiclass_master_chart` row is looked up to get the slot row.
- Pact magic (warlock) is a separate parallel slot table.
- Known/prepared spells come from `character_spells`.

Source: [src/lib/spellcasting.ts](../../src/lib/spellcasting.ts).

Slot table renders levels 1–9; pact magic renders below the standard table.

## Cross-references

- The reference launcher card (`CharacterReferencePanel.tsx`) sits on the upper sheet. Click to open the draggable reference window with class-specific scale values resolved at the character's level.
- The vital hub HP block auto-syncs from class progression once a class is added (escapes the default 10-HP state).

## Editing

Edits route through the builder, not the sheet. The sheet is presentational. The exception: HP / temp HP / current resource counters are toggleable in-place because they change frequently in play.

## Common gotchas

- **HP max is omitted on save** when it equals `derivedHpMax`. The sheet falls back to `derivedHpMax` for display when `hp.max` isn't present. So an explicit override only persists if it actually differs from the derived value.
- **Subclass selection writes to all matching progression rows** for that class — multiclass rows of the same class share one subclass.
- **Scale values are derived per render** — not cached on the character. Renaming a scaling column requires reloading the sheet to pick up the new identifier.

## Related docs

- [character-builder.md](character-builder.md) — builder logic, save flow, progressionState
- [compendium-classes.md](compendium-classes.md) — class data driving the sheet
- [compendium-scaling.md](compendium-scaling.md) — scale value resolution
- [compendium-spells.md](compendium-spells.md) — spell list
- [../architecture/reference-syntax.md](../architecture/reference-syntax.md) — formula references
- [../ui/style-guide.md](../ui/style-guide.md) — sheet styling patterns
