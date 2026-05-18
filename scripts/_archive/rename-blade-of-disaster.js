/**
 * Rename Blade of Disaster spell identifiers to disambiguate FRHF vs TCE.
 *
 * Background: two Firestore spells share `identifier='blade-of-disaster'`:
 *   - runmJfOWf1kPfVgfCg5R — Forgotten Realms: Heroes of Faerûn version (10d6 force, 60ft move)
 *   - zL76eTutaPXtI7qsMfUf — Tasha's Cauldron of Everything version (4d12+8d12 crit, 30ft move)
 *
 * D1 has `identifier TEXT NOT NULL UNIQUE`, so the second insert silently overwrites the first.
 * This script renames each to `<base>-<source-slug>` so both can coexist:
 *   - blade-of-disaster (FRHF) → blade-of-disaster-frhof
 *   - blade-of-disaster (TCE)  → blade-of-disaster-tce
 *
 * Sanity-checks each source slug before writing so a misconfigured source (e.g., user
 * changed the FRHF slug to "frhf-2024") doesn't produce the wrong identifier.
 *
 * Usage:
 *   node scripts/rename-blade-of-disaster.js          # dry-run, prints plan only
 *   node scripts/rename-blade-of-disaster.js --apply  # commit
 *
 * One-off — delete this file after running and confirming.
 */

import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');

const sa = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'firebase-service-account.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

// Each entry: spell doc id, expected source slug, expected name, new identifier suffix
const RENAMES = [
  {
    docId: 'runmJfOWf1kPfVgfCg5R',
    expectedName: 'Blade of Disaster',
    expectedSourceSlug: 'frhof',
    newIdentifier: 'blade-of-disaster-frhof',
  },
  {
    docId: 'zL76eTutaPXtI7qsMfUf',
    expectedName: 'Blade of Disaster',
    expectedSourceSlug: 'tcoe',
    newIdentifier: 'blade-of-disaster-tce',
  },
];

console.log(apply ? '=== APPLY MODE — Firestore writes will be committed ===' : '=== DRY RUN — no writes ===');
console.log();

async function main() {
  const ops = [];
  let abort = false;

  for (const r of RENAMES) {
    const ref = db.collection('spells').doc(r.docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  [SKIP] ${r.docId} — doc not found`);
      continue;
    }
    const d = snap.data();

    if (d.name !== r.expectedName) {
      console.log(`  [ABORT] ${r.docId} expected name "${r.expectedName}" but found "${d.name}"`);
      abort = true;
      continue;
    }

    if (d.identifier === r.newIdentifier) {
      console.log(`  [OK]   ${r.docId} (${d.name}) — already renamed to ${r.newIdentifier}`);
      continue;
    }

    if (d.identifier !== 'blade-of-disaster') {
      console.log(`  [ABORT] ${r.docId} (${d.name}) identifier is "${d.identifier}", not the expected "blade-of-disaster"`);
      abort = true;
      continue;
    }

    // Verify source slug
    const sourceSnap = d.sourceId ? await db.collection('sources').doc(d.sourceId).get() : null;
    const sourceSlug = sourceSnap?.exists ? sourceSnap.data().slug : null;
    if (sourceSlug !== r.expectedSourceSlug) {
      console.log(`  [ABORT] ${r.docId} (${d.name}) expected source slug "${r.expectedSourceSlug}" but found "${sourceSlug}". Aborting to avoid renaming the wrong copy.`);
      abort = true;
      continue;
    }

    console.log(`  [FIX]  ${r.docId} (${d.name}) [source=${sourceSlug}]:  identifier  "${d.identifier}"  →  "${r.newIdentifier}"`);
    ops.push({ ref, identifier: r.newIdentifier });
  }

  console.log();
  console.log(`  ${ops.length} rename(s) planned.`);

  if (abort) {
    console.error('\nAborting because of unexpected state above.');
    process.exit(1);
  }
  if (ops.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to commit.');
    return;
  }

  console.log('\nApplying...');
  const batch = db.batch();
  for (const op of ops) batch.update(op.ref, { identifier: op.identifier });
  await batch.commit();
  console.log('Committed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
