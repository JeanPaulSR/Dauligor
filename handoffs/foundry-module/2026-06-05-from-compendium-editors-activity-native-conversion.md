# From `compendium-editors` → `foundry-module`: Activity native-conversion contract changes

**Date:** 2026-06-05
**From:** `compendium-editors` (Activity Editor Foundry-fidelity rebuild)
**To:** `foundry-module` (owner of `class-import-service.js` / the semantic→native activity conversion)
**Status:** heads-up now · **formal verification request is DEFERRED until all activity kinds are done** (see the reminder at the bottom)

---

## Why you're getting this

The app's **Activity Editor** (`src/components/compendium/ActivityEditor.tsx` + `activity/*`) is
being rebuilt **kind by kind** to faithfully match Foundry dnd5e 5.3.1's activity config windows.
The app authors a **semantic** activity shape; your module's `class-import-service.js` converts it
to native `system.activities`. Two changes in the **Cast** work touch that contract — they need
module-side handling for the round-trip to be correct. **Nothing is broken today** (the module
degrades gracefully until both sides land), but please fold these into the conversion when you next
work the activity importer.

---

## 1. Cast `spell.uuid` now holds OUR spell `identifier` slug — not a raw Foundry UUID

The Cast activity used to expect the author to paste a raw Foundry UUID (`Item.xxxx` / `Compendium…`)
into `spell.uuid`. That was unusable. It's now a **search-and-assign picker over our own spell
compendium** (the D1 `spells` table). On assign, we store the picked spell's **`identifier` (slug)**
in `spell.uuid` — e.g. `"fireball"` — because our spells carry no Foundry-resolvable UUID in the
authoring layer (the original `foundryUuid` lives only in the import-only `_dauligorImport`
namespace, which is never re-exported).

**Module action:** in the activity conversion, resolve a Cast's `spell.uuid` **as a slug** → the
exported spell's compendium UUID (look it up by `identifier` in the exported spell pack). If the
value already looks like a full UUID (legacy / hand-entered), pass it through unchanged so both forms
work.

The rest of the Cast `spell` semantic shape (unchanged in meaning, listed for reference):

| semantic field | meaning |
|---|---|
| `spell.uuid` | **our spell `identifier` slug** (was: raw Foundry UUID) |
| `spell.ability` | casting-ability override; `''` = use spellcasting |
| `spell.level` | casting-level override (number) or `null` = spell's own level |
| `spell.properties[]` | **ignored** spell properties (vocal/somatic/material/concentration/ritual) |
| `spell.challenge.{override,attack,save}` | flat attack-bonus / save-DC override |
| `spell.spellbook` | "Display in Spellbook" flag |

## 2. New `override` flags on activation / duration / range / target

To mirror Foundry's `_setOverride`, the editor now exposes a per-section **Override** toggle on the
Activation / Duration / Range / Targeting tabs. It surfaces only when a source is linked — a **Cast**
with a linked spell, or a **Forward** with a linked target activity. The four semantic sections now
carry an `override: boolean`:

```
activation.override   duration.override   range.override   target.override
```

Semantics (same as Foundry): `override === false` (the default) ⇒ the activity **inherits** that
section from the linked source (spell for Cast, target activity for Forward); `override === true`
⇒ the activity's own values apply.

**Module action:** **emit these `override` booleans in the native activity shape.** dnd5e performs the
actual inheritance at runtime via `prepareFinalData` / `_setOverride`, so you don't need to copy the
spell's values across — you just need the flag to round-trip so Foundry knows whether to inherit.
Default to `false` when absent.

---

## 3. Transform settings + creature references (app-handled)

The **Transform** activity's "Settings" sub-tab (Keep / Merge / Active Effects / Other Options) is
authored into `transform.settings` (`{ keep[], merge[], effects[], minimumAC, spellLists[], tempFormula,
transformTokens }`). Per the project owner, **this part is primarily used and applied by OUR app at
runtime** — preset defaults, the `default`-selected toggles, and the `disables` locks are resolved
app-side. Two contract notes:

- **`transform.settings.spellLists` holds OUR spell-rule identifiers**, not Foundry spell-list registry
  refs (`class:wizard`, `subclass:moon`, …). The "Retained Spell Lists" picker is sourced from our
  `spell_rules` table.
- **Summon / Transform profile creature references** (`profiles[].uuid`) are authored via a creature
  search that's **empty until the monster compendium exists** — same slug-resolution story Cast's
  `spell.uuid` already uses, once monsters land.

---

## 4. ⏳ Standing reminder — full activity round-trip verification when ALL kinds are done

This is the part the project owner explicitly asked to flag for you:

> **When `compendium-editors` finishes matching ALL activity kinds to Foundry, `foundry-module`
> should run a full round-trip verification of the activity native conversion** — export a feature /
> spell that uses each kind, import it into Foundry, and confirm every kind renders and behaves like
> Foundry's own activity windows.

Kinds in scope (status as of this note, app side): **all kinds now structurally matched** — Attack,
Damage, Heal, Save, Check, Cast, Enchant, Forward, Use, Summon, Transform. Remaining gaps are the two
monster-dependent creature searchers (Summon/Transform profiles) and any field polish from screenshot
review. We'll send the formal "all kinds done — please verify" ping once the monster compendium lands
and the searchers are wired. The concrete conversion changes so far are #1, #2, and #3 above.

Enchant also added three reference tables on the app side (`consumable_categories`, `loot_categories`,
`item_properties` w/ `valid_types`) — informational; they feed the editor's restriction dropdowns and
don't change the native enchant shape.

---

**App-side status:** these changes are local on `compendium-editors` (not yet on `main`). No action is
blocking on you right now — fold #1 and #2 into the importer whenever convenient, and watch for the
"all kinds done" ping for #3.
