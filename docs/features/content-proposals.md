# Content Proposals

> **Status:**
> - **Phase 1 foundation** (additive `content-creator` permission,
>   scope JSON, admin grant UI, `worlds` table, `/admin/worlds` page)
>   **— shipped May 2026.**
> - **Phase 2a server foundation** (`pending_revisions` table, proxy
>   hardening on phase-1 entity tables, `/api/proposals*` creator
>   endpoint, `/api/admin/proposals*` admin queue with approve /
>   reject / conflict-detection)
>   **— shipped May 2026.**
> - **Phase 2b UX** (`/my-proposals` creator dashboard with generic
>   submit dialog, `/admin/proposals` review page with per-entity
>   tabs + 3-way conflict diff + cascade-aware reject)
>   **— shipped May 2026.**
> - **Phase 2c-1 / 2c-2 / 2c-3** "Propose change" hooks on the phase-1
>   editors (TagsExplorer, SpellRulesEditor, SpellListManager)
>   **— shipped May 2026.** All five proposal-allowlist entity types
>   are now reachable through their existing editors; content-creators
>   see the same UI as admins, but their Save / Add / Delete actions
>   round-trip through `/api/proposals` instead of writing directly.
> - **Phase 2d** Admin revert button + drift-check refuse on approved
>   revisions **— shipped May 2026.** A revert logs a new "approved
>   revert" revision in `pending_revisions` so the audit log stays
>   complete; revert-of-revert is just another revert with the
>   operation flipped again.
> - **Phase 2e** Submission Blocks (draft bundles) **— shipped May
>   2026.** A new `draft` status lets users stage many edits across
>   any wired editor into one bundle, then submit them atomically.
>   Drafts are user-private (admin queue never sees them). Block
>   state survives reloads via localStorage.
> - **Phase 4 foundation** entity-type allowlist extended with
>   `spell`, `class`, `unique_option_group`, `unique_option_item`,
>   plus per-entity configs (writable-column + JSON-column maps)
>   in `api/_lib/proposals.ts` **— shipped May 2026.** The server
>   side is ready to accept submissions against these four types.
> - **Phase 4 parallel-route design** (supersedes the original
>   in-place wiring plan): `/proposals/edit/*` routes wrap the
>   existing editor components with `<ProposalEditorWrapper>` that
>   adds Submit Changes + Drop Edits. `/compendium/*/manage` stays
>   admin-only with its existing Save / auto-update UX.
>   Content-creators have zero access to the admin routes.
>   - **4.1** `proposal_bundles` table + name/description endpoints
>     + `<BlockMetadataDialog>` **— shipped May 2026 (`ba1a334`).**
>   - **4.2** `<ProposalEditorWrapper>`, `useProposalAccumulator`,
>     `<PickOrCreateBlockDialog>` **— shipped May 2026 (`ae021d7`).**
>   - **4.3** Drop Edits at entity / section / field levels +
>     `<DropEntityButton>` / `<DropSectionButton>` / `<DropFieldIcon>`
>     **— shipped May 2026 (`f30b30e`).**
>   - **4.4** `<AdminOnly>` guard on `/compendium/{tags,spell-rules,
>     spell-lists}`, /proposals/edit/* catch-all, sidebar split
>     **— shipped May 2026 (`cc5d673`).**
>   - **4.5a–c** TagsExplorer / SpellRulesEditor / SpellListManager
>     wired through `useProposalAccumulator` + new
>     `/proposals/edit/<entity>` routes **— shipped May 2026
>     (`5482507` + `cdd8daa`).**
>   - **4.5d / 4.5e / 4.5f** SpellsEditor / UniqueOptionGroupEditor /
>     ClassEditor wiring **— not yet done.** See the resume plan at
>     [docs/../handoff-content-proposals-phase4-wiring.md](../handoff-content-proposals-phase4-wiring.md).
> - **Phase 3** (tagging revamp — descriptions, explorer UX, filter
>   UI) follows after the Phase 4 editor wiring.

## Notes / known issues resolved during Phase 2e

- **Block-mode dispatch bug (fixed `d6a485f`).** Each of the wired
  editors gated its proposal-route branch on `writer.mode ===
  'proposal'` exclusively. When Phase 2e introduced the `'block'`
  mode, that strict check missed it and block-mode mutations fell
  through to the admin-only direct-write path, which 403's at the
  proxy. The fix is one line per editor — `mode === 'proposal' ||
  mode === 'block'`. **Any future editor wiring must use this OR
  pattern by default.** Documented inline in
  [src/pages/compendium/TagsExplorer.tsx](../../src/pages/compendium/TagsExplorer.tsx),
  [SpellRulesEditor.tsx](../../src/pages/compendium/SpellRulesEditor.tsx),
  and [SpellListManager.tsx](../../src/pages/compendium/SpellListManager.tsx).

## Goal

Let trusted collaborators (a new `content-creator` role) author changes
to the compendium without granting direct write access. Their changes
enter a queue; an admin reviews and approves or rejects. Approved
proposals apply via the same write path admins use today, so existing
recompute hooks (rule rebuild, stale-class detection, module bake) fire
unchanged. Approved proposals are retained as an audit log so an admin
can revert any change to the state it overwrote.

## Why an additive permission, not a new role

The five existing roles (`admin` / `co-dm` / `lore-writer` /
`trusted-player` / `user`) all carry "trust me to write directly"
semantics in their respective domains. "Propose changes, await review"
is a different axis — a `lore-writer` who *also* wants to propose
compendium changes shouldn't have to give up their lore writes.

So `content-creator` is **additive**: it's a row in the new
`user_permissions` table layered on top of whatever single role the
user already has. The same `user_permissions` row carries optional
**scope** (worlds / campaigns / eras) so future contributors can be
narrowed to a specific world without affecting their base role.

The full model — scope JSON shape, the `requireContentCreatorAccess`
helper, the admin grant UI at `/admin/users` → Permissions tab — is
documented in
[../architecture/permissions-rbac.md](../architecture/permissions-rbac.md#additive-permissions-user_permissions).

## Scope

### Phase 1 — Tags, Spell Rules, Class Spell Lists

These three are tightly coupled (rules query tags, lists are populated
from rules) and form one shippable slice.

Tables exposed for proposal authoring in phase 1:

- `tag_groups` / `tags`
- `spell_rules` / `spell_rule_applications`
- `class_spell_lists`

### Phase 2 — Spells

Once phase 1 is in production, extend the entity-type allowlist to
include `spells`. Holding spells back keeps the first build focused —
spell rows carry the most JSON complexity (`tags`, `required_tags`,
`prerequisite_text`, `foundry_data`, `activities`, …) and benefit from
the bug-fixing pass that phase 1 will produce.

### Out of scope

- Lore articles already have their own draft/published flow; the
  proposal layer doesn't displace it.
- Classes / subclasses / feats / items / option groups / characters —
  authoring touches too many JSON shapes; revisit after phase 2.
- Per-campaign content — the proposal system is global, mirroring how
  the compendium itself is global.

## Data model

A single `pending_revisions` table captures every proposed mutation:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | UUID |
| `bundle_id` | TEXT (nullable) | Groups related revisions submitted together |
| `proposed_by_user_id` | TEXT (FK users.id) | The author |
| `proposed_at` | DATETIME | |
| `status` | TEXT | `pending` / `approved` / `rejected` / `withdrawn` |
| `entity_type` | TEXT | `tag` / `tag_group` / `spell_rule` / `spell_rule_application` / `class_spell_list` (phase 1); `spell` (phase 2) |
| `entity_id` | TEXT (nullable) | NULL for `create`; FK to the target row otherwise |
| `operation` | TEXT | `create` / `update` / `delete` |
| `proposed_payload` | JSON | The new row shape. NULL for `delete`. |
| `snapshot_at_proposal` | JSON | Row state when the proposal was submitted. Drives conflict detection + revert. NULL for `create`. |
| `reviewed_by_user_id` | TEXT (FK users.id, nullable) | |
| `reviewed_at` | DATETIME (nullable) | |
| `rejection_reason` | TEXT (nullable) | |
| `notes_from_proposer` | TEXT (nullable) | Free-text context for the reviewer |
| `cascade_parent_revision_id` | TEXT (FK self, nullable) | Declares a dependency on another revision in the same bundle |

CHECK constraints:

- `status IN ('pending', 'approved', 'rejected', 'withdrawn')`
- `entity_type IN (...allowlist...)` — phase-1 set above, extended in phase 2
- `operation IN ('create', 'update', 'delete')`

Indexes:

- `(status, proposed_at)` — admin queue rendering
- `(proposed_by_user_id, status)` — creator's own list
- `(entity_type, entity_id)` — "what proposals are pending against this row"

`bundle_id` is nullable so single-entity proposals stay simple. When set,
it groups revisions the creator authored together; the admin reviews them
as a unit and can approve/reject the bundle atomically.

**Phase 4.1 (planned)** adds a sibling `proposal_bundles` table keyed by
the same id, storing bundle metadata (`name`, `description`, `status`,
creator + timestamp). The relationship is a soft FK — no DB-level
constraint, validated in code — so existing bundles without a metadata
row keep working.

## Bundle semantics

When a proposer submits N related changes (e.g. a new tag plus a new
spell rule that filters on that tag), they share a `bundle_id`. Rejection
behavior:

- **Rejecting a leaf (e.g. the rule)** rejects only that revision. The
  parent (the tag) remains pending or already-approved — the leaf simply
  doesn't get its dependency.
- **Rejecting a dependency (e.g. the tag)** auto-cascades rejection to
  every revision in the bundle that depends on it. The
  `cascade_parent_revision_id` link is how the reviewer sees the chain.

Dependency direction is declared by the proposer at submit time: each
revision in a bundle may name an earlier revision in the same bundle as
its `cascade_parent_revision_id`. The server enforces that the parent
revision exists in the same bundle.

## Conflict detection

When an admin opens a proposal, the server compares
`snapshot_at_proposal` against the current live row:

| State | Behaviour |
|---|---|
| Snapshot matches current row | Clean — approve normally. |
| Snapshot differs (row was edited since proposal) | Flag as **conflicted** in the queue. Show a 3-way diff: snapshot / current / proposed. Admin decides — approve as-is (overwriting current), edit the proposal in place before approving, or reject with a reason. |

Phase 1 doesn't attempt auto-merge. The admin's manual decision is the
resolution.

## Roles + enforcement

### Additive permission: `content-creator`

Stored as a row in `user_permissions(user_id, permission_key, scope_json)`.
A user holding this row may submit proposals for phase-1 entities;
their base `users.role` is unchanged.

| Permission key | Capabilities |
|---|---|
| `content-creator` | Submit proposals for phase-1 entities (tags, tag groups, spell rules, spell rule applications, class spell lists). No direct writes. |

Scope semantics ([permissions-rbac.md §additive-permissions](../architecture/permissions-rbac.md#additive-permissions-user_permissions)):
`scope_json = NULL` means unrestricted; otherwise narrowed by world /
campaign / era subset. Phase 1 allows unrestricted grants; later
phases may require at-least-one-world.

### Server-side helpers

In [api/_lib/permissions.ts](../../api/_lib/permissions.ts):

| Helper | Admits |
|---|---|
| `requireContentCreatorAccess(authHeader, requiredScope?)` | `admin` role (always) OR a user with a `content-creator` `user_permissions` row whose scope covers `requiredScope`. |
| `getUserPermissions(uid)` | Loads + parses every grant for a user. |
| `hasPermission(uid, key, requiredScope?)` | Boolean predicate, same semantics. |

The existing `requireAdminAccess` continues to gate the admin-only
review endpoints.

### Proxy hardening

The generic `/api/d1/query` proxy currently allows staff writes to
`tags`, `tag_groups`, `spell_rules`, etc. (see [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md#per-table-access-patterns)
for the current matrix). Phase 1 adds the phase-1 entity tables to
`PROTECTED_WRITE_TABLES`:

| Table | Effect |
|---|---|
| `tags`, `tag_groups` | Direct writes refused for any role below `admin`; pointer at `/api/proposals` in the error body |
| `spell_rules`, `spell_rule_applications` | Same |
| `class_spell_lists` | Same |

Admins keep writing directly. The proposal endpoint applies approvals
server-side via `executeD1QueryInternal` (the same escape hatch
`POST /api/r2/scan-references` uses to bypass the read gate), so
approvals don't need to round-trip through the proxy.

## Endpoint surface

Post-Cloudflare-Pages migration, the 12-function cap is gone. The
proposal routes will land as native Pages Functions split by URL
family:

| File | URLs served |
|---|---|
| `functions/api/proposals/[[path]].ts` | `/api/proposals*` (creator submit / list / withdraw) |
| `functions/api/admin/proposals/[[path]].ts` | `/api/admin/proposals*` (admin queue / approve / reject / revert) |

No rewrite layer needed — Pages's native `[[path]]` catch-all wires
each file on the next deploy. See
[../architecture/routing.md §SPA fallback + API catch-all dispatchers](../architecture/routing.md#spa-fallback--api-catch-all-dispatchers)
for the routing pattern this follows.

Routes (Phase 2 build):

| Method | Path | Gate | Purpose |
|---|---|---|---|
| `POST` | `/api/proposals` | content-creator+ | Submit one or many revisions (bundle on the same call) |
| `GET` | `/api/proposals` | content-creator+ | List own proposals |
| `GET` | `/api/proposals/:id` | content-creator+ (own) or admin | View one proposal |
| `PATCH` | `/api/proposals/:id` | content-creator (own, while `status='pending'`) | Edit a pending proposal |
| `DELETE` | `/api/proposals/:id` | content-creator (own, while `status='pending'`) | Withdraw |
| `GET` | `/api/admin/proposals` | admin | Full queue, filterable by status / entity_type / proposer |
| `POST` | `/api/admin/proposals/:id/approve` | admin | Apply the diff; mark approved |
| `POST` | `/api/admin/proposals/:id/reject` | admin | Mark rejected with `rejection_reason`; cascade if a dependency |
| `POST` | `/api/admin/proposals/:id/revert` | admin | Re-apply `snapshot_at_proposal` to roll an approved change back |

## Approval mechanics

On `POST /api/admin/proposals/:id/approve`:

1. Verify `status = 'pending'`.
2. Re-fetch the current live row; compare to `snapshot_at_proposal`.
3. If conflicted, refuse with 409 and the diff payload — the client must
   resolve via the UI first.
4. Apply the operation:
   - `create` → INSERT using `proposed_payload`.
   - `update` → UPDATE the live row to match `proposed_payload`.
   - `delete` → DELETE the live row.
5. Mark `status = 'approved'`, set `reviewed_by_user_id` + `reviewed_at`.
6. Fire the same downstream hooks as a direct admin edit (e.g. for
   `spell_rules`: update timestamps that the existing stale-class
   detection consumes; the actual rule rebuild stays a manual admin
   action).

If the revision belongs to a bundle, the approver may choose "approve
bundle" — applies every pending revision in the bundle in
`cascade_parent_revision_id` topological order, atomic per-row (D1
doesn't transact across statements; partial application is logged and
left to the admin to resolve).

## Revert mechanics

Approved revisions remain in the table indefinitely.
`POST /api/admin/proposals/:id/revert` inverts the original operation
using `snapshot_at_proposal`:

| Original operation | Revert |
|---|---|
| `create` | DELETE the row whose id = `entity_id` |
| `update` | UPDATE the row back to `snapshot_at_proposal` |
| `delete` | INSERT using `snapshot_at_proposal` |

Each revert creates a **new** revision row (status `approved`, operation
flipped, `proposed_by` = the reverting admin) so the audit log shows the
revert as its own entry. Reverting a revert is just another revert — no
special case.

Revert refuses if the live row has drifted from the post-approval state
(for `create`/`update`: `current_row != proposed_payload`; for `delete`:
`current_row` exists at all). This protects against silently overwriting
changes that landed between the approval and the revert.

## UI surfaces (as shipped)

### Creator-side

- **Existing editors stay structurally unchanged (Phase 2c — shipped).**
  The wired editors (TagsExplorer, SpellRulesEditor, SpellListManager)
  keep their Save / Add / Delete affordances; mutations route through
  [src/lib/proposalAware.ts](../../src/lib/proposalAware.ts) which
  inspects the user's role + active Block and either direct-writes
  (admin, no block), submits a pending proposal (content-creator,
  no block), or stages a draft (any non-readonly user with a Block
  open).
- **Phase 4 redesign (in progress).** Content-creator UX moves to
  parallel `/proposals/edit/*` routes that wrap the same editor
  components with a `ProposalEditorWrapper` (Submit Changes
  replaces Save / auto-update; Drop Edits at entity / section /
  field; pick-or-create-block prompt). Content-creators lose
  access to `/compendium/*/manage` (standard blocked-page
  treatment). See build-order items 22–27 + the
  [handoff sheet](../handoff-content-proposals-phase4-wiring.md).
- **`/my-proposals` page** — four top-level tabs:
  - **Submissions** — the user's own proposal queue with status sub-
    filters (All / Pending / Approved / Rejected / Withdrawn).
    Drafts are filtered out of this view (they belong to the Block
    tab).
  - **Block** — the active Submission Block. Empty-state shows a
    Start Block button; active-state lists staged drafts + Submit
    Block + Discard buttons + the bundle id for debug clarity.
  - **New** / **Edit** — launcher cards for the editors wired
    through the proposal queue (Tags / Spell Rules / Spell Lists
    today; Spells / Classes / Modular Options appear as
    "coming soon" until the Phase 4 editor wiring lands).
- **Navbar pill** ("BLOCK · N") near the avatar when a block is
  active. Click jumps to `/my-proposals?tab=block`.

### Admin-side

- **`/admin/proposals` review page** with per-entity tabs (Tags /
  Tag Groups / Spell Rules / Rule Applications / Class Spell Lists;
  the Phase 4 four types are not yet surfaced as tabs — the queue
  endpoint returns rows of those types but the UI doesn't have tabs
  yet).
- Pending counts per entity tab; "Show resolved" toggle.
- Inline Approve / Reject (with reason + cascade to bundle children)
  on pending rows; inline Revert (with drift-check refuse) on
  approved rows. Detail dialog mirrors the inline actions plus
  shows the snapshot-at-submit / proposed_payload diff side-by-side.
- On approve, conflict drift (snapshot vs current) surfaces a 3-way
  diff modal so the admin can resolve manually. On revert, drift
  surfaces a 2-pane diff (expected vs current).
- Draft rows are NEVER surfaced to the admin queue — see
  [functions/api/admin/proposals/[[path]].ts](../../functions/api/admin/proposals/%5B%5Bpath%5D%5D.ts)
  for the filter (`status != 'draft'` baseline; `?status=draft` is
  silently rewritten to `pending`).
- **Bundle-aware actions are partial.** Reject cascades to declared
  in-bundle children. Approve currently fires per-row — there's no
  "approve whole bundle in one click" affordance yet; the design
  doc's `cascade_parent_revision_id` topological-order approval is a
  follow-up.

### `effectiveProfile` integration

`effectiveProfile.permissions['content-creator']` is the client-side
gate surface — present (with optional scope JSON) iff the user holds
the additive permission. The writer reads from this. Admins always
pass the gate regardless of this map.

Preview mode (admin viewing as `user`) keeps `permissions` intact on
purpose — preview mode strips `role` only, since the goal is to see
what a `user`-roled person sees, not to simulate losing additive
permissions. (If you want to preview as a content-creator without
admin powers, sign in as a separate test account.)

## Module-side impact

None. Tags, rules, and lists are baked into module exports via the
existing rebake hooks (`/api/module/<source>/classes/<class>.json`, the
public tags catalog, `spellRuleAllowlists` resolution at bake time). An
approved proposal triggers the same recompute path a direct admin edit
triggers today, so the Foundry side sees consistent state without
contract changes.

No updates required in `module/dauligor-pairing/docs/`.

## Build order

### Phase 1 — Foundation (✅ shipped May 2026)

1. **Schema migration** — `worlds` + `user_permissions` tables; seed
   the default Dauligor world
   ([20260518-1100_worlds_and_user_permissions.sql](../../worker/migrations/20260518-1100_worlds_and_user_permissions.sql)).
2. **Server helper** — `getUserPermissions`, `hasPermission`,
   `requireContentCreatorAccess`, `scopeContains` in
   [api/_lib/permissions.ts](../../api/_lib/permissions.ts).
3. **Worlds CRUD** —
   [functions/api/admin/worlds/[[path]].ts](../../functions/api/admin/worlds/%5B%5Bpath%5D%5D.ts).
4. **User permissions CRUD** — extended
   [functions/api/admin/users/[[path]].ts](../../functions/api/admin/users/%5B%5Bpath%5D%5D.ts)
   with `GET /:id/permissions`, `PUT /:id/permissions/:key`,
   `DELETE /:id/permissions/:key`. Badge column on the user list.
5. **`/api/me` extension** — folds `permissions` into the profile
   response so `effectiveProfile.permissions[key]` is the client-side
   gate.
6. **Admin UI** — `AdminUsers.tsx` tabbed shell (Users / Permissions);
   new `PermissionsManager` component with per-axis scope picker;
   `AdminWorlds.tsx` page at `/admin/worlds`.

### Phase 2a — Server foundation (✅ shipped May 2026)

7. **`pending_revisions` schema migration** —
   [20260518-2200_pending_revisions.sql](../../worker/migrations/20260518-2200_pending_revisions.sql).
   One row per proposed mutation; `proposed_payload` +
   `snapshot_at_proposal` drive conflict detection + revert; bundle
   + cascade columns for related-revision grouping.
8. **Proxy hardening** — phase-1 tables (`tags`, `tag_groups`,
   `spell_rules`, `spell_rule_applications`, `class_spell_lists`,
   `pending_revisions`) added to `PROTECTED_WRITE_TABLES` in
   [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts). Non-admin
   writes refused with 403; admins keep the direct path.
9. **Shared helpers** — [api/_lib/proposals.ts](../../api/_lib/proposals.ts):
   entity allowlist + column allowlist per entity, snapshot loader,
   sanitized payload builder, `applyApprovedOperation` (the one
   place that translates an approved revision into the actual
   INSERT/UPDATE/DELETE), conflict detector.
10. **Pages Functions** —
    [functions/api/proposals/[[path]].ts](../../functions/api/proposals/%5B%5Bpath%5D%5D.ts)
    (creator: POST submit, GET list-own, GET /:id, PATCH /:id while
    pending, DELETE /:id withdraw) and
    [functions/api/admin/proposals/[[path]].ts](../../functions/api/admin/proposals/%5B%5Bpath%5D%5D.ts)
    (admin: GET queue with filters, GET /:id with conflict status,
    POST /:id/approve, POST /:id/reject with bundle cascade).

### Phase 2b — UX (✅ shipped May 2026)

11. **`/my-proposals` page**
    ([src/pages/core/MyProposals.tsx](../../src/pages/core/MyProposals.tsx))
    — creator dashboard listing own proposals with status filters,
    preview, withdraw. Includes a generic "New proposal" dialog so
    the workflow is exercisable before per-editor hooks land. Linked
    from the navbar dropdown for users holding `content-creator` (and
    admins).
12. **`/admin/proposals` page**
    ([src/pages/admin/AdminProposals.tsx](../../src/pages/admin/AdminProposals.tsx))
    — per-entity tab strip + queue with pending counts, approve /
    reject (with reason) inline, 3-way conflict diff modal (snapshot
    / current / proposed) when approve refuses on drift. Linked from
    the admin dropdown.

### Phase 2c — Per-editor "Propose change" hooks (✅ shipped May 2026)

13. **TagsExplorer, SpellRulesEditor, SpellListManager** — all three
    editors now route through `useEntityWriter`
    ([src/lib/proposalAware.ts](../../src/lib/proposalAware.ts)).
    When `effectiveProfile.permissions['content-creator']` is held
    (and the user is not admin), Save / Add / Delete / Apply / Pin
    affordances POST to `/api/proposals` with the right
    `entity_type` / `operation` / `proposed_payload`. Direct writes
    stay on the admin path unchanged.

    Multi-row paths that don't fit a single-revision proposal —
    Tag merge / Tag move / Tag subtree-delete / Tag-group delete
    cascades / "Rebuild from rules" on class spell lists / spell-
    rule auto-rebuild on save — stay admin-only. Sidebar +
    `/my-proposals` launchers extend automatically as new entity
    types come online.

### Phase 2d — Admin revert (✅ shipped May 2026)

14. **Revert** — admin-side button on approved revisions in
    [src/pages/admin/AdminProposals.tsx](../../src/pages/admin/AdminProposals.tsx).
    Server-side path: `POST /api/admin/proposals/:id/revert` →
    drift check via `detectRevertDrift`
    ([api/_lib/proposals.ts](../../api/_lib/proposals.ts)) → on
    pass, `applyRevertOperation` runs the inverse op
    (create→delete, delete→create using the snapshot, update→
    update back to the snapshot). A new `pending_revisions` row
    is inserted with status `approved`, operation flipped, notes
    `[revert of <orig-id>]`, and the post-revert state captured
    in `proposed_payload` / `snapshot_at_proposal` so a revert-
    of-revert just flips again with no special case.
    Drift cases refused with 409:
      - `row_changed` — live row was edited since approval
      - `row_already_deleted` — live row was deleted (was
        create or update originally)
      - `row_resurrected` — live row exists for a delete-revert
        (someone re-created the entity)
    Drift surface to the admin via a 2-pane diff modal
    (expected vs current) so they can resolve manually.

### Phase 2e — Submission Blocks (✅ shipped May 2026)

15. **Draft status** — `pending_revisions.status` CHECK extended with
    `draft` ([20260519-1300_pending_revisions_draft_status.sql](../../worker/migrations/20260519-1300_pending_revisions_draft_status.sql)).
    Drafts are user-private; the admin queue endpoint silently
    rewrites `?status=draft` to `pending` and adds `status != 'draft'`
    to its baseline WHERE clause.
16. **Bundle endpoints** — `POST /api/proposals/bundle/<id>/submit`
    (drafts → pending, atomic per bundle) and `DELETE /api/proposals
    /bundle/<id>` (discard the bundle's drafts). `loadOwnEditable`
    admits both `pending` and `draft` so users can PATCH/DELETE
    their own staging rows.
17. **BlockProvider context** — [src/lib/proposalBlock.tsx](../../src/lib/proposalBlock.tsx).
    `activeBundleId` is persisted to localStorage; the provider
    fetches the active block's drafts on mount + after every write
    so the navbar pill + Block tab stay current.
18. **`useEntityWriter` learned a fourth mode** — `'block'`. Active
    when `!!activeBundleId && baseMode !== 'readonly'`. Same submit
    path as `'proposal'`, just adds `is_draft: true` + `bundle_id`
    to the POST. The `actionLabel` toast helper picks "added to
    block" copy in this mode.
19. **`/my-proposals` Block tab** — empty-state Start button, active-
    state staged-drafts list with Submit Block + Discard buttons.
    Navbar pill ("BLOCK · N") near the avatar acts as a deep-link.

### Phase 4 — Heavy entities (foundation ✅; editor wiring next)

20. **Entity-type allowlist extended** — `spell`, `class`,
    `unique_option_group`, `unique_option_item` added via
    [20260519-1600_proposals_entity_type_phase4.sql](../../worker/migrations/20260519-1600_proposals_entity_type_phase4.sql).
21. **Per-entity configs** in
    [api/_lib/proposals.ts](../../api/_lib/proposals.ts) — writable-
    column allowlist + JSON-column markers for all four. Server
    will accept and apply submissions against any of these types
    today.
22. **Block metadata + `proposal_bundles` table (Phase 4.1, NOT
    YET DONE).** New table giving bundles a `name` +
    `description`; new endpoints under `/api/proposals/bundles`
    (POST create, GET list-own-open, PATCH rename); replace the
    client-only UUID in
    [src/lib/proposalBlock.tsx](../../src/lib/proposalBlock.tsx)
    with a server-issued id. Required for the "pick or create"
    prompt.
23. **`<ProposalEditorWrapper>` + queued-writer plumbing
    (Phase 4.2, NOT YET DONE).** New component at
    `src/components/proposals/ProposalEditorWrapper.tsx` that
    wraps the existing editor components and exposes Submit
    Changes via a `ProposalContext`. New
    `useProposalAccumulator` hook buffers writes locally
    instead of firing per-change. New `PickOrCreateBlockDialog`
    surfaces when Submit Changes is clicked with no active
    block. Navigation-away warning when the queue is non-empty.
24. **Drop Edits affordances (Phase 4.3, NOT YET DONE).** Entity
    / section / field-level revert from inside the proposal
    editor. Reverts both local queue state and any already-
    staged draft fields server-side.
25. **Route guards + sidebar (Phase 4.4, NOT YET DONE).** New
    `/proposals/edit/*` routes in
    [src/App.tsx](../../src/App.tsx).
    **Content-creators lose access to `/compendium/*/manage`** —
    standard blocked-page treatment, no special redirect.
    Sidebar splits: admins see Compendium + Proposals, creators
    see Proposals only.
26. **Per-editor wiring (Phase 4.5, NOT YET DONE).** Each
    existing editor gets a `mode` prop and a route entry under
    `/proposals/edit/*`. Build order is TagsExplorer (POC) →
    SpellRulesEditor → SpellListManager → SpellsEditor →
    UniqueOptionGroupEditor → ClassEditor. Base editor in
    `mode='direct'` keeps today's behavior; in `mode='proposal'`
    delegates writes to the accumulator and hides its Save
    button.
27. **Block menu rolled-up view (Phase 4.6, NOT YET DONE).**
    `/my-proposals → Block` tab rolls drafts up by
    `entity_type` to one row per editor that contributed.
    Withdraw drops the whole group; Continue Editing returns
    to the proposal route filtered to staged entities.

Resume plan + per-editor checklist live at
[../handoff-content-proposals-phase4-wiring.md](../handoff-content-proposals-phase4-wiring.md).
Until Phase 4.1–4.6 land, content-creators can't produce
spell / class / option proposals from the UI; the server
nonetheless accepts hand-crafted POSTs at `/api/proposals` with
the right `entity_type` / payload shape.

### Phase 3 — Tagging revamp (not yet started)

23. **Tag descriptions** — `description` column on `tags` +
    `tag_groups`. Surfaced on hover in pickers and the explorer.
24. **TagsExplorer UI revamp** — better merge / move / bulk
    affordances.
25. **FilterBar / filter modal UI revamp** — apply the new shape to
    the spell + feat list filters.

## Open questions resolved (May 2026)

| Question | Decision |
|---|---|
| Scope of phase 1 | Tags, Spell Rules, Class Spell Lists. Spells join in phase 2. |
| Conflict handling | Show the admin a 3-way diff; manual decision. No auto-merge. |
| Bundle dependency cascade | Independent rejection by default. Rejecting a *parent* cascades to its declared dependants. Rejecting a *dependant* doesn't touch the parent. Declared at submit via `cascade_parent_revision_id`. |
| Admin notification path | Dedicated `/admin/proposals` page with per-entity tabs + pending-count badge in the admin dropdown. |
| Deletions | Allowed. Always reviewed (no shortcut). |
| Audit retention | Keep approved / rejected / withdrawn rows indefinitely — back the revert flow. |

## Related docs

- [../architecture/permissions-rbac.md](../architecture/permissions-rbac.md) — role definitions, three enforcement layers
- [admin-users.md](admin-users.md) — admin user-management patterns this design mirrors
- [compendium-options.md](compendium-options.md) — tag system (the data being proposed against)
- [spellbook-manager.md](spellbook-manager.md) — spell rules + class spell lists (the data being proposed against)
- [../database/structure/tags.md](../database/structure/tags.md) — tag schema canonical source
