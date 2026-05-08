// Server-side adapters that match the `fetchCollection` / `fetchDocument`
// signatures from `src/lib/d1.ts` but talk to the worker through
// `executeD1QueryInternal` instead of the client-only `/api/d1/query` proxy
// (which requires a Firebase JWT).
//
// Pass `SERVER_EXPORT_FETCHERS` to `exportClassSemantic(classId, fetchers)`
// from a Vercel function so the same shaping code runs server-side.
//
// The collection-name → table-name map is inlined here rather than imported
// from `src/lib/d1Tables.ts`. Vercel's serverless bundler did not reliably
// include the cross-folder src/ tree in this function in earlier attempts;
// duplicating ~50 string mappings is cheaper than chasing the bundling fix.
// Keep this in sync with `src/lib/d1Tables.ts` when tables are added.
import { executeD1QueryInternal } from "./d1-internal.js";

const D1_TABLE_MAP: Record<string, string> = {
  conditions: "status_conditions",
  spellcasting: "spellcasting_progressions",
  languageCategories: "language_categories",
  toolCategories: "tool_categories",
  weaponCategories: "weapon_categories",
  weaponProperties: "weapon_properties",
  armorCategories: "armor_categories",
  damageTypes: "damage_types",
  statuses: "status_conditions",
  conditionCategories: "condition_categories",
  standardMulticlassProgression: "multiclass_master_chart",
  attributes: "attributes",
  skills: "skills",
  tools: "tools",
  weapons: "weapons",
  armor: "armor",
  sources: "sources",
  spells: "spells",
  lore: "lore_articles",
  loreMetaCharacters: "lore_meta_characters",
  loreMetaLocations: "lore_meta_locations",
  loreMetaOrganizations: "lore_meta_organizations",
  loreMetaDeities: "lore_meta_deities",
  loreSecrets: "lore_secrets",
  loreArticleEras: "lore_article_eras",
  loreArticleCampaigns: "lore_article_campaigns",
  loreSecretEras: "lore_secret_eras",
  loreSecretCampaigns: "lore_secret_campaigns",
  loreArticleTags: "lore_article_tags",
  loreLinks: "lore_links",
  campaigns: "campaigns",
  items: "items",
  feats: "feats",
  features: "features",
  users: "users",
  eras: "eras",
  tagGroups: "tag_groups",
  tags: "tags",
  scalingColumns: "scaling_columns",
  uniqueOptionGroups: "unique_option_groups",
  uniqueOptionItems: "unique_option_items",
  spellcastingScalings: "spellcasting_progressions",
  pactMagicScalings: "spellcasting_progressions",
  spellsKnownScalings: "spellcasting_progressions",
  classes: "classes",
  subclasses: "subclasses",
  characters: "characters",
  characterProgression: "character_progression",
  characterSelections: "character_selections",
  characterInventory: "character_inventory",
  characterSpells: "character_spells",
  characterProficiencies: "character_proficiencies",
  campaignMembers: "campaign_members",
  systemMetadata: "system_metadata",
  maps: "maps",
  mapMarkers: "map_markers",
  mapHighlights: "map_highlights",
};

function getTableName(collectionName: string): string {
  return D1_TABLE_MAP[collectionName]
    ?? collectionName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Match the auto-parse list in src/lib/d1.ts:queryD1 so server-side rows have
// the same shape client-side ones do (already-parsed JSON columns).
const JSON_COLUMNS = new Set([
  "proficiencies", "spellcasting", "activities", "effects", "tags", "class_ids",
  "class_levels", "progression", "selections", "inventory", "spells", "meta_data",
  "classifications", "values", "levels", "option_ids", "fixed_ids", "category_ids",
  "optionIds", "fixedIds", "categoryIds", "prerequisites_items", "tag_ids", "tagIds",
  "properties", "advancements", "uses_recovery",
]);

function autoParseJsonColumns(row: any): any {
  if (!row || typeof row !== "object") return row;
  const out: any = { ...row };
  for (const field of JSON_COLUMNS) {
    if (typeof out[field] === "string") {
      try { out[field] = JSON.parse(out[field]); } catch { /* leave as-is */ }
    }
  }
  return out;
}

interface CollectionOptions {
  select?: string;
  where?: string;
  params?: any[];
  orderBy?: string;
}

export async function serverFetchCollection<T>(
  collectionName: string,
  options: CollectionOptions = {},
): Promise<T[]> {
  const tableName = getTableName(collectionName);
  let sql = `SELECT ${options.select || "*"} FROM ${tableName}`;
  if (options.where) sql += ` WHERE ${options.where}`;
  if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;

  const response = await executeD1QueryInternal({ sql, params: options.params });
  const rows = (response.results || []) as any[];
  return rows.map(autoParseJsonColumns) as T[];
}

export async function serverFetchDocument<T>(
  collectionName: string,
  id: string,
): Promise<T | null> {
  const tableName = getTableName(collectionName);
  const sql = `SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`;
  const response = await executeD1QueryInternal({ sql, params: [id] });
  const rows = (response.results || []) as any[];
  return rows[0] ? (autoParseJsonColumns(rows[0]) as T) : null;
}

export const SERVER_EXPORT_FETCHERS = {
  fetchCollection: serverFetchCollection,
  fetchDocument: serverFetchDocument,
};
