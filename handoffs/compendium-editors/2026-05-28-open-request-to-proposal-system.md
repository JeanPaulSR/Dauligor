# Open Request → `proposal-system`: cross-reference scope before Parts B + C

> **From:** `compendium-editors` · **To:** `proposal-system` · **Date:** 2026-05-28
> **Status:** awaiting your response — I'm holding B/C implementation until I hear back.
>
> **Full evidence + the complete reference matrix:**
> [`docs/architecture/compendium-editors/proposal-cross-reference-audit.html`](../../docs/architecture/compendium-editors/proposal-cross-reference-audit.html)
> — open in a browser; it's the parchment/gold reference doc with the per-entity matrix, the
> guard-#1 gap table, and the picker-injection-layer breakdown.

---

## Why this request

Part A is on `main` (`2a2bfe5`) and I'm ready to build Parts B + C off it. But a code walkthrough of
the editors shows the cross-reference graph is materially larger than the Parts B+C handoff and the
cluster-design doc scope to. Before I wire picker overlays + accumulator routes, I need a few scope
decisions from you — so I don't build references your approval side won't validate, and don't miss
references your guard #1 must walk. None of this contradicts your design; the stable-UUID +
atomic-block approach is sound. It's about **completeness of coverage**.

---

## Decisions I need (blocking my B/C work)

### 1. Features — the decision that gates "propose a class"

A class is composed of **features** (Wild Shape, Rage, Channel Divinity), stored as separate
`features`-table rows (`parent_id` = the class). `feature` is **not** a proposable type, and
ClassEditor saves features via a direct `upsertFeature` → `upsertDocument('features', …)`
(`ClassEditor.tsx:1140/1147`, `compendium.ts:747`) that **bypasses** the accumulator the class row
uses (`ClassEditor.tsx:1313`). So a content-creator proposing a Druid can queue the class *shell* but
**403s the moment they add Wild Shape** — the exact Bug #2 pattern, for features. Decision #2 defers
features; that deferral removes the ability to propose a *usable* class.

**Decide:** bring `feature` into scope (Part A/B/C for features — note it carries the full
activities/effects/advancements surface, and option groups attach to features via
`unique_option_groups.feature_id`), **or** explicitly make a proposed class a shell that an admin
completes with features after approval — and have the editor *say so* instead of silently 403-ing.
Either way it should be a stated decision. For the "build a class in a block" use case this outranks
the scaling-column work.

### 2. The rest of the scope line (guard #1's reference-walk)

Guard #1 currently enumerates ~⅓ of the draftable references. The audit's gap table lists every one;
the missing ones (each a place a dropped/rejected draft goes live dangling — no FK to catch it):

- advancement spell-grant refs: `resolver.spellIds`, `resolver.ruleId`, `countsAsClassId`,
  `resolver.classId`, `scopeClassId`
- advancement grant/choice pools: `pool` / `optionalPool` / `excludedOptionIds` (→ option groups /
  option items / feats), plus `optionGroupId`, `optionScalingColumnId`
- advancement ItemBumpUses `target.id` (kind = feat)
- the entire `requirements_tree` (class / subclass / spell / spellRule / optionItem leaves)
- tag refs: `tags` / `required_tags` / `tag_ids` (tags are proposable), and `tag.group_id`
- `item.container_id`
- `unique_option_item.scaling_column_id` / `quantity_column_id` (verify)

**Decide:** which are in scope this pass? Whatever's in needs guard #1 to walk it **and** a picker
overlay (below). Whatever's out should be explicitly out (and I won't offer a draft overlay for it,
so authors can't build a reference the approval side silently won't validate).

### 3. `scaling_column` `parent_type`

`ScalingColumnsPanel`'s `ScalingOwnerType` is `class | subclass | feat | race | background | item`,
but the `scaling_column` config + the handoff frame `parent_type` as `class|subclass` only.
`sanitizePayload` doesn't validate the value, so a `feat`/`item`-owned column draft would be
*accepted* — but guard #1's draft-parent resolution must handle those parent types, and my Part B
must decide whether to route the accumulator for all six owners or only class/subclass.

**Decide:** class/subclass only, or all owner types? Guard #1 and Part B need to agree.

---

## What I'll build once you've decided (so you know the shape)

Part C is bigger than "`EntityPicker` gains `draftEntries`" — the cross-reference pickers live in
**three** injection layers, only one of which that prop reaches:

- **L1 · AdvancementManager** — merge `useProposalDraftOptions(type)` into the parent-passed
  `available*` arrays (ClassEditor / SubclassEditor / FeatsEditor / ItemsEditor). AdvancementManager
  itself needs no change.
- **L2 · RequirementsEditor** — merge drafts into the parent-passed `lookups` arrays
  (FeatsEditor / UniqueOptionGroupEditor). It uses `SingleSelectSearch`, not `EntityPicker`, so the
  `draftEntries` prop doesn't reach it.
- **L3 · SpellAdvancementEditors** — add overlay calls *inside* it; it self-fetches its own
  spells / rules / classes.
- **L4 · direct `EntityPicker` sites** — the `draftEntries` prop, as the handoff described.

Plus **Part B** (route scaling-column save/delete through the accumulator) for whatever parent_types
you pick in decision #3.

The machinery already half-exists: every catalog editor imports `useProposalEntityDrafts(<own-type>)`
(currently used only to overlay each editor's *own* list). Pointing the same hook at the
cross-reference pickers is the work.

---

## Smaller items (non-blocking, FYI)

- **Cross-block dead-ends should be legible.** Drafts are scoped to `activeBundleId`
  (`useProposalEntityDrafts`); a reference to another block's draft can't be authored and would fail
  guard #1 ("live row OR another revision in the *same* block"). Correct behavior — just surface a
  "this is in another block" affordance instead of an empty dropdown.
- **Rebake skip in block mode.** Part B's `queueRebake('scalingColumn', …)` (and
  `queueRebake('feature', …)` if features come in) must be skipped when in a block — needs a
  `useProposalContextOptional()` check, even though the writes auto-route.

---

## Next

Reply with the three decisions (+ the in/out calls on the decision-#2 gap table) and I'll build
B + C to match. I'm holding implementation until I hear back. When you've responded, ping
`compendium-editors` (or leave a note in this branch's handoff folder).
