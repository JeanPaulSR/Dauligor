// Standalone collection-name → table-name map. Lives in its own file (with no
// imports) so it can be shared between the client-side d1.ts and server-side
// API code that talks to the worker via executeD1QueryInternal.
//
// Keep this list in sync with the actual D1 schema. When you add a new table:
// pick a camelCase collection alias here, point it at the snake_case table.
export const D1_TABLE_MAP: Record<string, string> = {
  conditions: 'status_conditions',
  spellcasting: 'spellcasting_progressions',
  languageCategories: 'language_categories',
  toolCategories: 'tool_categories',
  weaponCategories: 'weapon_categories',
  weaponProperties: 'weapon_properties',
  armorCategories: 'armor_categories',
  consumableCategories: 'consumable_categories',
  lootCategories: 'loot_categories',
  itemProperties: 'item_properties',
  // Admin-managed consumable second-axis taxonomies (Foundry
  // system.type.subtype) — drive the Ammunition Type / Poison Type
  // dropdowns on the consumable Details tab. Migration 20260607-1300.
  ammunitionTypes: 'ammunition_types',
  poisonTypes: 'poison_types',
  damageTypes: 'damage_types',
  statuses: 'status_conditions',
  conditionCategories: 'condition_categories',
  standardMulticlassProgression: 'multiclass_master_chart',
  // Pact magic master chart shares the generic master-chart table; stored under a
  // distinct row id ('pact') alongside the standard chart ('master').
  pactMasterChart: 'multiclass_master_chart',
  attributes: 'attributes',
  skills: 'skills',
  tools: 'tools',
  weapons: 'weapons',
  armor: 'armor',
  sources: 'sources',
  spells: 'spells',
  lore: 'lore_articles',
  loreMetaCharacters: 'lore_meta_characters',
  loreMetaLocations: 'lore_meta_locations',
  loreMetaOrganizations: 'lore_meta_organizations',
  loreMetaDeities: 'lore_meta_deities',
  loreArticleEras: 'lore_article_eras',
  loreArticleCampaigns: 'lore_article_campaigns',
  loreArticleTags: 'lore_article_tags',
  loreLinks: 'lore_links',
  campaigns: 'campaigns',
  items: 'items',
  // Catalog/template container recipe — a container item's contents as
  // references to catalog items (+ qty) or custom one-offs. Migration
  // 20260608-1200. Distinct from `character_inventory` (per-character
  // instances); the recipe is expanded into instances on a character.
  containerContents: 'container_contents',
  feats: 'feats',
  // Backgrounds + Species — promoted out of the `feats` table into their own
  // tables (migration 20260601-1200). camelCase columns; "species" is the 2024
  // name for "race" (the Foundry export type stays "race").
  backgrounds: 'backgrounds',
  species: 'species',
  // Background features — the special feature(s) a background grants
  // (migration 20260601-1400). Dedicated content type, granted via ItemGrant.
  backgroundFeatures: 'background_features',
  // speciesFeatures (species_features) retired — consolidated into species_options.
  // Species options — a reusable racial-trait library (Darkvision, Powerful
  // Build, …) attached to species via species.speciesOptionIds and granted as
  // features on export (migration 20260603-1600).
  speciesOptions: 'species_options',
  // Admin-managed taxonomy that groups feats into player-facing
  // buckets (General / Fighting Style / Epic Boon / Origin / …).
  // Authored via /admin/feat-categories; feats reference rows here
  // via the `feat_category_id` column added in migration
  // 20260526-2330.
  featCategories: 'feat_categories',
  // dnd5e v5 Bastion facilities (2024 DMG). Separate table from items
  // — distinct shape (orders/progress/trade/craft/defenders/hirelings)
  // + smaller catalog. Migration 20260526-2000.
  facilities: 'facilities',
  features: 'features',
  users: 'users',
  eras: 'eras',
  tagGroups: 'tag_groups',
  tags: 'tags',
  scalingColumns: 'scaling_columns',
  uniqueOptionGroups: 'unique_option_groups',
  uniqueOptionItems: 'unique_option_items',
  spellcastingScalings: 'spellcasting_progressions',
  pactMagicScalings: 'spellcasting_progressions',
  spellsKnownScalings: 'spellcasting_progressions',
  classes: 'classes',
  subclasses: 'subclasses',
  // classSpellLists table dropped in phase 4.6 — spell-list curation
  // is rule-routed via spell_rules.manual_spells / manual_exclusions
  // and resolved at request time by `src/lib/spellListResolver.ts`.
  spellRules: 'spell_rules',
  spellRuleApplications: 'spell_rule_applications',
  characters: 'characters',
  characterProgression: 'character_progression',
  characterSelections: 'character_selections',
  characterInventory: 'character_inventory',
  characterSpells: 'character_spells',
  characterSpellListExtensions: 'character_spell_list_extensions',
  characterProficiencies: 'character_proficiencies',
  campaignMembers: 'campaign_members',
  // Per-campaign homepage layout (ordered content blocks). Migration
  // 20260529-1700. When a campaign has blocks, they replace the default
  // Home body for its members.
  campaignHomeBlocks: 'campaign_home_blocks',
  systemMetadata: 'system_metadata',
  maps: 'maps',
  mapMarkers: 'map_markers',
  mapHighlights: 'map_highlights',
  // System pages — a site-consistent, reference-addressable glossary article
  // type (Conditions, Skills, Magic, homebrew), distinct from lore_articles.
  // The page `identifier` doubles as the `&`-reference kind. Migration
  // 20260529-1500.
  systemPages: 'system_pages',
  systemPageEntries: 'system_page_entries',
};

export function getTableName(collectionName: string): string {
  if (D1_TABLE_MAP[collectionName]) return D1_TABLE_MAP[collectionName];
  // Fallback: naive camelCase → snake_case (matches the pre-extract behavior).
  return collectionName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
