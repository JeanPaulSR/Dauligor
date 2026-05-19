# Content Proposals

> **Status:** Phase 1 foundation **shipped** (May 2026) — `worlds` +
> `user_permissions` tables, additive `content-creator` capability,
> admin UI for granting + scoping, `/admin/worlds` page. The proposal
> table, review queue, and creator UX are still pending (Phase 2
> below). Phase 1 stood up the *infrastructure*; nothing is enforced
> against entity writes yet.
>
> Phase 1 covers tags, spell rules, and class spell lists; spells join
> in phase 2; classes / feats / items / lore are out of scope for the
> initial build.

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

## UI surfaces

### Creator-side

- **Existing editors gain a "Propose change" alternate submit button**
  visible when `effectiveProfile.role === 'content-creator'`. The normal
  Save button is hidden for that role; "Propose change" replaces it.
  Clicking opens a modal: free-text "notes for reviewer" + optional
  bundle picker ("attach to existing pending bundle of mine, or start a
  new one") + Submit.
- **A "My Proposals" page** at `/my-proposals` — list of the user's own
  proposals with status, the entity touched, and the reviewer's
  response. Pending proposals are editable; withdrawn / rejected /
  approved are read-only.

### Admin-side

- **Dedicated review page** at `/admin/proposals`. Top-level tabs split
  by entity type: **Tags · Tag Groups · Spell Rules · Spell Lists**
  (phase 1) → **Spells** added in phase 2.
- Each tab shows pending proposals first, then a "Show resolved" toggle
  to surface approved/rejected/withdrawn. Within a tab, rows render
  with proposer, age, conflict indicator, and an inline preview of the
  change.
- **Bundle view** — proposals with a `bundle_id` collapse into a single
  row with an expand affordance; "Approve bundle" / "Reject bundle"
  appear at the bundle header.
- **Pending count badge** lives in the admin menu dropdown alongside
  the existing Settings / Users / Eras entries. Polled on profile load
  via a new count field in `GET /api/me`.

### `effectiveProfile` integration

The role flows through `effectiveProfile` like every other role.
Preview mode (admin viewing as `user`) hides the entire admin review
page since it's admin-only — no special handling needed. Creator-side
UI branches on `effectiveProfile.role === 'content-creator'` rather
than checking the raw role, so an admin previewing as a content-creator
also sees the "Propose change" buttons (useful for testing the flow).

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

### Phase 2 — Proposal workflow (not yet started)

7. **`pending_revisions` schema migration** — table + the audit /
   bundle / cascade columns.
8. **Proxy hardening** — add phase-1 tables to
   `PROTECTED_WRITE_TABLES` for non-admin roles in
   [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts).
9. **Pages Functions** —
   `functions/api/proposals/[[path]].ts` (creator) and
   `functions/api/admin/proposals/[[path]].ts` (admin queue).
10. **Creator UI** — "Propose change" button on the phase-1 editors
    ([TagsExplorer](../../src/pages/compendium/TagsExplorer.tsx),
    [SpellRulesEditor](../../src/pages/compendium/SpellRulesEditor.tsx),
    [SpellListManager](../../src/pages/compendium/SpellListManager.tsx)).
11. **`/my-proposals` page**.
12. **`/admin/proposals` page** — tab strip + per-tab queue + approve /
    reject actions + conflict diff view.
13. **Revert** — admin-side button on approved revisions, with the
    drift-check refuse.

### Phase 3 — Tagging revamp (not yet started)

14. **Tag descriptions** — `description` column on `tags` +
    `tag_groups`. Surfaced on hover in pickers and the explorer.
15. **TagsExplorer UI revamp** — better merge / move / bulk affordances.
16. **FilterBar / filter modal UI revamp** — apply the new shape to
    the spell + feat list filters.

### Phase 4 — Spells in the proposal allowlist

17. Extend entity-type allowlist to `spells` and surface the Propose
    button in `SpellsEditor`.

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
