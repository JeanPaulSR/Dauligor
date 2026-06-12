# Handoff → character-creator branch: app-side prereq filtering for feature-interaction compensation

**From:** settings-pages (Feature Interaction System, Phase 1)
**Date:** 2026-06-10
**Status:** request — app-side runtime work, owned by the character-creator branch (per the user's decision).

## Context
A new **Feature Interaction** system lets admins author rules for how
same-identifier features cooperate when multiclassing. v1 (settings-pages) shipped
the authoring side + the rule model; the **runtime "compensation pick" UI + its
prerequisite filtering** is yours.

- Rule store: `feature_interactions` table (migration `20260610-1700`) —
  `{ id, interactionKey, name, type, config }`. `interactionKey` matches a
  feature's `stackingKey`.
- The `alternative` type's `config.compensation` =
  `{ kind:'optionChoice', optionGroupId, countPerExtraSource, noRepeat, prereqFiltered }`.
- Model + helpers: `src/lib/featureInteractions.ts`
  (`fetchFeatureInteractions`, `indexInteractionsByKey`).
- Authoring page: Admin → Proficiencies → **Feature Interactions** tab
  (`src/pages/admin/FeatureInteractionsManager.tsx`).
- Builder today (settings-pages): `collapseStackedFeatures()` in
  `CharacterBuilder.tsx` already loads the rules and, when 2+ same-key features are
  granted, suppresses the duplicates and surfaces the rule's note (e.g. "Extra
  Attack doesn't stack; gain a Fighting Style instead"). It does **not** yet offer
  the actual choice.

## The ask
When an `alternative` rule fires (2+ granted features share its `interactionKey`),
grant the player **`(sources − 1) × countPerExtraSource`** picks from the
compensation `optionGroupId`, with:
- **`prereqFiltered`** → only offer options whose `requirements_tree` is met by the
  character (level, ability scores, proficiencies, owned options, etc.).
- **`noRepeat`** → exclude already-chosen options (and styles the character already
  has from a normal level-1 Fighting Style pick).

## Reuse (don't rebuild)
- The **module already evaluates** these prerequisites:
  `module/dauligor-pairing/scripts/requirements-walker.js`
  (`evaluateRequirementsTree(tree, ctx)` + `evaluateLeaf`, 10 auto-evaluable leaf
  types; `string` stays manual). Port that logic to TypeScript app-side, or share
  it — the context shape it builds (lines ~24–42) is the template:
  `{ satisfied:Set, classLevel, totalLevel, abilityScores, classLevels:Map,
  proficiencies:{…Sets}, ownedFeatureSourceIds:Set, ownedSpellSourceIds:Set,
  subclassEntityIds:Set }`.
- Requirement model + editor + formatters already exist in `src/lib/requirements.ts`
  (11 leaf types incl. `abilityScore`, `proficiency`, `level`, `optionItem`,
  `feature`). The `ItemChoice` advancement already models "pick N from option group".
- The compensation just needs an `ItemChoice`-like grant whose pool = the rule's
  option group, count = the formula above, filtered by the evaluator.

## Notes / open
- Phase-1 settings-pages work is data + authoring + the suppress-and-note runtime.
  Anything that needs to *evaluate character state to filter a pool* is this branch.
- The compensation `optionGroupId` is blank on the seeded `extra-attack` rule until
  someone authors a Fighting Styles option group (a separate content task; see
  design doc `docs/_drafts/feature-interaction-system-design-2026-06-10.html`, D2).
- Migrations `20260610-1400` (features.stackingKey) and `20260610-1700`
  (feature_interactions) are LOCAL-only as of this writing; coordinate before relying
  on them in prod.
