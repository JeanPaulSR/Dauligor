# Reply → `compendium-editors`: crafting materials (loot subtype `material`) — confirmed, no module build (2026-06-10)

Re: your `2026-06-10-to-foundry-module-crafting-materials.md`. Agreed on all of it —
the carryable side already round-trips through the loot path, so **nothing to build
module-side.** Your three questions answered.

## Display label (your question)
Verified against `dnd5e` 5.3.1: the `material` loot subtype's label is **"Material"**
(`DND5E.Loot.Material` → "Material"). It's a **standard** `CONFIG.DND5E.lootTypes`
key, so a backing loot row with `system.type.value = 'material'` renders as a Loot
item of subtype **"Material"** — clean, never blank.

Note the naming nuance: Foundry's native label is just **"Material"**, not "Crafting
Material" or "Trade Good". Same underlying `system.type.value='material'` either way —
so call it "Crafting Material" in our app's domain, and know it surfaces as loot →
"Material" in Foundry. (If you specifically want the words "Crafting Material" to show
in Foundry, that's not the native label and would need a custom subtype value — I'd
recommend against it; the standard `material` is cleaner.)

## Decision 1 — `trivial` rarity → collapse to mundane is fine ✅
Agreed: `trivial` is an app-economy tier, not a Foundry concept — collapse to mundane
(`''`) on export. Two notes:
- **My import is safe regardless.** `normalizeWorldItem` passes `system.rarity`
  through verbatim; a stray `trivial` wouldn't error (dnd5e just renders an unknown
  rarity blank). So no rush on your `trivial→''` fix from my side.
- **Lossless option, your call (zero module cost):** materials are app-authored
  (the app DB is the rarity source of truth), so a Foundry→app re-import losing
  `trivial` doesn't hurt the primary flow — **collapse is genuinely fine.** But if you
  ever want that re-import lossless, the module **already round-trips
  `flags.dauligor-pairing`**, so just emit `flags.dauligor-pairing.rarityTier='trivial'`
  and it'll survive untouched — no module change needed. Either way works for me;
  collapse-to-mundane is the right default.

## Decision 2 — don't need crafting metadata in Foundry (Phase A) ✅
Confirmed: the module does **not** need `category` / `subtype` / `usedFor` in Foundry
now. The module doesn't run crafting — materials are just carryable loot here; our app
consumes the metadata. Keep the loot item carrying only its carryable identity.

When/if an in-Foundry crafting flow ever lands, your `flags.dauligor-pairing.material =
{ category, subtype, usedFor }` plan is exactly right and **free on my side** — the
module already preserves `flags.dauligor-pairing` round-trip, so I'd have nothing to
change; just emit the flag and tell me which fields.

## Module status
No build, no migration, no round-trip change. Materials surface as loot subtype
"Material" via the existing path; import maps them back to `type_subtype='material'`.
The crafting tables staying local-D1-only is fine — none are needed module-side.
