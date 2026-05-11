# Active Effects

The shared editor used wherever the app authors dnd5e 5.x Active Effects — class features, subclass features, modular option items (Maneuvers / Invocations / Infusions), and feats. One component, one document schema, one export path. This page documents the editor + the data it produces + the supporting D1 tables.

## Where it's used

| Editor | File | Tab |
|---|---|---|
| Class features | [`ClassEditor.tsx`](../../src/pages/compendium/ClassEditor.tsx) | Feature modal → Effects |
| Subclass features | [`SubclassEditor.tsx`](../../src/pages/compendium/SubclassEditor.tsx) | Feature modal → Effects |
| Modular option items | [`UniqueOptionGroupEditor.tsx`](../../src/pages/compendium/UniqueOptionGroupEditor.tsx) | Option modal → Effects |
| Status conditions (admin) | [`StatusesEditor.tsx`](../../src/pages/admin/StatusesEditor.tsx) | inline Changes editor (subset of the full AE editor) |

Component source: [`src/components/compendium/ActiveEffectEditor.tsx`](../../src/components/compendium/ActiveEffectEditor.tsx).

## Dialog layout

Fixed `h-[640px] max-h-[90vh]` shell — the dialog stays the same size across tabs (each `TabsContent` is `flex-1 overflow-y-auto custom-scrollbar`, so they fill the stable shell and scroll independently). Width tracks Foundry's reference `ActiveEffectConfig` window (560px) inside `max-w-xl`.

Three tabs:

### Details

| Field | Notes |
|---|---|
| Icon | Same `<ImageUpload>` as the rest of the compendium. |
| Name | `autoFocus` on dialog open — important: without it, focus stays on the outer (option / feature) modal's container, which base-UI then marks `aria-hidden`, triggering a browser focus-trap warning. |
| Icon Tint Color | Hex + native color picker. |
| Effect Description | Plain textarea — Foundry renders it inside the AE info card. |
| Effect Suspended | Boolean — sets `disabled` on the AE document. |
| Apply Effect to Actor | Boolean — sets `transfer`. `true` (default) = effect transfers to whoever owns the parent item; `false` = scoped to the item (applied per-use via an activity). |
| Effect Type | `base` (default) or `enchantment`. dnd5e 5.x. Enchantment is bound to the Enchant-activity workflow on magic items. |
| Status Conditions | Multi-select via `<EntityPicker>`; pulls from the `status_conditions` D1 table (see [Status conditions and categories](#status-conditions-and-categories)). |

### Duration

Six numeric fields wrapped in two grouped cards:

- **Seconds + Start Time** — wall-clock duration (seconds) and start offset.
- **Combat duration** — Rounds, Turns, Round (start), Turn (start). Laid out with `grid-cols-[3rem_5rem_3rem_5rem]` so labels + inputs line up between the two combat rows even though "Rounds"/"Round" have different character counts.

All number inputs use the `.no-number-spin` utility (defined in `src/index.css`) to hide the browser default up/down spinners — they misaligned with neighbouring text inputs at our small input size. Typing, pasting, and arrow-key increment still work.

### Changes

`changes[]` rows — each is a single `{key, mode, value, priority}` entry. Three-section layout:

- **Header** (sticky) — column labels: leading magnifier spacer, Attribute Key, Change Mode, Value, Priority, trailing delete spacer.
- **Rows** (scrolls) — one row per change.
- **Footer** — bottom-right `+` button, matching the effect-list "Add Active Effect" pattern.

Column widths between header and rows mirror exactly: leading `w-6` icon, `flex-[2]` key, `w-28` mode, `flex-1` value, `w-20` priority, trailing `w-6` delete. Tweak both sides together when adjusting.

#### Attribute Key autocomplete

The key input is a custom [`<ActiveEffectKeyInput>`](../../src/components/compendium/ActiveEffectKeyInput.tsx) — a free-text combobox backed by a curated catalog of ~400 keys covering dnd5e 5.x system paths and the Midi-QOL / DAE / dnd5e-core flag namespaces.

Catalog source: [`src/lib/activeEffectKeys.ts`](../../src/lib/activeEffectKeys.ts). Categories:

- **Abilities / Skills / Bonuses** — `system.abilities.<key>.{value,bonuses,checkProf,saveProf}`, `system.skills.<key>.{bonuses,value}`, attack/damage bonuses per kind (mwak/rwak/msak/rsak), `system.bonuses.spell.dc`.
- **HP & AC** — `system.attributes.hp.{value,max,tempmax,temp,bonuses}`, AC formula / calc / flat / bonus / cover.
- **Initiative / Speed / Senses** — movement modes, darkvision/blindsight/etc.
- **Spellcasting** — `system.attributes.spellcasting`, spell DC override, per-level slot overrides, Warlock pact overrides.
- **Resistances / Traits / Resources** — di/dr/dv/ci, traits.size, languages, weapon/armor/tool proficiencies, primary/secondary/tertiary resources.
- **Concentration / Death Saves** — `system.attributes.concentration.{ability,bonuses.save,roll.mode,limit}`, `flags.midi-qol.advantage.deathSave.all`.
- **dnd5e core flags** — Halfling Lucky, Elven Accuracy, Jack of All Trades, Reliable Talent, Remarkable Athlete, Savage Attacks, Powerful Build, Diamond Soul, Observant, weapon/spell crit thresholds.
- **Midi-QOL** — full advantage / disadvantage tree (per attack kind, per ability, per skill, per save, death save, concentration, initiative), `grants.*` (advantage given to attackers against this actor), `fail.*` / `success.*` auto-success and auto-fail, `optional.*` Lucky-style choice bonuses, magic resistance, absorption per damage type, flat DR, Sharpshooter / Great Weapon Master / etc.
- **DAE** — `macro.execute`, `macro.itemMacro`, `macro.tokenMagic`, `macro.actorUpdate`, `flags.dae.specialDuration`, `flags.dae.transfer`.

UI behaviour:

- Free-text input — authors can type any key, even one we haven't catalogued. The catalog is suggestions, not validation.
- Dropdown opens on focus, filters by substring match against `key + label + description`.
- Suggestions are grouped by category in a stable order.
- Up/down arrows + Enter to pick, Escape to dismiss, click-outside dismisses.
- **Portal rendering** — the dropdown renders via `createPortal(document.body)` with `position: fixed` anchored to the input's bounding rect. This escapes the parent modal's `overflow: auto` so the dropdown can extend past the dialog edge.
- **Re-anchors on ancestor scroll** — uses `addEventListener('scroll', …, { capture: true })` to catch nested scrollers (modal bodies don't bubble scroll events).
- **Flips above when near viewport bottom** — when there's less than 320px of room below the input, the dropdown anchors to the input's top edge instead via `transform: translateY(-100%)`.
- **Wider anchor** — accepts an optional `widthAnchorRef` so the dropdown can size against the full change row rather than only the narrow key column. The Changes-tab passes a row ref so suggestions get the entire row's width.

#### Change Mode

Standard Foundry `CONST.ACTIVE_EFFECT_MODES`:

| Value | Label | Default priority |
|---|---|---|
| 0 | Custom | 0 |
| 1 | Multiply | 10 |
| 2 | Add (default) | 20 |
| 3 | Downgrade | 30 |
| 4 | Upgrade | 40 |
| 5 | Override | 50 |

#### Priority

Optional override of the per-mode default priority. `null` (the input is greyed) means "use the mode default". Foundry applies changes ascending by priority.

## Status conditions and categories

The Details tab's "Status Conditions" picker writes to `effect.statuses[]` — an array of condition IDs that get applied to the owning actor while the effect is active (e.g. Stunning Strike → `["stunned"]`, Hold Person → `["paralyzed"]`).

Data sources (both fetched via `fetchCollection()` on dialog open):

| Collection | Table | Field used |
|---|---|---|
| `statuses` | `status_conditions` | `identifier` → `statuses[]`, `name` → label, `category_id` → hint lookup |
| `conditionCategories` | `condition_categories` | `id` (matched against `status_conditions.category_id`), `name` → hint badge |

The hint badge ("PHB Conditions" / "Spell States" / etc.) renders both in the dropdown list AND on selected chips, so the categorisation context stays visible after picking.

Schema reference: [`status_conditions`](../database/structure/status_conditions.md).

Admin editing: `/admin/statuses`, a tabbed page with **Conditions** (rich form) + **Condition Categories** (`SimplePropertyEditor`).

### Force-fresh fetch

The fetch uses an explicit column projection (`select: 'id, identifier, name, category_id'`) rather than `SELECT *`. d1.ts's query cache is keyed on the full SQL string — varying the column list produces a fresh cache key and bypasses any stale sessionStorage entries from before the 20260511-0043 migration added `category_id`. Bonus: smaller payload.

## Export round-trip

The module-side normalizer ([`module/dauligor-pairing/scripts/class-import-service.js:normalizeSemanticItemEffects`](../../module/dauligor-pairing/scripts/class-import-service.js)) accepts every authored field:

```
{ _id, name, img, description, disabled, transfer, tint,
  duration, changes, statuses, type, sort, flags }
```

Each field is normalised defensively (string → trim, number → coerce, JSON → parse) and emitted onto the embedded item's `effects[]` array on the actor. `_id` is regenerated when malformed (Foundry requires exactly 16 alphanumeric chars). Status conditions on the active effect translate directly to the Foundry condition icons on the token while the effect is active.

## Things deliberately not exposed in the editor

| Field | Why |
|---|---|
| `origin` | Runtime field set by Foundry when an effect is applied (the UUID of the granting item). Authors don't author this. |
| `sort` | Integer ordering; system-managed. |
| `flags` (top-level) | Module-specific flag data (`flags.midi-qol.*`, `flags.dae.*`) is already authored through `changes` rows with the corresponding `key` paths — a top-level flags JSON editor would duplicate. |

## CSS notes

- `.custom-scrollbar` — site-wide thin gold scrollbar (defined in [`src/index.css`](../../src/index.css)). Applied to every overflow region in the editor: the autocomplete dropdown, all three tab bodies, the Changes-rows list, the EntityPicker dropdown, and the StatusesEditor Import JSON modal.
- `.no-number-spin` — hides the WebKit `::-*-spin-button` and Firefox `-moz-appearance: textfield`. Applied to every numeric input in the editor (Duration fields + Priority).

## Related docs

- [compendium-options.md](compendium-options.md) — option-item editor that hosts this component
- [compendium-classes.md](compendium-classes.md) — class feature editor that hosts this component
- [foundry-export.md](foundry-export.md) — export bundle shape
- [`status_conditions` schema](../database/structure/status_conditions.md)
