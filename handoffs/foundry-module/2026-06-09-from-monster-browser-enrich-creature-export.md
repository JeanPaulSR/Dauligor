# Request → `foundry-module`: enrich `creature-folder-export` with DERIVED values (2026-06-09)

**From:** `monster-browser` branch (new — greenfield public Monster Browser at
`/compendium/monsters`). **To:** `foundry-module` (owner of
`module/dauligor-pairing/**`).
**Status:** request · the app **degrades gracefully** without it (best-effort
compute + an `ac_unverified` flag), so this is high-value, not blocking.

## TL;DR

The `creature-folder-export.v1` is excellent — `creatureSummary` is exactly the
shape the new `monsters` table wants. But the summary is built from the **raw
`actor.toObject()` source**, so every Foundry-**derived** value comes out unset:
`ac.value` is `0`/null for **478/1001**, `proficiencyBonus` is `0` for **all 1001**,
`spellcasting.level` is `0` for all. Those numbers exist **only** on the live
(prepared) `actor.system` — `toObject()` never carries them, so the app **cannot
recompute the most important one (resolved AC) for ~306 creatures** from the export
alone. The function already receives the live `actor` — it just doesn't read from it.

**Ask: populate the summary's derived fields from `actor.system` (prepared), not
`source.system` (raw).** Plus two stale-path bugs (`source`, `spellLevel`). All in
one function: `buildCreatureSummary` at
[`module/dauligor-pairing/scripts/export-service.js:1535`](../../module/dauligor-pairing/scripts/export-service.js).

## Why this matters (evidence from all 1001 creatures)

Verified by Python probes over the real `creatures-creatures-export.json` (full
write-up: `docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html`):

| Field | Current export value | Why it's a problem |
|---|---|---|
| `creatureSummary.ac.value` | **0 or null for 478/1001** | AC calc splits `{natural:523, default:462, custom:16}`. `natural` reads `ac.flat` fine, but **306 `default`-calc creatures have no armor item and `flat:null`** → there is **no AC number anywhere in the static export**. `10+dex` is a guess. AC is line 1 of every stat block. |
| `creatureSummary.proficiencyBonus` | **0 for all 1001** | Reads raw `system.attributes.prof` (a derived field, absent in `toObject()`). The app must re-derive PB from CR to compute every save/skill bonus + passive Perception. |
| `creatureSummary.spellcasting.level` | **0 for all** | Reads the wrong/stale path (see fix #3). |
| `creatureSummary.source.book` / `.page` | **empty for all** | Reads the wrong/stale path (see fix #2). *(The app can work around this by reading `sourceDocument.system.source` — which IS populated — so this one is low-priority.)* |

**The root cause** — `export-service.js:1535-1536`:

```js
function buildCreatureSummary(actor, source) {   // ← `actor` is the LIVE Actor5e (prepared/derived)
  const system = source.system ?? {};            // ← but everything reads `source` = actor.toObject() (RAW)
  ...
```

`actor` is passed in but never used. `toObject()` returns **stored** data; Foundry's
runtime derivations (`prepareData()`) — resolved AC, PB, ability save totals, skill
totals, passive Perception, spell DC/attack — live on **`actor.system`**, not on the
clone. So they're missing from the digest, and (because the digest is the only
"computed" surface) the app has nowhere to read them from.

## The ask — 3 surgical changes to `buildCreatureSummary`

Keep `sourceDocument` exactly as-is (raw `toObject()` — it's the fidelity fallback;
the app reads all **authored** fields from it). Only enrich the **`creatureSummary`**
digest. New contract split: **authored data → `sourceDocument.system.*`; derived/
computed numbers → `creatureSummary`.**

### 1. Read derived values from the live `actor` (the critical one)

Source the following from `actor.system.*` (prepared), not `source.system.*`:

| Summary field | Read from (prepared) | Note |
|---|---|---|
| `ac.value` | `actor.system.attributes.ac.value` | **The critical fix** — the resolved AC integer, unblocks the 306. Keep `flat`/`formula`/`calc` from raw for provenance. |
| `proficiencyBonus` | `actor.system.attributes.prof` | derived PB. |
| **NEW** `abilities.<a>.save` | `actor.system.abilities.<a>.save` | the +N save total (we render "Dex +7"). |
| **NEW** `skills.<s>.total` and `.passive` | `actor.system.skills.<s>.total` / `.passive` | the +N skill total (we render "Perception +11", incl. expertise doubling) + passive value. |
| **NEW** `passivePerception` | `actor.system.skills.prc.passive` (or `actor.system.attributes.perception`) | the "passive Perception N" on the Senses line. |
| **NEW** `spellcasting.dc` and `.attack` | `actor.system.attributes.spell.dc` / `.attack` (or per-class block if v5 splits it) | monster spell save DC + to-hit (currently only in prose). 38 creatures have **two** spellcasting feats — if a per-block DC is available, emit it per block. |

(Whatever the exact dnd5e 5.3.1 derived paths are — you have the live system to read;
the names above are our best guess from the data. The principle is: emit Foundry's
prepared numbers.)

### 2. Fix the stale `source` path

`export-service.js:1567-1570` reads `system.details.source.{book,page}`. In dnd5e v5
publication source moved to **top-level `system.source.{book,page,rules}`**. Read from
there and **add `rules`** (`"2014"`/`"2024"`):

```js
source: {
  book:  String(system.source?.book  ?? "").trim(),
  page:  system.source?.page ?? null,
  rules: String(system.source?.rules ?? "").trim(),   // NEW
},
```

### 3. Fix the stale `spellLevel` path

`export-service.js:1596` reads `system.details.spellLevel` → use
`system.attributes.spell.level` (this is why `level` is always 0).

## Also

- Update **`module/dauligor-pairing/docs/creature-folder-export-contract.md`** to
  document the new derived fields + the path corrections (and the authored-vs-derived
  split).
- A fresh export of the same Creatures folder is enough for us to re-pin + import.
- 3 creature **names** carry a destroyed `U+FFFD` byte (`Roth�`, `Deep Roth�`) — the
  original `é` is unrecoverable downstream. If the export pipeline is corrupting them,
  a fix at the source would be cleaner than our hand-patch. Low priority.

## What we do until this lands

The app imports best-effort: derive PB from CR; compute saves/skills/passive from
that; compute AC (`natural`→`flat`, `default`→`10+dex+armor items+AE`, `custom`→eval
`formula`) and set **`ac_unverified=true`** on the ~306 we can't trust. The enriched
export replaces all of that with exact values and clears the flag.

## References

- Shape study + proposed `monsters` schema: `docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html`
- Raw analysis + probes: `E:\DnD\Professional\Foundry Export\_research\{SYNTHESIS,CRITIQUE,finder1..4}.md`
- Exporter: `module/dauligor-pairing/scripts/export-service.js` (`buildCreatureSummary` @ ~1535, `buildCreatureExportEntry` @ ~1624, `buildCreatureFolderExport` @ ~1642)
- Contract: `module/dauligor-pairing/docs/creature-folder-export-contract.md`
