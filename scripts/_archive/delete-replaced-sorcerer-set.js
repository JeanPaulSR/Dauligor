/**
 * Delete the obsolete Sorcerer set in Firestore.
 *
 * Context: when the original Sorcerer class doc (`awWmrbo3YxCMU86t7Yb9`) was
 * replaced with `b49Mkm7KjFfenfXBnRVY`, a complete new family (subclasses,
 * features, scaling columns) was authored under the new class ID. The OLD
 * children were never deleted — they were "orphans" pointing at the deleted
 * class. `cleanup-firestore-orphans.js` re-pointed them at the new class for
 * temporary safety, but we now have duplicates.
 *
 * This script removes the OLD set:
 *   - 8 Sorcerer subclasses (the previously-orphaned ones)
 *   - 43 features owned by those 8 subclasses
 *   - 6 base Sorcerer features (the previously-orphaned ones)
 *   - 2 Sorcerer scaling columns (the previously-orphaned ones)
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * One-off — once the cleanup is done, this script is no longer needed.
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

const SERVICE_ACCOUNT_PATH = path.resolve(ROOT, 'firebase-service-account.json');
const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

// ============================================================
// The OLD set — IDs we re-pointed in cleanup-firestore-orphans.js
// (verified against names so a typo can't accidentally delete the wrong doc)
// ============================================================

const NEW_CLASS_ID = 'b49Mkm7KjFfenfXBnRVY';   // current Sorcerer

const OLD_SUBCLASSES = [
  { id: 'mNymt4lPSWiQGmZZYtRc', expectedName: 'Draconic Bloodline' },
  { id: '7sl6hM7eRBcyEpnh6Qk8', expectedName: 'Wild Magic' },
  { id: 'LLoNjDXBiqiAfbKMunUu', expectedName: 'Clockwork Soul' },
  { id: 'hqIXpjEARLSI0mu0e0ph', expectedName: 'Shadow Magic' },
  { id: '0kSLQ2X6lfIP0qAgYzET', expectedName: 'Divine Soul' },
  { id: 'jKUSlfnt6NpZ14eLyeAC', expectedName: 'Lunar Sorcery' },
  { id: 'OtbHcqb9dVQB9TSUiN0K', expectedName: 'Aberrant Mind' },
  { id: 'yGu1Wmj5ApIykZAZoVve', expectedName: 'Storm Sorcery' },
];

const OLD_BASE_FEATURES = [
  { id: 'cwa4GIGJZDSvpjLWOpgw', expectedName: 'Magical Guidance' },
  { id: '0QP7d99hM4dEDMJwtJF3', expectedName: 'Metamagic' },
  { id: 'qrj2VrDuBnMQfL2Gwo5i', expectedName: 'Sorcerous Versatility' },
  { id: 'u9RlcGmjGZjC8u2yDzms', expectedName: 'Font of Magic' },
  { id: 'lfHJjmFpNSEvWcWIqwsF', expectedName: 'Sorcerous Restoration' },
  { id: '7HFfTk6tJPx3ITtN7jOK', expectedName: 'Sorcerous Origin' },
];

const OLD_SCALING_COLUMNS = [
  { id: 'gAdTi2hIzf6NRFc08Z9s', expectedName: 'Sorcery Points' },
  { id: 'wfKNMWJOiam3tgRMg2U4', expectedName: 'Metamagic' },
];

// ============================================================
// Verify each target exists, has the expected name, and currently
// points at the NEW class. If anything is unexpected we abort before
// touching data.
// ============================================================

async function verifyTarget(collection, target, parentField, expectedParent) {
  const ref = db.collection(collection).doc(target.id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ref, status: 'missing', actualName: null, actualParent: null };
  }
  const d = snap.data();
  if (d.name !== target.expectedName) {
    return { ref, status: 'name-mismatch', actualName: d.name, actualParent: d[parentField], doc: snap };
  }
  if (d[parentField] !== expectedParent) {
    return { ref, status: 'wrong-parent', actualName: d.name, actualParent: d[parentField], doc: snap };
  }
  return { ref, status: 'ok', actualName: d.name, actualParent: d[parentField], doc: snap };
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(apply ? '=== APPLY MODE — Firestore deletes will be committed ===' : '=== DRY RUN — no writes ===');
  console.log();

  const ops = [];   // { ref, label }
  let abort = false;

  // ---- Subclasses ----
  console.log('--- Subclasses to delete (8 expected) ---');
  for (const t of OLD_SUBCLASSES) {
    const v = await verifyTarget('subclasses', t, 'classId', NEW_CLASS_ID);
    if (v.status === 'missing') {
      console.log(`  [SKIP] ${t.id}  ${t.expectedName} — already deleted`);
      continue;
    }
    if (v.status === 'name-mismatch') {
      console.log(`  [ABORT] ${t.id}  expected name "${t.expectedName}" but found "${v.actualName}"`);
      abort = true;
      continue;
    }
    if (v.status === 'wrong-parent') {
      console.log(`  [ABORT] ${t.id} (${v.actualName})  classId is "${v.actualParent}", not ${NEW_CLASS_ID}. Was the cleanup script run?`);
      abort = true;
      continue;
    }
    console.log(`  [DEL] ${t.id}  ${v.actualName}`);
    ops.push({ ref: v.ref, label: `subclass ${v.actualName}` });
  }
  console.log();

  // ---- Base features ----
  console.log('--- Base Sorcerer features to delete (6 expected) ---');
  for (const t of OLD_BASE_FEATURES) {
    const v = await verifyTarget('features', t, 'parentId', NEW_CLASS_ID);
    if (v.status === 'missing') {
      console.log(`  [SKIP] ${t.id}  ${t.expectedName} — already deleted`);
      continue;
    }
    if (v.status === 'name-mismatch') {
      console.log(`  [WARN] ${t.id}  expected name "${t.expectedName}" but found "${v.actualName}"  — name drift, continuing`);
      // Names sometimes have trailing space. Don't abort.
    }
    if (v.status === 'wrong-parent') {
      console.log(`  [ABORT] ${t.id} (${v.actualName})  parentId is "${v.actualParent}", not ${NEW_CLASS_ID}.`);
      abort = true;
      continue;
    }
    const d = v.doc.data();
    if (d.parentType !== 'class') {
      console.log(`  [ABORT] ${t.id}  parentType is "${d.parentType}", expected "class".`);
      abort = true;
      continue;
    }
    console.log(`  [DEL] ${t.id}  L${d.level || '?'} | ${v.actualName}`);
    ops.push({ ref: v.ref, label: `feature ${v.actualName}` });
  }
  console.log();

  // ---- Scaling columns ----
  console.log('--- Scaling columns to delete (2 expected) ---');
  for (const t of OLD_SCALING_COLUMNS) {
    const v = await verifyTarget('scalingColumns', t, 'parentId', NEW_CLASS_ID);
    if (v.status === 'missing') {
      console.log(`  [SKIP] ${t.id}  ${t.expectedName} — already deleted`);
      continue;
    }
    if (v.status === 'name-mismatch') {
      console.log(`  [ABORT] ${t.id}  expected name "${t.expectedName}" but found "${v.actualName}"`);
      abort = true;
      continue;
    }
    if (v.status === 'wrong-parent') {
      console.log(`  [ABORT] ${t.id} (${v.actualName})  parentId is "${v.actualParent}", not ${NEW_CLASS_ID}.`);
      abort = true;
      continue;
    }
    const d = v.doc.data();
    if (d.parentType !== 'class') {
      console.log(`  [ABORT] ${t.id}  parentType is "${d.parentType}", expected "class".`);
      abort = true;
      continue;
    }
    console.log(`  [DEL] ${t.id}  ${v.actualName}`);
    ops.push({ ref: v.ref, label: `scaling ${v.actualName}` });
  }
  console.log();

  // ---- Cascading: features owned by the 8 old subclasses ----
  console.log('--- Cascading features (owned by the 8 old subclasses) ---');
  const oldSubclassIds = new Set(OLD_SUBCLASSES.map(t => t.id));
  const featuresSnap = await db.collection('features')
    .where('parentType', '==', 'subclass')
    .get();

  let cascadeCount = 0;
  for (const f of featuresSnap.docs) {
    const d = f.data();
    if (!oldSubclassIds.has(d.parentId)) continue;
    const parentName = OLD_SUBCLASSES.find(t => t.id === d.parentId)?.expectedName ?? '?';
    console.log(`  [DEL] ${f.id}  L${d.level || '?'} | ${d.name || '(unnamed)'}  ← ${parentName}`);
    ops.push({ ref: f.ref, label: `feature ${d.name} (under ${parentName})` });
    cascadeCount++;
  }
  console.log(`  → ${cascadeCount} feature(s)`);
  console.log();

  // ---- Cascading: scaling columns owned by the 8 old subclasses (defensive) ----
  console.log('--- Cascading scaling columns (owned by the 8 old subclasses) ---');
  const scalingSnap = await db.collection('scalingColumns')
    .where('parentType', '==', 'subclass')
    .get();

  let scalingCascade = 0;
  for (const s of scalingSnap.docs) {
    const d = s.data();
    if (!oldSubclassIds.has(d.parentId)) continue;
    const parentName = OLD_SUBCLASSES.find(t => t.id === d.parentId)?.expectedName ?? '?';
    console.log(`  [DEL] ${s.id}  ${d.name}  ← ${parentName}`);
    ops.push({ ref: s.ref, label: `scaling ${d.name} (under ${parentName})` });
    scalingCascade++;
  }
  if (scalingCascade === 0) console.log('  None.');
  else console.log(`  → ${scalingCascade}`);
  console.log();

  // ---- Summary ----
  console.log('--- Summary ---');
  console.log(`  Total deletions queued: ${ops.length}`);
  console.log();

  if (abort) {
    console.error('Aborting because of unexpected state above. Re-investigate before re-running.');
    process.exit(1);
  }

  if (ops.length === 0) {
    console.log('Nothing to delete. (Already cleaned up?)');
    return;
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to commit.');
    return;
  }

  console.log(`Applying ${ops.length} delete(s)...`);
  // Firestore batches max 500 ops; we have ~59. One batch is fine.
  const batch = db.batch();
  for (const op of ops) batch.delete(op.ref);
  await batch.commit();
  console.log('Committed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
