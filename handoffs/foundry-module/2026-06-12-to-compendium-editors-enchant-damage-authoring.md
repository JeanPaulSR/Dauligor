# Request → `compendium-editors`: enchantment DAMAGE authoring — use `system.damage.parts` (native dnd5e), stop actor-scoped `system.bonuses.*` inside enchantments (2026-06-12)

**From:** `foundry-module` (multi-agent investigation, all claims verified against dnd5e 5.3.1 /
Midi-QOL 13.0.58 / AC5e source; full report:
`module/dauligor-pairing/docs/_drafts/bonus-ecosystem-investigation-2026-06-12.html`). App-side
authoring fix — no module change needed.

## TL;DR
The Crimson Offering enchantment's damage is **inert by construction**: its effects add
`system.bonuses.mwak.damage` / `rwak.damage`, but those are **actor**-scoped fields
(read from `this.actor` at roll time, dnd5e.mjs:12551) while **enchantment changes apply
only to the ITEM** (dnd5e.mjs:23304). No module — Midi included — changes this.
The native, documented mechanism for "this weapon deals +X typed damage while enchanted"
is the **enchantment-only virtual change key `system.damage.parts`** (the official
Elemental Weapon pattern, dnd5e wiki Enchantment page, "current as of 5.3.0"; implemented
in `EnchantmentData._applyLegacy`, dnd5e.mjs:71008–71101). It appends a **typed, locked
damage part to every attack/damage/save activity** on the enchanted weapon. Dice formulas
+ `@scale` refs resolve; crit-doubling is RAW-correct; verified to survive Midi-QOL
13.0.58's item-clone workflow (Midi ≥13.0.52 required; we run .58).

## The fix (data + editor)

### 1. Immediate data fix — Crimson Offering (8 effects, one per damage type)
Replace each effect's two `system.bonuses.*` change rows with ONE row:
```
key:   system.damage.parts
mode:  2 (ADD)
value: [["@scale.alternate-blood-hunter.rite-die", "acid"]]     ← per-type: acid/cold/fire/lightning/poison/…
```
(keep/adjust the `name` override row, e.g. `{} (Crimson Rite: Fire)` — `{}` interpolates
the weapon's name). Value formats accepted by `_applyLegacy` (71035–37): the legacy pair
`[["<formula>","<type>"]]` or a full DamageData object
`{"custom":{"enabled":true,"formula":"…"},"types":["fire"]}` / `{"number":1,"denomination":4,"types":["fire"]}`.

### 2. Editor change — structured "Extra Damage Part" control for enchantments
- The enchantment-effect editor should offer **"Extra damage part" (formula + damage-type
  select)** that serializes to the `system.damage.parts` ADD change — NOT free-text JSON.
  ⚠ `_applyLegacy` parses the value inside a bare try/catch: **malformed JSON silently
  no-ops** (no error, no damage). Validate at authoring time.
- **Remove/warn on actor-scoped keys inside enchantments**: `system.bonuses.mwak/rwak/msak/rsak.damage`
  (& friends) are valid only on **actor-applied** effects (e.g. a transfer effect on a
  feature) — inside an enchantment they're dead rows. If `src/lib/activeEffectKeys.ts`
  offers them in the enchantment context, scope them out (audit other enchantment rows in
  D1 authored against these keys while you're there).
- `@<col>` shorthand: your f78b5bb expander runs over effect `changes[].value`, and the
  token regex should match inside the JSON string (`[["@rite-die","fire"]]` →
  `[["@scale.alternate-blood-hunter.rite-die","fire"]]`) — please verify once; authoring
  the full `@scale.<class>.<col>` form is the safe fallback.

### Other valid enchantment damage keys (verified, for the editor's vocabulary)
| Key | Effect | Dice? |
|---|---|---|
| `system.damage.parts` (ADD) | typed extra part on all activities — **the** mechanism | ✅ |
| `system.damage.bonus` (ADD) | appends to FIRST part only, inherits base type | ✅ |
| `system.damage.base.{number,denomination,bonus,types}` | modify the base roll (Shillelagh pattern) | bonus ✅ |
| `system.magicalBonus` | +N attack & first damage when magical (Magic Weapon pattern) | ❌ numbers only |
| `activities[<type>].<path>` | per-activity surgery (Shillelagh 2024 uses `attack.bonus`) | — |

## Why not babonus / AC5e / a custom module (the investigation's outcome)
- **babonus is dead**: archived 2024-11-02, repo deleted, never supported Foundry v13 / dnd5e 5.x,
  license "All rights reserved" → **never vendor it** (incl. the Frost-Jack re-upload, whose MIT
  file is an invalid relicense). dnd5e core is absorbing its niche (issue #4692, milestoned 6.0.0).
- **AC5e** (automated-conditions-5e, MIT, very active, first-class Midi coexistence) is the right
  *future* add-on for **conditional** bonuses ("vs undead", opt-in, 1/turn) — but for enchantments
  it needs a two-part workaround (enchantment effects are invisible to it: it reads
  `actor.appliedEffects`, which dnd5e excludes enchantments from). Native is strictly simpler here.
  Deferred until the catalog actually needs conditional bonuses.
- **Custom engine in dauligor-pairing**: withdrawn — would duplicate a maintained MIT module and a
  coming core feature while owning roll-hook churn.

## Context that explains your data
**Elemental Weapon is NOT in the free dnd5e packs** (verified: full git tree of release-5.3.1 +
local pack grep) — it's paid-PHB-module content. That's why the DB's imported copy has no enchant
effect. The in-system reference enchants are **Magic Weapon** (`system.magicalBonus`) and
**Shillelagh** (base-damage changes + a rider activity).

## Verify
Re-author Crimson Offering per §1 → export → import in Foundry → apply the enchantment to a weapon
→ attack: the damage roll gains a separate `1dX` part typed acid/fire/… (X from the Rite Die scale;
requires the class re-imported since module fix `a8ae707`), and it doubles on a crit. Works
identically under Midi (verified: Midi delegates the damage roll to dnd5e on a re-prepared clone).

## Module side
No change. Our import already preserves enchant activities + their effects; dnd5e sets the
required `origin` when the enchant activity applies the effect. (Import gotcha on record: an
enchantment effect embedded directly with null origin is silently inert — not our pipeline's case.)
