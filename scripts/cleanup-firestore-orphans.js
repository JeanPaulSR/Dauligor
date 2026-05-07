/**
 * Firestore orphan cleanup.
 *
 * Repairs stale parent references AND deletes truly-orphaned descendants
 * left behind when a class/subclass/group was deleted.
 *
 * Two categories of work:
 *
 *   1. Replacement repairs (parent doc was REPLACED with a new ID, not deleted):
 *      Every doc pointing at DEAD_CLASS_ID is re-pointed at NEW_CLASS_ID.
 *      Affected collections: subclasses.classId, features.parentId, scalingColumns.parentId.
 *      Add more (DEAD → NEW) pairs to REPLACEMENTS below if other class/subclass
 *      docs get replaced in the future.
 *
 *   2. True orphans (parent was DELETED entirely, never replaced):
 *      Subclasses with a `classId` that doesn't exist anywhere → delete.
 *      Features with a `parentId` that doesn't exist anywhere → delete.
 *      Scaling columns whose parent doesn't exist → delete.
 *      Unique option items whose `groupId` doesn't exist → delete.
 *
 * Usage:
 *   node scripts/cleanup-firestore-orphans.js                          # dry-run report
 *   node scripts/cleanup-firestore-orphans.js --apply                  # apply replacement repairs only
 *   node scripts/cleanup-firestore-orphans.js --apply --delete-orphans # also delete true orphans
 *
 * Idempotent: re-running after --apply does nothing additional.
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
const deleteOrphans = process.argv.includes('--delete-orphans');

const SERVICE_ACCOUNT_PATH = path.resolve(ROOT, 'firebase-service-account.json');
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('Error: firebase-service-account.json not found in project root.');
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = getFirestore('ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

// ============================================================
// Replacement map — parents that were REPLACED, not deleted.
// Every dependent doc pointing at the DEAD id gets re-pointed to the NEW id.
// ============================================================

const REPLACEMENTS = [
  {
    kind: 'class',
    deadId: 'awWmrbo3YxCMU86t7Yb9',
    newId:  'b49Mkm7KjFfenfXBnRVY',
    label:  'Sorcerer',
  },
  // Add more entries here if other class/subclass docs get replaced.
];

// ============================================================
// Helpers
// ============================================================

const banner = apply
  ? `=== APPLY MODE — writes will be committed${deleteOrphans ? ' (orphan deletes ENABLED)' : ''} ===`
  : '=== DRY RUN — no writes ===';
console.log(banner);
console.log();

/** Commit refs in Firestore-batch-friendly chunks (500 ops per batch). */
async function commitInBatches(ops) {
  const CHUNK = 450;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const slice = ops.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const op of slice) {
      if (op.kind === 'update') batch.update(op.ref, op.data);
      else if (op.kind === 'delete') batch.delete(op.ref);
    }
    await batch.commit();
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  // ----- Sanity: every replacement must have new ID present and dead ID absent -----
  for (const r of REPLACEMENTS) {
    const collection = r.kind === 'class' ? 'classes' : 'subclasses';
    const newSnap = await db.collection(collection).doc(r.newId).get();
    if (!newSnap.exists) {
      console.error(`Replacement target ${collection}/${r.newId} (${r.label}) not found — aborting.`);
      process.exit(1);
    }
    const deadSnap = await db.collection(collection).doc(r.deadId).get();
    if (deadSnap.exists) {
      console.error(`Replacement source ${collection}/${r.deadId} (${r.label}) STILL EXISTS — aborting.`);
      process.exit(1);
    }
    console.log(`Replacement: ${r.label} (${r.kind})  ${r.deadId}  →  ${r.newId} (${newSnap.data().name})`);
  }
  console.log();

  // ----- Load reference data once -----
  const [classesSnap, subclassesSnap, featuresSnap, scalingSnap, optGroupsSnap, optItemsSnap] = await Promise.all([
    db.collection('classes').get(),
    db.collection('subclasses').get(),
    db.collection('features').get(),
    db.collection('scalingColumns').get(),
    db.collection('uniqueOptionGroups').get(),
    db.collection('uniqueOptionItems').get(),
  ]);
  const classIds = new Set(classesSnap.docs.map(d => d.id));
  const subclassIds = new Set(subclassesSnap.docs.map(d => d.id));
  const optGroupIds = new Set(optGroupsSnap.docs.map(d => d.id));

  const ops = [];

  // ============================================================
  // Phase 1: Replacement repairs (re-point everything pointing at a dead parent)
  // ============================================================

  // Track which subclass / feature IDs got their parent fixed via repair —
  // used during orphan detection so we don't double-flag them.
  const repairedSubclassClassIds = new Map();   // subclassId → newClassId
  const repairedFeatureParentIds = new Map();   // featureId → newParentId
  const repairedScalingParentIds = new Map();   // scalingId → newParentId

  for (const r of REPLACEMENTS) {
    console.log(`--- Repairs for ${r.label} (${r.kind}: ${r.deadId} → ${r.newId}) ---`);

    if (r.kind === 'class') {
      // Subclasses pointing at the dead class
      const subs = subclassesSnap.docs.filter(d => d.data().classId === r.deadId);
      for (const s of subs) {
        const d = s.data();
        console.log(`  [FIX subclass]      ${s.id}  ${d.name}: classId  ${d.classId} → ${r.newId}`);
        ops.push({ kind: 'update', ref: s.ref, data: { classId: r.newId } });
        repairedSubclassClassIds.set(s.id, r.newId);
      }

      // Features pointing at the dead class
      const feats = featuresSnap.docs.filter(d => d.data().parentType === 'class' && d.data().parentId === r.deadId);
      for (const f of feats) {
        const d = f.data();
        console.log(`  [FIX feature]       ${f.id}  L${d.level || '?'} | ${d.name}: parentId  ${d.parentId} → ${r.newId}`);
        ops.push({ kind: 'update', ref: f.ref, data: { parentId: r.newId } });
        repairedFeatureParentIds.set(f.id, r.newId);
      }

      // Scaling columns pointing at the dead class
      const scales = scalingSnap.docs.filter(d => d.data().parentType === 'class' && d.data().parentId === r.deadId);
      for (const s of scales) {
        const d = s.data();
        console.log(`  [FIX scaling col]   ${s.id}  ${d.name}: parentId  ${d.parentId} → ${r.newId}`);
        ops.push({ kind: 'update', ref: s.ref, data: { parentId: r.newId } });
        repairedScalingParentIds.set(s.id, r.newId);
      }

      console.log(`  → ${subs.length} subclass(es), ${feats.length} feature(s), ${scales.length} scaling column(s)`);
    } else if (r.kind === 'subclass') {
      // Features and scaling columns pointing at the dead subclass
      const feats = featuresSnap.docs.filter(d => d.data().parentType === 'subclass' && d.data().parentId === r.deadId);
      for (const f of feats) {
        const d = f.data();
        console.log(`  [FIX feature]       ${f.id}  L${d.level || '?'} | ${d.name}: parentId  ${d.parentId} → ${r.newId}`);
        ops.push({ kind: 'update', ref: f.ref, data: { parentId: r.newId } });
        repairedFeatureParentIds.set(f.id, r.newId);
      }
      const scales = scalingSnap.docs.filter(d => d.data().parentType === 'subclass' && d.data().parentId === r.deadId);
      for (const s of scales) {
        const d = s.data();
        console.log(`  [FIX scaling col]   ${s.id}  ${d.name}: parentId  ${d.parentId} → ${r.newId}`);
        ops.push({ kind: 'update', ref: s.ref, data: { parentId: r.newId } });
        repairedScalingParentIds.set(s.id, r.newId);
      }
      console.log(`  → ${feats.length} feature(s), ${scales.length} scaling column(s)`);
    }
    console.log();
  }

  const totalRepairs = ops.length;

  // ============================================================
  // Phase 2: Detect TRUE orphans (parent doesn't exist anywhere)
  // ============================================================

  // Subclasses
  const orphanSubclasses = [];
  for (const s of subclassesSnap.docs) {
    const d = s.data();
    if (!d.classId) continue;
    const projectedClassId = repairedSubclassClassIds.get(s.id) ?? d.classId;
    if (!classIds.has(projectedClassId)) {
      orphanSubclasses.push({ id: s.id, ref: s.ref, name: d.name, classId: d.classId });
    }
  }

  // Features
  const orphanFeatures = [];
  for (const f of featuresSnap.docs) {
    const d = f.data();
    const projectedParentId = repairedFeatureParentIds.get(f.id) ?? d.parentId;
    let validParent = false;
    if (d.parentType === 'class') validParent = classIds.has(projectedParentId);
    else if (d.parentType === 'subclass') validParent = subclassIds.has(projectedParentId);
    if (!validParent) {
      orphanFeatures.push({
        id: f.id, ref: f.ref,
        name: d.name, level: d.level,
        parentType: d.parentType, parentId: d.parentId,
      });
    }
  }

  // Scaling columns
  const orphanScaling = [];
  for (const s of scalingSnap.docs) {
    const d = s.data();
    const projectedParentId = repairedScalingParentIds.get(s.id) ?? d.parentId;
    let validParent = false;
    if (d.parentType === 'class') validParent = classIds.has(projectedParentId);
    else if (d.parentType === 'subclass') validParent = subclassIds.has(projectedParentId);
    if (!validParent) {
      orphanScaling.push({
        id: s.id, ref: s.ref,
        name: d.name,
        parentType: d.parentType, parentId: d.parentId,
      });
    }
  }

  // Unique option items
  const orphanOptItems = [];
  for (const i of optItemsSnap.docs) {
    const d = i.data();
    if (d.groupId && !optGroupIds.has(d.groupId)) {
      orphanOptItems.push({
        id: i.id, ref: i.ref,
        name: d.name,
        groupId: d.groupId,
      });
    }
  }

  // ----- Report -----
  const reportSection = (title, list, fmt) => {
    console.log(`--- ${title} ---`);
    if (list.length === 0) {
      console.log('  None.');
    } else {
      for (const o of list) console.log(fmt(o));
      console.log(`  → ${list.length}`);
    }
    console.log();
  };

  reportSection('Orphan subclasses (parent class missing)',
    orphanSubclasses,
    o => `  [DEL] ${o.id}  ${o.name}  → classId=${o.classId} (missing)`);

  reportSection('Orphan features (parent missing)',
    orphanFeatures,
    o => `  [DEL] ${o.id}  L${o.level || '?'} | ${o.name || '(unnamed)'}  → ${o.parentType}=${o.parentId} (missing)`);

  reportSection('Orphan scaling columns (parent missing)',
    orphanScaling,
    o => `  [DEL] ${o.id}  ${o.name}  → ${o.parentType}=${o.parentId} (missing)`);

  reportSection('Orphan unique-option items (group missing)',
    orphanOptItems,
    o => `  [DEL] ${o.id}  ${o.name}  → groupId=${o.groupId} (missing)`);

  // ----- Plan deletes -----
  let plannedDeletes = 0;
  if (deleteOrphans) {
    for (const o of orphanFeatures)   { ops.push({ kind: 'delete', ref: o.ref }); plannedDeletes++; }
    for (const o of orphanScaling)    { ops.push({ kind: 'delete', ref: o.ref }); plannedDeletes++; }
    for (const o of orphanOptItems)   { ops.push({ kind: 'delete', ref: o.ref }); plannedDeletes++; }
    for (const o of orphanSubclasses) { ops.push({ kind: 'delete', ref: o.ref }); plannedDeletes++; }
  }

  // ============================================================
  // Phase 3: Apply
  // ============================================================

  const totalOrphans = orphanSubclasses.length + orphanFeatures.length + orphanScaling.length + orphanOptItems.length;

  console.log('--- Summary ---');
  console.log(`  Repairs to apply:      ${totalRepairs}`);
  console.log(`  Orphans found:         ${totalOrphans}`);
  console.log(`  Orphan deletes queued: ${deleteOrphans ? plannedDeletes : 0}${!deleteOrphans && totalOrphans > 0 ? '  (re-run with --delete-orphans to delete)' : ''}`);
  console.log();

  if (!apply) {
    console.log(`Dry run only. ${ops.length} op(s) would be committed.`);
    if (totalOrphans > 0 && !deleteOrphans) {
      console.log('Re-run with --apply --delete-orphans to also delete the orphans listed above.');
    } else if (ops.length > 0) {
      console.log('Re-run with --apply to commit.');
    }
    return;
  }

  if (ops.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log(`Applying ${ops.length} op(s)...`);
  await commitInBatches(ops);
  console.log('Committed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
