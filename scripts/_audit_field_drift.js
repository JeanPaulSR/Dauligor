/**
 * Systemic Firestore-vs-D1 field-universe diff.
 *
 * For each tracked collection, walks every Firestore document and collects the
 * union of field names. Maps camelCase → snake_case (mirroring the runtime
 * normalize logic) and diffs against the D1 table's actual columns.
 *
 * Output:
 *   - Firestore fields with NO D1 column (potential silent drops on save/migrate)
 *   - D1 columns with NO Firestore field (extras / phase-only / system cols)
 *
 * One-off audit; safe to re-run; no writes anywhere.
 */

import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- Bootstrap ----------
const sa = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-service-account.json'), 'utf8'));
const fbApp = admin.initializeApp({ credential: admin.credential.cert(sa) });
const fsDb = getFirestore(fbApp, 'ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

const d1Dir = path.join(ROOT, 'worker', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
const d1File = fs.readdirSync(d1Dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')[0];
const sqlite = new Database(path.join(d1Dir, d1File), { readonly: true });

// ---------- Field-name normalization (mirror compendium.ts + migrate.js mappers) ----------
function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c, i) => (i === 0 ? c.toLowerCase() : '_' + c.toLowerCase()));
}

// Fields that are intentionally unwrapped or rewritten (NOT a 1:1 column).
// Maps Firestore field name -> what it actually becomes in D1 (snake_case names),
// or null if intentionally dropped / synthesized elsewhere.
const FIELD_REWRITES = {
  // Universal
  classId: 'class_id', classIds: 'class_ids', subclassIds: 'subclass_ids', sourceId: 'source_id',
  imageUrl: 'image_url', imageDisplay: 'image_display',
  cardImageUrl: 'card_image_url', cardDisplay: 'card_display',
  previewImageUrl: 'preview_image_url', previewDisplay: 'preview_display',
  tagIds: 'tag_ids', excludedOptionIds: 'excluded_option_ids',
  uniqueOptionGroupIds: 'unique_option_group_ids',
  uniqueOptionMappings: 'unique_option_mappings',
  multiclassProficiencies: 'multiclass_proficiencies',
  multiclassRequirements: 'multiclass_requirements',
  primaryAbility: 'primary_ability', primaryAbilityChoice: 'primary_ability_choice',
  startingEquipment: 'starting_equipment',
  classIdentifier: 'class_identifier',
  isSubclassFeature: 'is_subclass_feature',
  subclassTitle: 'subclass_title', subclassFeatureLevels: 'subclass_feature_levels',
  asiLevels: 'asi_levels', hitDie: 'hit_die',
  savingThrows: 'saving_throws',
  scalingId: 'scaling_id', spellId: 'spell_id', itemId: 'item_id',
  optionGroupId: 'option_group_id', optionItemId: 'option_item_id',
  parentId: 'parent_id', parentType: 'parent_type',
  ownerId: 'owner_id', userId: 'user_id', campaignId: 'campaign_id',
  characterId: 'character_id', authorId: 'author_id',
  createdAt: 'created_at', updatedAt: 'updated_at',
  itemType: 'item_type', priceValue: 'price_value', priceDenomination: 'price_denomination',
  preparationMode: 'preparation_mode',
  // Composite objects unwrapped at write time (so the wrapper key has no D1 home)
  components: '__UNWRAPPED__',     // -> components_vocal/somatic/material/...
  uses: '__UNWRAPPED__',           // -> uses_max/spent/period/recovery
  prerequisites: '__UNWRAPPED__',  // -> prerequisites_level/items + repeatable
  automation: '__UNWRAPPED__',     // -> activities/effects
  // System
  id: '__DOC_ID__',                // Firestore doc id, not a field
};

function mapField(name) {
  if (FIELD_REWRITES[name] !== undefined) return FIELD_REWRITES[name];
  // Default: camelCase → snake_case
  return camelToSnake(name);
}

// ---------- D1 schema lookup ----------
function d1Cols(table) {
  try {
    return sqlite.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map(r => r.name);
  } catch {
    return [];
  }
}

// ---------- Collection → table map ----------
const COLLECTIONS = [
  ['sources', 'sources'],
  ['tagGroups', 'tag_groups'],
  ['tags', 'tags'],
  ['languageCategories', 'language_categories'],
  ['toolCategories', 'tool_categories'],
  ['weaponCategories', 'weapon_categories'],
  ['armorCategories', 'armor_categories'],
  ['attributes', 'attributes'],
  ['weaponProperties', 'weapon_properties'],
  ['damageTypes', 'damage_types'],
  ['languages', 'languages'],
  ['skills', 'skills'],
  ['tools', 'tools'],
  ['weapons', 'weapons'],
  ['armor', 'armor'],
  ['statuses', 'status_conditions'],
  ['imageMetadata', 'image_metadata'],
  ['uniqueOptionGroups', 'unique_option_groups'],
  ['uniqueOptionItems', 'unique_option_items'],
  ['spellcastingTypes', 'spellcasting_types'],
  // 3 → 1 fold (all become spellcasting_progressions)
  ['spellcastingScalings', 'spellcasting_progressions'],
  ['pactMagicScalings', 'spellcasting_progressions'],
  ['spellsKnownScalings', 'spellcasting_progressions'],
  ['standardMulticlassProgression', 'multiclass_master_chart'],
  ['eras', 'eras'],
  ['users', 'users'],
  ['campaigns', 'campaigns'],
  ['lore', 'lore_articles'],
  ['classes', 'classes'],
  ['subclasses', 'subclasses'],
  ['items', 'items'],
  ['feats', 'feats'],
  ['spells', 'spells'],
  ['features', 'features'],
  ['scalingColumns', 'scaling_columns'],
  ['characters', 'characters'],
];

// ---------- Run audit ----------
const reports = [];

for (const [coll, table] of COLLECTIONS) {
  process.stdout.write(`scanning ${coll} → ${table} ...`);
  let snap;
  try {
    snap = await fsDb.collection(coll).get();
  } catch (err) {
    console.log(` ERR (${err.message})`);
    continue;
  }

  const fieldUniverse = new Set();
  let docCount = 0;
  snap.forEach(doc => {
    docCount++;
    Object.keys(doc.data()).forEach(k => fieldUniverse.add(k));
  });

  console.log(` ${docCount} docs, ${fieldUniverse.size} unique fields`);

  const cols = new Set(d1Cols(table));
  if (cols.size === 0) {
    reports.push({ coll, table, docCount, missingTable: true });
    continue;
  }

  const orphanFsFields = [];     // Firestore field with no D1 home (potential drop)
  const expectedSnake = new Set();

  for (const fsField of fieldUniverse) {
    const mapped = mapField(fsField);
    if (mapped === '__DOC_ID__') continue;            // doc id, ignore
    if (mapped === '__UNWRAPPED__') continue;         // composite unwrapped
    expectedSnake.add(mapped);
    if (!cols.has(mapped)) orphanFsFields.push(`${fsField} → ${mapped}`);
  }

  // Junction-table targets — fields that exist in Firestore but live in a child table in D1.
  // Surfaced as orphans here; we annotate them separately.
  const JUNCTION_OK = {
    classes: ['proficiencies', 'advancements', 'spellcasting'], // JSON columns
    subclasses: ['advancements', 'spellcasting'],
    features: ['activities', 'effects', 'tags'],
    spells: ['activities', 'effects', 'tags'],
    items: ['activities', 'effects', 'tags'],
    feats: ['activities', 'effects', 'tags'],
    characters: [], // children live in character_*; surface separately
    lore: ['metadata', 'tags', 'visibilityEraIds', 'visibilityCampaignIds', 'linkedArticleIds', 'dmNotes'],
    campaigns: ['memberIds', 'dmId'],
    users: ['campaignIds'],
  };

  const allowed = new Set(JUNCTION_OK[coll] || []);
  const realDrift = orphanFsFields.filter(line => {
    const fsName = line.split(' → ')[0];
    return !allowed.has(fsName);
  });

  // D1 columns with no Firestore field (extras — phase-only or system cols)
  const SYSTEM_COLS = new Set(['id', 'created_at', 'updated_at']);
  const extraD1Cols = [...cols].filter(c => !expectedSnake.has(c) && !SYSTEM_COLS.has(c));

  reports.push({ coll, table, docCount, fields: fieldUniverse.size, drift: realDrift, extras: extraD1Cols });
}

// ---------- Print report ----------
console.log('\n\n================ FIRESTORE → D1 FIELD DRIFT REPORT ================\n');

let totalDrift = 0;
for (const r of reports) {
  if (r.missingTable) {
    console.log(`[${r.coll} → ${r.table}]  TABLE MISSING IN D1 (docs: ${r.docCount})`);
    continue;
  }
  const driftCount = r.drift.length;
  const extraCount = r.extras.length;
  totalDrift += driftCount;
  if (driftCount === 0 && extraCount === 0) continue;

  console.log(`[${r.coll} → ${r.table}]  docs: ${r.docCount}  fs-fields: ${r.fields}`);
  if (driftCount > 0) {
    console.log('  Firestore fields with NO D1 column (silent drops):');
    r.drift.forEach(d => console.log('    - ' + d));
  }
  if (extraCount > 0) {
    console.log('  D1 columns with no Firestore counterpart (extras / system / synthesized):');
    r.extras.forEach(e => console.log('    + ' + e));
  }
  console.log('');
}

console.log(`Total drift fields across all collections: ${totalDrift}`);
console.log('Note: "extras" are usually FK columns or synthesized values. Investigate only if surprising.');
