# Handoff — Content Proposals Phase 4 editor wiring

> **Status:** Phase 4 foundation (schema + per-entity configs) is in;
> the editor wiring is **not started**. Branch
> `claude/loving-banach-d76c40`. Foundation commit `044b8ae`; latest
> commit `d6a485f` (block-mode dispatch fix). The proposal system
> already accepts and applies submissions against `spell`, `class`,
> `unique_option_group`, `unique_option_item` server-side — it's the
> editors that haven't been taught to route through it yet.
>
> Resume by wiring **SpellsEditor first** as the POC for the heavy-
> editor pattern, then ClassEditor, then UniqueOptionGroupEditor.

## Where we ended

The previous session closed with:

1. **Submission Blocks shipped end-to-end** (Phase 2e, commit
   `6f80d61`). New `draft` status on `pending_revisions`; bundle
   submit/discard endpoints; `BlockProvider` + localStorage-backed
   `activeBundleId`; navbar pill; Block tab on `/my-proposals`;
   `useEntityWriter` learned a `'block'` mode.
2. **Phase 4 foundation** (commit `044b8ae`):
   - Migration [`20260519-1600_proposals_entity_type_phase4.sql`](../worker/migrations/20260519-1600_proposals_entity_type_phase4.sql)
     extends `pending_revisions.entity_type` CHECK with `spell`,
     `class`, `unique_option_group`, `unique_option_item`.
   - `api/_lib/proposals.ts` gains four new `ENTITY_CONFIGS`
     entries (writable columns + JSON columns).
   - `src/lib/proposalAware.ts` extends `ProposalEntityType` +
     `ENTITY_TO_COLLECTION` map (`spells`, `classes`,
     `uniqueOptionGroups`, `uniqueOptionItems`).
3. **Block-mode dispatch bug fixed** (commit `d6a485f`). Each of the
   three already-wired editors had
   `const isProposalMode = writer.mode === 'proposal'` — strict
   equality missed `'block'`, so block-mode mutations 403'd at the
   proxy. Fix: `mode === 'proposal' || mode === 'block'`. **The
   editors you're about to wire MUST follow this OR pattern from
   the start.**

## What's left

Three editors to wire. Same `useEntityWriter` pattern as
TagsExplorer / SpellRulesEditor / SpellListManager, but the surface
area is larger because these editors save more columns at once.

### 4a · SpellsEditor (smallest of the three to learn the pattern)

File: [`src/pages/compendium/SpellsEditor.tsx`](../src/pages/compendium/SpellsEditor.tsx)
(~1500 lines).

Pattern:

1. Add at the top of the component:

   ```ts
   const isAdmin = userProfile?.role === 'admin';
   const isContentCreator = !!userProfile?.permissions &&
     Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
   const canManageSpells = isAdmin || isContentCreator;
   const spellWriter = useEntityWriter('spell', userProfile);
   const isProposalMode = spellWriter.mode === 'proposal' || spellWriter.mode === 'block';
   ```

2. Loosen the admin gate (search for `if (!isAdmin)` early-returns
   and replace with `canManageSpells`).
3. At every direct `upsertDocument('spells', …)` / `queryD1` call
   site that writes to `spells`:
   - If `isProposalMode`, build the payload with snake_case keys
     matching the column allowlist
     ([`api/_lib/proposals.ts`](../api/_lib/proposals.ts) →
     `ENTITY_CONFIGS.spell.writableColumns`) and call
     `spellWriter.create(payload)` / `.update(id, payload)` /
     `.remove(id)`. **Do NOT pre-stringify JSON columns** — the
     writer's `sanitizePayload` runs `JSON.stringify` on
     `activities`, `effects`, `foundry_data`, `tags`,
     `required_tags` automatically.
   - Otherwise (admin direct mode), keep the existing path
     unchanged.
4. Toast copy: replace literal `toast('Saved')` / `toast('Created')`
   with `toast.success(actionLabel(spellWriter.mode, 'saved'))`. The
   helper produces "Saved" / "Save submitted for review" / "Save
   added to block" automatically.
5. Multi-row affordances (Backfill, Bulk Import Workbench, anything
   that mass-writes spells) stay admin-only — wrap their buttons in
   `{isAdmin && (...)}` and add a small "Restricted Actions" blurb
   for content-creators if appropriate.
6. Update launchers:
   - [`src/pages/core/MyProposals.tsx`](../src/pages/core/MyProposals.tsx)
     → flip the Spells card in `EDIT_ENTRIES` from `'coming-soon'`
     to `'ready'`. Add a Spells card to `CREATE_ENTRIES` if you
     want creators to be able to PROPOSE a brand-new spell (they
     can today via the API, but no UI affordance yet).
   - [`src/components/Sidebar.tsx`](../src/components/Sidebar.tsx)
     → already lists Spells under Compendium for everyone — no
     change needed; the editor admits content-creators after the
     gate loosens.
7. Apply the local migration if not done (it's in `044b8ae`):
   ```bash
   cd worker
   npx wrangler d1 execute dauligor-db --local --file=./migrations/20260519-1600_proposals_entity_type_phase4.sql
   ```

### 4b · UniqueOptionGroupEditor (small, do second)

File: [`src/pages/compendium/UniqueOptionGroupEditor.tsx`](../src/pages/compendium/UniqueOptionGroupEditor.tsx)
(~978 lines).

Two entity types to wire because option items are a separate row:

```ts
const groupWriter = useEntityWriter('unique_option_group', userProfile);
const itemWriter  = useEntityWriter('unique_option_item',  userProfile);
const isProposalMode = groupWriter.mode === 'proposal' || groupWriter.mode === 'block';
```

The page edits a group (`uniqueOptionGroups`) plus N items inside
it (`uniqueOptionItems`). Each item save / delete needs to route
through `itemWriter`; each group save through `groupWriter`.

For "Save all option-items in this group at once" (if the editor
exposes that), submit one proposal per item — they all end up in
the same Block if one is open, otherwise N separate pending
proposals. Skip the bulk affordance for content-creators if it
would feel weird as N separate revisions.

### 4c · ClassEditor (the heavy one)

File: [`src/pages/compendium/ClassEditor.tsx`](../src/pages/compendium/ClassEditor.tsx)
(~1900 lines).

Pattern identical to SpellsEditor, but the class payload has 13
JSON columns (see `ENTITY_CONFIGS.class.jsonColumns`). Most of
these are deeply nested editor state — advancements, multiclassing
proficiencies, spellcasting config, etc.

Plan the save path carefully: the writer's `sanitizePayload`
expects the payload at the column level, so e.g. `advancements`
should be the full advancements array (not the unpacked editor
state). If the editor mutates these in piece-meal patches today,
keep the existing assembly logic and just hand the final shape to
`classWriter.update(id, payload)`.

Subclasses live in the `subclasses` table which is **not** in the
Phase 4 allowlist — a content-creator can't propose subclass
edits yet. SubclassEditor stays admin-only; document this in the
class editor's "Restricted Actions" blurb.

## Gotchas

- **`isProposalMode` must be `proposal || block`.** This is the bug
  that landed in commit `d6a485f`. Lift the boolean out into a
  named const at the top of the component; resist the urge to
  re-write it inline.
- **JSON columns: write objects/arrays, not strings.** The writer
  stringifies them. Pre-stringified strings work (passthrough), but
  if the editor's existing path stringifies before calling
  `upsertDocument`, you can remove that step when routing through
  the writer.
- **Snake_case vs camelCase.** The writer's allowlist matches D1
  column names (snake_case). If your editor state is camelCase
  (`foundryData`, `requiredTags`), convert at the payload-build
  step.
- **`created_at` / `updated_at` are stripped.** They're not in any
  `writableColumns` set on purpose — server-managed only. Don't
  bother including them in the payload.
- **Multi-row paths.** Anything that mass-writes (backfill, bulk
  import, rebuild) stays admin-only. The single-revision proposal
  shape can't capture them today. See `SpellRulesEditor`'s
  "Rebuild All Applied" gate for the existing pattern (`isAdmin &&
  (...)`).
- **Subclasses + features + activities are nested.** Class editing
  often involves writing rows in other tables (features, activities,
  active effects) that aren't in the allowlist. Either:
  (a) leave those flows admin-only for now and document the gap, or
  (b) expand the allowlist + add the configs in a follow-up. **Do
  not silently fall through to direct writes** — the proxy will
  refuse and the user will see a 403.

## Test plan after each editor lands

1. **Admin direct write still works.** Sign in as admin (or use a
   `gm` / `admin@archive.internal` hardcoded account), open the
   editor, save a small change. Should toast "Saved" and write
   directly.
2. **Content-creator submits as pending.** Grant `content-creator`
   to a test user via `/admin/users → Permissions`. Sign in,
   open the editor, save → toast "Save submitted for review";
   admin queue at `/admin/proposals` sees the row.
3. **Block-mode stages drafts.** Same user, open a block via
   `/my-proposals → Block → Start Block`, then edit + save in the
   editor → toast "Save added to block"; Block tab shows the
   staged draft; admin queue does NOT show it. Submit Block → row
   flips to pending and admin sees it.
4. **Approve → live row matches the payload.** Re-open the editor;
   the saved change is visible.
5. **Revert** approved → live row rolls back; new "approved revert"
   row in the audit log.
6. **Drift refuses.** Reproduce by approving a content-creator's
   pending change, then editing the live row as admin (without
   touching the audit trail), then trying to revert. Should 409
   with the drift modal.

## Files most likely to need touching

```
src/pages/compendium/SpellsEditor.tsx
src/pages/compendium/UniqueOptionGroupEditor.tsx
src/pages/compendium/ClassEditor.tsx
src/pages/core/MyProposals.tsx        (launcher status flips)
docs/features/content-proposals.md   (mark Phase 4 sub-tasks shipped)
```

## Don't forget

- Run `npx tsc --noEmit` after each editor to catch type drift in
  the writer integration. Baseline is **13 pre-existing errors**
  (asChild + characterShared.ts); anything beyond that is a
  regression.
- Update [`docs/features/content-proposals.md`](features/content-proposals.md)
  status block when each sub-phase lands. Pattern: copy the
  Phase 2c-1 / 2c-2 / 2c-3 entries.
- Commit boundaries: **one editor per commit** so the diff stays
  reviewable. See `854bc79` / `d635305` / `483c86e` for the
  template.

## Out of scope for Phase 4 (track separately)

- Subclasses / features / activities / items / feats joining the
  allowlist. Each is its own design pass — the JSON shapes touch
  many other tables (drag-and-drop on activities, advancement-
  driven feature embeds, etc.). Note these in
  [`roadmap.md`](roadmap.md) if you want them tracked.
- "Approve bundle in one click" admin action. Today, approve fires
  per-row; bundles can be inspected via `bundle_id` but there's no
  bulk-approve UI. Tracked in the same doc under "UI polish pass".
