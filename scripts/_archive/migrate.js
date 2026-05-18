/**
 * Dauligor migration: Firestore → local Cloudflare D1 sqlite.
 *
 * Phases run in canonical order (1 → 2 → 3 → 4 → 5) so foreign-key lookups
 * are populated before dependent collections migrate.
 *
 * Local-only. Never targets remote D1. Re-runnable; INSERT … ON CONFLICT DO UPDATE
 * (true upsert that does not fire ON DELETE CASCADE on FK children).
 *
 * Requires firebase-service-account.json at the repo root.
 * Wrangler dev must be stopped (it locks the sqlite file).
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

// ============================================================
// Bootstrap
// ============================================================

const SERVICE_ACCOUNT_PATH = path.resolve(ROOT, 'firebase-service-account.json');
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('Error: firebase-service-account.json not found in project root.');
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const fbApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fsDb = getFirestore(fbApp, 'ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

function findLocalD1() {
  const dir = path.join(ROOT, 'worker', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!fs.existsSync(dir)) {
    console.error(`Local D1 directory not found at ${dir}`);
    console.error('Run `cd worker && npx wrangler dev` once to initialise it, then stop wrangler before re-running migrate.');
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (files.length === 0) {
    console.error(`No D1 sqlite file found in ${dir}. Apply schema migrations first.`);
    process.exit(1);
  }
  return path.join(dir, files[0]);
}

const sqlitePath = findLocalD1();
console.log(`D1: ${sqlitePath}`);

let sqlite;
try {
  sqlite = new Database(sqlitePath, { fileMustExist: true });
} catch (err) {
  if (String(err.message).includes('SQLITE_BUSY') || String(err.message).includes('locked')) {
    console.error('D1 sqlite is locked. Stop `wrangler dev` before running migrate.');
    process.exit(1);
  }
  throw err;
}
sqlite.pragma('foreign_keys = OFF');
sqlite.pragma('journal_mode = WAL');

// ============================================================
// Lookup state
// ============================================================

const lookups = {
  // ID sets — used by fk() to validate referential integrity at insert time
  sources: new Set(),
  eras: new Set(),
  users: new Set(),
  campaigns: new Set(),
  classes: new Set(),
  subclasses: new Set(),
  articles: new Set(),
  tags: new Set(),
  // Field-to-id lookups — populated as their parent table migrates
  langCat: {},
  toolCat: {},
  weaponCat: {},
  armorCat: {},
  attr: {},
  // Synthesised relationships
  userCampaigns: {},                // userId → campaignIds[]
  campaignDm: {},                   // campaignId → { dmId, createdAt }
  // Slug dedup
  slugs: new Set(),
};

// ============================================================
// SQL helpers
// ============================================================

/** Coerce a JS value into something better-sqlite3's bind() will accept. */
function toSqlValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Validated FK helper: returns the value if it exists in validSet, else null. */
function fk(value, validSet) {
  const s = typeof value === 'string' ? value.trim() : '';
  return (s && validSet.has(s)) ? s : null;
}

/** Slug derivation with collision-safe suffixing. */
function slugify(name) {
  const base = (name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let slug = base;
  let i = 2;
  while (lookups.slugs.has(slug)) slug = `${base}-${i++}`;
  lookups.slugs.add(slug);
  return slug;
}

/**
 * Generic insert builder.
 * Caches prepared statements per (table, column-set) so repeated inserts
 * with identical shape reuse a single compiled statement.
 *
 * Always quotes column names so reserved words (`order`, `values`) work
 * without per-column special cases.
 */
const stmtCache = new Map();
const pkCache = new Map();
function getPkCols(table) {
  let pk = pkCache.get(table);
  if (!pk) {
    pk = sqlite.prepare(`SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`).all(table).map(r => r.name);
    pkCache.set(table, pk);
  }
  return pk;
}
function insert(table, row) {
  const cols = Object.keys(row);
  const cacheKey = `${table}::${cols.join(',')}`;
  let stmt = stmtCache.get(cacheKey);
  if (!stmt) {
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    // ON CONFLICT DO UPDATE updates in place. Avoid INSERT OR REPLACE: it
    // resolves PK conflicts by DELETE + INSERT, which fires ON DELETE CASCADE
    // on FK children (e.g. classes → subclasses).
    const pkCols = getPkCols(table);
    const conflictTarget = pkCols.length > 0 ? pkCols.map(c => `"${c}"`).join(', ') : '"id"';
    const updateCols = cols.filter(c => !pkCols.includes(c));
    const updateClause = updateCols.length > 0
      ? `DO UPDATE SET ${updateCols.map(c => `"${c}" = excluded."${c}"`).join(', ')}`
      : 'DO NOTHING';
    stmt = sqlite.prepare(`INSERT INTO ${table} (${colSql}) VALUES (${placeholders}) ON CONFLICT(${conflictTarget}) ${updateClause}`);
    stmtCache.set(cacheKey, stmt);
  }
  stmt.run(...cols.map(c => toSqlValue(row[c])));
}

/** Cached IGNORE-style insert for junction tables. */
const ignoreStmtCache = new Map();
function insertIgnore(table, row) {
  const cols = Object.keys(row);
  const cacheKey = `${table}::${cols.join(',')}`;
  let stmt = ignoreStmtCache.get(cacheKey);
  if (!stmt) {
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    stmt = sqlite.prepare(`INSERT OR IGNORE INTO ${table} (${colSql}) VALUES (${placeholders})`);
    ignoreStmtCache.set(cacheKey, stmt);
  }
  stmt.run(...cols.map(c => toSqlValue(row[c])));
}

// ============================================================
// Phase runner — wraps a Firestore-collection migration in a transaction
// ============================================================

async function migrateCollection(collectionName, tableName, mapper, onDocProcessed) {
  process.stdout.write(`  ${collectionName} → ${tableName} `);
  try {
    const snap = await fsDb.collection(collectionName).get();
    let inserted = 0, skipped = 0;
    const tx = sqlite.transaction(() => {
      for (const doc of snap.docs) {
        const data = doc.data();
        const row = mapper(doc.id, data);
        if (row === null || row === undefined) {
          skipped++;
          continue;
        }
        insert(tableName, row);
        if (onDocProcessed) onDocProcessed(doc.id, data);
        inserted++;
      }
    });
    tx();
    console.log(`(${snap.size} read → ${inserted} inserted${skipped ? `, ${skipped} skipped` : ''})`);
  } catch (err) {
    console.log(`FAILED`);
    console.error(`    ${err.message}`);
  }
}

// ============================================================
// Phase 1 — Foundation & taxonomy
// ============================================================

const mapSimple = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  order: d.order ?? null,
  description: d.description || ''
});

const mapSource = (id, d) => ({
  id,
  name: d.name,
  slug: d.slug || id,
  abbreviation: d.abbreviation || '',
  rules_version: d.rules || '2014',
  status: d.status || 'ready',
  description: d.description || '',
  image_url: d.imageUrl || '',
  external_url: d.url || '',
  tags: d.tags || []
});

const mapTagGroup = (id, d) => ({
  id,
  name: d.name,
  category: d.category || '',
  classifications: d.classifications || [],
  description: d.description || ''
});

const mapTag = (id, d) => ({
  id,
  group_id: d.groupId,
  name: d.name,
  slug: d.slug || id
});

const mapAttribute = (id, d) => ({
  id,
  name: d.name,
  identifier: (d.identifier || id).toUpperCase(),
  order: d.order ?? null,
  description: d.description || ''
});

const mapLanguage = (id, d) => ({
  id,
  category_id: lookups.langCat[d.category] || null,
  name: d.name,
  identifier: d.identifier || id,
  description: d.description || '',
  order: d.order ?? 0
});

const mapSkill = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  foundry_alias: d.foundryAlias || '',
  ability_id: lookups.attr[(d.ability || '').toUpperCase()] || null,
  description: d.description || '',
  source: d.source || '',
  page: d.page ?? null,
  basic_rules: !!d.basicRules
});

const mapTool = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  category_id: lookups.toolCat[d.categoryId] || lookups.toolCat[d.category] || null,
  foundry_alias: d.foundryAlias || '',
  ability_id: lookups.attr[(d.ability || '').toUpperCase()] || null,
  description: d.description || '',
  source: d.source || '',
  page: d.page ?? null,
  basic_rules: !!d.basicRules
});

const mapWeapon = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  category_id: lookups.weaponCat[d.categoryId] || lookups.weaponCat[d.category] || null,
  weapon_type: d.weaponType || 'Melee',
  ability_id: lookups.attr[(d.ability || 'STR').toUpperCase()] || null,
  foundry_alias: d.foundryAlias || '',
  description: d.description || '',
  property_ids: d.propertyIds || [],
  source: d.source || '',
  page: d.page ?? null,
  basic_rules: !!d.basicRules
});

const mapArmor = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  category_id: lookups.armorCat[d.categoryId] || lookups.armorCat[d.category] || null,
  ability_id: lookups.attr[(d.ability || 'STR').toUpperCase()] || null,
  foundry_alias: d.foundryAlias || '',
  description: d.description || '',
  source: d.source || '',
  page: d.page ?? null,
  basic_rules: !!d.basicRules
});

const mapStatus = (id, d) => ({
  id,
  identifier: d.identifier || id,
  name: d.name,
  image_url: d.img || '',
  reference: d.reference || '',
  description: d.description || '',
  order: d.order ?? null,
  implied_ids: d.impliedStatuses || [],
  changes: d.changes || [],
  source: d.source || 'custom'
});

const mapImageMeta = (id, d) => {
  const uploadedAt = d.uploadedAt?.toDate?.().toISOString()
    ?? d.uploadedAt?.toISOString?.()
    ?? '';
  return {
    id,
    url: d.url || '',
    storage_path: d.storagePath || '',
    filename: d.filename || '',
    folder: d.folder || '',
    creator: d.creator || '',
    description: d.description || '',
    tags: d.tags || [],
    license: d.license || '',
    source: d.source || '',
    uploaded_by: d.uploadedBy || '',
    uploaded_by_name: d.uploadedByName || '',
    uploaded_at: uploadedAt,
    size: d.size ?? null
  };
};

const mapOptionGroup = (id, d) => ({
  id,
  name: d.name,
  description: d.description || '',
  source_id: fk(d.sourceId, lookups.sources),
  class_ids: d.classIds || [],
  created_at: d.createdAt || null
});

const mapOptionItem = (id, d) => ({
  id,
  group_id: d.groupId || null,
  name: d.name,
  description: d.description || '',
  icon_url: d.iconUrl || '',
  source_id: fk(d.sourceId, lookups.sources),
  level_prerequisite: d.levelPrerequisite ?? 0,
  string_prerequisite: d.stringPrerequisite || '',
  is_repeatable: !!d.isRepeatable,
  page: String(d.page || ''),
  class_ids: d.classIds || [],
  created_at: d.createdAt || null
});

const mapSpellcastingType = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  foundry_name: d.foundryName || '',
  formula: d.formula || ''
});

const mapSpellcastingProgression = (type) => (id, d) => ({
  id,
  name: d.name,
  type,
  levels: d.levels ?? {}
});

const mapMulticlassChart = (id, d) => ({
  id,
  levels: d.levels ?? []
});

// ============================================================
// Phase 2 — Identity & social
// ============================================================

const mapEra = (id, d) => {
  if (!d.name) return null;
  return {
    id,
    name: d.name,
    description: d.description || '',
    order: d.order ?? null,
    background_image_url: d.backgroundImageUrl || '',
    created_at: d.createdAt || ''
  };
};

const VALID_ROLES = new Set(['admin', 'co-dm', 'lore-writer', 'trusted-player', 'user']);
const VALID_THEMES = new Set(['parchment', 'light', 'dark']);

const mapUser = (id, d) => {
  if (!d.username) return null;
  return {
    id,
    username: d.username,
    display_name: d.displayName || '',
    role: VALID_ROLES.has(d.role) ? d.role : 'user',
    avatar_url: d.avatarUrl || '',
    bio: d.bio || '',
    pronouns: d.pronouns || '',
    theme: VALID_THEMES.has(d.theme) ? d.theme : 'parchment',
    accent_color: d.accentColor || '',
    hide_username: !!d.hideUsername,
    is_private: !!d.isPrivate,
    recovery_email: d.recoveryEmail || '',
    active_campaign_id: d.activeCampaignId || null,
    created_at: d.createdAt || ''
  };
};

const mapCampaign = (id, d) => {
  if (!d.name) return null;
  return {
    id,
    name: d.name,
    slug: slugify(d.name),
    description: d.description || '',
    dm_id: fk(d.dmId, lookups.users),
    era_id: fk(d.eraId, lookups.eras),
    image_url: d.imageUrl || '',
    preview_image_url: d.previewImageUrl || '',
    card_image_url: d.cardImageUrl || '',
    background_image_url: d.backgroundImageUrl || '',
    recommended_lore_id: d.recommendedLoreId || null,
    settings: d.settings ?? null,
    created_at: d.createdAt || ''
  };
};

/**
 * Synthesise campaign_members rows from:
 *   - campaignDm (one 'dm' row per campaign)
 *   - userCampaigns (one 'player' row per user/campaign pair)
 * DM rows take precedence; INSERT OR IGNORE silently skips dupes.
 */
function migrateCampaignMembers() {
  process.stdout.write(`  (synthesised) → campaign_members `);
  let count = 0;
  const tx = sqlite.transaction(() => {
    for (const [campaignId, { dmId, createdAt }] of Object.entries(lookups.campaignDm)) {
      if (!lookups.campaigns.has(campaignId) || !lookups.users.has(dmId)) continue;
      insertIgnore('campaign_members', {
        campaign_id: campaignId,
        user_id: dmId,
        role: 'dm',
        joined_at: createdAt || null
      });
      count++;
    }
    for (const [userId, campaignIds] of Object.entries(lookups.userCampaigns)) {
      if (!lookups.users.has(userId)) continue;
      for (const cid of campaignIds) {
        if (!lookups.campaigns.has(cid)) continue;
        insertIgnore('campaign_members', {
          campaign_id: cid,
          user_id: userId,
          role: 'player',
          joined_at: null
        });
        count++;
      }
    }
  });
  tx();
  console.log(`(${count} rows)`);
}

// ============================================================
// Phase 3 — Wiki & lore
// ============================================================

const mapLoreArticle = (id, d, dmNotes) => ({
  id,
  title: d.title,
  slug: d.slug || slugify(d.title || id),
  category: d.category,
  folder: d.folder || null,
  content: d.content || '',
  excerpt: d.excerpt || '',
  parent_id: fk(d.parentId, lookups.articles),
  status: d.status || 'draft',
  author_id: fk(d.authorId, lookups.users),
  dm_notes: dmNotes || null,
  image_url: d.imageUrl || '',
  image_display: d.imageDisplay,
  card_image_url: d.cardImageUrl || '',
  card_display: d.cardDisplay,
  preview_image_url: d.previewImageUrl || '',
  preview_display: d.previewDisplay,
  created_at: d.createdAt || '',
  updated_at: d.updatedAt || ''
});

const mapLoreMetaCharacter = (articleId, m) => ({
  article_id: articleId,
  race: m.race || null,
  age: m.age || null,
  alignment: m.alignment || null,
  occupation: m.occupation || null,
  life_status: m.lifeStatus || null,
  gender: m.gender || null,
  pronouns: m.pronouns || null,
  birth_date: m.birthDate || null,
  death_date: m.deathDate || null
});

const mapLoreMetaLocation = (articleId, m) => ({
  article_id: articleId,
  location_type: m.locationType || null,
  population: m.population || null,
  climate: m.climate || null,
  ruler: m.ruler || null,
  founding_date: m.foundingDate || null,
  parent_location: m.parentLocation || null,
  owning_organization: m.owningOrganization || null
});

const mapLoreMetaOrganization = (articleId, m) => ({
  article_id: articleId,
  headquarters: m.headquarters || null,
  leader: m.leader || null,
  motto: m.motto || null,
  founding_date: m.foundingDate || null
});

const mapLoreMetaDeity = (articleId, m) => ({
  article_id: articleId,
  domains: m.domains || null,
  holy_symbol: m.holySymbol || null
});

const mapLoreSecret = (secretId, articleId, d) => ({
  id: secretId,
  article_id: articleId,
  content: d.content,
  created_at: d.createdAt || '',
  updated_at: d.updatedAt || ''
});

async function migrateLore() {
  process.stdout.write(`  lore → lore_articles & metadata `);
  const snap = await fsDb.collection('lore').get();

  // Pre-populate validArticleIds for the parent_id FK
  for (const doc of snap.docs) lookups.articles.add(doc.id);

  // Lore migration mixes async (sub-collection fetches) with writes; we
  // can't wrap everything in one transaction. Instead, we do per-article
  // transactions after we have all the async data.
  let articles = 0, meta = 0, secrets = 0, junctions = 0;

  for (const doc of snap.docs) {
    const id = doc.id;
    const d = doc.data();

    const notesSnap = await doc.ref.collection('dmData').doc('notes').get();
    const dmNotes = notesSnap.exists ? notesSnap.data().content : null;
    const secretsSnap = await doc.ref.collection('secrets').get();

    sqlite.transaction(() => {
      insert('lore_articles', mapLoreArticle(id, d, dmNotes));
      articles++;

      const m = d.metadata || {};
      if (d.category === 'character') {
        insert('lore_meta_characters', mapLoreMetaCharacter(id, m)); meta++;
      } else if (d.category === 'deity') {
        insert('lore_meta_characters', mapLoreMetaCharacter(id, m)); meta++;
        if (m.domains || m.holySymbol) {
          insert('lore_meta_deities', mapLoreMetaDeity(id, m)); meta++;
        }
      } else if (['building', 'settlement', 'geography', 'country'].includes(d.category)) {
        insert('lore_meta_locations', mapLoreMetaLocation(id, m)); meta++;
      } else if (d.category === 'organization') {
        insert('lore_meta_organizations', mapLoreMetaOrganization(id, m)); meta++;
      } else if (d.category === 'religion') {
        insert('lore_meta_organizations', mapLoreMetaOrganization(id, m)); meta++;
        if (m.domains || m.holySymbol) {
          insert('lore_meta_deities', mapLoreMetaDeity(id, m)); meta++;
        }
      }

      if (Array.isArray(d.visibilityEraIds)) {
        for (const eraId of d.visibilityEraIds) {
          if (lookups.eras.has(eraId)) {
            insertIgnore('lore_article_eras', { article_id: id, era_id: eraId });
            junctions++;
          }
        }
      }
      if (Array.isArray(d.visibilityCampaignIds)) {
        for (const cId of d.visibilityCampaignIds) {
          if (lookups.campaigns.has(cId)) {
            insertIgnore('lore_article_campaigns', { article_id: id, campaign_id: cId });
            junctions++;
          }
        }
      }
      if (Array.isArray(d.tags)) {
        for (const tagId of d.tags) {
          if (lookups.tags.has(tagId)) {
            insertIgnore('lore_article_tags', { article_id: id, tag_id: tagId });
            junctions++;
          }
        }
      }
      if (Array.isArray(d.linkedArticleIds)) {
        for (const targetId of d.linkedArticleIds) {
          insertIgnore('lore_links', { article_id: id, target_id: targetId });
          junctions++;
        }
      }

      for (const sDoc of secretsSnap.docs) {
        const sId = sDoc.id;
        const sData = sDoc.data();
        insert('lore_secrets', mapLoreSecret(sId, id, sData));
        secrets++;

        if (Array.isArray(sData.eraIds)) {
          for (const eId of sData.eraIds) {
            if (lookups.eras.has(eId)) {
              insertIgnore('lore_secret_eras', { secret_id: sId, era_id: eId });
              junctions++;
            }
          }
        }
        if (Array.isArray(sData.revealedCampaignIds)) {
          for (const cId of sData.revealedCampaignIds) {
            if (lookups.campaigns.has(cId)) {
              insertIgnore('lore_secret_campaigns', { secret_id: sId, campaign_id: cId });
              junctions++;
            }
          }
        }
      }
    })();
  }

  console.log(`(${articles} articles, ${meta} meta, ${secrets} secrets, ${junctions} junctions)`);
}

// ============================================================
// Phase 4 — Compendium
// ============================================================

const mapItem = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  item_type: d.type || 'loot',
  rarity: d.rarity || 'none',
  quantity: d.quantity ?? 1,
  weight: parseFloat(d.weight || 0),
  price_value: parseFloat(d.priceValue || 0),
  price_denomination: d.priceDenomination || 'gp',
  attunement: !!d.attunement,
  equipped: !!d.equipped,
  identified: !!d.identified,
  magical: !!d.magical,
  description: d.description || '',
  image_url: d.imageUrl || '',
  activities: d.automation?.activities || [],
  effects: d.automation?.effects || [],
  source_id: fk(d.sourceId || d.source?.id, lookups.sources),
  page: d.page || null,
  tags: d.tags || []
});

const mapFeat = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  feat_type: d.featType || 'general',
  source_type: d.sourceType || 'feat',
  requirements: d.requirements || '',
  repeatable: !!d.repeatable,
  uses_max: d.uses?.max || '',
  uses_spent: d.uses?.spent ?? 0,
  description: d.description || '',
  image_url: d.imageUrl || '',
  activities: d.automation?.activities || [],
  effects: d.automation?.effects || [],
  source_id: fk(d.sourceId || d.source?.id, lookups.sources),
  page: d.page || null,
  tags: d.tags || []
});

const mapSpell = (id, d) => {
  const shell = d.foundryShell || d.foundryDocument?.system || {};
  const foundryData = {
    activation: shell.activation || {},
    range: shell.range || {},
    duration: shell.duration || {},
    target: shell.target || {},
    properties: shell.properties || [],
    materials: shell.materials || {}
  };
  return {
    id,
    name: d.name,
    identifier: d.identifier || id,
    level: d.level ?? 0,
    school: d.school || '',
    preparation_mode: d.preparationMode || 'spell',
    ritual: !!d.ritual,
    concentration: !!d.concentration,
    components_vocal: !!d.components?.vocal,
    components_somatic: !!d.components?.somatic,
    components_material: !!d.components?.material,
    components_material_text: d.components?.materialText || '',
    components_consumed: !!d.components?.consumed,
    components_cost: d.components?.cost || '',
    description: d.description || '',
    image_url: d.imageUrl || '',
    activities: d.automation?.activities || d.activities || [],
    effects: d.automation?.effects || d.effects || [],
    foundry_data: foundryData,
    source_id: fk(d.sourceId || d.source?.id, lookups.sources),
    page: d.foundryImport?.sourcePage || d.page || null,
    tags: d.tagIds || d.tags || []
  };
};

const mapFeature = (id, d) => {
  if (d.parentType === 'class' && !lookups.classes.has(d.parentId)) return null;
  if (d.parentType === 'subclass' && !lookups.subclasses.has(d.parentId)) return null;

  const uses = d.uses || d.usage || {};
  const prereqs = d.prerequisites || {};
  return {
    id,
    name: d.name,
    identifier: d.identifier || id,
    parent_id: d.parentId || null,
    parent_type: d.parentType || null,
    level: d.level ?? 1,
    feature_type: d.featureType || 'class',
    subtype: d.subtype || null,
    requirements: d.requirements || '',
    description: d.description || '',
    image_url: d.imageUrl || '',
    icon_url: d.iconUrl || '',
    uses_max: uses.max || '',
    uses_spent: uses.spent ?? 0,
    uses_recovery: uses.recovery || [],
    prerequisites_level: prereqs.level ?? null,
    prerequisites_items: prereqs.items || [],
    repeatable: !!d.repeatable,
    is_subclass_feature: !!d.isSubclassFeature,
    properties: d.properties || [],
    activities: d.automation?.activities || d.activities || [],
    effects: d.automation?.effects || d.effects || [],
    advancements: d.advancements || [],
    quantity_column_id: d.quantityColumnId || null,
    scaling_column_id: d.scalingColumnId || null,
    source_id: fk(d.sourceId || d.source?.id, lookups.sources),
    page: d.page || null,
    tags: d.tagIds || d.tags || []
  };
};

const mapClass = (id, d) => ({
  id,
  name: d.name,
  identifier: d.identifier || id,
  source_id: fk(d.sourceId || d.source?.id, lookups.sources),
  category: d.category || null,
  tag_ids: d.tagIds || [],
  hit_die: d.hitDie ?? 8,
  description: d.description || '',
  lore: d.lore || '',
  preview: d.preview || '',
  image_url: d.imageUrl || '',
  card_image_url: d.cardImageUrl || '',
  preview_image_url: d.previewImageUrl || '',
  card_display: d.cardDisplay,
  image_display: d.imageDisplay,
  preview_display: d.previewDisplay,
  saving_throws: d.savingThrows || [],
  proficiencies: d.proficiencies || {},
  starting_equipment: d.startingEquipment || '',
  multiclassing: d.multiclassing || '',
  multiclass_proficiencies: d.multiclassProficiencies || {},
  primary_ability: d.primaryAbility || [],
  primary_ability_choice: d.primaryAbilityChoice || [],
  spellcasting: d.spellcasting || {},
  advancements: d.advancements || [],
  subclass_title: d.subclassTitle || 'Subclass',
  subclass_feature_levels: d.subclassFeatureLevels || [],
  asi_levels: d.asiLevels || [],
  wealth: d.wealth || '',
  excluded_option_ids: d.excludedOptionIds || {},
  unique_option_mappings: d.uniqueOptionMappings || []
});

const mapSubclass = (id, d) => {
  if (!lookups.classes.has(d.classId)) {
    console.warn(`    [WARN] Skipping orphaned subclass ${id} (${d.name}) — parent ${d.classId} missing`);
    return null;
  }
  return {
    id,
    class_id: d.classId,
    name: d.name,
    identifier: d.identifier || id,
    class_identifier: d.classIdentifier || '',
    source_id: fk(d.sourceId || d.source?.id, lookups.sources),
    description: d.description || '',
    lore: d.lore || '',
    image_url: d.imageUrl || '',
    image_display: d.imageDisplay,
    card_image_url: d.cardImageUrl || '',
    card_display: d.cardDisplay,
    preview_image_url: d.previewImageUrl || '',
    preview_display: d.previewDisplay,
    tag_ids: d.tagIds || [],
    spellcasting: d.spellcasting || {},
    advancements: d.advancements || [],
    excluded_option_ids: d.excludedOptionIds || {},
    unique_option_group_ids: d.uniqueOptionGroupIds || []
  };
};

const mapScaling = (id, d) => {
  if (d.parentType === 'class' && !lookups.classes.has(d.parentId)) return null;
  if (d.parentType === 'subclass' && !lookups.subclasses.has(d.parentId)) return null;
  return {
    id,
    name: d.name,
    parent_id: d.parentId,
    parent_type: d.parentType,
    values: d.values || {}
  };
};

// ============================================================
// Phase 5 — Characters
// ============================================================

const mapCharacterBase = (id, d) => {
  const stats = d.stats || { base: {} };
  const info = d.info || {};
  const hp = d.hp || {};
  const senses = d.senses || {};
  const metadata = {
    isLevelLocked: !!d.isLevelLocked,
    exhaustion: d.exhaustion || 0,
    hasInspiration: !!d.hasInspiration,
    hitDie: d.hitDie || {},
    spellPoints: d.spellPoints || {},
    ac: d.ac || 10,
    initiative: d.initiative || 0,
    speed: d.speed || 30,
    proficiencyBonus: d.proficiencyBonus || 2,
    bookmarks: d.bookmarks || [],
    overriddenSkillAbilities: d.overriddenSkillAbilities || {}
  };
  return {
    id,
    user_id: d.userId,
    campaign_id: fk(d.campaignId, lookups.campaigns),
    name: d.name,
    image_url: d.imageUrl || '',
    race_id: d.raceId || null,
    background_id: d.backgroundId || null,
    level: d.level || 1,
    exhaustion: d.exhaustion || 0,
    has_inspiration: !!d.hasInspiration,
    current_hp: hp.current ?? 10,
    temp_hp: hp.temp ?? 0,
    max_hp_override: hp.max ?? null,
    stats_json: stats.base,
    info_json: info,
    senses_json: senses,
    metadata_json: metadata,
    created_at: d.createdAt || '',
    updated_at: d.updatedAt || ''
  };
};

async function migrateCharacters() {
  process.stdout.write(`  characters → characters & subtables `);
  const snap = await fsDb.collection('characters').get();
  let baseN = 0, progN = 0, selN = 0, invN = 0, spN = 0, profN = 0;

  const tx = sqlite.transaction(() => {
    for (const doc of snap.docs) {
      const id = doc.id;
      const d = doc.data();

      // 1. Base character
      insert('characters', mapCharacterBase(id, d));
      baseN++;

      // 2. Class progression
      const prog = d.progression || [];
      prog.forEach((entry, idx) => {
        insert('character_progression', {
          id: `${id}_p_${idx}`,
          character_id: id,
          class_id: entry.classId,
          subclass_id: entry.subclassId || null,
          level_index: idx + 1,
          hp_roll: entry.hpRoll || 0
        });
        progN++;
      });

      // 3. Selections (advancement choices)
      const selOptions = d.selectedOptions || {};
      Object.entries(selOptions).forEach(([key, values], idx) => {
        if (!Array.isArray(values) || values.length === 0) return;
        let scope = null, advId = key, level = 1;
        if (key.includes('|')) {
          const parts = key.split('|');
          scope = parts.filter(p => !p.startsWith('adv:') && !p.startsWith('level:')).join('|') || null;
          const advPart = parts.find(p => p.startsWith('adv:'));
          const levelPart = parts.find(p => p.startsWith('level:'));
          if (advPart) advId = advPart.replace('adv:', '');
          if (levelPart) level = parseInt(levelPart.replace('level:', '')) || 1;
        }
        insert('character_selections', {
          id: `${id}_s_${idx}`,
          character_id: id,
          advancement_id: advId,
          level,
          selected_ids: values,
          source_scope: scope
        });
        selN++;
      });

      // 4. Inventory & spells from progressionState
      const ps = d.progressionState || {};
      if (Array.isArray(ps.ownedItems)) {
        ps.ownedItems.forEach((item, idx) => {
          insert('character_inventory', {
            id: `${id}_i_${idx}`,
            character_id: id,
            item_id: item.id || item.entityId,
            quantity: item.quantity || 1,
            is_equipped: !!item.isEquipped,
            container_id: item.containerId || null,
            custom_data: item.customData || {}
          });
          invN++;
        });
      }
      if (Array.isArray(ps.ownedSpells)) {
        ps.ownedSpells.forEach((spell, idx) => {
          insert('character_spells', {
            id: `${id}_sp_${idx}`,
            character_id: id,
            spell_id: spell.id || spell.entityId,
            source_id: spell.sourceId || null,
            is_prepared: !!spell.isPrepared,
            is_always_prepared: !!spell.isAlwaysPrepared
          });
          spN++;
        });
      }

      // 5. Proficiencies (flattened from root arrays)
      const addProfs = (list, type, level) => {
        if (!Array.isArray(list)) return;
        list.forEach((entityId, idx) => {
          insert('character_proficiencies', {
            id: `${id}_prof_${type}_${idx}`,
            character_id: id,
            entity_id: entityId,
            entity_type: type,
            proficiency_level: level
          });
          profN++;
        });
      };
      addProfs(d.savingThrows, 'save', 1);
      addProfs(d.halfProficientSavingThrows, 'save', 0.5);
      addProfs(d.expertiseSavingThrows, 'save', 2);
      addProfs(d.proficientSkills, 'skill', 1);
      addProfs(d.expertiseSkills, 'skill', 2);
      addProfs(d.halfProficientSkills, 'skill', 0.5);
      addProfs(d.armorProficiencies, 'armor', 1);
      addProfs(d.weaponProficiencies, 'weapon', 1);
      addProfs(d.toolProficiencies, 'tool', 1);
      addProfs(d.languages, 'language', 1);
      addProfs(d.resistances, 'resistance', 1);
      addProfs(d.immunities, 'immunity', 1);
      addProfs(d.vulnerabilities, 'vulnerability', 1);
    }
  });
  tx();
  console.log(`(${snap.size} chars: ${baseN} base, ${progN} prog, ${selN} sel, ${invN} inv, ${spN} sp, ${profN} prof)`);
}

// ============================================================
// Run — phases in canonical order: 1 → 2 → 3 → 4 → 5
// ============================================================

async function run() {
  const t0 = Date.now();

  // ---- Phase 1: Foundation & taxonomy ----
  console.log('\n=== Phase 1: Foundation & taxonomy ===');
  await migrateCollection('sources', 'sources', mapSource, (id) => lookups.sources.add(id));
  await migrateCollection('tagGroups', 'tag_groups', mapTagGroup);
  await migrateCollection('tags', 'tags', mapTag, (id) => lookups.tags.add(id));

  await migrateCollection('languageCategories', 'language_categories', mapSimple, (id, d) => {
    lookups.langCat[d.name] = id;
  });
  await migrateCollection('toolCategories', 'tool_categories', mapSimple, (id, d) => {
    lookups.toolCat[id] = id;
    lookups.toolCat[d.name] = id;
  });
  await migrateCollection('weaponCategories', 'weapon_categories', mapSimple, (id, d) => {
    lookups.weaponCat[id] = id;
    lookups.weaponCat[d.name] = id;
  });
  await migrateCollection('armorCategories', 'armor_categories', mapSimple, (id, d) => {
    lookups.armorCat[id] = id;
    lookups.armorCat[d.name] = id;
  });
  await migrateCollection('attributes', 'attributes', mapAttribute, (id, d) => {
    lookups.attr[(d.identifier || id).toUpperCase()] = id;
  });

  await migrateCollection('weaponProperties', 'weapon_properties', mapSimple);
  await migrateCollection('damageTypes', 'damage_types', mapSimple);
  await migrateCollection('conditions', 'condition_categories', mapSimple);

  await migrateCollection('languages', 'languages', mapLanguage);
  await migrateCollection('skills', 'skills', mapSkill);
  await migrateCollection('tools', 'tools', mapTool);
  await migrateCollection('weapons', 'weapons', mapWeapon);
  await migrateCollection('armor', 'armor', mapArmor);
  await migrateCollection('statuses', 'status_conditions', mapStatus);
  await migrateCollection('imageMetadata', 'image_metadata', mapImageMeta);

  await migrateCollection('uniqueOptionGroups', 'unique_option_groups', mapOptionGroup);
  await migrateCollection('uniqueOptionItems', 'unique_option_items', mapOptionItem);

  await migrateCollection('spellcastingTypes', 'spellcasting_types', mapSpellcastingType);
  await migrateCollection('spellcastingScalings', 'spellcasting_progressions', mapSpellcastingProgression('standard'));
  await migrateCollection('pactMagicScalings', 'spellcasting_progressions', mapSpellcastingProgression('pact'));
  await migrateCollection('spellsKnownScalings', 'spellcasting_progressions', mapSpellcastingProgression('known'));
  await migrateCollection('standardMulticlassProgression', 'multiclass_master_chart', mapMulticlassChart);

  // ---- Phase 2: Identity & social ----
  console.log('\n=== Phase 2: Identity & social ===');
  await migrateCollection('eras', 'eras', mapEra, (id) => lookups.eras.add(id));
  await migrateCollection('users', 'users', mapUser, (id, d) => {
    lookups.users.add(id);
    if (Array.isArray(d.campaignIds) && d.campaignIds.length > 0) {
      lookups.userCampaigns[id] = d.campaignIds;
    }
  });
  await migrateCollection('campaigns', 'campaigns', mapCampaign, (id, d) => {
    lookups.campaigns.add(id);
    if (d.dmId) lookups.campaignDm[id] = { dmId: d.dmId, createdAt: d.createdAt || '' };
  });
  migrateCampaignMembers();

  // ---- Phase 3: Wiki & lore ----
  console.log('\n=== Phase 3: Wiki & lore ===');
  await migrateLore();

  // ---- Phase 4: Compendium ----
  console.log('\n=== Phase 4: Compendium ===');
  await migrateCollection('classes', 'classes', mapClass, (id) => lookups.classes.add(id));
  await migrateCollection('subclasses', 'subclasses', mapSubclass, (id) => lookups.subclasses.add(id));
  await migrateCollection('items', 'items', mapItem);
  await migrateCollection('feats', 'feats', mapFeat);
  await migrateCollection('spells', 'spells', mapSpell);
  await migrateCollection('features', 'features', mapFeature);
  await migrateCollection('scalingColumns', 'scaling_columns', mapScaling);

  // ---- Phase 5: Characters ----
  console.log('\n=== Phase 5: Characters ===');
  await migrateCharacters();

  console.log(`\nMigration finished in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  sqlite.close();
}

run().catch((err) => {
  console.error(err);
  try { sqlite.close(); } catch {}
  process.exit(1);
});
