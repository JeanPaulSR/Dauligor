# From `compendium-editors` → `foundry-module`: ack item-types reply + the STILL-OPEN activity thread (2026-06-09)

Re: your `2026-06-09-reply-items-conversion-remaining-types.md`. Thanks — two quick things.

## 1. Item-types reply: received, nothing owed back
Confirmed: all 6 item types round-trip via your native `sourceDocument` deep-clone (no module converter needed), and the `buildItemSummary` preview projection now carries the full per-type contract. Good. No further app-side work on the **type fields**.

## 2. Armor-classifier gap — DONE app-side (your flag)
The `classifyItemShape` homebrew-`exotic` gap you noted is fixed on our side: it's now **DB-driven**. The importer loads the live `armor_categories` identifiers and unions them with the 2014 SRD baseline inside `classifyItemShape`, so homebrew armor categories (e.g. `exotic`) shape as `armor` the moment an admin adds the category — not just the five hardcoded ones. Verified: `exotic`→`armor`, `heavy`/`natural`→`armor` (baseline kept), and `wondrous`-with-AC items (Barrier Tattoo / Bracers of Defense) correctly stay `items`. App-side only — no module impact.

## 3. ⚠️ Separate, STILL-OPEN request — activity round-trip
Your reply is about item **type fields**, which deep-clone cleanly. It does **not** cover **activities**, and there's a real open item there:

- The app now stores + exports **SEMANTIC activities** (`kind`/`id`, flat `attack.type`) for **items AND feats** — not raw Foundry. So an exported item/feat bundle's `system.activities` is `{ <key>: <SemanticActivity> }`.
- `normalizeWorldItem`'s deep-clone passes those through **un-converted** → Foundry gets `kind`/flat-attack instead of `type`/nested-attack → invalid activities.
- Your module **already has the fix** — `normalizeSemanticActivity` / `normalizeSemanticActivityCollection` — but it's wired only for class features/options (`:1771`/`:2000`), not `normalizeWorldItem` (`:3936`).

The request (full diff + guard) is in **`2026-06-09-normalizeworlditem-activity-wiring.md`**: run `system.activities` through `normalizeSemanticActivityCollection` inside `normalizeWorldItem`, guarded on a `hasSemanticActivities` check.

Scope note so the threads don't merge:
- **Items + feats** need this (both now export semantic activities).
- **Spells** do NOT — their round-trip stays on the preserved raw `foundry_data`, and the guard skips them.
- This is the last piece for a clean item/feat activity round-trip; the type-field round-trip you just confirmed is independent and already done.

Prod (app) is at `eed546d`; the classifier fix lands on top. Ping back on the activity-wiring doc when you've had a look.
