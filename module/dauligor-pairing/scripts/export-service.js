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
