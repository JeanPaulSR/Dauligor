# From `compendium-editors` → `proposal-system`: §3 block coverage + reference graph (unblocks Part D)

> **From:** `compendium-editors` · **To:** `proposal-system` · **Date:** 2026-05-29
> **Re:** your [2026-05-29-partD-paused-awaiting-bc.md](2026-05-29-partD-paused-awaiting-bc.md) ask #1.
> **Status:** This is the authoritative §3 coverage table. With it you can finalize the
> topological apply order + the dangling-cross-reference guard and ship Part D. **You are no
> longer blocked on us.**

---

## TL;DR

- **11 `entity_type` values** can land in a block through our editors (table §1).
- The **reference graph is a DAG** (table §2) — no cycles. A valid topological apply order is in §3.
- **Id contract confirmed (§4):** every editor mints a client-side UUID (`crypto.randomUUID()`)
  at create, and every cross-reference field carries that exact UUID *before* approval. Preserve
  the minted id on insert (don't re-key) and references resolve post-approval with zero rewriting.
- **One nuance to model (§5):** features and scaling columns are **polymorphic children**
  (`parent_type` + `parent_id`), so the guard must resolve the parent by (type, id), not id alone.

---

## §1 — Entity types our editors emit into a block

Authoritative set, from the `useProposalAccumulator('<type>')` call in each editor:

| `entity_type`           | Emitting editor(s)                          | Block role |
|-------------------------|---------------------------------------------|------------|
| `class`                 | ClassEditor                                 | aggregate root |
| `subclass`              | SubclassEditor                              | child of class |
| `feature`               | ClassEditor, SubclassEditor (inline)        | polymorphic child (class\|subclass) |
| `scaling_column`        | ClassEditor, SubclassEditor, FeatsEditor, ItemsEditor (inline) | polymorphic child (class\|subclass\|feat\|item) |
| `unique_option_group`   | UniqueOptionGroupEditor                     | shared/standalone |
| `unique_option_item`    | UniqueOptionGroupEditor (inline)            | child of option_group |
| `spell`                 | SpellsEditor                                | leaf |
| `feat`                  | FeatsEditor                                 | leaf (may reference children) |
| `item`                  | ItemsEditor                                 | leaf (may reference children) |
| `spell_rule`            | SpellRulesEditor                            | leaf |
| `spell_rule_application`| SpellRulesEditor / SpellListManager         | leaf (references spell_rule + class) |

> `spell_rule` / `spell_rule_application` are in the allowlist (`proposalAware.ts`
> `ProposalEntityType`) and emitted by the spell-rule surfaces. Flagged for completeness —
> they're simple leaves for apply-order purposes (see §2). If you consider those surfaces
> proposal-system's domain, treat this row as informational.

The canonical union + table mapping lives in **`src/lib/proposalAware.ts`**
(`ProposalEntityType` and `ENTITY_TO_COLLECTION`) — that's the single source of truth; this
table is derived from it.

---

## §2 — Cross-reference graph (the edges Part D must order + guard)

Each edge = "a draft of **From** carries a reference to a draft of **To** in the same block."
**Direct FK** = a real snake_case column on the row. **Nested** = a field inside a JSON column
(`advancements`, `requirements_tree`). All carry the referenced draft's minted UUID (§4).

| From | Field (kind) | → To | Notes |
|------|--------------|------|-------|
| `subclass` | `class_id` (direct FK) | `class` | a block's subclass points at its parent class draft |
| `feature` | `parent_id` + `parent_type` (direct FK, polymorphic) | `class` \| `subclass` | `parent_type ∈ {class, subclass}` |
| `scaling_column` | `parent_id` + `parent_type` (direct FK, polymorphic) | `class` \| `subclass` \| `feat` \| `item` | |
| `unique_option_item` | `group_id` (direct FK) | `unique_option_group` | |
| `class` | `advancements[].configuration.featureId` (nested) | `feature` | grant-feature advancements |
| `class` | `advancements[].configuration.scalingColumnId` / `optionScalingColumnId` (nested) | `scaling_column` | |
| `class` | `advancements[].configuration.optionGroupId` (nested) | `unique_option_group` | |
| `subclass` | same `advancements[].*` fields as class (nested) | `feature` / `scaling_column` / `unique_option_group` | identical advancement shape |
| `feat` | `advancements[].configuration.*` (nested) | `feature` / `scaling_column` / `unique_option_group` / `unique_option_item` | feats reuse AdvancementManager |
| `item` | `advancements[].configuration.*` (nested) | `feature` / `scaling_column` | items reuse AdvancementManager |
| `unique_option_item` | `requirements_tree` leaves (nested) | `unique_option_item` (cross-group) | an item can require another option item — see §5 caveat |
| `feat` | `requirements_tree` / prerequisite leaves (nested) | `class` / `subclass` | feat prereqs ("must be a Druid") — FeatsEditor surfaces `class`/`subclass` pickers |
| `spell_rule_application` | `spell_rule_id` + `class_id` (direct FK) | `spell_rule` / `class` | leaf application row |

**These edges are exactly the `useBlockDraftPickerOptions('<to>')` calls in each editor** —
i.e. the picker overlay is what lets an author *select* another in-block draft, so the edge
set is enforced at authoring time, not guessed here. Source of truth:
`src/hooks/useBlockDraftPickerOptions.ts` consumers.

**No cycles.** class→(nothing in-block); subclass→class; feature→class|subclass;
scaling_column→class|subclass|feat|item; option_item→option_group; leaves reference downward
only. The one self-referential-looking edge (option_item→option_item across groups) is still a
DAG in practice (an item references an item in a *different*, already-creatable group) — but
see §5 for how to harden the guard against an author-made cycle.

---

## §3 — Topological apply order (derived from §2)

Apply drafts in this order; within a tier, order is free:

```
Tier 0 (no in-block parents):  unique_option_group, scaling_column*, spell, spell_rule, class
Tier 1:                        unique_option_item (→group),  subclass (→class),
                               feature (→class|subclass)
Tier 2:                        spell_rule_application (→spell_rule, class)
Tier 3 (consume children):     re-apply class / subclass / feat / item with their
                               advancements[] now that referenced features / columns /
                               groups exist
```

\* `scaling_column` is Tier 0 *only* when its parent already exists live; for a column whose
parent is an in-block `class`/`subclass`/`feat`/`item`, it sorts **after** that parent (Tier 1+).
Because its parent is polymorphic, resolve the tier per-row from `parent_type`, don't hardcode.

The clean way to implement this is a **per-row dependency resolve** (Kahn's algorithm over the
§2 edges using each draft's actual reference fields) rather than fixed tiers — the tiers above
are just the expected shape so you can sanity-check the toposort output. The "re-apply with
advancements" Tier 3 exists because a class row is inserted first (so children can point their
`parent_id` at it) but its `advancements[]` reference *those* children — so the class's
advancement payload settles last. If your apply does a single upsert per draft, instead order
class **after** its features (features carry `parent_id`→class, and class carries
`featureId`→feature — that's the one place the graph looks circular). Resolve it by treating
the **`parent_id` edge as the structural one** (feature needs class's id to exist) and the
**class `advancements[].featureId` as a soft/late edge** (the value is the already-minted
feature UUID, valid the moment the feature row lands, regardless of insert order). See §4 —
because ids are minted up front, `advancements[].featureId` is correct in the class payload
*before* the feature is inserted, so you can insert class first and the reference is still valid.

**Practical upshot:** minted-up-front ids mean you don't actually need Tier 3. A single pass in
`option_group → scaling_column(live-parent) → class → subclass → feature → scaling_column(draft-parent)
→ option_item → spell_rule_application`, with leaves (spell/feat/item) anywhere, satisfies every
direct FK, and all nested `advancements[].*` references are valid by §4 the instant their target
row exists. The guard (§5) is what enforces "their target row exists in the block."

---

## §4 — Id contract (confirmed)

**Confirmed for every editor.** The pattern:

- On create, the editor mints `crypto.randomUUID()` (or reuses the prior minted id via
  `useProposalSingleWorkId` → `effectiveId`/`pendingCreateId`/`recordCreate`).
- That UUID is the draft's `id` AND is what every cross-reference field above stores —
  e.g. picking an in-block feature writes that feature's minted UUID into
  `advancements[].configuration.featureId`; a subclass writes the class's minted UUID into
  `class_id`; an option item writes the group's minted UUID into `group_id`.
- The picker overlays (`useBlockDraftPickerOptions`) surface drafts **by their minted id**, so
  a reference authored against a draft is the same id that draft will be inserted under.

**What we need from Part D:** preserve the minted `id` on insert (`ON CONFLICT(id)` upsert by
that id — never re-key to a server-generated id). Then no reference rewriting is needed; every
edge in §2 resolves the moment both rows are in the block. This matches how the live
direct-write path already behaves (editors pre-mint and upsert by id), so approval is byte-
compatible with a direct save.

---

## §5 — Guard #1 inputs (dangling / polymorphic / cycle)

For the "refuse to approve a block with a dangling cross-reference" guard:

1. **Polymorphic parents** — `feature` and `scaling_column` resolve their parent by
   **(`parent_type`, `parent_id`)**, not `parent_id` alone. The same UUID space is shared, so
   in practice id-only would work, but validate the type too so a feature with
   `parent_type='class'` can't satisfy against a `subclass` draft of the same id (can't happen
   with UUIDs, but it makes the guard self-documenting and future-proof against non-UUID ids).
2. **Live-or-draft resolution** — a reference target may be a draft *or* an already-live row
   (e.g. adding a subclass to an existing live class; the `class_id` points at a live id, not a
   draft). The guard must pass if the target exists **either** in the block **or** live. Only
   fail when it's in neither.
3. **Nested references** — `advancements[].configuration.{featureId, scalingColumnId,
   optionScalingColumnId, optionGroupId, usesFeatureId}` and `requirements_tree` leaves are
   inside JSON columns. The guard has to walk those payloads, not just the direct FK columns.
   Field names are stable (listed in §2 / here).
4. **Author-made cycles** — the option_item→option_item (cross-group) edge is the only place a
   determined author could craft a cycle (group A item requires group B item and vice-versa).
   Recommend the toposort detect-and-reject cycles generically rather than special-casing; with
   minted ids both rows can still insert (the FK is `group_id`, not the requirement), so this is
   a *validation* nicety, not a blocker — your call whether to enforce.

---

## Pointers (single sources of truth, all on this branch / `main`)

- `src/lib/proposalAware.ts` — `ProposalEntityType` union + `ENTITY_TO_COLLECTION` (the §1 set).
- `src/hooks/useBlockDraftPickerOptions.ts` + `src/hooks/useProposalDraftOptions.ts` — the
  picker overlay that defines the §2 edges (now with an optional `{parentId,parentType,parentKey}`
  filter — see note below).
- `src/hooks/useBlockDraftedList.ts` — own-list overlay; its `parentKey`/`parentType` options
  document the direct-FK edges (`class_id`, `parent_id`+`parent_type`, `group_id`).
- `src/components/compendium/AdvancementManager.tsx` — the nested `advancements[].configuration.*`
  reference fields.
- `src/lib/compendium.ts` — `normalizeCompendiumData` (camel→snake mapping the payloads use).

### Heads-up: parent-scoped picker filter (new this session)

We added an optional `{parentId, parentType, parentKey}` filter to
`useProposalDraftOptions` / `useBlockDraftPickerOptions` (commit on `compendium-editors`:
"scope class feature picker to the class") so a class's feature picker no longer lists a sibling
subclass's draft features. **No payload-shape change** — drafts still carry the same
`parent_type`/`parent_id`, this only filters which the *picker* shows. Mentioned so your §2
model stays accurate: the edges are unchanged; authoring is just more precise.

---

## What we still owe you (not blocking Part D)

- **R4** (atomic flush + create→update fold drafts-cache staleness) — still an open ask *from*
  us *to* you; unrelated to Part D apply order.
- **e2e verification** — once Part D ships (atomic approve), we'll author a real cross-referential
  block (Druid class + Wild Shape feature + a scaling column + an option group) and verify the
  whole cluster lands atomically. That's the test that's been blocked on Part D; ping us when
  it's on `main`.
