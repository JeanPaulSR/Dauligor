# Reference Syntax (Formula References)

A formula authored in a Dauligor editor (spellcasting formula, feature usage, activity damage) can use shorthand references like `@prof` or `@scale.<class>.<column>`. These are resolved at export time into Foundry-native paths so the resulting Foundry items roll correctly.

This doc covers the supported shorthand, how it maps to Foundry, and where in the app users see/use it.

## Supported references

Implemented in [src/lib/referenceSyntax.ts](../../src/lib/referenceSyntax.ts).

### Universal scalars

| Syntax | Means | Foundry equivalent |
|---|---|---|
| `@prof` | Proficiency bonus | `@prof` (native) |
| `@level` | Class level | `@classes.<class>.levels` (resolved at export) |
| `@totalLevel` | Total character level | `@details.level` |
| `@mod` | Spellcasting ability modifier (chosen on the class) | `@abilities.<ability>.mod` |
| `@value` | Spellcasting ability score (raw) | `@abilities.<ability>.value` |

### Scale values

| Syntax | Means |
|---|---|
| `@scale.<class>.<column>` | Value from a class scaling column at the character's class level |
| `@scale.<class>.<subclass>.<column>` | Subclass scaling column |

The resolver matches `<class>` against class **identifiers** (slugs), not display names — see "stable identifiers" below.

### Math helpers

Standard formula math is available in formula fields:
- `min(a, b)`
- `max(a, b)`
- `floor(x)`, `ceil(x)`, `round(x)`
- Arithmetic: `+`, `-`, `*`, `/`
- Dice: `1d8`, `(@level)d6`, `Xd(Y+Z)`

The dice/math evaluator uses `mathjs` for non-dice expressions. Dice notation is preserved as-is for Foundry to roll.

## Where users see references

### Inline help triggers
Formula fields render a small `?` popover (`ReferenceSyntaxHelp.tsx`) that shows the legal references for that field's context.

### Reference sheet dialog
Class editors and the character sheet have an "Open Reference Sheet" button that opens a draggable utility window (`ReferenceSheetDialog.tsx`). The dialog shows the full table of references with examples.

### Per-class context
The reference sheet auto-resolves references using the active class/subclass. So `@scale.cleric.cantrip-damage` shows the resolved value for the user's character at their current level.

## Where references are resolved

Two resolution points:

### 1. Live preview (in-app)
`ReferenceSheetDialog` and `CharacterReferencePanel` evaluate references against the current character's state for display purposes. This is informational only.

### 2. Class export (the load-bearing one)
[src/lib/classExport.ts](../../src/lib/classExport.ts) and [src/lib/characterExport.ts](../../src/lib/characterExport.ts) rewrite shorthand references into native Foundry `@`-paths during export. Examples:

| Stored | Exported |
|---|---|
| `@level + @prof` | `@classes.cleric.levels + @prof` |
| `1d8 + @mod` | `1d8 + @abilities.wis.mod` |
| `@scale.sorcerer.sorcery-points` | `@scale.sorcerer.sorcery-points` (already native) |

## Stable identifiers

Class and subclass references must use **identifiers** (lowercase slugs like `cleric`, `wizard`, `eldritch-knight`), not display names. Reasons:

- Two classes can share a display name (homebrew + official version of the same archetype).
- Foundry uses identifiers in its native `@` paths.
- Renaming a class shouldn't break formulas across the app.

When authoring a formula, always type the identifier (it shows up in the class editor's "Identifier" field). The formula helper shows identifiers, not names.

## Class-column resolution

A "class column" is a `scaling_columns` row whose `parent_id` matches the class. Each column has:
- A display name (e.g., "Cantrip Damage")
- An identifier (e.g., `cantrip-damage`)
- A 20-row `values` map

`@scale.cleric.cantrip-damage` resolves by:
1. Finding the cleric class row.
2. Finding the column with identifier `cantrip-damage` whose `parent_id = cleric.id`.
3. Reading `values[character.classLevel]`.

Subclass columns work the same way with `parent_id = subclass.id`. The export pipeline produces a Foundry `ScaleValue` advancement so the reference resolves natively in Foundry too.

## Spellcasting formula shortcuts

A few extra shorthand references are accepted in the spellcasting formula authoring UI:

| Shorthand | Resolves to |
|---|---|
| `@level` | Class level (per the spellcasting class) |
| `@totalLevel` | Total character level |
| `@prof` | Proficiency bonus |
| `@mod` | Chosen spellcasting ability modifier |
| `@value` | Chosen spellcasting ability score |

Plus math helpers (`floor`, `ceil`, `min`, `max`).

`classExport.ts` resolves these into the concrete Foundry-native paths during export, e.g.:

| Stored | Exported |
|---|---|
| `@mod + @level` | `@abilities.wis.mod + @classes.druid.levels` |
| `floor(@level / 2)` | `floor(@classes.fighter.levels / 2)` |
| `WIS + Level` | `@abilities.wis.mod + @classes.druid.levels` (legacy shorthand still accepted) |

## Implementation notes

- All references start with `@`.
- Resolution is performed by tokenising the formula and replacing matching tokens. Unrecognised `@xxx` tokens are passed through unchanged so Foundry-native references survive intact.
- The resolver is **read-only** — references are never modified in storage. They're rewritten only at export.
- Authoring stays human-readable; export stays Foundry-correct.

## Sources

- [src/lib/referenceSyntax.ts](../../src/lib/referenceSyntax.ts) — the resolver, scalar list, helper API
- [src/components/reference/ReferenceSyntaxHelp.tsx](../../src/components/reference/ReferenceSyntaxHelp.tsx) — field-level popover
- [src/components/reference/ReferenceSheetDialog.tsx](../../src/components/reference/ReferenceSheetDialog.tsx) — full reference utility window
- [src/components/reference/CharacterReferencePanel.tsx](../../src/components/reference/CharacterReferencePanel.tsx) — sheet-side launcher
- [src/lib/classExport.ts](../../src/lib/classExport.ts) — export-time resolution

## Related docs

- [foundry-integration.md](foundry-integration.md) — overall pairing philosophy
- [../features/foundry-export.md](../features/foundry-export.md) — export pipeline details
- [../features/character-builder.md](../features/character-builder.md) — where character-side references are authored
