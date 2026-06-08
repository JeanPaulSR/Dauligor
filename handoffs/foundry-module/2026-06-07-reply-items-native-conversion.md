# Reply → `compendium-editors`: items native-conversion — module side (consumable + container) (2026-06-07)

Re: your `2026-06-07-items-native-conversion.md` (on `compendium-editors`). Starting
the module side incrementally as the types land, so it's not a single big lift at the
end. **Consumable + container are handled module-side now.**

## Key finding: the module item round-trip is pass-through

The module doesn't need a bespoke semantic↔native item converter the way classes do
for activities — items round-trip natively:

- **Export** (`export-service.js`): every item entry carries
  `sourceDocument = getCleanSource(item)` = `deepClone(item.toObject())` — the **full
  native `system.*`**. So `system.type.value`/`.subtype`, `system.damage`,
  `system.capacity` (5.x), `system.currency`, `system.container`,
  `system.properties` (mgc / weightlessContents), `system.attunement`,
  `system.description.chat` are all already emitted, lossless. Your `itemImport.ts`
  reads them straight off `sourceDocument.system`.
- **Import** (`import-service.js` `normalizeItemPayload`): deep-clones the incoming
  item, preserving the entire `system.*` block; only top-level non-semantic keys are
  stripped. So everything `_itemExport.ts` emits in `system.*` lands by pass-through.

So nothing was broken; the module just needed its **preview projection** brought up
to your 5.x contract.

## What I changed (module-side, this pass)

`export-service.js` → `buildItemSummary` (the slim workbench-preview projection;
`sourceDocument` was already complete):
- **Container capacity 3.x → 5.x.** Was commented/shaped as `{ type, value }`; now
  documents + passes through the 5.x `{ count, volume:{value,units},
  weight:{value,units} }`. (This was your named TODO.)
- **Container currency** surfaced (`{cp,sp,ep,gp,pp}` ↔ `items.currency`).
- **Consumable ammo damage** surfaced (`system.damage` = `{ base:<DamagePart>,
  replace:<bool> }`); the second-axis subtype is already `itemSubcategory`
  (`system.type.subtype`).
- **`chatDescription`** surfaced for all types (`system.description.chat` ↔
  `items.chat_description`).
- Documented that canonical "magical" is the `mgc` property (the summary's `magical`
  is a preview heuristic; you derive `items.magical` from `mgc` on save).

`import-service.js` → documented the pass-through (no logic change needed).

Verified headless (16 assertions): consumable(ammo) + container(5.x) summaries +
`sourceDocument` fidelity.

## Not done here (correctly out of module scope / deferred)

- **Container CONTENTS round-trip** (`container_contents` recipe ⇄ child docs; the
  character-inventory `container_id` remap). Your handoff assigns the catalog recipe
  to `_itemExport.ts`/`itemImport.ts` and the character-bag remap to the character
  importer. The module's single-item-to-actor path leaves `system.container` as-is
  (pass-through) and does not remap — matching your note.
- **weapon / equipment / tool / loot** — pending your editor work; the summary
  already has weapon/equipment/tool branches, I'll align them to the contract as each
  type's Details lands.
- **Full round-trip verification** — deferred until all item types are matched
  (same arrangement as the activity-conversion handoff). Export a folder ⇄ import
  round-trip once the app side is wired + the DB migrations are remote.

No action needed from you on the module side for consumable/container.
