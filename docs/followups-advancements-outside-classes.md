# Follow-ups — "Advancements outside classes" track

Consolidated catalog of everything that's still open after Phase A
(editor UI extraction), Phase B (Foundry round-trip for non-class
owners), and Phase C (`ItemBumpUses` end-to-end). Created when we
shifted focus back to feats / editors code clarity (2026-05-27).

The track is **shipped end-to-end** for the in-scope authoring + the
direct Foundry-export paths. The items below are scope-bounded follow-
ups that didn't make the v1 cut, plus the module-side and runtime work
that needs the *other* surfaces (character builder inventory, server
synthesis, Foundry-side module) to be fleshed out before they're worth
doing.

Top-of-mind reading order if you pick this up cold:

1. [docs/roadmap.md § Scaling columns for non-class owners — follow-ups](roadmap.md#scaling-columns-for-non-class-owners--follow-ups)
2. [docs/handoff-scaling-non-class-owners.md](handoff-scaling-non-class-owners.md) — design calls
3. [docs/handoff-phase-c-itembumpuses.md](handoff-phase-c-itembumpuses.md) — Phase C pickup
4. [docs/verification-scaling-non-class-owners.md § J](verification-scaling-non-class-owners.md#j-itembumpuses-end-to-end-phase-c-v1) — end-to-end verification

---

## 1. Module-side (Foundry / dnd5e work)

These items live in `module/dauligor-pairing/` and need Foundry-side
implementation, not app-side. The app's behavior is stable as far as
the contracts are concerned.

### 1.1 Item server-export consumer (Phase B.2 — module side)

**Status**: app endpoint shipped (`ecd4906`), module consumer not started.

The app serves Foundry-ready item documents at
`/api/module/items/<dbId>.json`. The module needs an importer that
consumes that endpoint and embeds the item (mirroring the existing
feat importer pattern in `module/dauligor-pairing/scripts/`).

Until this lands, the items export endpoint is verifiable only via
URL inspection (see
[verification doc § F'](verification-scaling-non-class-owners.md#f-item-server-export-endpoint-phase-b2-items--forward-direction)).
No end-to-end Foundry play-time test is available.

### 1.2 `itemBumpUses` actor-flag consumer (Phase C — module side)

**Status**: app emits flags (`960a99d`), module-side audit UI not started.

The character exporter bakes `ItemBumpUses` bumps into each granted
feature item's `system.uses.max` (Foundry resolves the combined
formula natively at play time), AND emits two audit trails the module
could surface in a debug or DM-facing UI:

- per-feature-item: `flags['dauligor-pairing'].itemBumpUses = [{amount, sourceKind, sourceId, sourceName, sourceAdvancementId}]`
- whole-actor: `actor.flags['dauligor-pairing'].itemBumpUses = { bumps, warnings }`

The `warnings` array carries `target-not-present` / `target-missing-id`
entries — useful to surface to the DM so they can manually apply
intent the app couldn't bake.

Nothing breaks if the module ignores these flags entirely.

### 1.3 `item-import-contract.md` advancements field acknowledgement

**Status**: open · low priority.

The canonical contract doc treats `system.advancement` as
"intentionally omitted" from the slim `itemSummary` projection. That's
still accurate for the projection, but the full `sourceDocument`
*does* round-trip advancements (Phase B.3 items relies on this). A
short clarifying note in `item-folder-export-contract.md` § "What's
intentionally not in the entry" would prevent future agents from
re-deriving the same confusion.

Owner-gated per the `dauligor-guardian` skill.

### 1.4 Stale module-doc refs

**Status**: open · low priority.

Several other module docs (not on the original B.4 list) reference
`ScaleValue` / `scalingColumns` in class-only language:

- `module/dauligor-pairing/docs/advancement-and-activity-implementation-guide.md`
- `module/dauligor-pairing/docs/character-class-import-guide.md`
- `module/dauligor-pairing/docs/class-import-and-advancement-guide.md`
- `module/dauligor-pairing/docs/class-import-endpoint-notes.md`
- `module/dauligor-pairing/docs/class-semantic-export-notes.md`
- `module/dauligor-pairing/docs/reference-syntax-guide.md`
- `module/dauligor-pairing/docs/foundry-dnd5e-reference.md`
- `module/dauligor-pairing/docs/google-doc-synthesis.md`

The three core contract docs were updated this turn
(`class-import-contract.md`, `advancement-construction-guide.md`,
`schema-crosswalk.md`); the rest of the corpus would benefit from a
sweep but isn't blocking.

The roadmap originally listed `class-feature-activity-contract.md`
in the B.4 set, but it no longer contains any ScaleValue references —
that pointer was stale. Drop it from the B.4 list next time you touch
the roadmap.

---

## 2. App-side runtime (character builder + export)

These extensions live in `src/pages/characters/` and `src/lib/`. They
unblock the *runtime* path for advancement sources that authoring
already supports — currently the walker handles class / subclass /
feature / feat advancements at runtime, but not items.

### 2.1 Item-authored bumps in the character runtime

**Status**: authoring shipped (`ec9f229`), runtime walker doesn't accept items.

`collectItemBumpUses` in
[`src/lib/characterLogic.ts`](../src/lib/characterLogic.ts) currently
takes `{ progression, classCache, subclassCache, featureCache,
ownedFeats, totalCharacterLevel }`. Extending it to also accept
`ownedItems` (and walking each item's `advancements` array the same
way it walks feat advancements) would let Amulet-of-the-Devout-style
bumps fire on the character sheet + in the Foundry export.

Blockers:

- The character builder's inventory / equipped-items layer isn't
  heavily implemented yet (user's call when we shifted scope).
- Need to decide whether an item bump fires when the item is *owned*
  vs *equipped* vs *attuned* (5e attunement matters for many items).

### 2.2 Server-side feat synthesizer for actor export

**Status**: open · deferred (character JSON export is not a current priority).

The Foundry actor exporter in
[`src/lib/characterShared.ts`](../src/lib/characterShared.ts) walks
class / subclass / feature advancements correctly because their
advancements live on the rows directly. **Feat-authored bumps drop
silently** because `rebuildCharacterFromSql` doesn't synthesize
`character.feats` server-side — feat synthesis is a client-only walker
in CharacterBuilder around line 2895.

To unblock: port the feat synthesis walker (or a slim version of it)
to a server-callable helper that buildCharacterExport can use to
populate `charData.feats` before passing it to `collectItemBumpUses`.

### 2.3 Persistence of `derivedItemBumpUses`

**Status**: open · nice-to-have.

`character.derivedItemBumpUses` is a transient field. Every load
re-derives it from the walker. That's fine for correctness but it
means raw D1 reads of the character don't carry the field — anything
that needs the audit trail without running the walker (e.g. a CLI
report tool) has to rebuild it.

If we ever need this for audit logs, a `derived_item_bump_uses TEXT`
column on `characters` (JSON-stringified) + a save-path hook would do
it. Not worth the migration today.

---

## 3. Authoring surface — future advancement modes

These were design-flagged Phase D / E by the original "Bump uses
first" call. Don't pick these up until the bump-uses runtime is
solid (sections 2.1 + 2.2).

### 3.1 `'addToChoice'` mode

Extend a target `ItemChoice`'s pool. Example: a feat that adds an
extra Fighting Style option to the Fighter's L1 choice.

### 3.2 `'replace'` mode

Full feature overwrite. Example: a feat that replaces Channel
Divinity (1/rest) with Channel Divinity (1/short rest).

Both modes share the target-picker UX with `ItemBumpUses` (kind +
entity dropdown via `SingleSelectSearch`), so most of the editor-side
infrastructure is reusable. Where they differ is the *mutation*
semantics — `addToChoice` patches an existing advancement's pool,
`replace` swaps the feature item entirely.

### 3.3 Multi-target bumps — open question

Today an `ItemBumpUses` advancement targets one feature / feat. If
the author needs "this feat bumps both Channel Divinity AND Bardic
Inspiration," they author two advancements. Confirm with the user
whether that's the right shape, or whether a `targets: [{kind, id}, ...]`
array is worth the complexity. The runtime walker would need a small
refactor to handle the array case.

---

## 4. Quality / cleanup (not part of this track but adjacent)

### 4.1 Pre-existing TypeScript errors (7)

`npx tsc --noEmit` reports 7 errors that have been around since before
this track started. They're flagged in every verification doc so they
don't get confused with new regressions. Worth a focused cleanup pass
sometime:

- 5× `asChild` on `Button` — `CompendiumBrowserShell.tsx`, `CampaignEditor.tsx`, `SpellList.tsx`, `LoreEditor.tsx` (3 instances).
- 1× `getTotalCharacterLevel` arg count in `characterShared.ts` line ~520 — the caller passes 3 args but the signature is 2 args; the third arg is silently ignored. Fix is either tighten the signature or drop the arg at the call site.
- 1× `asChild` on `Button` — `LoreEditor.tsx` (another instance).

### 4.2 Stash hygiene

`git stash list` carries entries from cross-branch context bleed
during this session:

```
stash@{0}: On feat/itembumpuses-advancement: ItemBumpUses Phase C v2 carryover (docs)
stash@{1}: On feat/itembumpuses-advancement: ItemBumpUses Phase C v2 carryover (from feat/itembumpuses-advancement, not class-routing work)
```

Verify they're not carrying anything important and drop them.

### 4.3 `cleanup-branches.bat` + stale draft docs

Untracked files in the working tree that look like personal/local
artifacts:

- `cleanup-branches.bat`
- `docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html`
- `docs/handoff-foundry-alignment-2026-05-25.md`

Confirm with the user whether these should be tracked, gitignored, or
deleted.

---

## 5. Next-area focus call (handed off here, 2026-05-27)

User explicitly shifted focus back to **code clarity in feats and
editors** after Phase C shipped. That's the active track now. The
items in this doc are deliberately parked for a later session.

Pick this back up when:

- the character builder's inventory layer is mature enough that
  `ownedItems`-based runtime application has a clear consumer (§ 2.1)
- character JSON export becomes a priority again (§ 2.2)
- the Foundry-side module ramps back up — sections 1.1 + 1.2 + the
  remaining module doc sweep (§ 1.4) cluster naturally
