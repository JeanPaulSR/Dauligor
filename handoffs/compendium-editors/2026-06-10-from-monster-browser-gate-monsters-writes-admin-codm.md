# Request → `compendium-editors`: gate `monsters` writes to admin + co-DM

**From:** `monster-browser` · **Date:** 2026-06-10 · **Type:** request (small, security tightening)
**Owner of the file:** `compendium-editors` owns `api/_lib/**` — hence this handoff rather than a self-edit.

## Context
The monster-browser branch shipped the public Monster Browser and is building the admin
**NPC/Monster editor** at `/compendium/monsters/manage` (`src/pages/compendium/MonstersEditor.tsx`,
saving via `upsertMonster` → `upsertDocument('monsters', …)` → `/api/d1/query`).

The product decision (user, 2026-06-10) is that **only admins + co-DMs** may create/edit monsters.

## Current behavior (the gap)
`monsters` is **not** in `PROTECTED_WRITE_TABLES` in `api/_lib/d1-proxy.ts:179`, so a monster
mutation falls to the generic `requireStaffAccess(authHeader)` branch
(`api/_lib/d1-proxy.ts:286`) — which admits **admin / co-dm / lore-writer**. That's one role
too wide: a `lore-writer` could write monster rows through the generic proxy.

The frontend already hides the "Monster Manager" entry point + editor from non-(admin/co-dm)
(`MonsterList`/`MonstersEditor` use `role === 'admin' || role === 'co-dm'`), so this is a
defense-in-depth / API-surface tightening, not a visible-UX bug.

## Requested change
Gate `monsters` writes to the **admin + co-DM** role set (the existing
`CHARACTER_DM_ROLES = new Set(["admin", "co-dm"])` in `api/_lib/firebase-admin.ts:36`).

Two-part, minimal:

1. **`api/_lib/firebase-admin.ts`** — add a helper next to `requireAdminAccess` (line ~384):
   ```ts
   export async function requireDmAccess(authHeader?: string | string[]) {
     return checkAccessFromToken(authHeader, CHARACTER_DM_ROLES, "Admin or co-DM access required.");
   }
   ```
   (`CHARACTER_DM_ROLES` + `checkAccessFromToken` already exist in this file.)

2. **`api/_lib/d1-proxy.ts`** — give `monsters` mutations their own gate before the generic
   `isMutation → requireStaffAccess` branch (around line 282-287). Mirror the existing
   campaign-write special-case pattern:
   ```ts
   const MONSTER_WRITE_PATTERN = /\b(?:INTO|FROM|UPDATE|TABLE)\s+monsters\b/i;
   const isMonsterWrite = isMutation && MONSTER_WRITE_PATTERN.test(normalizedSql);
   // …in the gate ladder, before `else if (isMutation)`:
   } else if (isMonsterWrite) {
     await requireDmAccess(authHeader);   // admin + co-dm (not lore-writer)
   } else if (isMutation) {
     await requireStaffAccess(authHeader);
   ```
   (Import `requireDmAccess` alongside the existing `requireAdminAccess`/`requireStaffAccess`.)

No DB change. No reads affected (monster reads are public-ish like the rest of the compendium and
should stay on the read path).

## Verify
- admin / co-dm can save a monster via the editor; lore-writer gets 403 on the mutation.
- existing monster **reads** (public browser + editor list) unaffected.

## Status on our side
Editor P1 is shipped on `monster-browser` and works today under the current staff gate. This
handoff only narrows the API gate from staff → admin+co-dm. Ping `monster-browser` when landed
and we'll drop this note.
