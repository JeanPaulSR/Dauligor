# Worked Migration Example: `src/lib/spellSummary.ts`

A concrete, step-by-step walk-through of migrating a single Firestore touchpoint to D1. **Use this as a template** for the other items on the [Firestore-cut punchlist](firestore-cut-punchlist.md).

This is a real example — `spellSummary.ts` actually needs this work. The walk-through reasons through it as if you were doing it for the first time.

## Why this file is a good template

- It's small (~140 lines).
- It's self-contained (one Firestore collection, no cross-file state).
- It already has one function (`subscribeSpellSummaries`) partially migrated, so it shows the pattern in two states.
- The migration **simplifies** rather than complicates — the legacy `spellSummaries` collection isn't needed in D1 because the data can be derived from `spells` directly.
- The pattern is the most common shape: "Firestore CRUD on a side-index collection that no longer needs to exist."

## Step 1 — Inventory the current state

Read the file end-to-end. Identify:

| Export | What it does | Touches |
|---|---|---|
| `buildSpellSummaryPayload` | Pure transform from spell row to summary shape | None — pure function |
| `mapSpellDocsToSummaries` | Maps Firestore snapshot to summary shape | Firestore (used internally) |
| `subscribeSpellSummaries` | Loads spell list for the UI | Already uses `fetchCollection('spells', firebaseFallback, …)` ✅ |
| `upsertSpellSummary` | Writes summary row to `spellSummaries` Firestore collection | Firestore directly |
| `deleteSpellSummary` | Deletes summary row | Firestore directly |
| `createSpellWithSummary` | Creates spell + summary | Firestore directly (both `spells` and `spellSummaries`) |
| `spellSummariesExist` | Boolean check | Firestore directly |
| `backfillSpellSummaries` | Bulk copy `spells` → `spellSummaries` | Firestore directly |

Then `grep -rn` for each export across `src/` to find call sites:

```
src/pages/compendium/SpellList.tsx:25   subscribeSpellSummaries (already migrated ✅)
src/pages/core/Settings.tsx:564          string 'spellSummaries' in a purge config (separate concern)
```

(`SpellsEditor.tsx` and `SpellImportWorkbench.tsx` also use these exports; the grep above is illustrative — do a fuller grep yourself when migrating for real.)

## Step 2 — Decide the migration shape

The key decision: **does `spellSummaries` need a D1 home, or can the data be derived from `spells`?**

Looking at `subscribeSpellSummaries` (the one already migrated), the answer is already encoded in the code:

```ts
const data = await fetchCollection<any>('spells', async () => { ... }, { orderBy: 'name ASC' });
// then map D1 row fields (snake_case) → camelCase summary shape
```

It reads from `spells` directly and shapes the result client-side. So the migration's shape is:

> The `spellSummaries` collection is unnecessary. Drop the side index entirely. Every former write to `spellSummaries` becomes a no-op (or, if it carried data the `spells` row didn't, fold that data into `spells`).

This is a common pattern: **a Firestore-era side index that exists only because Firestore couldn't do the right query is no longer needed when you have SQL**.

Compare this with `imageMetadata.ts` (Phase A2 in the punchlist), which is the opposite shape: the metadata genuinely is separate from the image URL and needs its own D1 table (`image_metadata`).

## Step 3 — Plan the diffs

Per export, decide:

| Export | New behaviour | New implementation |
|---|---|---|
| `buildSpellSummaryPayload` | Unchanged | Keep |
| `mapSpellDocsToSummaries` | Unused after migration | Delete |
| `subscribeSpellSummaries` | Already migrated; flip fallback to `null` | Change fallback to `null`, keep mapping |
| `upsertSpellSummary` | No longer needed | Delete |
| `deleteSpellSummary` | No longer needed | Delete |
| `createSpellWithSummary` | Just creates the spell | Replace with single `upsertDocument('spells', …)` |
| `spellSummariesExist` | Logically equivalent to "any spells exist?" | Replace with thin `queryD1('SELECT COUNT(*) FROM spells')` |
| `backfillSpellSummaries` | No-op | Delete |

This is the most important step. **Don't translate the Firestore code call-by-call.** Translate the *intent*. Sometimes the answer is "this code shouldn't exist any more."

## Step 4 — Write the new file

```ts
// src/lib/spellSummary.ts (post-migration)
import { fetchCollection, queryD1, upsertDocument } from './d1';

export type SpellSummaryRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  imageUrl?: string;
  level?: number;
  school?: string;
  tagIds?: string[];
  updatedAt?: string;
  createdAt?: string;
  foundryImport?: {
    sourceBook?: string;
    sourcePage?: string;
    rules?: string;
  };
  [key: string]: any;
};

/**
 * Shape a spell row (from D1 or anywhere) into the summary record the UI expects.
 * Pure transform — kept because callers still build payloads outside of D1 reads.
 */
export function buildSpellSummaryPayload(spell: Record<string, any>) {
  return {
    name: String(spell.name ?? ''),
    identifier: String(spell.identifier ?? ''),
    sourceId: String(spell.sourceId ?? spell.source_id ?? ''),
    imageUrl: String(spell.imageUrl ?? spell.image_url ?? ''),
    level: Number(spell.level ?? 0),
    school: String(spell.school ?? ''),
    tagIds: Array.isArray(spell.tagIds ?? spell.tags) ? (spell.tagIds ?? spell.tags) : [],
    updatedAt: spell.updatedAt ?? spell.updated_at ?? '',
    createdAt: spell.createdAt ?? spell.created_at ?? '',
    foundryImport: {
      sourceBook: String(spell.foundryImport?.sourceBook ?? ''),
      sourcePage: String(spell.foundryImport?.sourcePage ?? ''),
      rules: String(spell.foundryImport?.rules ?? '')
    }
  };
}

/**
 * Subscribe-style API kept for compatibility with existing callers.
 * Returns an unsubscribe function. The "subscription" is actually a one-shot load
 * because D1 has no live snapshots — call sites that need refresh-on-mutation
 * should rely on the foundation heartbeat or trigger a manual reload.
 */
export function subscribeSpellSummaries(
  onData: (records: SpellSummaryRecord[]) => void,
  onError?: (error: unknown) => void,
) {
  let active = true;

  (async () => {
    try {
      const rows = await fetchCollection<any>('spells', null, { orderBy: 'name ASC' });
      if (!active) return;
      const mapped: SpellSummaryRecord[] = rows.map(row => ({
        id: row.id,
        ...buildSpellSummaryPayload(row),
        // Keep the foundry blob accessible to detail views
        foundryShell: row.foundry_shell ?? row.foundry_data,
      }));
      onData(mapped);
    } catch (err) {
      if (active) onError?.(err);
    }
  })();

  return () => { active = false; };
}

/**
 * Create a spell. The legacy "with summary" name is preserved for caller compatibility,
 * but it's now just an upsert to the spells table.
 */
export async function createSpellWithSummary(spell: Record<string, any>) {
  const id = spell.id ?? crypto.randomUUID();
  await upsertDocument('spells', id, spell);
  return id;
}

/**
 * Used to gate one-time backfill UI. Now answers "are there any spells?".
 */
export async function spellSummariesExist() {
  const rows = await queryD1<{ c: number }>('SELECT COUNT(*) as c FROM spells', [], { noCache: true });
  return (rows[0]?.c ?? 0) > 0;
}
```

What changed:
- `firebase/firestore` import gone
- `db` import gone
- `mapSpellDocsToSummaries` deleted (unused)
- `upsertSpellSummary` deleted (callers now write directly to `spells`)
- `deleteSpellSummary` deleted (callers now delete from `spells` directly)
- `backfillSpellSummaries` deleted (no longer needed)
- `subscribeSpellSummaries` simplified (no fallback)
- `createSpellWithSummary` simplified to a single `upsertDocument`
- `spellSummariesExist` rewritten as a count query

Net: ~140 lines → ~60 lines. The simplification is the migration.

## Step 5 — Update call sites

```
$ grep -rn "upsertSpellSummary\|deleteSpellSummary\|backfillSpellSummaries\|mapSpellDocsToSummaries" src/
```

Each call site needs review:
- A caller of `upsertSpellSummary(id, spell)` should already be writing the spell to D1 elsewhere; the summary write was a redundant side-effect. Delete the call.
- A caller of `deleteSpellSummary(id)` should be deleting the spell itself; the summary delete was a side-effect. Delete the call.
- A caller of `backfillSpellSummaries()` was a one-time UI button; remove the button or replace with a no-op + toast saying "no longer needed".

If a caller was passing data that **wasn't** in the spell row (rare — check the payload shape carefully), fold those fields into the spell row first.

## Step 6 — Update the punchlist

In [firestore-cut-punchlist.md](firestore-cut-punchlist.md), tick off the A1 box and any sub-items.

## Step 7 — Validate against local D1

1. Start the two-terminal local dev (see [../operations/local-dev.md](../operations/local-dev.md)).
2. Open the spell list (`/compendium/spells`).
3. Confirm the list populates and search/filter still works.
4. Open `/compendium/spells/manage` (admin), edit a spell, save, confirm it persists across reload.
5. Run a Foundry spell folder import; confirm new spells appear in the list.
6. Open the network tab — there should be **no** `firestore.googleapis.com` requests during these flows.
7. Console — there should be **no** `Falling back to Firebase` warnings related to spells.

If any of these fail, the migration isn't done. Roll back the file and try again.

## Step 8 — Commit (in your main worktree)

The user has explicitly noted: don't push to `main` until the full punchlist is validated. So this is a "save your progress locally" commit, not a deploy.

If using git, a single focused commit:
```
git add src/lib/spellSummary.ts src/pages/...
git commit -m "Migrate spellSummary.ts off Firestore"
```

If not using git: keep the diff isolated to a single saved snapshot you can revert if validation fails downstream.

## Pattern recognition for other files

When migrating any other punchlist item, ask yourself the same questions in this order:

1. **Inventory** — what does each export do?
2. **Find call sites** — `grep -rn` for each export.
3. **Decide shape** — for each export, is it: (a) translate to D1 helper directly, (b) delete (legacy / no longer needed), (c) restructure (data shape changed)?
4. **Plan diffs** — write the table before writing the code.
5. **Implement** — sometimes the diff is one line (`firebaseFallback` → `null`); sometimes it's a deletion.
6. **Update call sites** — they're often simpler than expected because the summary/index logic disappears.
7. **Update punchlist** — tick boxes.
8. **Validate locally** — concrete user flow, network tab, console.
9. **Commit** (or save a labelled snapshot if not using git).

Do **not**:
- Do call-by-call mechanical translation. Think about whether the function should still exist.
- Migrate multiple files at once. Each gets its own validation cycle.
- Push to `main` until every box on the punchlist is ticked.
- Delete the Firestore client (`db` from `firebase.ts`) until the **last** call site is gone — that's the very last step in [firestore-cut-punchlist.md](firestore-cut-punchlist.md) Phase E.

## When the shape doesn't fit this template

This file's migration is "delete most of it." The other punchlist items vary:

| File | Shape |
|---|---|
| `imageMetadata.ts` | **Translate.** `imageMetadata` collection has a real D1 home (`image_metadata`); each function gets a 1:1 D1 helper swap. |
| `classExport.ts` writes | **Translate + batch.** Many `setDoc` calls; collapse into `upsertDocumentBatch`. |
| `Map.tsx` | **Translate + restructure.** `onSnapshot` becomes one-shot fetch; live updates come from polling. |
| `SpellcastingAdvancementManager.tsx` | **Translate + collapse.** Three Firestore collections collapse into one D1 table via `D1_TABLE_MAP`. |
| `CharacterBuilder.tsx` | **Sweep.** ~25 reads, mostly `getDoc`/`getDocs` on catalogs. Bulk `Promise.all` of `fetchCollection` calls. |
| `ImageManager.tsx` | **Translate.** `getDocs(collection(db, col))` → `fetchCollection(col, null)`. |
| `config/wiki_settings` | **Designate + translate.** Decision required first (where does it live in D1?), then 1:1 translation. |

## Related docs

- [firestore-cut-punchlist.md](firestore-cut-punchlist.md) — the full work list with checkboxes
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — `fetchCollection`, `upsertDocument`, `queryD1`, etc.
- [../operations/local-dev.md](../operations/local-dev.md) — local validation setup
- [README.md](README.md) — phase status, schema philosophy
