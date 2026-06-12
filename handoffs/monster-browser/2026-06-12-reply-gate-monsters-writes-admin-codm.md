# Reply → `monster-browser`: `monsters` writes now gated to admin + co-DM — DONE + verified (2026-06-12)

Re: your request `compendium-editors/2026-06-10-from-monster-browser-gate-monsters-writes-admin-codm.md`.
Implemented exactly as specced on `compendium-editors` (we own `api/_lib/**`).

## What changed
1. **`api/_lib/firebase-admin.ts`** — added `requireDmAccess` next to `requireAdminAccess`:
   ```ts
   export async function requireDmAccess(authHeader?: string | string[]) {
     return checkAccessFromToken(authHeader, CHARACTER_DM_ROLES, "Admin or co-DM access required.");
   }
   ```
   (`CHARACTER_DM_ROLES = {admin, co-dm}` + `checkAccessFromToken` already existed.)

2. **`api/_lib/d1-proxy.ts`** — imported `requireDmAccess`; added a `monsters`-write pattern +
   flag mirroring the campaign special-case, and a gate branch **before** the generic
   `isMutation → requireStaffAccess`:
   ```ts
   const MONSTER_WRITE_PATTERN = /\b(?:INTO|FROM|UPDATE|TABLE)\s+monsters\b/i;
   const isMonsterWrite = isMutation && MONSTER_WRITE_PATTERN.test(normalizedSql);
   // …gate ladder:
   } else if (isMonsterWrite) {
     await requireDmAccess(authHeader);          // admin + co-dm (not lore-writer)
   } else if (isMutation) {
     await requireStaffAccess(authHeader);       // admin/co-dm/lore-writer (unchanged)
   ```

## Verified
- **tsc**: 3 baseline / 0 new.
- **Adversarial regex harness, 6/6**: `INSERT/UPDATE/DELETE … monsters` → gated as a monster
  write; `SELECT * FROM monsters` → NOT a write (stays on the read path); `INSERT INTO
  monster_spells` and `INSERT INTO items` → not matched (no over-reach).
- **Reads unaffected**: `monsters` is not in `PROTECTED_READ_TABLES`; the change is `isMutation`-
  gated, so monster reads (public browser + editor list) take the same path as before.

## Net effect
A `lore-writer` (admitted by the generic staff gate) now gets **403** on any monster mutation;
admin + co-DM still save normally. Defense-in-depth matching your frontend
`role === 'admin' || role === 'co-dm'` gate. No DB change, no migration.

## Status
Committed on `compendium-editors`. (Will land on `main` on the owner's next push — ping if you
need it expedited.) You can drop your request note once it's live.
