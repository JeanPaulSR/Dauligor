# Content Proposals (Planning)

> **Status:** Design — not yet implemented. Captures the agreed shape of
> a review/approval workflow for compendium content authored by non-admin
> contributors. Phase 1 covers tags, spell rules, and class spell lists;
> spells join in phase 2; classes / feats / items / lore are out of scope
> for the initial build.

## Goal

Let trusted collaborators (a new `content-creator` role) author changes
to the compendium without granting direct write access. Their changes
enter a queue; an admin reviews and approves or rejects. Approved
proposals apply via the same write path admins use today, so existing
recompute hooks (rule rebuild, stale-class detection, module bake) fire
unchanged. Approved proposals are retained as an audit log so an admin
can revert any change to the state it overwrote.

## Why a new role

The five existing roles (`admin` / `co-dm` / `lore-writer` /
`trusted-player` / `user`) all carry "trust me to write directly"
semantics in their respective domains. "Propose changes, await review"
is a different axis. `content-creator` slots in **below** `lore-writer`
and **above** `trusted-player` — it grants no direct writes anywhere, only
the ability to submit proposals through one endpoint.

Existing role docs and the canonical RBAC matrix:
[../architecture/permissions-rbac.md](../architecture/permissions-rbac.md).

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

### New role: `content-creator`

| Role | UI Label | Capabilities |
|---|---|---|
| `content-creator` | Contributor | Submit proposals for phase-1 entities. No direct writes anywhere. |

Slotted between `trusted-player` and `lore-writer` in the existing
ladder. The `users.role` CHECK constraint gains this value.

### Server-side helpers

In [api/_lib/firebase-admin.ts](../../api/_lib/firebase-admin.ts):

| Helper | Admits |
|---|---|
| `requireContentCreatorAccess(authHeader)` | `content-creator` and every staff role above it. |

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

Vercel Hobby plan caps functions at **12** and the repo currently uses
**11** (see [vercel.json](../../vercel.json) plus the per-route endpoint
list under `api/`). All proposal routes fold into **one** new function:

| File | URLs served | Dispatcher |
|---|---|---|
| `api/proposals.ts` | `/api/proposals*` (creator) and `/api/admin/proposals*` (admin) | Parses `req.url`, branches on path + method + role |

New `vercel.json` rewrites (mirrors the `api/admin/users.ts` pattern):

```jsonc
{ "source": "/api/proposals/(.*)",       "destination": "/api/proposals" }
{ "source": "/api/proposals",            "destination": "/api/proposals" }
{ "source": "/api/admin/proposals/(.*)", "destination": "/api/proposals" }
{ "source": "/api/admin/proposals",      "destination": "/api/proposals" }
```

Routes (internal dispatch):

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

1. **Schema migration** — `pending_revisions` table + add
   `content-creator` to the `users.role` CHECK constraint.
2. **Server helper** — `requireContentCreatorAccess` in
   `firebase-admin.ts`.
3. **Proxy hardening** — add phase-1 tables to
   `PROTECTED_WRITE_TABLES` for non-admin roles in
   [api/_lib/d1-proxy.ts](../../api/_lib/d1-proxy.ts).
4. **`api/proposals.ts` dispatcher** — CRUD on the revisions table for
   creator + admin paths. Approve / reject / revert without bundle
   cascade first; cascade is a second pass.
5. **vercel.json** — add the four rewrites.
6. **Creator UI** — "Propose change" button on the phase-1 editors
   ([TagManager](../../src/pages/compendium/TagManager.tsx),
   [TagGroupEditor](../../src/pages/compendium/TagGroupEditor.tsx),
   [SpellRulesEditor](../../src/pages/compendium/SpellRulesEditor.tsx),
   [SpellListManager](../../src/pages/compendium/SpellListManager.tsx)).
7. **`/my-proposals` page**.
8. **`/admin/proposals` page** — tab strip + per-tab queue + approve /
   reject actions + conflict diff view.
9. **Revert** — admin-side button on approved revisions, with the
   drift-check refuse.
10. **Phase 2** — extend entity-type allowlist to `spells` and surface
    the Propose button in `SpellsEditor`.

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
