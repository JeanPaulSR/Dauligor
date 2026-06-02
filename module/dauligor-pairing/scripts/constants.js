export const MODULE_ID = "dauligor-pairing";

export const SETTINGS = {
  defaultImportUrl: "default-import-url",
  defaultClassCatalogUrl: "default-class-catalog-url",
  defaultClassFolderPath: "default-class-folder-path",
  apiEndpointMode: "api-endpoint-mode",
  // World-scoped shared ability-score roll pool used by the Character
  // Creator. Holds an array of roll-set entries (see ability-roll-pool.js).
  // Scope "world" so every connected client sees the same pool; non-GM
  // players contribute via a socketlib GM relay.
  abilityRollPool: "ability-roll-pool"
};

export const SAMPLE_FILE = "modules/dauligor-pairing/data/sample-character.json";
export const CLASS_CATALOG_FILE = "modules/dauligor-pairing/data/classes/catalog.json";
export const SOURCE_LIBRARY_FILE = "modules/dauligor-pairing/data/sources/catalog.json";
export const IMPORTER_TEMPLATE = "modules/dauligor-pairing/templates/importer-shell.hbs";
export const CLASS_BROWSER_TEMPLATE = "modules/dauligor-pairing/templates/class-browser-shell.hbs";
export const CLASS_OPTIONS_TEMPLATE = "modules/dauligor-pairing/templates/class-options-shell.hbs";
export const SPELL_PREPARATION_TEMPLATE = "modules/dauligor-pairing/templates/spell-preparation-shell.hbs";
export const FEATURE_MANAGER_TEMPLATE = "modules/dauligor-pairing/templates/feature-manager-shell.hbs";
export const DAULIGOR_SPELLS_TAB_TEMPLATE = "modules/dauligor-pairing/templates/dauligor-spells-tab.hbs";
export const CHARACTER_CREATOR_TEMPLATE = "modules/dauligor-pairing/templates/character-creator-shell.hbs";
export const LAUNCHER_TEMPLATE = "modules/dauligor-pairing/templates/launcher-shell.hbs";
