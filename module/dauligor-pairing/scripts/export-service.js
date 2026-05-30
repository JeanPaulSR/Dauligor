import { MODULE_ID } from "./constants.js";
import { buildDocumentEnvelope, chooseDownload, downloadJson, getCleanSource, log, notifyInfo, notifyWarn } from "./utils.js";

function summarizeWorld() {
  const actors = Array.from(game.actors ?? []);
  const items = Array.from(game.items ?? []);
  const journals = Array.from(game.journal ?? []);
  const tables = Array.from(game.tables ?? []);

  return {
    actors: {
      characters: actors.filter((it) => it.type === "character").length,
      npcs: actors.filter((it) => it.type === "npc").length,
      other: actors.filter((it) => !["character", "npc"].includes(it.type)).length
    },
    items: {
      classes: items.filter((it) => it.type === "class").length,
      subclasses: items.filter((it) => it.type === "subclass").length,
      feats: items.filter((it) => it.type === "feat").length,
      spells: items.filter((it) => it.type === "spell").length,
      inventory: items.filter((it) => ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"].includes(it.type)).length,
      other: items.filter((it) => !["class", "subclass", "feat", "spell", "weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"].includes(it.type)).length
    },
    journals: journals.length,
    rollTables: tables.length
  };
}

export async function exportDocument(document) {
  if (!document) {
    notifyWarn("No document was selected to export.");
    return;
  }

  const envelope = buildDocumentEnvelope(document);
  log("Prepared document export", envelope);
  notifyInfo(`Prepared "${document.name}" for export. See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: `Export ${document.documentName}`,
    name: document.name
  });

  if (shouldDownload) downloadJson(envelope, `${document.documentName}-${document.name}`);
}

export function buildResearchBundle(document) {
  if (!document) return null;

  const envelope = buildDocumentEnvelope(document);
  const source = envelope.source;

  return {
    kind: "dauligor.research-bundle.v1",
    ...envelope,
    sourceTracking: collectInterestingFlags(source.flags),
    analysis: buildDocumentAnalysis(document, source)
  };
}

export async function exportResearchBundle(document) {
  if (!document) {
    notifyWarn("No document was selected to export.");
    return;
  }

  const bundle = buildResearchBundle(document);
  log("Prepared research bundle", bundle);
  notifyInfo(`Prepared research bundle for "${document.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: `Export ${document.documentName} Research Bundle`,
    name: `${document.name} research bundle`
  });

  if (shouldDownload) downloadJson(bundle, `${document.documentName}-${document.name}-research`);
}

export function buildWorldSnapshot() {
  const actors = Array.from(game.actors ?? []);
  const items = Array.from(game.items ?? []);
  const journals = Array.from(game.journal ?? []);
  const tables = Array.from(game.tables ?? []);

  return {
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null
    },
    summary: summarizeWorld(),
    actors: {
      characters: actors.filter((it) => it.type === "character").map(getCleanSource),
      npcs: actors.filter((it) => it.type === "npc").map(getCleanSource),
      other: actors.filter((it) => !["character", "npc"].includes(it.type)).map(getCleanSource)
    },
    items: {
      classes: items.filter((it) => it.type === "class").map(getCleanSource),
      subclasses: items.filter((it) => it.type === "subclass").map(getCleanSource),
      feats: items.filter((it) => it.type === "feat").map(getCleanSource),
      spells: items.filter((it) => it.type === "spell").map(getCleanSource),
      inventory: items.filter((it) => ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"].includes(it.type)).map(getCleanSource),
      other: items.filter((it) => !["class", "subclass", "feat", "spell", "weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"].includes(it.type)).map(getCleanSource)
    },
    journals: journals.map(getCleanSource),
    rollTables: tables.map(getCleanSource)
  };
}

export async function exportWorldSnapshot() {
  const snapshot = buildWorldSnapshot();
  log("Prepared world snapshot", snapshot);
  notifyInfo("Prepared a world snapshot export. See console for the full object.");

  const shouldDownload = await chooseDownload({
    title: "Export World Snapshot",
    name: game.world?.title ?? "world"
  });

  if (shouldDownload) downloadJson(snapshot, `${game.world?.title ?? "world"}-snapshot`);
}

export function buildWorldResearchSnapshot() {
  const actors = Array.from(game.actors ?? []);
  const items = Array.from(game.items ?? []);
  const journals = Array.from(game.journal ?? []);
  const tables = Array.from(game.tables ?? []);

  return {
    kind: "dauligor.world-research-snapshot.v1",
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null
    },
    summary: {
      ...summarizeWorld(),
      activities: {
        itemsWithActivities: items.filter((it) => Object.keys(it.toObject().system?.activities ?? {}).length > 0).length,
        totalActivities: items.reduce((count, it) => count + Object.keys(it.toObject().system?.activities ?? {}).length, 0)
      },
      advancements: {
        itemsWithAdvancement: items.filter((it) => Array.isArray(it.toObject().system?.advancement) && it.toObject().system.advancement.length > 0).length,
        totalAdvancements: items.reduce((count, it) => count + ((it.toObject().system?.advancement ?? []).length), 0)
      },
      effects: {
        actorEffects: actors.reduce((count, actor) => count + Array.from(actor.effects ?? []).length, 0),
        itemEffects: items.reduce((count, item) => count + Array.from(item.effects ?? []).length, 0)
      }
    },
    docs: {
      actors: actors.map((actor) => buildResearchBundle(actor)),
      items: items.map((item) => buildResearchBundle(item)),
      journals: journals.map((journal) => buildResearchBundle(journal)),
      rollTables: tables.map((table) => buildResearchBundle(table))
    }
  };
}

export async function exportWorldResearchSnapshot() {
  const snapshot = buildWorldResearchSnapshot();
  log("Prepared world research snapshot", snapshot);
  notifyInfo("Prepared a world research snapshot. See console for the full object.");

  const shouldDownload = await chooseDownload({
    title: "Export World Research Snapshot",
    name: `${game.world?.title ?? "world"} research snapshot`
  });

  if (shouldDownload) downloadJson(snapshot, `${game.world?.title ?? "world"}-research-snapshot`);
}

function getFolderPath(folder) {
  if (!folder) return "";

  const parts = [];
  let current = folder;
  while (current) {
    parts.unshift(current.name ?? "");
    current = current.folder ?? null;
  }

  return parts.filter(Boolean).join("/");
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectDescendantFolderIds(folder) {
  const ids = new Set();
  const queue = [folder];

  while (queue.length) {
    const current = queue.shift();
    if (!current?.id || ids.has(current.id)) continue;
    ids.add(current.id);

    const children = Array.from(game.folders ?? []).filter((candidate) =>
      candidate.type === folder.type
      && (candidate.folder?.id ?? null) === current.id
    );

    queue.push(...children);
  }

  return ids;
}

function summarizeSpellCounts(spells) {
  const byLevel = {};
  const bySchool = {};
  const byMethod = {};
  let totalActivities = 0;
  let totalEffects = 0;

  for (const spell of spells) {
    const source = spell.toObject();
    const level = Number(source.system?.level ?? 0);
    const school = String(source.system?.school ?? "").trim() || "unknown";
    const method = String(source.system?.method ?? "").trim() || "unknown";
    const activityCount = Object.keys(source.system?.activities ?? {}).length;
    const effectCount = Array.isArray(source.effects) ? source.effects.length : 0;

    byLevel[level] = (byLevel[level] ?? 0) + 1;
    bySchool[school] = (bySchool[school] ?? 0) + 1;
    byMethod[method] = (byMethod[method] ?? 0) + 1;
    totalActivities += activityCount;
    totalEffects += effectCount;
  }

  return {
    spellCount: spells.length,
    byLevel,
    bySchool,
    byMethod,
    totalActivities,
    totalEffects
  };
}

function buildSpellExportEntry(spell, rootFolder) {
  const source = getCleanSource(spell);
  const folderPath = spell.folder ? getFolderPath(spell.folder) : "";
  const activityEntries = Object.entries(source.system?.activities ?? {});

  return {
    id: spell.id,
    uuid: spell.uuid,
    name: spell.name,
    type: spell.type,
    folderId: spell.folder?.id ?? null,
    folderPath,
    relativeFolderPath: folderPath && rootFolder
      ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
      : "",
    source: {
      book: source.system?.source?.book ?? "",
      page: source.system?.source?.page ?? null,
      rules: source.system?.source?.rules ?? ""
    },
    spellSummary: {
      level: source.system?.level ?? 0,
      school: source.system?.school ?? "",
      method: source.system?.method ?? "",
      prepared: source.system?.prepared ?? 0,
      ability: source.system?.ability ?? "",
      sourceItem: source.system?.sourceItem ?? "",
      properties: Array.from(source.system?.properties ?? []),
      materialSummary: {
        value: source.system?.materials?.value ?? "",
        cost: source.system?.materials?.cost ?? 0,
        consumed: source.system?.materials?.consumed ?? false,
        supply: source.system?.materials?.supply ?? 0
      },
      activation: source.system?.activation ?? {},
      range: source.system?.range ?? {},
      target: source.system?.target ?? {},
      duration: source.system?.duration ?? {},
      activityCount: activityEntries.length,
      effectCount: Array.isArray(source.effects) ? source.effects.length : 0
    },
    sourceDocument: source
  };
}

export function buildSpellFolderExport(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const spells = Array.from(game.items ?? []).filter((item) =>
    item.type === "spell"
    && includedFolderIds.has(item.folder?.id ?? "")
  );

  const folderPath = getFolderPath(folder);

  return {
    kind: "dauligor.foundry-spell-folder-export.v1",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null
    },
    folder: {
      id: folder.id,
      uuid: folder.uuid ?? null,
      name: folder.name,
      type: folder.type,
      path: folderPath,
      includeSubfolders,
      includedFolderIds: Array.from(includedFolderIds),
      parentId: folder.folder?.id ?? null
    },
    summary: summarizeSpellCounts(spells),
    spells: spells
      .slice()
      .sort((a, b) => {
        const aLevel = Number(a.system?.level ?? 0);
        const bLevel = Number(b.system?.level ?? 0);
        if (aLevel !== bLevel) return aLevel - bLevel;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      })
      .map((spell) => buildSpellExportEntry(spell, folder))
  };
}

export async function exportSpellFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") {
    notifyWarn("Select an Item folder before exporting spells.");
    return;
  }

  const payload = buildSpellFolderExport(folder, { includeSubfolders });
  const spellCount = payload?.summary?.spellCount ?? 0;
  if (!spellCount) {
    notifyWarn(`No spell items were found in "${folder.name}".`);
    return;
  }

  log("Prepared spell folder export", payload);
  notifyInfo(`Prepared ${spellCount} spells from "${folder.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: "Export Spell Folder",
    name: `${folder.name} (${spellCount} spells)`
  });

  if (shouldDownload) downloadJson(payload, `${folder.name}-spells-export`);
}

// ─── Feat folder export ────────────────────────────────────────────────
//
// Mirrors the spell folder export above. Feats are dnd5e v5 items of
// type "feat" (covers class features, race features, background features,
// general feats, and Dauligor's class-feature variants). The export
// payload follows the same envelope shape as
// `dauligor.foundry-spell-folder-export.v1` so a future app-side batch
// importer can route on `kind` and reuse the per-folder traversal.
//
// Contract: see `module/dauligor-pairing/docs/feat-folder-export-contract.md`.

function summarizeFeatCounts(feats) {
  const byType = {};
  const bySubtype = {};
  const flags = {
    repeatable: 0,
    hasUses: 0,
    hasActivities: 0,
    hasEffects: 0,
    hasPrereqs: 0,
  };
  let totalActivities = 0;
  let totalEffects = 0;

  for (const feat of feats) {
    const source = feat.toObject();
    const featType = String(source.system?.type?.value ?? "").trim() || "unknown";
    const featSubtype = String(source.system?.type?.subtype ?? "").trim();
    const activityCount = Object.keys(source.system?.activities ?? {}).length;
    const effectCount = Array.isArray(source.effects) ? source.effects.length : 0;
    const hasUses = !!(source.system?.uses?.max || source.system?.uses?.spent);
    const hasPrereqs = !!(
      String(source.system?.requirements ?? "").trim()
      || Object.keys(source.system?.prerequisites ?? {}).length > 0
    );
    const isRepeatable = Array.isArray(source.system?.properties)
      && source.system.properties.includes("repeatable");

    byType[featType] = (byType[featType] ?? 0) + 1;
    if (featSubtype) bySubtype[featSubtype] = (bySubtype[featSubtype] ?? 0) + 1;
    if (isRepeatable) flags.repeatable++;
    if (hasUses) flags.hasUses++;
    if (activityCount > 0) flags.hasActivities++;
    if (effectCount > 0) flags.hasEffects++;
    if (hasPrereqs) flags.hasPrereqs++;
    totalActivities += activityCount;
    totalEffects += effectCount;
  }

  return {
    featCount: feats.length,
    byType,
    bySubtype,
    flags,
    totalActivities,
    totalEffects,
  };
}

function buildFeatExportEntry(feat, rootFolder) {
  const source = getCleanSource(feat);
  const folderPath = feat.folder ? getFolderPath(feat.folder) : "";
  const activityEntries = Object.entries(source.system?.activities ?? {});
  const properties = Array.from(source.system?.properties ?? []);

  return {
    id: feat.id,
    uuid: feat.uuid,
    name: feat.name,
    type: feat.type,                                  // always "feat" for this builder
    folderId: feat.folder?.id ?? null,
    folderPath,
    relativeFolderPath: folderPath && rootFolder
      ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
      : "",
    source: {
      book: source.system?.source?.book ?? "",
      page: source.system?.source?.page ?? null,
      rules: source.system?.source?.rules ?? "",
    },
    featSummary: {
      // Foundry dnd5e v5 splits feat categorization across type.value
      // ("feat" / "class" / "race" / "background") and type.subtype
      // (e.g. "fighting-style", "metamagic"). Preserve both verbatim
      // so app-side import can route them into the right buckets.
      featType: source.system?.type?.value ?? "",
      featSubtype: source.system?.type?.subtype ?? "",
      identifier: source.system?.identifier ?? "",
      requirements: String(source.system?.requirements ?? ""),  // human-readable prereq text
      properties,
      repeatable: properties.includes("repeatable"),
      uses: source.system?.uses ?? {},                          // { max, spent, recovery, ... }
      activation: source.system?.activation ?? {},
      activityCount: activityEntries.length,
      effectCount: Array.isArray(source.effects) ? source.effects.length : 0,
    },
    sourceDocument: source,
  };
}

export function buildFeatFolderExport(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const feats = Array.from(game.items ?? []).filter((item) =>
    item.type === "feat"
    && includedFolderIds.has(item.folder?.id ?? "")
  );

  const folderPath = getFolderPath(folder);

  return {
    kind: "dauligor.foundry-feat-folder-export.v1",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null,
    },
    folder: {
      id: folder.id,
      uuid: folder.uuid ?? null,
      name: folder.name,
      type: folder.type,
      path: folderPath,
      includeSubfolders,
      includedFolderIds: Array.from(includedFolderIds),
      parentId: folder.folder?.id ?? null,
    },
    summary: summarizeFeatCounts(feats),
    feats: feats
      .slice()
      .sort((a, b) => {
        // Group by feat type first (class features cluster together),
        // then by name within each type. Mirrors the spell sort's
        // "level grouping then alphabetical" idea.
        const aType = String(a.system?.type?.value ?? "");
        const bType = String(b.system?.type?.value ?? "");
        if (aType !== bType) return aType.localeCompare(bType);
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      })
      .map((feat) => buildFeatExportEntry(feat, folder)),
  };
}

export async function exportFeatFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") {
    notifyWarn("Select an Item folder before exporting feats.");
    return;
  }

  const payload = buildFeatFolderExport(folder, { includeSubfolders });
  const featCount = payload?.summary?.featCount ?? 0;
  if (!featCount) {
    notifyWarn(`No feat items were found in "${folder.name}".`);
    return;
  }

  log("Prepared feat folder export", payload);
  notifyInfo(`Prepared ${featCount} feats from "${folder.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: "Export Feat Folder",
    name: `${folder.name} (${featCount} feats)`,
  });

  if (shouldDownload) downloadJson(payload, `${folder.name}-feats-export`);
}

// ─── Background + Race folder exports ───────────────────────────────
//
// Backgrounds and races are feat-family Item documents (`type:"background"`
// / `"race"`). The Dauligor app currently stores them in the `feats` table
// with no dedicated columns for their type-specific `system` fields, so the
// app side (compendium editors) needs the REAL shipped Foundry shape to
// design that table. EXPORT-FIRST: these exporters capture real Foundry
// background/race items so the app can model the exact shapes before the
// import round-trip is wired.
//
// Mirrors the feat folder export. Each entry carries the full
// `sourceDocument` (the authoritative shape evidence) plus a type-specific
// summary surfacing the fields the app must add columns for:
//   - background: system.startingEquipment[] (EquipmentEntryData tree),
//                 system.wealth (formula), advancement map
//   - race:       system.movement, system.senses, system.type
//                 (CreatureTypeField), advancement map

function buildFolderExportHeader(folder, kind, includeSubfolders, includedFolderIds, folderPath) {
  return {
    kind,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null,
    },
    folder: {
      id: folder.id,
      uuid: folder.uuid ?? null,
      name: folder.name,
      type: folder.type,
      path: folderPath,
      includeSubfolders,
      includedFolderIds: Array.from(includedFolderIds),
      parentId: folder.folder?.id ?? null,
    },
  };
}

function buildFeatFamilyEntryBase(doc, rootFolder) {
  const source = getCleanSource(doc);
  const folderPath = doc.folder ? getFolderPath(doc.folder) : "";
  return {
    entry: {
      id: doc.id,
      uuid: doc.uuid,
      name: doc.name,
      type: doc.type,                                   // "background" / "race"
      folderId: doc.folder?.id ?? null,
      folderPath,
      relativeFolderPath: folderPath && rootFolder
        ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
        : "",
      source: {
        book: source.system?.source?.book ?? "",
        page: source.system?.source?.page ?? null,
        rules: source.system?.source?.rules ?? "",
      },
    },
    source,
  };
}

function buildBackgroundExportEntry(doc, rootFolder) {
  const { entry, source } = buildFeatFamilyEntryBase(doc, rootFolder);
  const startingEquipment = Array.isArray(source.system?.startingEquipment)
    ? source.system.startingEquipment
    : [];
  return {
    ...entry,
    backgroundSummary: {
      identifier: source.system?.identifier ?? "",
      // The two StartingEquipmentTemplate fields the feats table can't hold yet.
      startingEquipment,                               // EquipmentEntryData[]
      startingEquipmentCount: startingEquipment.length,
      wealth: source.system?.wealth ?? "",             // starting-gold formula
      advancementKeys: Object.keys(source.system?.advancement ?? {}),
      advancementTypes: Object.values(source.system?.advancement ?? {}).map((a) => a?.type ?? "unknown"),
      hasDescription: !!String(source.system?.description?.value ?? "").trim(),
    },
    sourceDocument: source,
  };
}

function buildRaceExportEntry(doc, rootFolder) {
  const { entry, source } = buildFeatFamilyEntryBase(doc, rootFolder);
  return {
    ...entry,
    raceSummary: {
      identifier: source.system?.identifier ?? "",
      // The dnd5e RaceData fields beyond the feat machinery.
      movement: source.system?.movement ?? {},         // {walk,fly,swim,climb,burrow,hover,units}
      senses: source.system?.senses ?? {},             // {darkvision,blindsight,tremorsense,truesight,units,special}
      type: source.system?.type ?? {},                 // CreatureTypeField {value,subtype,swarm,custom}
      advancementKeys: Object.keys(source.system?.advancement ?? {}),
      advancementTypes: Object.values(source.system?.advancement ?? {}).map((a) => a?.type ?? "unknown"),
      hasDescription: !!String(source.system?.description?.value ?? "").trim(),
    },
    sourceDocument: source,
  };
}

function summarizeBackgroundCounts(docs) {
  let withStartingEquipment = 0;
  let withWealth = 0;
  let withAdvancements = 0;
  for (const d of docs) {
    const s = d.toObject().system ?? {};
    if (Array.isArray(s.startingEquipment) && s.startingEquipment.length) withStartingEquipment++;
    if (String(s.wealth ?? "").trim()) withWealth++;
    if (Object.keys(s.advancement ?? {}).length) withAdvancements++;
  }
  return { backgroundCount: docs.length, withStartingEquipment, withWealth, withAdvancements };
}

function summarizeRaceCounts(docs) {
  const byCreatureType = {};
  let withMovement = 0;
  let withSenses = 0;
  let withAdvancements = 0;
  for (const d of docs) {
    const s = d.toObject().system ?? {};
    const ct = String(s.type?.value ?? "").trim() || "unknown";
    byCreatureType[ct] = (byCreatureType[ct] ?? 0) + 1;
    if (s.movement && Object.values(s.movement).some((v) => v != null && v !== false && v !== "")) withMovement++;
    if (s.senses && Object.values(s.senses).some((v) => v != null && v !== "")) withSenses++;
    if (Object.keys(s.advancement ?? {}).length) withAdvancements++;
  }
  return { raceCount: docs.length, byCreatureType, withMovement, withSenses, withAdvancements };
}

function buildFeatFamilyFolderExport(folder, { docType, kind, listKey, summarize, buildEntry, includeSubfolders = true }) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const docs = Array.from(game.items ?? []).filter((item) =>
    item.type === docType
    && includedFolderIds.has(item.folder?.id ?? "")
  );
  const folderPath = getFolderPath(folder);

  return {
    ...buildFolderExportHeader(folder, kind, includeSubfolders, includedFolderIds, folderPath),
    summary: summarize(docs),
    [listKey]: docs
      .slice()
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      .map((doc) => buildEntry(doc, folder)),
  };
}

export function buildBackgroundFolderExport(folder, { includeSubfolders = true } = {}) {
  return buildFeatFamilyFolderExport(folder, {
    docType: "background",
    kind: "dauligor.foundry-background-folder-export.v1",
    listKey: "backgrounds",
    summarize: summarizeBackgroundCounts,
    buildEntry: buildBackgroundExportEntry,
    includeSubfolders,
  });
}

export function buildRaceFolderExport(folder, { includeSubfolders = true } = {}) {
  return buildFeatFamilyFolderExport(folder, {
    docType: "race",
    kind: "dauligor.foundry-race-folder-export.v1",
    listKey: "races",
    summarize: summarizeRaceCounts,
    buildEntry: buildRaceExportEntry,
    includeSubfolders,
  });
}

export async function exportBackgroundFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") {
    notifyWarn("Select an Item folder before exporting backgrounds.");
    return;
  }
  const payload = buildBackgroundFolderExport(folder, { includeSubfolders });
  const count = payload?.summary?.backgroundCount ?? 0;
  if (!count) {
    notifyWarn(`No background items were found in "${folder.name}".`);
    return;
  }
  log("Prepared background folder export", payload);
  notifyInfo(`Prepared ${count} backgrounds from "${folder.name}". See console for the full object.`);
  const shouldDownload = await chooseDownload({
    title: "Export Background Folder",
    name: `${folder.name} (${count} backgrounds)`,
  });
  if (shouldDownload) downloadJson(payload, `${folder.name}-backgrounds-export`);
}

export async function exportRaceFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") {
    notifyWarn("Select an Item folder before exporting races.");
    return;
  }
  const payload = buildRaceFolderExport(folder, { includeSubfolders });
  const count = payload?.summary?.raceCount ?? 0;
  if (!count) {
    notifyWarn(`No race items were found in "${folder.name}".`);
    return;
  }
  log("Prepared race folder export", payload);
  notifyInfo(`Prepared ${count} races from "${folder.name}". See console for the full object.`);
  const shouldDownload = await chooseDownload({
    title: "Export Race Folder",
    name: `${folder.name} (${count} races)`,
  });
  if (shouldDownload) downloadJson(payload, `${folder.name}-races-export`);
}

// ─── Item folder export ─────────────────────────────────────────────
//
// Mirrors the spell + feat folder exports but covers the seven dnd5e v5
// Item document types that represent "physical things": weapon /
// equipment / consumable / tool / loot / container / backpack.
//
// Deliberately EXCLUDED:
//   - `feat` / `spell` — own exporters (richer summary shapes)
//   - `class` / `subclass` / `race` / `background` — own document concepts;
//     the existing per-class exporter handles those
//   - `facility` — new dnd5e 2024 Bastion documents; no Dauligor table
//     yet, so excluded to keep the payload focused
//
// `equipment` is a deliberately fuzzy bucket inside Foundry. A single
// `equipment` Item can be armor (system.type.value ∈
// light/medium/heavy/shield/natural) OR generic worn gear (clothing /
// trinket / wondrous / vehicle). The exporter preserves both
// `item.type` (document-level) and `system.type.value` (subcategory)
// so the downstream importer can route correctly.

const ITEM_FOLDER_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

/**
 * Read `system.weight` defensively. dnd5e v5 wraps weight as
 * `{ value: 1, units: "lb" }` but older items (and some legacy
 * compendium content) still carry a flat number. Returns 0 when neither
 * shape is present so the summary aggregation can sum safely.
 */
function readItemWeight(system) {
  if (system == null) return 0;
  const raw = system.weight;
  if (raw == null) return 0;
  if (typeof raw === "object") return Number(raw.value ?? 0) || 0;
  return Number(raw) || 0;
}

function summarizeItemCounts(items) {
  // `byType` counts by Foundry document type (weapon / consumable / …)
  // — the routing key the downstream importer will switch on.
  const byType = {};
  // `bySubcategory` counts by `system.type.value` (light / simpleM /
  // potion / …) — the within-type discriminator, useful for spotting
  // armor-vs-clothing mixes inside the `equipment` bucket at a glance.
  const bySubcategory = {};
  // `byRarity` lets authors gauge "how much of this folder is magical
  // / uncommon / rare" before deciding which subset to import.
  const byRarity = {};
  // Flag rollups for the import workbench's hero stats. `magical` is
  // best-effort — dnd5e v5 uses two signals (`properties.includes('mgc')`
  // AND a non-`none` rarity) and we count an item as magical if either
  // is set, which matches how Plutonium tags magic items.
  const flags = {
    magical: 0,
    requiresAttunement: 0,
    container: 0,
    hasActivities: 0,
    hasEffects: 0,
  };
  let totalActivities = 0;
  let totalEffects = 0;
  let totalWeight = 0;
  let totalPriceGp = 0;

  for (const item of items) {
    const source = item.toObject();
    const system = source.system ?? {};
    const type = item.type;
    const subcategory = String(system.type?.value ?? "").trim();
    const rarity = String(system.rarity ?? "").trim() || "none";
    const attunement = String(system.attunement ?? "").trim();
    const isMagical = (Array.isArray(system.properties) && system.properties.includes("mgc")) || rarity !== "none";
    const activityCount = Object.keys(system.activities ?? {}).length;
    const effectCount = Array.isArray(source.effects) ? source.effects.length : 0;
    const weight = readItemWeight(system);
    const quantity = Number(system.quantity ?? 1) || 1;

    byType[type] = (byType[type] ?? 0) + 1;
    if (subcategory) bySubcategory[subcategory] = (bySubcategory[subcategory] ?? 0) + 1;
    byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
    if (isMagical) flags.magical++;
    if (attunement && attunement !== "none") flags.requiresAttunement++;
    if (type === "container" || type === "backpack") flags.container++;
    if (activityCount > 0) flags.hasActivities++;
    if (effectCount > 0) flags.hasEffects++;
    totalActivities += activityCount;
    totalEffects += effectCount;
    totalWeight += weight * quantity;
    // Price denomination is intentionally ignored in the gp rollup —
    // dnd5e v5 supports cp/sp/ep/gp/pp but the vast majority of
    // compendium items list everything in gp, and a denominated sum
    // would require a coin-rate constant nobody asked for. Authors who
    // need the breakdown can read it off `sourceDocument.system.price`.
    totalPriceGp += Number(system.price?.value ?? 0) * quantity;
  }

  return {
    itemCount: items.length,
    byType,
    bySubcategory,
    byRarity,
    flags,
    totalActivities,
    totalEffects,
    totalWeight,
    totalPriceGp,
  };
}

/**
 * Build the per-item summary projection. Same idea as `featSummary` —
 * a slim, type-aware preview the import workbench can render without
 * touching `sourceDocument`. Authors who need fidelity always have
 * the full `sourceDocument` to fall back on.
 *
 * The shape varies by `item.type` because the dnd5e v5 schema for each
 * item document is genuinely different — a weapon has damage parts a
 * potion doesn't, a container has a capacity object equipment doesn't,
 * etc. Each branch only emits fields that exist for that type.
 */
function buildItemSummary(item, source) {
  const system = source.system ?? {};
  const properties = Array.from(system.properties ?? []);

  const base = {
    itemType: item.type,
    itemCategory: String(system.type?.value ?? ""),
    itemSubcategory: String(system.type?.subtype ?? ""),
    identifier: String(system.identifier ?? ""),
    rarity: String(system.rarity ?? "").trim() || "none",
    quantity: Number(system.quantity ?? 1) || 1,
    weight: readItemWeight(system),
    price: {
      value: Number(system.price?.value ?? 0) || 0,
      denomination: String(system.price?.denomination ?? "gp"),
    },
    attunement: String(system.attunement ?? ""),
    equipped: !!system.equipped,
    identified: system.identified !== false,
    magical: properties.includes("mgc") || (String(system.rarity ?? "").trim() && system.rarity !== "none"),
    properties,
    uses: system.uses ?? {},
    activation: system.activation ?? {},
    activityCount: Object.keys(system.activities ?? {}).length,
    effectCount: Array.isArray(source.effects) ? source.effects.length : 0,
  };

  // Type-specific projections — each branch reads only fields the
  // dnd5e v5 schema documents for that item type.
  if (item.type === "weapon") {
    base.weapon = {
      // `system.damage.base` carries the canonical damage line in
      // dnd5e v5 (number of dice / die / bonus). Activities re-state
      // it on the per-activity attack roll.
      damage: system.damage ?? {},
      range: system.range ?? {},
      mastery: String(system.mastery ?? ""),
      magicalBonus: Number(system.magicalBonus ?? 0) || 0,
      ammunition: system.ammunition ?? null,
      proficient: system.proficient ?? null,
    };
  } else if (item.type === "equipment") {
    base.equipment = {
      // `system.armor.value` is the AC; `.dex` is the dex bonus cap
      // (null = no cap, 0 = no dex, 2 = medium-armor +2 cap, etc.).
      // `.magicalBonus` is the +N enchant.
      armor: system.armor ?? {},
      strength: system.strength ?? null,
      stealth: !!system.stealth,
      proficient: system.proficient ?? null,
    };
  } else if (item.type === "tool") {
    base.tool = {
      ability: String(system.ability ?? ""),
      proficient: system.proficient ?? null,
      bonus: String(system.bonus ?? ""),
    };
  } else if (item.type === "consumable") {
    base.consumable = {
      // Most consumable behavior is encoded in activities + uses;
      // surface the auto-destroy flag so the workbench can preview
      // "destroys on last use" without reaching into uses.
      destroyOnEmpty: !!system.uses?.autoDestroy,
    };
  } else if (item.type === "container" || item.type === "backpack") {
    base.container = {
      // `capacity` shape: { type: "weight" | "items" | "volume", value: <number> }
      capacity: system.capacity ?? {},
    };
  }
  // `loot` has no type-specific extras beyond the base block.

  return base;
}

function buildItemExportEntry(item, rootFolder) {
  const source = getCleanSource(item);
  const folderPath = item.folder ? getFolderPath(item.folder) : "";

  return {
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    type: item.type,
    folderId: item.folder?.id ?? null,
    folderPath,
    relativeFolderPath: folderPath && rootFolder
      ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
      : "",
    source: {
      book: source.system?.source?.book ?? "",
      page: source.system?.source?.page ?? null,
      rules: source.system?.source?.rules ?? "",
    },
    itemSummary: buildItemSummary(item, source),
    sourceDocument: source,
  };
}

export function buildItemFolderExport(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const items = Array.from(game.items ?? []).filter((item) =>
    ITEM_FOLDER_TYPES.includes(item.type)
    && includedFolderIds.has(item.folder?.id ?? "")
  );

  const folderPath = getFolderPath(folder);

  return {
    kind: "dauligor.foundry-item-folder-export.v1",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null,
    },
    folder: {
      id: folder.id,
      uuid: folder.uuid ?? null,
      name: folder.name,
      type: folder.type,
      path: folderPath,
      includeSubfolders,
      includedFolderIds: Array.from(includedFolderIds),
      parentId: folder.folder?.id ?? null,
    },
    summary: summarizeItemCounts(items),
    items: items
      .slice()
      .sort((a, b) => {
        // Cluster by Foundry item type first (all weapons together,
        // then all armor, etc.) and alphabetize within each cluster.
        // Mirrors the feat sort's "group by type then by name" idea.
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      })
      .map((item) => buildItemExportEntry(item, folder)),
  };
}

export async function exportItemFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Item") {
    notifyWarn("Select an Item folder before exporting items.");
    return;
  }

  const payload = buildItemFolderExport(folder, { includeSubfolders });
  const itemCount = payload?.summary?.itemCount ?? 0;
  if (!itemCount) {
    notifyWarn(`No item documents (weapon / equipment / consumable / tool / loot / container) were found in "${folder.name}".`);
    return;
  }

  log("Prepared item folder export", payload);
  notifyInfo(`Prepared ${itemCount} items from "${folder.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: "Export Item Folder",
    name: `${folder.name} (${itemCount} items)`,
  });

  if (shouldDownload) downloadJson(payload, `${folder.name}-items-export`);
}

// ─── Actor folder export ────────────────────────────────────────────
//
// Mirrors the spell + feat + item folder exports for the four dnd5e v5
// Actor document types: character / npc / vehicle / group.
//
// This is a **research-only** export today — Dauligor has no actor
// table, no NPC bestiary, no PC round-trip. The payload ships the full
// `sourceDocument` for fidelity plus a type-aware slim `actorSummary`
// projection a future workbench can render without thawing the whole
// document. When a Dauligor consumer lands (NPC bestiary, monster
// compendium, character round-trip, …), the schema decision drives
// the import; the exporter doesn't bake one in.
//
// `encounter` is intentionally NOT in the type list — it's an
// org-tool document Foundry uses to scaffold encounter setup, not a
// creature. If we want it later it's a one-line addition.

const ACTOR_FOLDER_TYPES = ["character", "npc", "vehicle", "group"];

/**
 * Strip a biography blob down to plain-text first-N-chars for the
 * slim summary. The full HTML is always present on `sourceDocument`;
 * this is just enough for an importer's row-preview line.
 */
function buildBiographySnippet(html, maxLen = 200) {
  const raw = String(html ?? "")
    .replace(/<[^>]*>/g, " ")        // strip HTML tags
    .replace(/\s+/g, " ")             // collapse whitespace
    .trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen).trim()}…`;
}

function summarizeActorCounts(actors) {
  // `byType` counts by actor document type — the routing key for a
  // future fan-out importer (NPC bestiary vs character round-trip).
  const byType = {};
  // CR histogram only fills from npc actors; cleared zeros are
  // dropped at the end so the JSON stays compact.
  const byCr = {};
  const flags = {
    hasInventory: 0,
    hasSpellbook: 0,
    hasClasses: 0,
    hasEffects: 0,
  };
  let totalEmbeddedItems = 0;
  let totalEffects = 0;

  for (const actor of actors) {
    const source = actor.toObject();
    const type = actor.type;
    const system = source.system ?? {};
    const itemsArray = Array.isArray(source.items) ? source.items : [];
    const effectsArray = Array.isArray(source.effects) ? source.effects : [];

    byType[type] = (byType[type] ?? 0) + 1;

    if (type === "npc") {
      // CR is stored as a number in dnd5e v5 (e.g. 0.125, 0.25, 1, 2, 10)
      // — keep the literal value so authors can spot 1/8 vs 1 at a glance.
      const cr = system.details?.cr;
      const crLabel = cr == null ? "unknown" : String(cr);
      byCr[crLabel] = (byCr[crLabel] ?? 0) + 1;
    }

    if (itemsArray.length > 0) flags.hasInventory++;
    if (itemsArray.some((it) => it.type === "spell")) flags.hasSpellbook++;
    if (itemsArray.some((it) => it.type === "class")) flags.hasClasses++;
    if (effectsArray.length > 0) flags.hasEffects++;

    totalEmbeddedItems += itemsArray.length;
    totalEffects += effectsArray.length;
  }

  // Sort CR keys numerically so the JSON object reads in CR order
  // when serialized (object key order is preserved in modern JS).
  const sortedByCr = {};
  Object.keys(byCr)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .forEach((key) => { sortedByCr[key] = byCr[key]; });

  return {
    actorCount: actors.length,
    byType,
    byCr: sortedByCr,
    flags,
    totalEmbeddedItems,
    totalEffects,
  };
}

/**
 * Per-actor slim projection. Shape varies by `actor.type` because a
 * character carries class progression a vehicle doesn't, an npc
 * carries CR + creature traits a character doesn't, etc. Each branch
 * only emits fields documented for that actor type by dnd5e v5.
 *
 * Always includes the common base fields so a generic preview row
 * (name + image + HP + AC + ability scores) works regardless of type.
 */
function buildActorSummary(actor, source) {
  const system = source.system ?? {};
  const itemsArray = Array.isArray(source.items) ? source.items : [];
  const effectsArray = Array.isArray(source.effects) ? source.effects : [];

  // HP — dnd5e v5 stores `value` (current), `max` (cap), and
  // `temp` (temporary). For npc / vehicle the max is the rolled HP;
  // for character it's derived from class + Con + bonuses.
  const hp = system.attributes?.hp ?? {};
  // AC — `value` is the resolved AC when the sheet computes it;
  // `flat` is an override; `formula` is the calculation string.
  const ac = system.attributes?.ac ?? {};

  const base = {
    actorType: actor.type,
    portraitImg: source.img ?? "",
    tokenImg: source.prototypeToken?.texture?.src ?? source.token?.img ?? "",
    alignment: String(system.details?.alignment ?? "").trim(),
    hp: {
      value: Number(hp.value ?? 0) || 0,
      max: Number(hp.max ?? 0) || 0,
      temp: Number(hp.temp ?? 0) || 0,
    },
    ac: {
      value: Number(ac.value ?? 0) || 0,
      flat: ac.flat ?? null,
      formula: String(ac.formula ?? ""),
      calc: String(ac.calc ?? ""),
    },
    abilities: {
      str: Number(system.abilities?.str?.value ?? 0) || 0,
      dex: Number(system.abilities?.dex?.value ?? 0) || 0,
      con: Number(system.abilities?.con?.value ?? 0) || 0,
      int: Number(system.abilities?.int?.value ?? 0) || 0,
      wis: Number(system.abilities?.wis?.value ?? 0) || 0,
      cha: Number(system.abilities?.cha?.value ?? 0) || 0,
    },
    biography: buildBiographySnippet(system.details?.biography?.value ?? system.description?.value ?? ""),
    itemCount: itemsArray.length,
    effectCount: effectsArray.length,
    // Inventory roll-up — embedded item type histogram. Skips the
    // full item dump (lives on sourceDocument.items) but lets a
    // preview line read "1 class, 12 spells, 3 weapons" at a glance.
    embeddedTypeCounts: itemsArray.reduce((acc, it) => {
      const key = String(it.type ?? "unknown");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };

  if (actor.type === "character") {
    // Pull class + subclass info from embedded items so a preview can
    // read "Fighter 5 / Wizard 3 (Diviner)" without parsing the
    // full inventory. dnd5e v5 stores classes as embedded items of
    // type "class" with system.levels; subclasses are separate items.
    const classItems = itemsArray.filter((it) => it.type === "class");
    const subclassItems = itemsArray.filter((it) => it.type === "subclass");
    const classes = classItems.map((cls) => {
      const subclass = subclassItems.find((sub) => sub.system?.classIdentifier === cls.system?.identifier);
      return {
        identifier: String(cls.system?.identifier ?? cls.name ?? ""),
        name: String(cls.name ?? ""),
        level: Number(cls.system?.levels ?? 0) || 0,
        subclass: subclass ? {
          identifier: String(subclass.system?.identifier ?? subclass.name ?? ""),
          name: String(subclass.name ?? ""),
        } : null,
      };
    });

    base.character = {
      race: String(system.details?.race ?? "").trim(),
      background: String(system.details?.background ?? "").trim(),
      classes,
      totalLevel: classes.reduce((sum, c) => sum + c.level, 0),
      xp: {
        value: Number(system.details?.xp?.value ?? 0) || 0,
        max: Number(system.details?.xp?.max ?? 0) || 0,
      },
      currency: {
        cp: Number(system.currency?.cp ?? 0) || 0,
        sp: Number(system.currency?.sp ?? 0) || 0,
        ep: Number(system.currency?.ep ?? 0) || 0,
        gp: Number(system.currency?.gp ?? 0) || 0,
        pp: Number(system.currency?.pp ?? 0) || 0,
      },
      // Spell slot snapshot — dnd5e v5 stores per-level slots as
      // system.spells.spell1, spell2, etc., plus pact. We surface
      // only `value`/`max` per slot level so the preview is compact.
      spellSlots: extractSpellSlotSummary(system.spells ?? {}),
    };
  } else if (actor.type === "npc") {
    base.npc = {
      creatureType: String(system.details?.type?.value ?? system.details?.type ?? "").trim(),
      creatureSubtype: String(system.details?.type?.subtype ?? "").trim(),
      cr: system.details?.cr ?? null,
      proficiencyBonus: Number(system.attributes?.prof ?? 0) || 0,
      source: {
        book: String(system.details?.source?.book ?? "").trim(),
        page: system.details?.source?.page ?? null,
      },
      // Traits — these are arrays of slugs in dnd5e v5
      // (e.g. damage immunity slugs: "fire" / "cold" / "poison").
      traits: {
        damageImmunities: Array.from(system.traits?.di?.value ?? []),
        damageResistances: Array.from(system.traits?.dr?.value ?? []),
        damageVulnerabilities: Array.from(system.traits?.dv?.value ?? []),
        conditionImmunities: Array.from(system.traits?.ci?.value ?? []),
        languages: Array.from(system.traits?.languages?.value ?? []),
      },
    };
  } else if (actor.type === "vehicle") {
    base.vehicle = {
      vehicleType: String(system.vehicleType ?? "").trim(),
      dimensions: String(system.attributes?.dimensions ?? "").trim(),
      capacity: {
        creature: String(system.attributes?.capacity?.creature ?? "").trim(),
        cargo: Number(system.attributes?.capacity?.cargo ?? 0) || 0,
      },
      actions: {
        stations: !!system.attributes?.actions?.stations,
        value: Number(system.attributes?.actions?.value ?? 0) || 0,
        threshold: Number(system.attributes?.actions?.thresholds ?? 0) || 0,
      },
      movement: system.attributes?.movement ?? {},
    };
  } else if (actor.type === "group") {
    // `system.members` in dnd5e v5 is `[{ actor: ActorUUID, ... }]`.
    // Older worlds may have it as a flat string[] of ids. Tolerate both.
    const rawMembers = Array.isArray(system.members) ? system.members : [];
    const members = rawMembers.map((m) => {
      if (typeof m === "string") return { uuid: m, name: "", actorType: "" };
      const memberActor = m?.actor ? fromUuidSync?.(typeof m.actor === "string" ? m.actor : m.actor.uuid) : null;
      return {
        uuid: typeof m?.actor === "string" ? m.actor : (m?.actor?.uuid ?? ""),
        name: memberActor?.name ?? m?.name ?? "",
        actorType: memberActor?.type ?? "",
      };
    });
    base.group = {
      groupType: String(system.type?.value ?? system.type ?? "").trim(),
      memberCount: members.length,
      members,
    };
  }

  return base;
}

/**
 * Extract a compact spell-slot snapshot from `system.spells`. Returns
 * `{ pact: {value, max}, spell1: {value, max}, ... }` skipping levels
 * that don't exist on this sheet. Used by the character branch only.
 */
function extractSpellSlotSummary(spells) {
  const result = {};
  for (const key of Object.keys(spells)) {
    if (!/^(?:spell[1-9]|pact)$/.test(key)) continue;
    const slot = spells[key];
    if (!slot || typeof slot !== "object") continue;
    // Skip slot levels the actor doesn't have (max is 0). Keeps the
    // payload focused on levels the character can actually cast at.
    if (Number(slot.max ?? 0) === 0 && Number(slot.value ?? 0) === 0) continue;
    result[key] = {
      value: Number(slot.value ?? 0) || 0,
      max: Number(slot.max ?? 0) || 0,
      override: slot.override ?? null,
    };
  }
  return result;
}

function buildActorExportEntry(actor, rootFolder) {
  const source = getCleanSource(actor);
  const folderPath = actor.folder ? getFolderPath(actor.folder) : "";

  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,
    folderId: actor.folder?.id ?? null,
    folderPath,
    relativeFolderPath: folderPath && rootFolder
      ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
      : "",
    actorSummary: buildActorSummary(actor, source),
    sourceDocument: source,
  };
}

export function buildActorFolderExport(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Actor") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const actors = Array.from(game.actors ?? []).filter((actor) =>
    ACTOR_FOLDER_TYPES.includes(actor.type)
    && includedFolderIds.has(actor.folder?.id ?? "")
  );

  const folderPath = getFolderPath(folder);

  return {
    kind: "dauligor.foundry-actor-folder-export.v1",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    game: {
      worldId: game.world?.id ?? null,
      worldTitle: game.world?.title ?? null,
      systemId: game.system?.id ?? null,
      systemVersion: game.system?.version ?? null,
      coreVersion: game.release?.version ?? null,
    },
    folder: {
      id: folder.id,
      uuid: folder.uuid ?? null,
      name: folder.name,
      type: folder.type,
      path: folderPath,
      includeSubfolders,
      includedFolderIds: Array.from(includedFolderIds),
      parentId: folder.folder?.id ?? null,
    },
    summary: summarizeActorCounts(actors),
    actors: actors
      .slice()
      .sort((a, b) => {
        // Cluster by actor type (all npcs together, then all characters,
        // …) then by name. Same approach the item export uses.
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      })
      .map((actor) => buildActorExportEntry(actor, folder)),
  };
}

export async function exportActorFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Actor") {
    notifyWarn("Select an Actor folder before exporting actors.");
    return;
  }

  const payload = buildActorFolderExport(folder, { includeSubfolders });
  const actorCount = payload?.summary?.actorCount ?? 0;
  if (!actorCount) {
    notifyWarn(`No actor documents (character / npc / vehicle / group) were found in "${folder.name}".`);
    return;
  }

  log("Prepared actor folder export", payload);
  notifyInfo(`Prepared ${actorCount} actors from "${folder.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: "Export Actor Folder",
    name: `${folder.name} (${actorCount} actors)`,
  });

  if (shouldDownload) downloadJson(payload, `${folder.name}-actors-export`);
}

// ─── Creature folder export ─────────────────────────────────────────
//
// Creatures are Actors (`type:"npc"`), not Items. Export-first: capture
// real Foundry NPC stat blocks (the full `sourceDocument` incl. embedded
// items + effects) plus a creature-focused summary, so the app can design
// a dedicated creatures table before the import round-trip is wired.
// Parallels the background/race folder exports.
//
// Scoped to `npc` only — PCs / vehicles / groups are covered by the
// generic actor folder export above. Use that one for a broad actor
// sweep; use this one for monster / NPC stat-block evidence.

function summarizeCreatureCounts(creatures) {
  const byCr = {};
  const byCreatureType = {};
  let withSpellcasting = 0;
  let withLegendary = 0;
  let totalEmbeddedItems = 0;
  for (const actor of creatures) {
    const obj = actor.toObject();
    const s = obj.system ?? {};
    const crLabel = s.details?.cr == null ? "unknown" : String(s.details.cr);
    byCr[crLabel] = (byCr[crLabel] ?? 0) + 1;
    const ct = String(s.details?.type?.value ?? "").trim() || "unknown";
    byCreatureType[ct] = (byCreatureType[ct] ?? 0) + 1;
    if (String(s.attributes?.spellcasting ?? "").trim()) withSpellcasting++;
    if (Number(s.resources?.legact?.max ?? 0) > 0 || Number(s.resources?.legres?.max ?? 0) > 0) withLegendary++;
    totalEmbeddedItems += Array.isArray(obj.items) ? obj.items.length : 0;
  }
  const sortedByCr = {};
  Object.keys(byCr)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .forEach((key) => { sortedByCr[key] = byCr[key]; });
  return {
    creatureCount: creatures.length,
    byCr: sortedByCr,
    byCreatureType,
    withSpellcasting,
    withLegendary,
    totalEmbeddedItems,
  };
}

/**
 * Rich creature (npc) stat-block summary — surfaces the fields a Dauligor
 * creatures table will need columns for. The authoritative full shape is
 * always on the entry's `sourceDocument`; this is the convenience digest.
 * dnd5e v5 npc paths; read defensively so a missing field defaults clean.
 */
function buildCreatureSummary(actor, source) {
  const system = source.system ?? {};
  const items = Array.isArray(source.items) ? source.items : [];
  const hp = system.attributes?.hp ?? {};
  const ac = system.attributes?.ac ?? {};

  const abilities = {};
  for (const k of ["str", "dex", "con", "int", "wis", "cha"]) {
    const a = system.abilities?.[k] ?? {};
    abilities[k] = { value: Number(a.value ?? 0) || 0, proficient: Number(a.proficient ?? 0) || 0 };
  }

  // Only proficient/expertise skills (value > 0) — keeps the digest tight.
  const skills = {};
  for (const [k, v] of Object.entries(system.skills ?? {})) {
    const prof = Number(v?.value ?? 0) || 0;
    if (prof > 0) skills[k] = { value: prof, ability: String(v?.ability ?? "") };
  }

  return {
    img: source.img ?? "",
    tokenImg: source.prototypeToken?.texture?.src ?? "",
    creatureType: {
      value: String(system.details?.type?.value ?? "").trim(),
      subtype: String(system.details?.type?.subtype ?? "").trim(),
      swarm: String(system.details?.type?.swarm ?? "").trim(),
      custom: String(system.details?.type?.custom ?? "").trim(),
    },
    size: String(system.traits?.size ?? "").trim(),
    alignment: String(system.details?.alignment ?? "").trim(),
    cr: system.details?.cr ?? null,
    proficiencyBonus: Number(system.attributes?.prof ?? 0) || 0,
    source: {
      book: String(system.details?.source?.book ?? "").trim(),
      page: system.details?.source?.page ?? null,
    },
    hp: {
      value: Number(hp.value ?? 0) || 0,
      max: Number(hp.max ?? 0) || 0,
      formula: String(hp.formula ?? ""),
      temp: Number(hp.temp ?? 0) || 0,
    },
    ac: {
      value: Number(ac.value ?? 0) || 0,
      flat: ac.flat ?? null,
      formula: String(ac.formula ?? ""),
      calc: String(ac.calc ?? ""),
    },
    abilities,
    skills,
    movement: system.attributes?.movement ?? {},   // {walk,fly,swim,climb,burrow,hover,units}
    senses: system.attributes?.senses ?? {},        // {darkvision,blindsight,tremorsense,truesight,special,units}
    traits: {
      damageImmunities: Array.from(system.traits?.di?.value ?? []),
      damageResistances: Array.from(system.traits?.dr?.value ?? []),
      damageVulnerabilities: Array.from(system.traits?.dv?.value ?? []),
      conditionImmunities: Array.from(system.traits?.ci?.value ?? []),
      languages: Array.from(system.traits?.languages?.value ?? []),
    },
    spellcasting: {
      ability: String(system.attributes?.spellcasting ?? "").trim(),
      level: Number(system.details?.spellLevel ?? 0) || 0,
      slots: extractSpellSlotSummary(system.spells ?? {}),
    },
    legendary: {
      actions: {
        value: Number(system.resources?.legact?.value ?? 0) || 0,
        max: Number(system.resources?.legact?.max ?? 0) || 0,
      },
      resistance: {
        value: Number(system.resources?.legres?.value ?? 0) || 0,
        max: Number(system.resources?.legres?.max ?? 0) || 0,
      },
      lair: !!system.resources?.lair?.value,
    },
    biography: buildBiographySnippet(system.details?.biography?.value ?? ""),
    itemCount: items.length,
    effectCount: Array.isArray(source.effects) ? source.effects.length : 0,
    // Embedded stat-block pieces by type — feat (traits/actions), weapon
    // (attacks), spell (spellcasting), consumable, etc. The full items
    // live on sourceDocument.items.
    embeddedTypeCounts: items.reduce((acc, it) => {
      const key = String(it.type ?? "unknown");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function buildCreatureExportEntry(actor, rootFolder) {
  const source = getCleanSource(actor);
  const folderPath = actor.folder ? getFolderPath(actor.folder) : "";
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,                                 // "npc"
    folderId: actor.folder?.id ?? null,
    folderPath,
    relativeFolderPath: folderPath && rootFolder
      ? folderPath.replace(new RegExp(`^${escapeRegex(getFolderPath(rootFolder))}/?`), "")
      : "",
    creatureSummary: buildCreatureSummary(actor, source),
    sourceDocument: source,
  };
}

export function buildCreatureFolderExport(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Actor") return null;

  const includedFolderIds = includeSubfolders ? collectDescendantFolderIds(folder) : new Set([folder.id]);
  const creatures = Array.from(game.actors ?? []).filter((actor) =>
    actor.type === "npc"
    && includedFolderIds.has(actor.folder?.id ?? "")
  );
  const folderPath = getFolderPath(folder);

  return {
    ...buildFolderExportHeader(folder, "dauligor.foundry-creature-folder-export.v1", includeSubfolders, includedFolderIds, folderPath),
    summary: summarizeCreatureCounts(creatures),
    creatures: creatures
      .slice()
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
      .map((actor) => buildCreatureExportEntry(actor, folder)),
  };
}

export async function exportCreatureFolder(folder, { includeSubfolders = true } = {}) {
  if (!folder || folder.documentName !== "Folder" || folder.type !== "Actor") {
    notifyWarn("Select an Actor folder before exporting creatures.");
    return;
  }
  const payload = buildCreatureFolderExport(folder, { includeSubfolders });
  const count = payload?.summary?.creatureCount ?? 0;
  if (!count) {
    notifyWarn(`No creature (npc) actors were found in "${folder.name}".`);
    return;
  }
  log("Prepared creature folder export", payload);
  notifyInfo(`Prepared ${count} creatures from "${folder.name}". See console for the full object.`);
  const shouldDownload = await chooseDownload({
    title: "Export Creature Folder",
    name: `${folder.name} (${count} creatures)`,
  });
  if (shouldDownload) downloadJson(payload, `${folder.name}-creatures-export`);
}

function serializeForJson(value, { seen = new WeakSet(), depth = 0, maxDepth = 10 } = {}) {
  if (value == null) return value;
  if (depth > maxDepth) return "[MaxDepth]";

  const valueType = typeof value;
  if (["string", "number", "boolean"].includes(valueType)) return value;
  if (valueType === "bigint") return value.toString();
  if (valueType === "function") return `[Function ${value.name || "anonymous"}]`;
  if (valueType === "symbol") return value.toString();

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Set) {
    return Array.from(value, (entry) => serializeForJson(entry, { seen, depth: depth + 1, maxDepth }));
  }
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries(), ([key, entry]) => [
      String(key),
      serializeForJson(entry, { seen, depth: depth + 1, maxDepth })
    ]));
  }
  if (value instanceof HTMLElement) {
    return {
      tagName: value.tagName,
      className: value.className,
      outerHTML: value.outerHTML
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeForJson(entry, { seen, depth: depth + 1, maxDepth }));
  }

  if (valueType === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (typeof value.toObject === "function" && value.documentName) {
      try {
        return {
          documentName: value.documentName,
          uuid: value.uuid ?? null,
          name: value.name ?? null,
          type: value.type ?? null,
          source: foundry.utils.deepClone(value.toObject())
        };
      } catch (_error) {
        return {
          documentName: value.documentName,
          uuid: value.uuid ?? null,
          name: value.name ?? null,
          type: value.type ?? null
        };
      }
    }

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "parent" || key === "collection") continue;
      output[key] = serializeForJson(entry, { seen, depth: depth + 1, maxDepth });
    }
    return output;
  }

  return String(value);
}

async function prepareApplicationContext(app) {
  if (!app) return null;

  try {
    if (typeof app._prepareContext === "function") {
      return await app._prepareContext({});
    }
  } catch (error) {
    return {
      error: `_prepareContext failed: ${error.message}`
    };
  }

  try {
    if (typeof app.getData === "function") {
      return await app.getData({});
    }
  } catch (error) {
    return {
      error: `getData failed: ${error.message}`
    };
  }

  return null;
}

function collectApplicationTemplateMetadata(app) {
  const ctor = app?.constructor;
  return serializeForJson({
    constructorName: ctor?.name ?? null,
    parts: ctor?.PARTS ?? null,
    tabs: ctor?.TABS ?? null,
    defaultOptions: ctor?.DEFAULT_OPTIONS ?? null
  });
}

function resolveAppDocument(documentLike) {
  if (!documentLike) return null;
  if (typeof documentLike.toObject === "function") return documentLike;
  if (typeof documentLike.object?.toObject === "function") return documentLike.object;
  return null;
}

function getAppRootElement(app) {
  return app?.element?.[0]
    ?? app?.element
    ?? app?.window?.element?.[0]
    ?? app?.window?.element
    ?? null;
}

export async function exportApplicationWindow(app) {
  if (!app) {
    notifyWarn("No application window was selected to export.");
    return;
  }

  const root = getAppRootElement(app);
  const document = resolveAppDocument(app.document ?? app.object ?? null);
  const context = await prepareApplicationContext(app);

  const payload = {
    kind: "dauligor.window-export.v1",
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    application: {
      id: app.id ?? null,
      appId: app.appId ?? null,
      constructorName: app.constructor?.name ?? null,
      title: app.title ?? app.window?.title ?? document?.name ?? null,
      documentName: document?.documentName ?? app.document?.documentName ?? null,
      uuid: document?.uuid ?? app.document?.uuid ?? null,
      type: document?.type ?? app.document?.type ?? null,
      templates: collectApplicationTemplateMetadata(app)
    },
    document: document ? buildDocumentEnvelope(document) : null,
    context: serializeForJson(context),
    renderedHtml: root?.outerHTML ?? null
  };

  log("Prepared application window export", payload);
  notifyInfo(`Prepared window export for "${payload.application.title ?? payload.application.constructorName ?? "window"}".`);

  const shouldDownload = await chooseDownload({
    title: "Export Window Structure",
    name: payload.application.title ?? payload.application.constructorName ?? "window"
  });

  if (!shouldDownload) return;

  const filenameBase = [
    payload.application.documentName || "window",
    payload.application.type || payload.application.constructorName || "app",
    payload.application.title || document?.name || "export"
  ].filter(Boolean).join("-");

  downloadJson(payload, filenameBase);
}

export function buildActorClassSnapshot(actor) {
  if (!actor) return null;

  const source = getCleanSource(actor);
  const classItems = Array.from(actor.items ?? []).filter((item) => item.type === "class");
  const subclassItems = Array.from(actor.items ?? []).filter((item) => item.type === "subclass");
  const classLinkedItems = Array.from(actor.items ?? []).filter((item) =>
    item.type === "feat"
    && item.getFlag?.(MODULE_ID, "classSourceId"));

  return {
    kind: "dauligor.actor-class-snapshot.v1",
    exportedAt: new Date().toISOString(),
    moduleId: MODULE_ID,
    actor: {
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      type: actor.type,
      flags: foundry.utils.deepClone(source.flags ?? {}),
      system: foundry.utils.deepClone(source.system ?? {})
    },
    classes: classItems.map((item) => getCleanSource(item)),
    subclasses: subclassItems.map((item) => getCleanSource(item)),
    classLinkedItems: classLinkedItems.map((item) => getCleanSource(item))
  };
}

export async function exportActorClassSnapshot(actor) {
  if (!actor) {
    notifyWarn("No actor was selected to export class data.");
    return;
  }

  const snapshot = buildActorClassSnapshot(actor);
  log("Prepared actor class snapshot", snapshot);
  notifyInfo(`Prepared class snapshot for "${actor.name}". See console for the full object.`);

  const shouldDownload = await chooseDownload({
    title: "Export Actor Class Snapshot",
    name: `${actor.name} class snapshot`
  });

  if (shouldDownload) downloadJson(snapshot, `${actor.name}-class-snapshot`);
}

function buildDocumentAnalysis(document, source) {
  switch (document.documentName) {
    case "Item":
      return analyzeItem(document, source);
    case "Actor":
      return analyzeActor(document, source);
    case "JournalEntry":
      return analyzeJournal(document, source);
    case "RollTable":
      return analyzeRollTable(document, source);
    default:
      return {
        documentName: document.documentName,
        notes: ["No specialized analysis is registered for this document type yet."]
      };
  }
}

function analyzeItem(item, source) {
  const activities = Object.entries(source.system?.activities ?? {}).map(([id, activity]) => ({
    id,
    name: activity.name ?? null,
    type: activity.type ?? null,
    sort: activity.sort ?? null,
    activation: activity.activation ?? null,
    consumption: activity.consumption ?? null,
    target: activity.target ?? null,
    range: activity.range ?? null,
    duration: activity.duration ?? null,
    damage: activity.damage ?? null,
    healing: activity.healing ?? null,
    save: activity.save ?? null,
    uses: activity.uses ?? null,
    effects: activity.effects ?? []
  }));

  const advancements = (source.system?.advancement ?? []).map((advancement) => ({
    id: advancement._id ?? null,
    type: advancement.type ?? null,
    title: advancement.title ?? null,
    level: advancement.level ?? null,
    classRestriction: advancement.classRestriction ?? "",
    configuration: advancement.configuration ?? null,
    value: advancement.value ?? null
  }));

  const effectSummaries = collectEffectSummaries(item);

  return {
    itemCategory: categorizeItemType(source.type),
    itemType: source.type,
    physical: {
      quantity: source.system?.quantity ?? null,
      weight: source.system?.weight ?? null,
      price: source.system?.price ?? null,
      equipped: source.system?.equipped ?? null,
      attuned: source.system?.attuned ?? null,
      attunement: source.system?.attunement ?? null,
      identified: source.system?.identified ?? null,
      container: source.system?.container ?? null
    },
    itemSpecific: {
      identifier: source.system?.identifier ?? null,
      classIdentifier: source.system?.classIdentifier ?? null,
      level: source.system?.level ?? null,
      school: source.system?.school ?? null,
      method: source.system?.method ?? null,
      primaryAbility: source.system?.primaryAbility ?? null,
      hd: source.system?.hd ?? null,
      spellcasting: source.system?.spellcasting ?? null,
      armor: source.system?.armor ?? null,
      damage: source.system?.damage ?? null,
      properties: source.system?.properties ?? [],
      uses: source.system?.uses ?? null
    },
    behavior: {
      hasActivities: activities.length > 0,
      activityCount: activities.length,
      activityTypes: summarizeCounts(activities.map((activity) => activity.type ?? "unknown")),
      activities,
      hasAdvancement: advancements.length > 0,
      advancementCount: advancements.length,
      advancementTypes: summarizeCounts(advancements.map((advancement) => advancement.type ?? "unknown")),
      advancements,
      hasEffects: effectSummaries.length > 0,
      effects: effectSummaries
    },
    chatAndUseNotes: buildItemUseNotes(source, activities, effectSummaries, advancements)
  };
}

function analyzeActor(actor, source) {
  const embeddedItems = Array.from(actor.items ?? []);
  const classItems = embeddedItems.filter((item) => item.type === "class").map((item) => {
    const itemSource = item.toObject();
    return {
      id: item.id,
      name: item.name,
      identifier: itemSource.system?.identifier ?? null,
      levels: itemSource.system?.levels ?? null,
      subclassIdentifiers: embeddedItems
        .filter((candidate) => candidate.type === "subclass" && candidate.toObject().system?.classIdentifier === itemSource.system?.identifier)
        .map((candidate) => candidate.toObject().system?.identifier ?? candidate.name)
    };
  });

  const itemTypeCounts = summarizeCounts(embeddedItems.map((item) => item.type ?? "unknown"));

  return {
    actorType: source.type,
    coreBranches: {
      abilities: source.system?.abilities ?? null,
      skills: source.system?.skills ?? null,
      attributes: source.system?.attributes ?? null,
      traits: source.system?.traits ?? null,
      details: source.system?.details ?? null,
      resources: source.system?.resources ?? null
    },
    embeddedContent: {
      itemCount: embeddedItems.length,
      itemTypeCounts,
      classItems,
      effectCount: Array.from(actor.effects ?? []).length
    },
    behavior: {
      effectSummaries: collectEffectSummaries(actor),
      itemsWithActivities: embeddedItems
        .map((item) => ({ name: item.name, type: item.type, activityCount: Object.keys(item.toObject().system?.activities ?? {}).length }))
        .filter((item) => item.activityCount > 0)
    },
    researchNotes: buildActorResearchNotes(source, classItems, itemTypeCounts)
  };
}

function analyzeJournal(journal, source) {
  return {
    pageCount: Array.isArray(source.pages) ? source.pages.length : 0,
    pageSummaries: (source.pages ?? []).map((page) => ({
      id: page._id ?? null,
      name: page.name ?? null,
      type: page.type ?? null,
      textFormat: page.text?.format ?? null,
      hasMarkdown: !!page.text?.markdown,
      hasHTML: !!page.text?.content
    }))
  };
}

function analyzeRollTable(_table, source) {
  return {
    resultCount: Array.isArray(source.results) ? source.results.length : 0,
    formula: source.formula ?? null,
    replacement: source.replacement ?? null,
    displayRoll: source.displayRoll ?? null
  };
}

function buildItemUseNotes(source, activities, effectSummaries, advancements) {
  const notes = [];

  if (!activities.length) notes.push("No activities found. The item may import successfully but feel incomplete when used in play.");
  if (activities.some((activity) => activity.type === "attack")) notes.push("Attack behavior is represented through item activities, not only item root fields.");
  if (activities.some((activity) => activity.type === "damage" || activity.damage)) notes.push("Damage formulas should be reviewed alongside activity data and any scale values they reference.");
  if (activities.some((activity) => activity.type === "heal" || activity.healing)) notes.push("Healing behavior is present and should be checked against consumable or spell use flows.");
  if (effectSummaries.length) notes.push("This item has active effects. Importers should preserve or synthesize mechanically meaningful effects.");
  if (advancements.length) notes.push("This item carries advancement data. Treat it as a progression container, not just descriptive content.");
  if (source.type === "class" || source.type === "subclass") notes.push("Classes and subclasses should preserve identifier links and structured advancement data.");
  if (source.type === "spell") notes.push("Spells should be checked for preparation, materials, casting method, activities, and chat-card usefulness.");

  return notes;
}

function buildActorResearchNotes(source, classItems, itemTypeCounts) {
  const notes = [];

  if (source.type === "character") notes.push("Characters usually require both actor root updates and embedded item upserts.");
  if (source.type === "npc") notes.push("NPCs should use a dedicated mapper and not be treated as reskinned characters.");
  if (classItems.length) notes.push("Class and subclass linkage depends on stable identifiers across embedded items.");
  if (itemTypeCounts.spell) notes.push("This actor has embedded spells. Spell items may carry activities, uses, and effects that matter for runtime behavior.");

  return notes;
}

function collectEffectSummaries(document) {
  return Array.from(document.effects ?? []).map((effect) => {
    const source = effect.toObject();
    return {
      id: effect.id,
      name: effect.name,
      origin: source.origin ?? null,
      disabled: !!source.disabled,
      transfer: source.transfer ?? null,
      statuses: Array.isArray(source.statuses) ? source.statuses : Array.from(source.statuses ?? []),
      duration: source.duration ?? null,
      changes: source.changes ?? []
    };
  });
}

function collectInterestingFlags(flags) {
  return {
    [MODULE_ID]: flags?.[MODULE_ID] ?? null,
    plutonium: flags?.plutonium ?? null
  };
}

function categorizeItemType(type) {
  if (["weapon"].includes(type)) return "weapon";
  if (["equipment"].includes(type)) return "equipment";
  if (["consumable"].includes(type)) return "consumable";
  if (["tool"].includes(type)) return "tool";
  if (["loot", "container", "backpack"].includes(type)) return "loot-or-container";
  if (["feat"].includes(type)) return "feat-or-feature";
  if (["spell"].includes(type)) return "spell";
  if (["class", "subclass"].includes(type)) return "class-progression";
  if (["background", "race", "species"].includes(type)) return "origin";
  return "other";
}

function summarizeCounts(values) {
  return values.reduce((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}
