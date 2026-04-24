import { CLASS_CATALOG_FILE, MODULE_ID, SETTINGS, SOURCE_LIBRARY_FILE } from "./constants.js";
import { applyReferenceNormalization, syncDocumentReferences } from "./reference-service.js";
import { log, notifyInfo, notifyWarn, warn } from "./utils.js";

const DEFAULT_CLASS_ICON = "icons/svg/item-bag.svg";
const DEFAULT_SUBCLASS_ICON = "icons/svg/upgrade.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";
const DEFAULT_OPTION_ICON = "icons/svg/upgrade.svg";
const DEFAULT_SOURCE_BOOK = "Dauligor";
const FEATURE_SUPPORTED_ADVANCEMENT_TYPES = new Set(["AbilityScoreImprovement", "ItemChoice", "ItemGrant", "ScaleValue", "Trait"]);
const SUPPORTED_SEMANTIC_ACTIVITY_TYPES = new Set(["attack", "cast", "check", "damage", "enchant", "forward", "heal", "save", "summon", "transform", "utility"]);

export async function openClassImportBrowser() {
  const catalogUrl = game.settings.get(MODULE_ID, SETTINGS.defaultClassCatalogUrl) || CLASS_CATALOG_FILE;
  notifyWarn(`The legacy class dialog is no longer used. Open the Dauligor importer app instead. Current catalog: ${catalogUrl}`);
}

export async function fetchSourceCatalog(url = SOURCE_LIBRARY_FILE) {
  const payload = await fetchJson(url);
  if (!payload) return null;

  if (payload.kind !== "dauligor.source-catalog.v1") {
    notifyWarn(`Source catalog at ${url} did not return dauligor.source-catalog.v1.`);
    return null;
  }

  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return {
    ...payload,
    entries: entries
      .filter((entry) => entry?.sourceId && entry?.name)
      .map((entry) => ({
        ...entry,
        detailUrl: resolveCatalogUrl(url, entry.detailUrl),
        classCatalogUrl: resolveCatalogUrl(url, entry.classCatalogUrl),
        spellCatalogUrl: resolveCatalogUrl(url, entry.spellCatalogUrl),
        itemCatalogUrl: resolveCatalogUrl(url, entry.itemCatalogUrl),
        featCatalogUrl: resolveCatalogUrl(url, entry.featCatalogUrl),
        actorCatalogUrl: resolveCatalogUrl(url, entry.actorCatalogUrl)
      }))
  };
}

export async function importClassPayloadToWorld(payload, { entry = null, folderPath = null, actor = null, targetLevel = null, importSelection = null } = {}) {
  if (!game.user?.isGM) {
    notifyWarn("Only a GM can import Dauligor classes into the world.");
    return null;
  }

  if (!payload || typeof payload !== "object") {
    notifyWarn("The class payload was empty or invalid.");
    return null;
  }

  const supportedPayload = normalizeSupportedClassPayload(payload, { entry });
  if (!supportedPayload || typeof supportedPayload !== "object") {
    notifyWarn("Unsupported class payload. Expected a Dauligor class bundle, semantic full class export, dauligor.item.v1 class item, or a raw Foundry-like class item.");
    return null;
  }

  if (actor) {
    return importClassPayloadToActor(supportedPayload, { entry, actor, targetLevel, importSelection });
  }

  if (supportedPayload.kind === "dauligor.class-bundle.v1") {
    return importClassBundleToWorld(supportedPayload, { entry, folderPath });
  }

  if (supportedPayload.kind === "dauligor.item.v1" && supportedPayload.item?.type === "class") {
    const classItem = normalizeWorldItem(supportedPayload.item, supportedPayload.source);
    applyPayloadMetadata(classItem.flags?.[MODULE_ID], { payloadMeta: supportedPayload, importMode: "world" });
    const classDoc = await upsertWorldItem(classItem, { folderPath });
    notifyInfo(`Imported class "${classDoc.name}" from a dauligor.item.v1 payload.`);
    return classDoc;
  }

  if (supportedPayload.type === "class" && supportedPayload.system) {
    const classDoc = await upsertWorldItem(normalizeWorldItem(supportedPayload), { folderPath });
    notifyInfo(`Imported raw class item "${classDoc.name}".`);
    return classDoc;
  }

  notifyWarn("Unsupported class payload. Expected a Dauligor class bundle, semantic full class export, dauligor.item.v1 class item, or a raw Foundry-like class item.");
  return null;
}

async function importClassPayloadToActor(payload, { entry = null, actor = null, targetLevel = null, importSelection = null } = {}) {
  if (payload.kind === "dauligor.class-bundle.v1") {
    return importClassBundleToActor(payload, { entry, actor, targetLevel, importSelection });
  }

  const classItem = payload.kind === "dauligor.item.v1"
    ? payload.item
    : payload;

  if (!classItem || classItem.type !== "class" || !classItem.system) {
    notifyWarn("Unsupported actor class payload. Expected a class bundle, semantic full export, or a class item.");
    return null;
  }

  const targetActor = resolveTargetActor(actor);
  if (!targetActor) {
    notifyWarn("Open the importer from an actor sheet to embed a class directly on a character.");
    return null;
  }

  const normalizedClass = normalizeWorldItem(classItem, payload.source);
  const classLevel = normalizeClassLevel(targetLevel, normalizedClass.system?.levels);
  const existingClassItem = findMatchingActorItem(targetActor, normalizedClass);
  const preparedClass = prepareEmbeddedActorClassItem(normalizedClass, {
    targetLevel: classLevel,
    existingItem: existingClassItem,
    payloadMeta: payload
  });
  const actorClassDoc = await upsertActorItem(targetActor, preparedClass);
  notifyInfo(`Imported "${actorClassDoc.name}" to "${targetActor.name}" at class level ${classLevel}.`);
  return actorClassDoc;
}

async function importClassBundleToWorld(payload, { entry = null, folderPath = null } = {}) {
  const classItem = payload.classItem;
  if (!classItem || classItem.type !== "class") {
    notifyWarn("The Dauligor class bundle did not include a valid classItem.");
    return null;
  }

  const supportItems = collectBundleSupportItems(payload).map((item) => {
    const normalized = normalizeWorldItem(item, payload.source);
    applyPayloadMetadata(normalized.flags?.[MODULE_ID], { payloadMeta: payload, importMode: "world" });
    return normalized;
  });

  const importedSupportDocs = [];
  for (const supportItem of supportItems) {
    importedSupportDocs.push(await upsertWorldItem(supportItem, { folderPath }));
  }

  const preparedClassItem = prepareStructuredItemForImport(classItem, payload.source, importedSupportDocs);
  applyPayloadMetadata(preparedClassItem.item.flags?.[MODULE_ID], { payloadMeta: payload, importMode: "world" });
  const classDoc = await upsertWorldItem(preparedClassItem.item, { folderPath });

  const importedSubclassDocs = [];
  const subclassItems = Array.isArray(payload.subclassItems) ? payload.subclassItems : [];
  for (const subclassItem of subclassItems) {
    try {
      const preparedSubclassItem = prepareStructuredItemForImport(subclassItem, payload.source, importedSupportDocs);
      applyPayloadMetadata(preparedSubclassItem.item.flags?.[MODULE_ID], { payloadMeta: payload, importMode: "world" });
      importedSubclassDocs.push(await upsertWorldItem(preparedSubclassItem.item, { folderPath }));
      preparedClassItem.unresolved.push(...preparedSubclassItem.unresolved);
    } catch (error) {
      warn("Failed to import normalized subclass item from class bundle", { subclassItem, error });
      ui.notifications?.warn(`The subclass "${subclassItem?.name ?? "unknown"}" could not be imported yet. The class import still completed.`);
    }
  }

  const importedName = classDoc?.name ?? classItem.name ?? entry?.name ?? "class";
  const importedDocs = [...importedSupportDocs, classDoc, ...importedSubclassDocs].filter(Boolean);
  await syncDocumentAdvancementReferences(importedDocs);
  await syncDocumentReferences(importedDocs, {
    sourceMeta: payload.source,
    relatedDocuments: importedDocs
  });
  if (preparedClassItem.unresolved.length) {
    notifyWarn(`Imported "${importedName}", but ${preparedClassItem.unresolved.length} advancement reference(s) could not be resolved.`);
  } else {
    notifyInfo(`Imported "${importedName}" with ${countBundleItems(payload, "classFeatures")} class feature item(s), ${countBundleItems(payload, "subclassFeatures")} subclass feature item(s), ${countBundleItems(payload, "optionItems")} class option item(s), and ${importedSubclassDocs.length} subclass item(s).`);
  }

  log("Imported Dauligor class bundle", {
    entry,
    payload,
    classDoc,
    importedSupportDocs,
    importedSubclassDocs,
    unresolved: preparedClassItem.unresolved
  });

  return classDoc;
}

async function importClassBundleToActor(payload, { entry = null, actor = null, targetLevel = null, importSelection = null } = {}) {
  const targetActor = resolveTargetActor(actor);
  const classItem = payload.classItem;
  if (!targetActor || !classItem || classItem.type !== "class") {
    notifyWarn("The Dauligor class bundle did not include a valid actor target and classItem.");
    return null;
  }

  const workflow = buildClassImportWorkflow(payload, {
    entry,
    actor: targetActor,
    targetLevel,
    preferredSubclassSourceId: importSelection?.subclassSourceId ?? null,
    importSelection
  });
  if (!workflow) {
    notifyWarn("The selected class payload could not be prepared for actor import.");
    return null;
  }

  if (workflow.requiresSubclassSelection && !workflow.selection.subclassSourceId) {
    notifyWarn(`Choose a subclass for "${workflow.classItem.name}" before importing it onto an actor.`);
    return null;
  }

  const normalizedClass = workflow.classItem;
  const classLevel = workflow.targetLevel;
  const classSourceId = workflow.classSourceId;
  const desiredFeatureSourceIds = new Set(workflow.desiredClassFeatureItems.map((item) => item.flags?.[MODULE_ID]?.sourceId).filter(Boolean));
  const desiredSubclassFeatureSourceIds = new Set(workflow.desiredSubclassFeatureItems.map((item) => item.flags?.[MODULE_ID]?.sourceId).filter(Boolean));
  const desiredOptionSourceIds = new Set(workflow.selectedOptionItems.map((item) => item.flags?.[MODULE_ID]?.sourceId).filter(Boolean));
  const existingClassItem = workflow.existingClassItem;
  const hpResolution = hasHitPointAdvancement(normalizedClass.system?.advancement)
    ? await resolveHitPointImport({
      actor: targetActor,
      classItem: normalizedClass,
      currentLevel: workflow.existingClassLevel,
      targetLevel: classLevel,
      hpMode: workflow.selection.hpMode,
      hpCustomFormula: workflow.selection.hpCustomFormula
    })
    : null;
  if (hpResolution) {
    log("Resolved class HP import", {
      actorName: targetActor.name,
      className: normalizedClass.name,
      classSourceId,
      existingClassLevel: workflow.existingClassLevel,
      targetLevel: classLevel,
      hpMode: workflow.selection.hpMode,
      hpCustomFormula: workflow.selection.hpCustomFormula,
      hpMeta: summarizeHpMeta(hpResolution.hpMeta),
      hpGainData: summarizeHpGainData(hpResolution.hpGainData),
      advancementValues: hpResolution.advancementValues
    });
  }

  const preparedClass = prepareEmbeddedActorClassItem(normalizedClass, {
    targetLevel: classLevel,
    existingItem: existingClassItem,
    payloadMeta: payload,
    importSelection: workflow.selection
  });
  const actorClassDoc = await upsertActorItem(targetActor, preparedClass);
  if (!actorClassDoc) {
    notifyWarn(`Failed to import "${classItem.name ?? entry?.name ?? "class"}" onto "${targetActor.name}".`);
    return null;
  }

  const importedFeatures = [];
  for (const featureItem of workflow.desiredClassFeatureItems) {
    const existingFeature = findMatchingActorItem(targetActor, featureItem);
    importedFeatures.push(await upsertActorItem(targetActor, normalizeEmbeddedActorFeature(featureItem, classSourceId, {
      existingItem: existingFeature,
      payloadMeta: payload
    })));
  }

  let subclassDoc = null;
  if (workflow.selectedSubclassItem) {
    const existingSubclassItem = workflow.existingSubclassItem;
    const preparedSubclass = prepareEmbeddedActorSubclassItem(workflow.selectedSubclassItem, {
      existingItem: existingSubclassItem,
      payloadMeta: payload,
      classSourceId
    });
    subclassDoc = await upsertActorItem(targetActor, preparedSubclass);
    if (!subclassDoc) {
      notifyWarn(`Failed to import subclass "${workflow.selectedSubclassItem.name}" onto "${targetActor.name}".`);
    }
  }

  const importedSubclassFeatures = [];
  for (const featureItem of workflow.desiredSubclassFeatureItems) {
    const existingFeature = findMatchingActorItem(targetActor, featureItem);
    importedSubclassFeatures.push(await upsertActorItem(targetActor, normalizeEmbeddedActorFeature(featureItem, classSourceId, {
      existingItem: existingFeature,
      payloadMeta: payload
    })));
  }

  const importedOptionItems = [];
  for (const optionItem of workflow.selectedOptionItems) {
    const existingOptionItem = findMatchingActorItem(targetActor, optionItem);
    importedOptionItems.push(await upsertActorItem(targetActor, normalizeEmbeddedActorFeature(optionItem, classSourceId, {
      existingItem: existingOptionItem,
      payloadMeta: payload
    })));
  }

  const removedFeatures = await pruneActorImportedItems(targetActor, {
    classSourceId,
    sourceType: "classFeature",
    desiredSourceIds: desiredFeatureSourceIds
  });
  const removedSubclassFeatures = await pruneActorImportedItems(targetActor, {
    classSourceId,
    sourceType: "subclassFeature",
    desiredSourceIds: desiredSubclassFeatureSourceIds
  });
  const removedOptionItems = await pruneActorImportedItems(targetActor, {
    classSourceId,
    sourceType: "classOption",
    desiredSourceIds: desiredOptionSourceIds
  });
  const removedSubclassItems = await pruneActorImportedItems(targetActor, {
    classSourceId,
    sourceType: "subclass",
    itemType: "subclass",
    desiredSourceIds: workflow.selection.subclassSourceId ? new Set([workflow.selection.subclassSourceId]) : new Set()
  });
  const syncedClassDoc = await syncActorClassAdvancements(targetActor, actorClassDoc, normalizedClass.system?.advancement, {
    classSourceId,
    targetLevel: classLevel,
    existingClassLevel: workflow.existingClassLevel,
    hpMode: workflow.selection.hpMode,
    hpCustomFormula: workflow.selection.hpCustomFormula,
    skillSelections: workflow.selection.skillSelections,
    hpResolution
  });
  log("Post-sync class advancement state", {
    actorName: targetActor.name,
    className: (syncedClassDoc ?? actorClassDoc)?.name ?? normalizedClass.name,
    classSourceId,
    hpAdvancement: getHitPointAdvancementSnapshot(syncedClassDoc ?? actorClassDoc)
  });
  let syncedSubclassDoc = subclassDoc;
  if (subclassDoc && workflow.selectedSubclassItem) {
    syncedSubclassDoc = await syncActorClassAdvancements(targetActor, subclassDoc, workflow.selectedSubclassItem.system?.advancement, {
      classSourceId,
      targetLevel: classLevel
    });
  }
  const appliedSkillChoices = await applyActorSkillSelections(targetActor, workflow.selection.skillSelections);
  const appliedHpIncrease = await applyActorHitPointIncrease(targetActor, syncedClassDoc ?? actorClassDoc, {
    existingClassLevel: workflow.existingClassLevel,
    targetLevel: classLevel,
    hpMode: workflow.selection.hpMode,
    hpCustomFormula: workflow.selection.hpCustomFormula,
    hpResolution
  });
  const importedActorDocs = [
    syncedClassDoc ?? actorClassDoc,
    syncedSubclassDoc ?? subclassDoc,
    ...importedFeatures,
    ...importedSubclassFeatures,
    ...importedOptionItems
  ].filter(Boolean);
  await syncDocumentAdvancementReferences(importedActorDocs);
  await syncDocumentReferences(importedActorDocs, {
    actor: targetActor,
    sourceMeta: payload.source,
    relatedDocuments: importedActorDocs
  });

  notifyInfo(
    `Imported "${(syncedClassDoc ?? actorClassDoc).name}" to "${targetActor.name}" at class level ${classLevel}`
    + ` with ${importedFeatures.length} class feature item(s), ${importedSubclassFeatures.length} subclass feature item(s),`
    + ` and ${importedOptionItems.length} selected option item(s).`
    + `${appliedHpIncrease ? ` Applied ${appliedHpIncrease} hit point(s).` : ""}`
    + `${appliedSkillChoices ? ` Applied ${appliedSkillChoices} skill proficiency selection(s).` : ""}`
    + `${removedFeatures ? ` Removed ${removedFeatures} class feature item(s).` : ""}`
    + `${removedSubclassFeatures ? ` Removed ${removedSubclassFeatures} subclass feature item(s).` : ""}`
    + `${removedOptionItems ? ` Removed ${removedOptionItems} class option item(s).` : ""}`
    + `${removedSubclassItems ? ` Removed ${removedSubclassItems} subclass item(s).` : ""}`
  );

  log("Imported Dauligor class bundle to actor", {
    entry,
    payload,
    workflow,
    actor: targetActor,
    actorClassDoc: syncedClassDoc ?? actorClassDoc,
    subclassDoc: syncedSubclassDoc ?? subclassDoc,
    classLevel,
    importedFeatures,
    appliedSkillChoices,
    importedSubclassFeatures,
    importedOptionItems,
    desiredFeatureSourceIds: [...desiredFeatureSourceIds],
    desiredSubclassFeatureSourceIds: [...desiredSubclassFeatureSourceIds],
    desiredOptionSourceIds: [...desiredOptionSourceIds],
    removedFeatures,
    removedSubclassFeatures,
    removedOptionItems,
    removedSubclassItems
  });

  return syncedClassDoc ?? actorClassDoc;
}

export function buildClassImportWorkflow(payload, {
  entry = null,
  actor = null,
  targetLevel = null,
  preferredSubclassSourceId = null,
  importSelection = null
} = {}) {
  const supportedPayload = normalizeSupportedClassPayload(payload, { entry });
  if (!supportedPayload || typeof supportedPayload !== "object") return null;

  const bundle = coerceClassPayloadToBundle(supportedPayload);
  const classItem = normalizeWorldItem(bundle.classItem, bundle.source);
  const classSourceId = classItem.flags?.[MODULE_ID]?.sourceId ?? bundle.source?.id ?? null;
  const targetActor = resolveTargetActor(actor);
  const existingClassItem = targetActor ? findMatchingActorItem(targetActor, classItem) : null;
  const existingClassLevel = Number(existingClassItem?.system?.levels ?? 0) || 0;
  const requestedTargetLevel = normalizeClassLevel(targetLevel, classItem.system?.levels);
  const normalizedTargetLevel = normalizeClassLevel(Math.max(existingClassLevel, requestedTargetLevel), classItem.system?.levels);
  const existingSelections = sanitizeClassImportSelection(existingClassItem?.getFlag(MODULE_ID, "importSelections") ?? {});
  const semanticClassData = getSemanticClassData(supportedPayload);

  const classFeatures = ensureArray(bundle.classFeatures).map((item) => normalizeWorldItem(item, bundle.source));
  const subclassItems = ensureArray(bundle.subclassItems).map((item) => normalizeWorldItem(item, bundle.source));
  const subclassFeatures = ensureArray(bundle.subclassFeatures).map((item) => normalizeWorldItem(item, bundle.source));
  const optionItems = ensureArray(bundle.optionItems).map((item) => normalizeWorldItem(item, bundle.source));

  const minSubclassLevel = getMinimumSubclassSelectionLevel(classItem.system?.advancement, classFeatures);
  const existingSubclassItem = targetActor
    ? targetActor.items.find((item) =>
      item.type === "subclass"
      && item.getFlag(MODULE_ID, "classSourceId") === classSourceId)
    : null;
  const requestedSelections = sanitizeClassImportSelection(importSelection ?? {});
  const subclassSourceIdSet = new Set(subclassItems.map((item) => item.flags?.[MODULE_ID]?.sourceId).filter(Boolean));
  const hasSubclassSupport = subclassItems.length > 0;

  let selectedSubclassSourceId = preferredSubclassSourceId
    ?? requestedSelections.subclassSourceId
    ?? existingSelections.subclassSourceId
    ?? existingSubclassItem?.getFlag?.(MODULE_ID, "sourceId")
    ?? null;
  if (selectedSubclassSourceId && !subclassSourceIdSet.has(selectedSubclassSourceId)) selectedSubclassSourceId = null;
  const includeSubclass = hasSubclassSupport
    ? (requestedSelections.includeSubclass ?? existingSelections.includeSubclass ?? Boolean(selectedSubclassSourceId))
    : false;
  const effectiveSubclassSourceId = includeSubclass ? selectedSubclassSourceId : null;

  const optionGroups = normalizeClassOptionGroups(classItem.flags?.[MODULE_ID]?.optionGroups)
    .map((group) => {
      const availableOptions = optionItems
        .filter((item) => (item.flags?.[MODULE_ID]?.groupSourceId ?? null) === group.sourceId)
        .filter((item) => Number(item.flags?.[MODULE_ID]?.levelPrerequisite ?? 0) <= normalizedTargetLevel)
        .sort((left, right) => left.name.localeCompare(right.name));
      const maxSelections = getSelectionCountForLevel(group.selectionCountsByLevel, normalizedTargetLevel);
      const preferredSelections = requestedSelections.optionSelections[group.sourceId]?.length
        ? requestedSelections.optionSelections[group.sourceId]
        : existingSelections.optionSelections[group.sourceId] ?? [];
      const validSelections = preferredSelections.filter((sourceId) =>
        availableOptions.some((item) => item.flags?.[MODULE_ID]?.sourceId === sourceId));

      return {
        ...group,
        maxSelections,
        options: availableOptions,
        selectedSourceIds: maxSelections > 0 ? validSelections.slice(0, maxSelections) : [],
        featureName: classFeatures.find((item) => item.flags?.[MODULE_ID]?.sourceId === group.featureSourceId)?.name ?? null
      };
    });

  const normalizedSelection = {
    includeSubclass,
    subclassSourceId: effectiveSubclassSourceId,
    optionSelections: Object.fromEntries(optionGroups
      .filter((group) => group.selectedSourceIds.length)
      .map((group) => [group.sourceId, [...group.selectedSourceIds]])),
    hpMode: requestedSelections.hpMode ?? existingSelections.hpMode ?? (normalizedTargetLevel <= 1 ? "max" : "average"),
    hpCustomFormula: requestedSelections.hpCustomFormula ?? existingSelections.hpCustomFormula ?? null,
    spellMode: requestedSelections.spellMode ?? existingSelections.spellMode ?? (classItem.system?.spellcasting?.progression !== "none" ? "placeholder" : null),
    skillSelections: getInitialSkillSelections({
      classData: semanticClassData,
      requestedSelections,
      existingSelections
    })
  };

  const desiredClassFeatureIds = collectGrantedFeatureSourceIds(classItem.system?.advancement, normalizedTargetLevel);
  const desiredClassFeatureItems = classFeatures.filter((item) => {
    const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? null;
    if (!sourceId || !desiredClassFeatureIds.has(sourceId)) return false;

    const featureKind = item.flags?.[MODULE_ID]?.featureKind ?? null;
    const featureLevel = Number(item.flags?.[MODULE_ID]?.level ?? 0);
    if (featureKind === "subclassChoice") {
      if (!normalizedSelection.includeSubclass) return false;
      if (featureLevel > 1) return false;
    }
    return true;
  });

  const selectedSubclassItem = normalizedSelection.includeSubclass && normalizedSelection.subclassSourceId
    ? subclassItems.find((item) => item.flags?.[MODULE_ID]?.sourceId === normalizedSelection.subclassSourceId) ?? null
    : null;
  const desiredSubclassFeatureIds = selectedSubclassItem
    ? collectGrantedFeatureSourceIds(selectedSubclassItem.system?.advancement, normalizedTargetLevel)
    : new Set();
  const desiredSubclassFeatureItems = selectedSubclassItem
    ? subclassFeatures.filter((item) =>
      (item.flags?.[MODULE_ID]?.parentSourceId ?? null) === normalizedSelection.subclassSourceId
      && desiredSubclassFeatureIds.has(item.flags?.[MODULE_ID]?.sourceId ?? ""))
    : [];

  const selectedOptionSourceIds = new Set(Object.values(normalizedSelection.optionSelections).flat());
  const selectedOptionItems = optionItems.filter((item) => selectedOptionSourceIds.has(item.flags?.[MODULE_ID]?.sourceId ?? ""));
  const skillChoices = buildSkillChoiceConfig(semanticClassData);
  const levelRows = buildClassLevelRows({
    classFeatures,
    subclassFeatures,
    selectedSubclassSourceId: selectedSubclassItem?.flags?.[MODULE_ID]?.sourceId ?? null,
    includeSubclass: normalizedSelection.includeSubclass,
    minimumLevel: Math.max(existingClassLevel, 1),
    targetLevel: normalizedTargetLevel
  });
  const spellcastingRows = buildSpellcastingProgressionRows(supportedPayload, semanticClassData);

  log("Class import workflow skill trace", {
    entrySourceId: entry?.sourceId ?? null,
    payloadKind: supportedPayload?.kind ?? supportedPayload?.type ?? "raw",
    classSourceId,
    className: classItem?.name ?? null,
    actorName: targetActor?.name ?? null,
    targetLevel: normalizedTargetLevel,
    semanticSkills: summarizeSkillChoiceSource(semanticClassData),
    resolvedSkillChoices: {
      choiceCount: skillChoices.choiceCount,
      fixed: [...skillChoices.fixed],
      options: [...skillChoices.options],
      allOptions: [...skillChoices.allOptions]
    }
  });

  return {
    payload: supportedPayload,
    bundle,
    semanticClassData,
    classItem,
    classSourceId,
    targetActor,
    targetLevel: normalizedTargetLevel,
    existingClassLevel,
    classFeatures,
    subclassItems,
    subclassFeatures,
    optionItems,
    optionGroups,
    minSubclassLevel,
    requiresSubclassSelection: Boolean(
      targetActor
      && normalizedSelection.includeSubclass
      && subclassItems.length
      && normalizedTargetLevel >= minSubclassLevel
    ),
    selection: normalizedSelection,
    selectedSubclassItem,
    existingClassItem,
    existingSubclassItem,
    desiredClassFeatureItems,
    desiredSubclassFeatureItems,
    selectedOptionItems,
    hasSpellcasting: classItem.system?.spellcasting?.progression !== "none",
    hasSubclassSupport,
    skillChoices,
    levelRows,
    spellcastingRows,
    startingEquipment: semanticClassData?.startingEquipment ?? ""
  };
}

function normalizeSupportedClassPayload(payload, { entry = null } = {}) {
  if (!payload || typeof payload !== "object") return null;

  if (payload.kind === "dauligor.class-bundle.v1") return payload;
  if (payload.kind === "dauligor.item.v1" && payload.item?.type === "class") return payload;
  if (payload.type === "class" && payload.system) return payload;
  if (isSemanticClassExport(payload)) return normalizeSemanticClassExportToBundle(payload, { entry });

  return payload;
}

function coerceClassPayloadToBundle(payload) {
  if (payload?.kind === "dauligor.class-bundle.v1") return payload;

  if (payload?.kind === "dauligor.item.v1" && payload.item?.type === "class") {
    return {
      kind: "dauligor.class-bundle.v1",
      source: payload.source ?? null,
      schemaVersion: payload.schemaVersion ?? 1,
      classItem: payload.item,
      classFeatures: [],
      subclassItems: [],
      subclassFeatures: [],
      optionItems: []
    };
  }

  if (payload?.type === "class" && payload.system) {
    return {
      kind: "dauligor.class-bundle.v1",
      source: null,
      schemaVersion: 1,
      classItem: payload,
      classFeatures: [],
      subclassItems: [],
      subclassFeatures: [],
      optionItems: []
    };
  }

  return {
    kind: "dauligor.class-bundle.v1",
    source: payload?.source ?? null,
    schemaVersion: payload?.schemaVersion ?? 1,
    classItem: payload?.classItem ?? {},
    classFeatures: ensureArray(payload?.classFeatures),
    subclassItems: ensureArray(payload?.subclassItems),
    subclassFeatures: ensureArray(payload?.subclassFeatures),
    optionItems: ensureArray(payload?.optionItems)
  };
}

function sanitizeClassImportSelection(selection) {
  const optionSelections = {};
  for (const [groupSourceId, sourceIds] of Object.entries(selection?.optionSelections ?? {})) {
    const normalizedGroupSourceId = trimString(groupSourceId);
    const normalizedSourceIds = [...new Set(ensureArray(sourceIds).map((sourceId) => trimString(sourceId)).filter(Boolean))];
    if (!normalizedGroupSourceId || !normalizedSourceIds.length) continue;
    optionSelections[normalizedGroupSourceId] = normalizedSourceIds;
  }

  return {
    includeSubclass: selection?.includeSubclass === undefined ? null : Boolean(selection.includeSubclass),
    subclassSourceId: trimString(selection?.subclassSourceId) || null,
    optionSelections,
    hpMode: trimString(selection?.hpMode) || null,
    hpCustomFormula: trimString(selection?.hpCustomFormula) || null,
    spellMode: trimString(selection?.spellMode) || null,
    skillSelections: [...new Set(ensureArray(selection?.skillSelections).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))]
  };
}

function getSemanticClassData(payload) {
  if (isSemanticClassExport(payload)) return payload.class ?? null;
  if (payload?.kind === "dauligor.class-bundle.v1") return payload.semanticClassData ?? null;
  return payload?.semanticClassData ?? null;
}

function getInitialSkillSelections({ classData = null, requestedSelections = {}, existingSelections = {} } = {}) {
  const skillConfig = buildSkillChoiceConfig(classData);
  const requested = requestedSelections.skillSelections?.length ? requestedSelections.skillSelections : existingSelections.skillSelections ?? [];
  const selected = new Set(skillConfig.fixed);
  for (const slug of requested) {
    if (skillConfig.availableSet.has(slug)) selected.add(slug);
  }
  return [...selected];
}

function buildSkillChoiceConfig(classData) {
  const skills = classData?.proficiencies?.skills ?? classData?.skills ?? {};
  const fixed = [...new Set(ensureArray(skills.fixed).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))];
  const options = [...new Set(ensureArray(skills.options).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))];
  const allOptions = [...new Set([...fixed, ...options])];
  const availableSet = new Set(allOptions);

  return {
    choiceCount: Math.max(0, Number(skills.choiceCount ?? 0) || 0),
    fixed,
    options,
    allOptions,
    availableSet
  };
}

function summarizeSkillChoiceSource(classData) {
  return {
    topLevelSkills: foundry.utils.deepClone(classData?.skills ?? null),
    proficiencySkills: foundry.utils.deepClone(classData?.proficiencies?.skills ?? null)
  };
}

function normalizeSkillSlug(value) {
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return null;
  if (CONFIG.DND5E?.skills?.[normalized]) return normalized;

  const aliases = {
    acr: "acr",
    acrobatics: "acr",
    ani: "ani",
    animalhandling: "ani",
    "animal-handling": "ani",
    arc: "arc",
    arcana: "arc",
    ath: "ath",
    athletics: "ath",
    dec: "dec",
    deception: "dec",
    his: "his",
    history: "his",
    ins: "ins",
    insight: "ins",
    inv: "inv",
    investigation: "inv",
    itm: "itm",
    intimidation: "itm",
    med: "med",
    medicine: "med",
    nat: "nat",
    nature: "nat",
    per: "per",
    persuasion: "per",
    prc: "prc",
    perception: "prc",
    prf: "prf",
    performance: "prf",
    rel: "rel",
    religion: "rel",
    slt: "slt",
    sleightofhand: "slt",
    "sleight-of-hand": "slt",
    ste: "ste",
    stealth: "ste",
    sur: "sur",
    survival: "sur"
  };

  const compact = normalized.replace(/[^a-z]/g, "");
  const aliased = aliases[normalized] ?? aliases[compact];
  return aliased && CONFIG.DND5E?.skills?.[aliased] ? aliased : null;
}

function normalizeClassOptionGroups(groups) {
  return ensureArray(groups)
    .map((group) => ({
      sourceId: trimString(group?.sourceId) || null,
      featureSourceId: trimString(group?.featureSourceId) || null,
      scalingSourceId: trimString(group?.scalingSourceId) || null,
      selectionCountsByLevel: normalizeScaleValues(group?.selectionCountsByLevel),
      name: trimString(group?.name) || null
    }))
    .filter((group) => group.sourceId);
}

function getMinimumSubclassSelectionLevel(classAdvancement, classFeatures) {
  const subclassAdvancementLevel = Object.values(normalizeAdvancementStructure(classAdvancement))
    .map((entry) => (entry?.type === "Subclass" ? Number(entry?.level ?? 0) : 0))
    .filter((level) => Number.isFinite(level) && level > 0);

  if (subclassAdvancementLevel.length) {
    return Math.min(...subclassAdvancementLevel);
  }

  const levels = ensureArray(classFeatures)
    .map((item) => ({
      featureKind: item.flags?.[MODULE_ID]?.featureKind ?? null,
      level: Number(item.flags?.[MODULE_ID]?.level ?? 0)
    }))
    .filter(({ featureKind, level }) => featureKind === "subclassChoice" && level > 0)
    .map(({ level }) => level);

  return levels.length ? Math.min(...levels) : 99;
}

function getSelectionCountForLevel(values, targetLevel) {
  let selected = 0;
  for (const [level, count] of Object.entries(normalizeScaleValues(values))) {
    const numericLevel = Number(level);
    if (!Number.isFinite(numericLevel) || numericLevel > targetLevel) continue;
    selected = Number(count ?? 0) || selected;
  }
  return Math.max(0, selected);
}

function buildClassLevelRows({
  classFeatures = [],
  subclassFeatures = [],
  selectedSubclassSourceId = null,
  includeSubclass = false,
  minimumLevel = 1,
  targetLevel = 1,
  maxLevel = 20
} = {}) {
  const byLevel = new Map();
  const pushFeature = (level, name) => {
    if (!Number.isFinite(level) || level <= 0 || !name) return;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(name);
  };

  for (const item of ensureArray(classFeatures)) {
    const level = Number(item.flags?.[MODULE_ID]?.level ?? 0);
    const featureKind = item.flags?.[MODULE_ID]?.featureKind ?? null;
    if (featureKind === "subclassChoice") {
      if (!includeSubclass) continue;
      if (level > 1) continue;
    }
    pushFeature(level, trimString(item.name));
  }

  if (includeSubclass && selectedSubclassSourceId) {
    for (const item of ensureArray(subclassFeatures)) {
      if ((item.flags?.[MODULE_ID]?.parentSourceId ?? null) !== selectedSubclassSourceId) continue;
      const level = Number(item.flags?.[MODULE_ID]?.level ?? 0);
      pushFeature(level, trimString(item.name));
    }
  }

  return Array.from({ length: maxLevel }, (_value, index) => {
    const level = index + 1;
    return {
      level,
      featureSummary: [...new Set(byLevel.get(level) ?? [])].join(", ") || "-",
      locked: level < minimumLevel,
      selected: level <= targetLevel,
      current: level === targetLevel
    };
  });
}

function buildSpellcastingProgressionRows(payload, classData) {
  const spellcastingId = classData?.spellcastingId ?? classData?.spellcasting?.progressionId ?? null;
  const levels = payload?.spellcastingScalings?.[spellcastingId]?.levels ?? null;
  if (!levels || typeof levels !== "object") return [];

  return Object.entries(levels)
    .map(([level, data]) => {
      const numericLevel = Number(level);
      if (!Number.isFinite(numericLevel) || !data || typeof data !== "object") return null;
      const slotPairs = Object.entries(data)
        .filter(([key, value]) => /^\d+$/.test(String(key)) && Number(value ?? 0) > 0)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([slotLevel, count]) => `${slotLevel}:${count}`);

      return {
        level: numericLevel,
        cantrips: data.cantrips ?? "—",
        spells: data.spells ?? "—",
        slots: slotPairs.length ? slotPairs.join(" ") : "—"
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.level - right.level);
}

function isSemanticClassExport(payload) {
  return !!payload?.class
    && typeof payload.class === "object"
    && Array.isArray(payload.features)
    && Array.isArray(payload.subclasses)
    && Array.isArray(payload.scalingColumns);
}

function normalizeSemanticClassExportToBundle(payload, { entry = null } = {}) {
  const classData = payload.class ?? {};
  const subclasses = ensureArray(payload.subclasses);
  const features = ensureArray(payload.features);
  const scalingColumns = ensureArray(payload.scalingColumns);
  const uniqueOptionGroups = ensureArray(payload.uniqueOptionGroups);
  const uniqueOptionItems = ensureArray(payload.uniqueOptionItems);
  const sourceMeta = buildSemanticSourceMeta(payload);
  const sourceBookId = trimString(sourceMeta.sourceId ?? classData.sourceId) || null;
  const classSourceId = resolveSemanticEntitySourceId("class", classData, { sourceBookId });

  const context = {
    payload,
    entry,
    classData,
    subclasses,
    features,
    scalingColumns,
    uniqueOptionGroups,
    uniqueOptionItems,
    sourceMeta,
    sourceBookId,
    classSourceId,
    classIdentifier: normalizeSemanticIdentifier(classData.identifier ?? classData.name ?? classData.id, "class"),
    featuresById: indexBy(features, "id"),
    featuresBySourceId: indexBy(features, "sourceId"),
    subclassesById: indexBy(subclasses, "id"),
    subclassesBySourceId: indexBy(subclasses, "sourceId"),
    scalingColumnsById: indexBy(scalingColumns, "id"),
    scalingColumnsBySourceId: indexBy(scalingColumns, "sourceId"),
    optionGroupsById: indexBy(uniqueOptionGroups, "id"),
    optionGroupsBySourceId: indexBy(uniqueOptionGroups, "sourceId")
  };

  const classFeatures = features
    .filter((feature) => shouldTreatAsClassGrantFeature(feature, context))
    .map((feature) => createSemanticFeatureItem(feature, context, { sourceType: "classFeature" }));

  const subclassFeatures = features
    .filter((feature) => feature?.featureKind === "subclassFeature")
    .map((feature) => createSemanticFeatureItem(feature, context, { sourceType: "subclassFeature" }));

  const optionItems = uniqueOptionItems
    .map((optionItem) => createSemanticOptionItem(optionItem, context))
    .filter(Boolean);

  const subclassItems = subclasses
    .map((subclass) => createSemanticSubclassItem(subclass, context))
    .filter(Boolean);

  const classItem = createSemanticClassItem(context);

  log("Normalized semantic class export", {
    entrySourceId: entry?.sourceId ?? null,
    classSourceId,
    sourceBookId,
    classEntityId: trimString(classData?.id) || null,
    className: classData?.name ?? null,
    skillSource: summarizeSkillChoiceSource(classData)
  });

  return {
    kind: "dauligor.class-bundle.v1",
    schemaVersion: 1,
    source: context.sourceMeta,
    semanticClassData: foundry.utils.deepClone(classData),
    classItem,
    classFeatures,
    subclassItems,
    subclassFeatures,
    optionItems
  };
}

function createSemanticClassItem(context) {
  const { classData, sourceMeta, classIdentifier, subclasses, uniqueOptionGroups } = context;
  const optionGroupMetadata = buildSemanticOptionGroupMetadata(context);
  const hitDieValue = parseHitDieFaces(classData.hitDie);
  const rootAdvancement = normalizeSemanticRootAdvancements(classData?.advancements, context, {
    ownerSourceId: context.classSourceId,
    defaultLevel: 1
  });

  const item = {
    name: trimString(classData.name) || "Class",
    type: "class",
    img: normalizeImagePath(classData.imageUrl, DEFAULT_CLASS_ICON),
    flags: {
      [MODULE_ID]: {
        sourceId: context.classSourceId,
        sourceBookId: context.sourceBookId,
        entityId: trimString(classData.id) || null,
        identifier: classIdentifier,
        hitDieValue,
        sourceType: "class",
        subclassSourceIds: subclasses.map((subclass) => subclass?.sourceId).filter(Boolean),
        optionGroups: optionGroupMetadata
      }
    },
    system: {
      identifier: classIdentifier,
      description: {
        value: buildSemanticClassDescription(context),
        chat: ""
      },
      source: buildFoundrySourceData(sourceMeta, context.payload?.source ?? null),
      levels: 1,
      hd: {
        denomination: normalizeHitDie(classData.hitDie),
        spent: 0,
        additional: ""
      },
      spellcasting: buildFoundrySpellcastingData(classData.spellcasting),
      primaryAbility: {
        value: normalizeAbilityList(classData.primaryAbility),
        all: false
      },
      wealth: normalizeWealthFormula(classData.wealth ?? ""),
      properties: [],
      advancement: Object.keys(rootAdvancement).length
        ? rootAdvancement
        : buildSemanticClassAdvancement(context)
    }
  };

  if (!uniqueOptionGroups.length) {
    delete item.flags[MODULE_ID].optionGroups;
  }

  return item;
}

function createSemanticSubclassItem(subclass, context) {
  const subclassSourceId = resolveSemanticEntitySourceId("subclass", subclass, { sourceBookId: context.sourceBookId });
  if (!subclassSourceId) return null;
  const rootAdvancement = normalizeSemanticRootAdvancements(subclass?.advancements, context, {
    ownerSourceId: subclassSourceId,
    defaultLevel: 1
  });

  const sourceMeta = {
    ...context.sourceMeta,
    entity: "subclass",
    id: trimString(subclass?.id) || subclassSourceId
  };

  return {
    name: trimString(subclass.name) || "Subclass",
    type: "subclass",
    img: normalizeImagePath(subclass.imageUrl, DEFAULT_SUBCLASS_ICON),
    flags: {
      [MODULE_ID]: {
        sourceId: subclassSourceId,
        sourceBookId: context.sourceBookId,
        entityId: trimString(subclass?.id) || null,
        identifier: normalizeSemanticIdentifier(subclass.identifier ?? subclass.name ?? subclass.id, "subclass"),
        sourceType: "subclass",
        classSourceId: context.classSourceId ?? null
      }
    },
    system: {
      identifier: normalizeSemanticIdentifier(subclass.identifier ?? subclassSourceId ?? subclass.name, "subclass"),
      classIdentifier: context.classIdentifier,
      description: {
        value: normalizeHtmlBlock(subclass.description) || `<p>${foundry.utils.escapeHTML(trimString(subclass.name) || "Subclass")} imported from Dauligor.</p>`,
        chat: ""
      },
      source: buildFoundrySourceData(sourceMeta, context.payload?.source ?? null),
      advancement: Object.keys(rootAdvancement).length
        ? rootAdvancement
        : buildSemanticSubclassAdvancement(subclass, context)
    }
  };
}

function createSemanticFeatureItem(feature, context, { sourceType = "classFeature" } = {}) {
  const sourceId = feature?.sourceId ?? buildSemanticSourceId(sourceType === "subclassFeature" ? "subclass-feature" : "class-feature", feature);
  const classSourceId = feature?.classSourceId ?? context.classSourceId ?? null;
  const parentSourceId = feature?.parentSourceId ?? null;
  const requirementLabel = buildSemanticFeatureRequirement(feature, context);

  const flags = {
    sourceId,
    sourceBookId: context.sourceBookId,
    entityId: trimString(feature?.id) || null,
    identifier: normalizeSemanticIdentifier(feature?.identifier ?? feature?.name ?? feature?.id, sourceType === "subclassFeature" ? "subclass-feature" : "class-feature") || null,
    classSourceId,
    parentSourceId,
    sourceType,
    featureKind: feature?.featureKind ?? null,
    level: Number(feature?.level ?? 0) || 0
  };

  if (parentSourceId && parentSourceId !== classSourceId) {
    flags.subclassSourceId = parentSourceId;
  }
  if (Array.isArray(feature?.uniqueOptionGroupIds) && feature.uniqueOptionGroupIds.length) {
    flags.uniqueOptionGroupIds = feature.uniqueOptionGroupIds.map((groupId) => {
      const group = context.optionGroupsById.get(groupId);
      return group?.sourceId ?? groupId;
    });
  }
  if (feature?.automation && typeof feature.automation === "object") {
    flags.semanticAutomation = foundry.utils.deepClone(feature.automation);
  }
  if (Array.isArray(feature?.advancements) && feature.advancements.length) {
    flags.semanticAdvancements = foundry.utils.deepClone(feature.advancements);
  }

  const system = {
    description: {
      value: normalizeHtmlBlock(feature?.description) || `<p>${foundry.utils.escapeHTML(buildSemanticFeatureName(feature))}</p>`,
      chat: ""
    },
    requirements: requirementLabel
  };
  const uses = normalizeSemanticUses(feature?.usage ?? feature?.uses);
  if (uses) system.uses = uses;

  const activities = normalizeSemanticActivityCollection(feature?.automation?.activities);
  if (activities && Object.keys(activities).length) system.activities = activities;

  const advancement = normalizeSemanticFeatureAdvancements(feature, context);
  if (advancement && Object.keys(advancement).length) system.advancement = advancement;

  return {
    name: buildSemanticFeatureName(feature),
    type: "feat",
    img: normalizeImagePath(feature?.imageUrl, DEFAULT_FEATURE_ICON),
    flags: {
      [MODULE_ID]: flags
    },
    system
  };
}

function createSemanticOptionItem(optionItem, context) {
  const sourceId = optionItem?.sourceId ?? buildSemanticSourceId("class-option", optionItem);
  if (!sourceId) return null;

  const group = context.optionGroupsBySourceId.get(optionItem?.groupSourceId)
    ?? context.optionGroupsById.get(optionItem?.groupId)
    ?? null;
  const feature = group?.featureSourceId
    ? context.featuresBySourceId.get(group.featureSourceId)
    : null;

  const flags = {
    sourceId,
    sourceBookId: context.sourceBookId,
    entityId: trimString(optionItem?.id) || null,
    identifier: normalizeSemanticIdentifier(optionItem?.identifier ?? optionItem?.name ?? optionItem?.id, "class-option") || null,
    sourceType: "classOption",
    classSourceId: context.classSourceId ?? null,
    groupSourceId: group?.sourceId ?? optionItem?.groupSourceId ?? null,
    featureSourceId: group?.featureSourceId ?? null,
    scalingSourceId: group?.scalingSourceId ?? null
  };
  if (optionItem?.levelPrerequisite != null) flags.levelPrerequisite = optionItem.levelPrerequisite;

  if (optionItem?.automation && typeof optionItem.automation === "object") {
    flags.semanticAutomation = foundry.utils.deepClone(optionItem.automation);
  }
  if (Array.isArray(optionItem?.advancements) && optionItem.advancements.length) {
    flags.semanticAdvancements = foundry.utils.deepClone(optionItem.advancements);
  }

  const system = {
    description: {
      value: normalizeHtmlBlock(optionItem?.description) || `<p>${foundry.utils.escapeHTML(trimString(optionItem?.name) || "Class Option")}</p>`,
      chat: ""
    },
    requirements: buildSemanticOptionRequirement(optionItem, context, feature)
  };
  const uses = normalizeSemanticUses(optionItem?.usage ?? optionItem?.uses);
  if (uses) system.uses = uses;

  const activities = normalizeSemanticActivityCollection(optionItem?.automation?.activities);
  if (activities && Object.keys(activities).length) system.activities = activities;

  const advancement = normalizeSemanticFeatureAdvancements(optionItem, context);
  if (advancement && Object.keys(advancement).length) system.advancement = advancement;

  return {
    name: trimString(optionItem?.name) || "Class Option",
    type: "feat",
    img: normalizeImagePath(optionItem?.imageUrl, DEFAULT_OPTION_ICON),
    flags: {
      [MODULE_ID]: flags
    },
    system
  };
}

function normalizeSemanticFeatureAdvancements(feature, context) {
  const entries = ensureArray(feature?.advancements)
    .map((advancement, index) => normalizeSemanticFeatureAdvancement(advancement, { feature, context, index }))
    .filter(Boolean);

  return entries.length ? normalizeAdvancementStructure(entries) : null;
}

function normalizeSemanticRootAdvancements(advancements, context, {
  ownerSourceId = null,
  defaultLevel = 1
} = {}) {
  const advancementEntries = Array.isArray(advancements)
    ? advancements
    : (advancements && typeof advancements === "object")
      ? Object.values(advancements)
      : [];

  const entries = advancementEntries
    .map((advancement, index) => normalizeSemanticRootAdvancement(advancement, {
      context,
      ownerSourceId,
      defaultLevel,
      index
    }))
    .filter(Boolean);

  return entries.length ? normalizeAdvancementStructure(entries) : {};
}

function normalizeSemanticRootAdvancement(advancement, {
  context,
  ownerSourceId,
  defaultLevel = 1,
  index = 0
} = {}) {
  const type = trimString(advancement?.type);
  if (!type) return null;

  const sourceOwnerId = ownerSourceId ?? "semantic-owner";
  const sourceAdvancementId = trimString(advancement?._id) || buildAdvancementId(sourceOwnerId, type, `root-advancement-${index + 1}`);
  const level = Number(advancement?.level ?? defaultLevel ?? 0) || 0;
  const title = trimString(advancement?.title);
  const hint = trimString(advancement?.hint);
  const flags = foundry.utils.deepClone(advancement?.flags ?? {});
  flags[MODULE_ID] ??= {};
  flags[MODULE_ID].semanticAdvancementId = sourceAdvancementId;
  flags[MODULE_ID].sourceAdvancementId = sourceAdvancementId;

  const base = {
    _id: sourceAdvancementId,
    type,
    configuration: {},
    value: foundry.utils.deepClone(advancement?.value ?? {}),
    flags,
    hint
  };
  if (level > 0) base.level = level;
  if (title) base.title = title;
  if (trimString(advancement?.classRestriction)) base.classRestriction = trimString(advancement.classRestriction);

  if (trimString(advancement?.featureSourceId)) {
    base.flags[MODULE_ID].featureSourceId = trimString(advancement.featureSourceId);
  }

  switch (type) {
    case "AbilityScoreImprovement":
    case "Size":
      base.configuration = foundry.utils.deepClone(advancement?.configuration ?? {});
      return base;

    case "HitPoints":
      base.configuration = foundry.utils.deepClone(advancement?.configuration ?? {});
      base.value = foundry.utils.deepClone(advancement?.value ?? {});
      return base;

    case "Subclass":
      base.configuration = foundry.utils.deepClone(advancement?.configuration ?? {});
      base.value = foundry.utils.deepClone(advancement?.value ?? {});
      return base;

    case "ItemGrant":
      return normalizeSemanticRootItemGrantAdvancement(base, advancement, context);

    case "ItemChoice":
      return normalizeSemanticRootItemChoiceAdvancement(base, advancement, context);

    case "ScaleValue":
      return normalizeSemanticFeatureScaleAdvancement(base, advancement, context);

    case "Trait":
      return normalizeSemanticRootTraitAdvancement(base, advancement, context);

    default:
      return null;
  }
}

function normalizeSemanticFeatureAdvancement(advancement, { feature, context, index = 0 } = {}) {
  const type = trimString(advancement?.type);
  if (!FEATURE_SUPPORTED_ADVANCEMENT_TYPES.has(type)) return null;

  const featureSourceId = feature?.sourceId
    ?? buildSemanticSourceId(feature?.featureKind === "subclassFeature" ? "subclass-feature" : "class-feature", feature);
  const id = trimString(advancement?._id) || buildAdvancementId(featureSourceId, type, `feature-advancement-${index + 1}`);
  const level = Number(advancement?.level ?? feature?.level ?? 0) || 0;
  const title = trimString(advancement?.title);
  const hint = trimString(advancement?.hint);

  const flags = foundry.utils.deepClone(advancement?.flags ?? {});
  flags[MODULE_ID] ??= {};
  flags[MODULE_ID].semanticAdvancementId = trimString(advancement?._id) || id;
  flags[MODULE_ID].featureSourceId = featureSourceId;

  const base = {
    _id: id,
    type,
    configuration: {},
    value: foundry.utils.deepClone(advancement?.value ?? {}),
    flags,
    hint
  };
  if (level > 0) base.level = level;
  if (title) base.title = title;
  if (trimString(advancement?.classRestriction)) base.classRestriction = trimString(advancement.classRestriction);

  switch (type) {
    case "AbilityScoreImprovement":
      base.configuration = foundry.utils.deepClone(advancement?.configuration ?? {});
      return base;

    case "ItemGrant":
      return normalizeSemanticFeatureItemGrantAdvancement(base, advancement, context);

    case "ItemChoice":
      return normalizeSemanticFeatureItemChoiceAdvancement(base, advancement, context);

    case "ScaleValue":
      return normalizeSemanticFeatureScaleAdvancement(base, advancement, context);

    case "Trait":
      return normalizeSemanticFeatureTraitAdvancement(base, advancement, context);

    default:
      return null;
  }
}

function normalizeSemanticRootItemGrantAdvancement(base, advancement, context) {
  const configuration = advancement?.configuration ?? {};
  const explicitItems = ensureArray(configuration?.items)
    .map((entry) => ({
      sourceId: trimString(entry?.sourceId ?? entry?.uuid ?? entry),
      optional: entry?.optional ?? configuration?.optional ?? false
    }))
    .filter((entry) => entry.sourceId);
  const pooledItems = resolveFeaturePoolSourceIds(configuration?.pool, context)
    .map((sourceId) => ({
      sourceId,
      optional: configuration?.optional ?? false
    }));
  const sourceItemMap = new Map();
  for (const entry of [...explicitItems, ...pooledItems]) {
    if (!entry.sourceId) continue;
    if (!sourceItemMap.has(entry.sourceId)) {
      sourceItemMap.set(entry.sourceId, { ...entry });
      continue;
    }

    const existing = sourceItemMap.get(entry.sourceId);
    existing.optional = existing.optional && entry.optional;
  }
  const sourceItems = [...sourceItemMap.values()];

  base.configuration = {
    items: sourceItems.map((entry) => ({
      sourceId: entry.sourceId,
      optional: entry.optional
    })),
    optional: configuration?.optional ?? false,
    spell: normalizeAdvancementSpellConfig(configuration?.spell)
  };

  if (!base.value || typeof base.value !== "object") base.value = {};
  base.value.added ??= {};
  if (sourceItems.length) {
    base.flags[MODULE_ID].sourceItems = sourceItems.map((entry) => entry.sourceId);
  }

  return base;
}

function normalizeSemanticRootItemChoiceAdvancement(base, advancement, context) {
  const configuration = advancement?.configuration ?? {};
  const level = Number(base.level ?? 0) || 1;
  const sourcePool = configuration?.choiceType === "option-group"
    ? resolveOptionGroupSourceIds(configuration?.optionGroupId, context)
    : resolveFeaturePoolSourceIds(configuration?.pool, context);

  base.configuration = {
    allowDrops: configuration?.allowDrops ?? false,
    choices: normalizeItemChoiceChoices(configuration, level, context),
    pool: sourcePool.map((sourceId) => ({ sourceId })),
    restriction: normalizeItemChoiceRestriction(configuration?.restriction),
    spell: normalizeNullableSpellConfig(configuration?.spell),
    type: trimString(configuration?.type) || "feat"
  };

  if (sourcePool.length) {
    base.flags[MODULE_ID].sourcePool = sourcePool;
  }

  if (!base.value || typeof base.value !== "object") base.value = {};
  base.value.added ??= {};
  base.value.replaced ??= {};
  return base;
}

function normalizeSemanticRootTraitAdvancement(base, advancement, context) {
  const normalized = normalizeSemanticFeatureTraitAdvancement(base, advancement, context);
  if (!normalized) return null;

  const traitType = trimString(advancement?.configuration?.type);
  if (traitType === "skills") {
    normalized.flags[MODULE_ID] ??= {};
    normalized.flags[MODULE_ID].advancementKind = "skills";
  }
  if (traitType === "saves") {
    normalized.flags[MODULE_ID] ??= {};
    normalized.flags[MODULE_ID].advancementKind = "savingThrows";
  }

  return normalized;
}

function normalizeSemanticFeatureItemGrantAdvancement(base, advancement, context) {
  const configuration = advancement?.configuration ?? {};
  const sourceItems = dedupeSourceIds([
    ...resolveFeaturePoolSourceIds(configuration?.pool, context),
    ...ensureArray(configuration?.items).map((entry) => trimString(entry?.sourceId ?? entry)).filter(Boolean)
  ]);

  base.configuration = {
    items: ensureArray(configuration?.items)
      .filter((entry) => trimString(entry?.uuid))
      .map((entry) => ({
        uuid: trimString(entry.uuid),
        optional: entry.optional ?? false
      })),
    optional: configuration?.optional ?? false,
    spell: normalizeAdvancementSpellConfig(configuration?.spell)
  };

  if (sourceItems.length) {
    base.flags[MODULE_ID].sourceItems = sourceItems;
  }

  if (!base.value || typeof base.value !== "object") base.value = {};
  base.value.added ??= {};
  return base;
}

function normalizeSemanticFeatureItemChoiceAdvancement(base, advancement, context) {
  const configuration = advancement?.configuration ?? {};
  const level = Number(base.level ?? 0) || 1;
  const sourcePool = configuration?.choiceType === "option-group"
    ? resolveOptionGroupSourceIds(configuration?.optionGroupId, context)
    : resolveFeaturePoolSourceIds(configuration?.pool, context);

  base.configuration = {
    allowDrops: configuration?.allowDrops ?? false,
    choices: normalizeItemChoiceChoices(configuration, level, context),
    pool: ensureArray(configuration?.pool)
      .filter((entry) => trimString(entry?.uuid))
      .map((entry) => ({ uuid: trimString(entry.uuid) })),
    restriction: normalizeItemChoiceRestriction(configuration?.restriction),
    spell: normalizeNullableSpellConfig(configuration?.spell),
    type: trimString(configuration?.type) || "feat"
  };

  if (sourcePool.length) {
    base.flags[MODULE_ID].sourcePool = sourcePool;
  }

  if (!base.value || typeof base.value !== "object") base.value = {};
  base.value.added ??= {};
  base.value.replaced ??= {};
  return base;
}

function normalizeSemanticFeatureScaleAdvancement(base, advancement, context) {
  const configuration = foundry.utils.deepClone(advancement?.configuration ?? {});
  const scale = normalizeScaleConfiguration(
    configuration?.scale
    ?? context.scalingColumnsById.get(configuration?.scalingColumnId)?.values
    ?? context.scalingColumnsBySourceId.get(configuration?.scalingSourceId)?.values
  );
  const identifier = trimString(configuration?.identifier);
  if (!identifier || !Object.keys(scale).length) return null;

  base.configuration = {
    identifier,
    type: trimString(configuration?.type) || "number",
    distance: {
      units: trimString(configuration?.distance?.units)
    },
    scale
  };
  if (!base.value || typeof base.value !== "object") base.value = {};
  return base;
}

function normalizeSemanticFeatureTraitAdvancement(base, advancement, context) {
  const configuration = advancement?.configuration ?? {};
  if (Array.isArray(configuration?.choices) && Array.isArray(configuration?.grants)) {
    base.configuration = {
      mode: trimString(configuration?.mode) || "default",
      allowReplacements: configuration?.allowReplacements ?? false,
      grants: ensureArray(configuration?.grants).map((entry) => trimString(entry)).filter(Boolean),
      choices: ensureArray(configuration?.choices)
        .map((choice) => ({
          count: Math.max(0, Number(choice?.count ?? 0) || 0),
          pool: ensureArray(choice?.pool).map((entry) => trimString(entry)).filter(Boolean)
        }))
        .filter((choice) => choice.count > 0 && choice.pool.length)
    };
    if (!base.value || typeof base.value !== "object") base.value = {};
    return base;
  }

  const grants = ensureArray(configuration?.fixed)
    .map((entry) => normalizeTraitKey(configuration?.type, entry))
    .filter(Boolean);
  const pool = ensureArray(configuration?.options)
    .map((entry) => normalizeTraitKey(configuration?.type, entry))
    .filter(Boolean);
  const choiceCount = configuration?.choiceSource === "scaling"
    ? 0
    : Math.max(0, Number(configuration?.choiceCount ?? 0) || 0);

  if (!grants.length && (!pool.length || choiceCount <= 0)) return null;

  base.configuration = {
    mode: trimString(configuration?.mode) || "default",
    allowReplacements: configuration?.allowReplacements ?? false,
    grants,
    choices: pool.length && choiceCount > 0
      ? [{
        count: choiceCount,
        pool
      }]
      : []
  };
  if (!base.value || typeof base.value !== "object") base.value = {};
  return base;
}

function normalizeItemChoiceChoices(configuration, level, context) {
  if (configuration?.choices && typeof configuration.choices === "object") {
    const normalized = {};
    for (const [choiceLevel, data] of Object.entries(configuration.choices)) {
      const numericLevel = Number(choiceLevel);
      const count = Math.max(0, Number(data?.count ?? 0) || 0);
      if (!Number.isFinite(numericLevel) || numericLevel <= 0) continue;
      if (count <= 0 && !data?.replacement) continue;
      normalized[String(numericLevel)] = {
        count,
        replacement: data?.replacement ?? false
      };
    }
    if (Object.keys(normalized).length) return normalized;
  }

  if (configuration?.countSource === "scaling") {
    const values = normalizeScaleValues(
      context.scalingColumnsById.get(configuration?.scalingColumnId)?.values
      ?? context.scalingColumnsBySourceId.get(configuration?.scalingSourceId)?.values
    );
    const choices = buildIncrementalChoiceMap(values, level);
    if (Object.keys(choices).length) return choices;
  }

  const count = Math.max(0, Number(configuration?.count ?? 0) || 0);
  if (count <= 0) return {};
  return {
    [String(level)]: {
      count,
      replacement: configuration?.replacement ?? false
    }
  };
}

function buildIncrementalChoiceMap(values, minimumLevel = 1) {
  const mapped = {};
  let previous = 0;

  for (const [level, value] of Object.entries(values ?? {}).sort((left, right) => Number(left[0]) - Number(right[0]))) {
    const numericLevel = Number(level);
    const numericValue = Number(value ?? 0) || 0;
    if (!Number.isFinite(numericLevel) || numericLevel <= 0) continue;

    if (numericLevel < minimumLevel) {
      previous = numericValue;
      continue;
    }

    const delta = numericValue - previous;
    if (delta > 0) {
      mapped[String(numericLevel)] = {
        count: delta,
        replacement: false
      };
    }
    previous = numericValue;
  }

  return mapped;
}

function normalizeItemChoiceRestriction(restriction) {
  return {
    level: trimString(restriction?.level),
    list: ensureArray(restriction?.list).map((entry) => trimString(entry)).filter(Boolean),
    subtype: trimString(restriction?.subtype),
    type: trimString(restriction?.type)
  };
}

function normalizeAdvancementSpellConfig(spell) {
  return {
    ability: Array.isArray(spell?.ability)
      ? spell.ability.map((entry) => trimString(entry))
      : [trimString(spell?.ability)],
    uses: {
      max: trimString(spell?.uses?.max),
      per: trimString(spell?.uses?.per),
      requireSlot: spell?.uses?.requireSlot ?? false
    },
    prepared: Number(spell?.prepared ?? 0) || 0
  };
}

function normalizeNullableSpellConfig(spell) {
  if (!spell || typeof spell !== "object") return null;
  const normalized = normalizeAdvancementSpellConfig(spell);
  const hasAbility = normalized.ability.some(Boolean);
  const hasUses = Boolean(normalized.uses.max || normalized.uses.per || normalized.uses.requireSlot);
  const hasPrepared = normalized.prepared !== 0;
  return hasAbility || hasUses || hasPrepared ? normalized : null;
}

function normalizeScaleConfiguration(scale) {
  const normalized = {};
  for (const [level, value] of Object.entries(scale ?? {})) {
    const numericLevel = Number(level);
    if (!Number.isFinite(numericLevel) || numericLevel <= 0) continue;
    if (value && typeof value === "object" && Object.hasOwn(value, "value")) {
      normalized[String(numericLevel)] = foundry.utils.deepClone(value);
    } else {
      normalized[String(numericLevel)] = { value: normalizeNumericValue(value) };
    }
  }
  return normalized;
}

function resolveFeaturePoolSourceIds(pool, context) {
  return dedupeSourceIds(
    ensureArray(pool)
      .map((entry) => context.featuresById.get(entry)?.sourceId ?? trimString(entry))
      .filter(Boolean)
  );
}

function resolveOptionGroupSourceIds(optionGroupId, context) {
  const group = context.optionGroupsById.get(optionGroupId)
    ?? context.optionGroupsBySourceId.get(optionGroupId)
    ?? null;
  if (!group) return [];

  return dedupeSourceIds(
    context.uniqueOptionItems
      .filter((item) =>
        (item?.groupSourceId && item.groupSourceId === group.sourceId)
        || (item?.groupId && item.groupId === group.id)
      )
      .map((item) => trimString(item?.sourceId))
      .filter(Boolean)
  );
}

function dedupeSourceIds(values) {
  return [...new Set(ensureArray(values).map((value) => trimString(value)).filter(Boolean))];
}

function normalizeTraitKey(type, value) {
  const raw = trimString(value);
  if (!raw) return null;
  if (raw.includes(":")) return raw;

  switch (trimString(type).toLowerCase()) {
    case "skills": {
      const skill = normalizeSkillSlug(raw);
      return skill ? `skills:${skill}` : null;
    }
    case "saves": {
      const ability = normalizeAbilityCode(raw);
      return ability ? `saves:${ability}` : null;
    }
    case "tools":
      return `tool:${slugify(raw)}`;
    case "armor":
      return `armor:${slugify(raw)}`;
    case "weapons":
      return `weapon:${slugify(raw)}`;
    case "languages":
      return `languages:${slugify(raw)}`;
    default:
      return raw;
  }
}

function normalizeSemanticActivityCollection(activities) {
  const entries = Array.isArray(activities)
    ? activities
    : activities && typeof activities === "object"
      ? Object.values(activities)
      : [];
  const normalized = {};

  entries.forEach((activity, index) => {
    const mapped = normalizeSemanticActivity(activity, index);
    if (!mapped) return;
    normalized[mapped._id] = mapped;
  });

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeSemanticActivity(activity, index = 0) {
  const type = trimString(activity?.kind ?? activity?.type).toLowerCase();
  if (!SUPPORTED_SEMANTIC_ACTIVITY_TYPES.has(type)) return null;

  const id = trimString(activity?.id ?? activity?._id) || foundry.utils.randomID();
  const normalized = {
    type,
    _id: id,
    img: normalizeImagePath(activity?.img, `systems/dnd5e/icons/svg/activity/${type}.svg`),
    sort: Number.isFinite(Number(activity?.sort)) ? Number(activity.sort) : index * 100000,
    activation: normalizeSemanticActivation(activity?.activation),
    consumption: normalizeSemanticConsumption(activity?.consumption),
    description: normalizeSemanticActivityDescription(activity),
    duration: normalizeSemanticDuration(activity?.duration),
    effects: normalizeSemanticActivityEffects(activity?.effects),
    flags: foundry.utils.deepClone(activity?.flags ?? {}),
    range: normalizeSemanticRange(activity?.range),
    target: normalizeSemanticTarget(activity?.target),
    uses: normalizeSemanticUses(activity?.uses),
    visibility: normalizeSemanticVisibility(activity?.visibility),
    name: trimString(activity?.name)
  };

  if (activity?.damage) normalized.damage = normalizeSemanticDamage(activity.damage);

  switch (type) {
    case "attack":
      normalized.attack = normalizeSemanticAttack(activity?.attack);
      break;
    case "cast":
      normalized.spell = normalizeSemanticSpell(activity?.spell);
      break;
    case "check":
      normalized.check = normalizeSemanticCheck(activity?.check);
      break;
    case "damage":
      normalized.damage = normalizeSemanticDamage(activity?.damage);
      break;
    case "enchant":
      normalized.enchant = {
        self: activity?.enchant?.self ?? false
      };
      normalized.restrictions = normalizeSemanticEnchantRestrictions(activity?.enchant?.restrictions ?? activity?.restrictions);
      if (!normalized.effects.length) {
        normalized.effects = normalizeSemanticActivityEffects(activity?.enchant?.effects);
      }
      break;
    case "forward":
      normalized.activity = {
        id: trimString(activity?.activity?.id)
      };
      break;
    case "heal":
      normalized.healing = normalizeSemanticHealing(activity?.healing);
      break;
    case "save":
      normalized.save = normalizeSemanticSave(activity?.save);
      break;
    case "summon":
      Object.assign(normalized, normalizeSemanticSummon(activity?.summon));
      break;
    case "transform":
      Object.assign(normalized, normalizeSemanticTransform(activity?.transform));
      break;
    case "utility":
      normalized.roll = normalizeSemanticRoll(activity?.roll);
      break;
    default:
      break;
  }

  return normalized;
}

function normalizeSemanticActivation(activation) {
  return {
    type: trimString(activation?.type),
    override: activation?.override ?? false,
    value: activation?.value ?? undefined,
    condition: trimString(activation?.condition)
  };
}

function normalizeSemanticConsumption(consumption) {
  return {
    scaling: {
      allowed: consumption?.scaling?.allowed ?? false,
      max: normalizeOptionalString(consumption?.scaling?.max)
    },
    spellSlot: consumption?.spellSlot ?? false,
    targets: ensureArray(consumption?.targets).map((target) => ({
      type: trimString(target?.type),
      value: normalizeOptionalString(target?.value),
      target: trimString(target?.target),
      scaling: {
        mode: trimString(target?.scaling?.mode),
        formula: normalizeOptionalString(target?.scaling?.formula)
      }
    }))
  };
}

function normalizeSemanticActivityDescription(activity) {
  return {
    chatFlavor: trimString(activity?.chatFlavor ?? activity?.description?.chatFlavor)
  };
}

function normalizeSemanticDuration(duration) {
  return {
    units: trimString(duration?.units) || "inst",
    concentration: duration?.concentration ?? false,
    override: duration?.override ?? false,
    value: normalizeOptionalString(duration?.value),
    special: trimString(duration?.special)
  };
}

function normalizeSemanticActivityEffects(effects) {
  return ensureArray(effects).map((effect) => ({
    _id: trimString(effect?._id) || foundry.utils.randomID(),
    level: foundry.utils.deepClone(effect?.level ?? {}),
    riders: foundry.utils.deepClone(effect?.riders ?? {})
  }));
}

function normalizeSemanticRange(range) {
  return {
    units: trimString(range?.units) || "self",
    override: range?.override ?? false,
    value: normalizeOptionalString(range?.value),
    special: trimString(range?.special)
  };
}

function normalizeSemanticTarget(target) {
  return {
    template: {
      contiguous: target?.template?.contiguous ?? false,
      stationary: target?.template?.stationary ?? false,
      units: trimString(target?.template?.units) || "ft",
      count: normalizeOptionalString(target?.template?.count),
      type: trimString(target?.template?.type),
      size: normalizeOptionalString(target?.template?.size),
      width: normalizeOptionalString(target?.template?.width),
      height: normalizeOptionalString(target?.template?.height)
    },
    affects: {
      choice: target?.affects?.choice ?? false,
      count: normalizeOptionalString(target?.affects?.count),
      type: trimString(target?.affects?.type),
      special: trimString(target?.affects?.special)
    },
    override: target?.override ?? false,
    prompt: target?.prompt ?? false
  };
}

function normalizeSemanticUses(uses) {
  if (!uses || typeof uses !== "object") return null;
  const hasFields = uses.spent != null || uses.max != null || Array.isArray(uses.recovery);
  if (!hasFields) return null;

  return {
    spent: Math.max(0, Number(uses?.spent ?? 0) || 0),
    max: normalizeOptionalString(uses?.max),
    recovery: normalizeSemanticRecovery(uses?.recovery)
  };
}

function normalizeSemanticRecovery(recovery) {
  return ensureArray(recovery).map((entry) => ({
    period: trimString(entry?.period),
    type: trimString(entry?.type),
    formula: normalizeOptionalString(entry?.formula)
  }));
}

function normalizeSemanticVisibility(visibility) {
  return {
    level: {
      min: visibility?.level?.min ?? null,
      max: visibility?.level?.max ?? null
    },
    requireAttunement: visibility?.requireAttunement ?? false,
    requireIdentification: visibility?.requireIdentification ?? false,
    requireMagic: visibility?.requireMagic ?? false,
    identifier: trimString(visibility?.identifier)
  };
}

function normalizeSemanticAttack(attack) {
  return {
    critical: {
      threshold: attack?.critical?.threshold ?? null
    },
    flat: attack?.flat ?? false,
    type: {
      value: trimString(attack?.type),
      classification: trimString(attack?.classification)
    },
    ability: trimString(attack?.ability),
    bonus: normalizeOptionalString(attack?.bonus)
  };
}

function normalizeSemanticCheck(check) {
  return {
    associated: ensureArray(check?.associated).map((entry) => trimString(entry)).filter(Boolean),
    ability: trimString(check?.ability),
    dc: {
      calculation: trimString(check?.dc?.calculation),
      formula: normalizeOptionalString(check?.dc?.formula)
    }
  };
}

function normalizeSemanticSave(save) {
  return {
    ability: normalizeAbilityList(save?.abilities ?? save?.ability),
    dc: {
      calculation: trimString(save?.dc?.calculation),
      formula: normalizeOptionalString(save?.dc?.formula)
    }
  };
}

function normalizeSemanticDamage(damage) {
  return {
    critical: {
      allow: damage?.critical?.allow,
      bonus: normalizeOptionalString(damage?.critical?.bonus)
    },
    includeBase: damage?.includeBase ?? false,
    onSave: trimString(damage?.onSave),
    parts: ensureArray(damage?.parts).map((part) => ({
      custom: {
        enabled: part?.custom?.enabled ?? false,
        formula: normalizeOptionalString(part?.custom?.formula)
      },
      number: part?.number ?? null,
      denomination: part?.denomination ?? null,
      bonus: normalizeOptionalString(part?.bonus),
      types: ensureArray(part?.types).map((entry) => trimString(entry)).filter(Boolean),
      scaling: {
        mode: trimString(part?.scaling?.mode),
        number: part?.scaling?.number ?? 1,
        formula: normalizeOptionalString(part?.scaling?.formula)
      }
    }))
  };
}

function normalizeSemanticHealing(healing) {
  const firstPart = ensureArray(healing?.parts).find(Boolean);
  if (firstPart) {
    return {
      types: ensureArray(firstPart?.types).map((entry) => trimString(entry)).filter(Boolean),
      custom: {
        enabled: firstPart?.custom?.enabled ?? false,
        formula: normalizeOptionalString(firstPart?.custom?.formula)
      },
      scaling: {
        mode: trimString(firstPart?.scaling?.mode),
        number: firstPart?.scaling?.number ?? 1,
        formula: normalizeOptionalString(firstPart?.scaling?.formula)
      },
      number: firstPart?.number ?? null,
      denomination: firstPart?.denomination ?? null,
      bonus: normalizeOptionalString(firstPart?.bonus)
    };
  }

  return {
    types: ensureArray(healing?.types).map((entry) => trimString(entry)).filter(Boolean),
    custom: {
      enabled: healing?.custom?.enabled ?? false,
      formula: normalizeOptionalString(healing?.custom?.formula)
    },
    scaling: {
      mode: trimString(healing?.scaling?.mode),
      number: healing?.scaling?.number ?? 1,
      formula: normalizeOptionalString(healing?.scaling?.formula)
    },
    number: healing?.number ?? null,
    denomination: healing?.denomination ?? null,
    bonus: normalizeOptionalString(healing?.bonus)
  };
}

function normalizeSemanticSpell(spell) {
  return {
    challenge: {
      override: spell?.challenge?.override ?? false,
      attack: spell?.challenge?.attack ?? null,
      save: spell?.challenge?.save ?? null
    },
    properties: ensureArray(spell?.properties).map((entry) => trimString(entry)).filter(Boolean),
    spellbook: spell?.spellbook ?? false,
    uuid: trimString(spell?.uuid),
    ability: trimString(spell?.ability),
    level: spell?.level ?? null
  };
}

function normalizeSemanticEnchantRestrictions(restrictions) {
  return {
    allowMagical: restrictions?.allowMagical ?? false,
    categories: ensureArray(restrictions?.categories).map((entry) => trimString(entry)).filter(Boolean),
    properties: ensureArray(restrictions?.properties).map((entry) => trimString(entry)).filter(Boolean),
    type: trimString(restrictions?.type)
  };
}

function normalizeSemanticSummon(summon) {
  return {
    bonuses: {
      ac: normalizeOptionalString(summon?.bonuses?.ac),
      hd: normalizeOptionalString(summon?.bonuses?.hd),
      hp: normalizeOptionalString(summon?.bonuses?.hp),
      attackDamage: normalizeOptionalString(summon?.bonuses?.attackDamage),
      saveDamage: normalizeOptionalString(summon?.bonuses?.saveDamage),
      healing: normalizeOptionalString(summon?.bonuses?.healing)
    },
    creatureSizes: ensureArray(summon?.creatureSizes).map((entry) => trimString(entry)).filter(Boolean),
    creatureTypes: ensureArray(summon?.creatureTypes).map((entry) => trimString(entry)).filter(Boolean),
    match: {
      attacks: summon?.match?.attacks ?? false,
      disposition: summon?.match?.disposition ?? false,
      proficiency: summon?.match?.proficiency ?? false,
      saves: summon?.match?.saves ?? false,
      ability: trimString(summon?.match?.ability)
    },
    profiles: ensureArray(summon?.profiles).map((profile) => ({
      count: normalizeOptionalString(profile?.count),
      name: trimString(profile?.name),
      _id: trimString(profile?._id) || foundry.utils.randomID(),
      uuid: trimString(profile?.uuid) || null,
      level: {
        min: profile?.level?.min ?? null,
        max: profile?.level?.max ?? null
      },
      types: ensureArray(profile?.types).map((entry) => trimString(entry)).filter(Boolean)
    })),
    summon: {
      prompt: summon?.prompt ?? false,
      mode: trimString(summon?.mode)
    },
    tempHP: normalizeOptionalString(summon?.tempHP)
  };
}

function normalizeSemanticTransform(transform) {
  return {
    profiles: ensureArray(transform?.profiles).map((profile) => ({
      name: trimString(profile?.name),
      _id: trimString(profile?._id) || foundry.utils.randomID(),
      uuid: trimString(profile?.uuid) || null,
      level: {
        min: profile?.level?.min ?? null,
        max: profile?.level?.max ?? null
      },
      movement: ensureArray(profile?.movement).map((entry) => trimString(entry)).filter(Boolean),
      sizes: ensureArray(profile?.sizes).map((entry) => trimString(entry)).filter(Boolean),
      types: ensureArray(profile?.types).map((entry) => trimString(entry)).filter(Boolean)
    })),
    settings: foundry.utils.deepClone(transform?.settings ?? {}),
    transform: {
      customize: transform?.customize ?? false,
      mode: trimString(transform?.mode),
      preset: trimString(transform?.preset)
    }
  };
}

function normalizeSemanticRoll(roll) {
  return {
    formula: normalizeOptionalString(roll?.formula),
    name: trimString(roll?.name),
    prompt: roll?.prompt ?? false,
    visible: roll?.visible ?? true
  };
}

function buildSemanticClassAdvancement(context) {
  const advancement = {};
  const classSourceId = context.classSourceId ?? buildSemanticSourceId("class", context.classData);

  const hitPoints = buildHitPointsAdvancement(context.classData, classSourceId);
  if (hitPoints) advancement[hitPoints._id] = hitPoints;

  const savingThrows = buildSavingThrowAdvancement(context.classData, classSourceId);
  if (savingThrows) advancement[savingThrows._id] = savingThrows;

  const skillChoices = buildSkillAdvancement(context.classData, classSourceId);
  if (skillChoices) advancement[skillChoices._id] = skillChoices;

  for (const scale of buildScaleValueAdvancements(context)) {
    advancement[scale._id] = scale;
  }

  const classGrantFeatures = context.features.filter((feature) => shouldTreatAsClassGrantFeature(feature, context));
  Object.assign(advancement, buildItemGrantAdvancements(classGrantFeatures, {
    ownerSourceId: classSourceId,
    title: "Features"
  }));

  return advancement;
}

function buildSemanticSubclassAdvancement(subclass, context) {
  const subclassSourceId = resolveSemanticEntitySourceId("subclass", subclass, { sourceBookId: context.sourceBookId });
  const subclassFeatures = context.features.filter((feature) =>
    feature?.featureKind === "subclassFeature"
    && (feature?.parentSourceId ?? null) === subclassSourceId
  );

  return buildItemGrantAdvancements(subclassFeatures, {
    ownerSourceId: subclassSourceId,
    title: "Features"
  });
}

function buildHitPointsAdvancement(classData, ownerSourceId = null) {
  const sourceId = ownerSourceId ?? buildSemanticSourceId("class", classData);
  if (!sourceId) return null;

  return {
    _id: buildAdvancementId(sourceId, "hit-points"),
    type: "HitPoints",
    configuration: {},
    value: {
      1: "max"
    },
    flags: {},
    hint: ""
  };
}

function buildSavingThrowAdvancement(classData, ownerSourceId = null) {
  const sourceId = ownerSourceId ?? buildSemanticSourceId("class", classData);
  const grants = normalizeAbilityList(classData?.savingThrows).map((ability) => `saves:${ability}`);
  if (!sourceId || !grants.length) return null;

  return {
    _id: buildAdvancementId(sourceId, "saving-throws"),
    type: "Trait",
    level: 1,
    title: "Saving Throws",
    classRestriction: "primary",
    configuration: {
      mode: "default",
      allowReplacements: false,
      grants,
      choices: []
    },
    value: {
      chosen: grants
    },
    flags: {
      [MODULE_ID]: {
        advancementKind: "savingThrows"
      }
    },
    hint: ""
  };
}

function buildSkillAdvancement(classData, ownerSourceId = null) {
  const sourceId = ownerSourceId ?? buildSemanticSourceId("class", classData);
  if (!sourceId) return null;

  const skillConfig = buildSkillChoiceConfig(classData);
  const grants = skillConfig.fixed.map((slug) => `skills:${slug}`);
  const pool = skillConfig.options.map((slug) => `skills:${slug}`);
  if (!grants.length && !pool.length) return null;

  return {
    _id: buildAdvancementId(sourceId, "skills"),
    type: "Trait",
    level: 1,
    title: "Skills",
    classRestriction: "primary",
    configuration: {
      mode: "default",
      allowReplacements: false,
      grants,
      choices: pool.length && skillConfig.choiceCount > 0
        ? [{
          count: skillConfig.choiceCount,
          pool
        }]
        : []
    },
    value: {},
    flags: {
      [MODULE_ID]: {
        advancementKind: "skills"
      }
    },
    hint: ""
  };
}

function buildScaleValueAdvancements(context) {
  const advancements = [];
  const classSourceId = context.classSourceId ?? buildSemanticSourceId("class", context.classData);

  const spellcastingLevels = context.payload?.spellcastingScalings?.[context.classData?.spellcastingId]?.levels ?? null;
  if (spellcastingLevels && typeof spellcastingLevels === "object") {
    const cantripValues = extractSpellcastingScaleValues(spellcastingLevels, "cantrips");
    if (Object.keys(cantripValues).length) {
      advancements.push(createScaleValueAdvancement({
        ownerSourceId: classSourceId,
        sourceScaleId: `${classSourceId}:cantrips-known`,
        title: "Cantrips Known",
        identifier: "cantrips-known",
        values: cantripValues
      }));
    }

    const spellValues = extractSpellcastingScaleValues(spellcastingLevels, "spells");
    if (Object.keys(spellValues).length) {
      advancements.push(createScaleValueAdvancement({
        ownerSourceId: classSourceId,
        sourceScaleId: `${classSourceId}:spells-known`,
        title: "Spells Known",
        identifier: "spells-known",
        values: spellValues
      }));
    }
  }

  for (const scalingColumn of context.scalingColumns) {
    const identifier = normalizeScaleIdentifier(scalingColumn?.sourceId ?? scalingColumn?.name);
    const values = normalizeScaleValues(scalingColumn?.values);
    if (!identifier || !Object.keys(values).length) continue;

    advancements.push(createScaleValueAdvancement({
      ownerSourceId: classSourceId,
      sourceScaleId: scalingColumn?.sourceId ?? scalingColumn?.id ?? identifier,
      title: trimString(scalingColumn?.name) || "Scale",
      identifier,
      values
    }));
  }

  return advancements;
}

function createScaleValueAdvancement({ ownerSourceId, sourceScaleId, title, identifier, values }) {
  return {
    _id: buildAdvancementId(ownerSourceId, sourceScaleId),
    type: "ScaleValue",
    title,
    configuration: {
      identifier,
      type: "number",
      distance: {
        units: ""
      },
      scale: Object.fromEntries(
        Object.entries(values).map(([level, value]) => [
          level,
          { value }
        ])
      )
    },
    value: {},
    flags: sourceScaleId
      ? {
        [MODULE_ID]: {
          sourceScaleId
        }
      }
      : {},
    hint: ""
  };
}

function buildItemGrantAdvancements(features, { ownerSourceId, title = "Features" } = {}) {
  const grouped = new Map();

  for (const feature of features) {
    const sourceId = feature?.sourceId ?? null;
    const rawLevel = Number(feature?.level ?? 0);
    const level = Number.isFinite(rawLevel) ? rawLevel : 0;
    if (!sourceId || level <= 0) continue;

    if (!grouped.has(level)) grouped.set(level, []);
    grouped.get(level).push(feature);
  }

  const advancement = {};
  for (const level of [...grouped.keys()].sort((a, b) => a - b)) {
    const featuresAtLevel = grouped.get(level) ?? [];
    const id = buildAdvancementId(ownerSourceId, title, `level-${level}`);
    advancement[id] = {
      _id: id,
      type: "ItemGrant",
      level,
      title,
      configuration: {
        items: featuresAtLevel.map((feature) => ({
          sourceId: feature.sourceId,
          optional: false
        })),
        optional: false,
        spell: {
          ability: [""],
          uses: {
            max: "",
            per: "",
            requireSlot: false
          },
          prepared: 0
        }
      },
      value: {},
      flags: {},
      hint: ""
    };
  }

  return advancement;
}

function buildSemanticOptionGroupMetadata(context) {
  const mappingByGroupId = indexBy(ensureArray(context.classData?.uniqueOptionMappings), "groupId");

  return context.uniqueOptionGroups.map((group) => {
    const mapping = mappingByGroupId.get(group?.id) ?? {};
    const feature = context.featuresBySourceId.get(group?.featureSourceId)
      ?? context.featuresById.get(group?.featureId)
      ?? context.featuresById.get(mapping?.featureId)
      ?? null;

    const scalingSourceId = group?.scalingSourceId
      ?? context.scalingColumnsById.get(group?.scalingColumnId)?.sourceId
      ?? context.scalingColumnsById.get(mapping?.scalingColumnId)?.sourceId
      ?? null;

    return {
      sourceId: group?.sourceId ?? null,
      name: trimString(group?.name) || null,
      featureSourceId: group?.featureSourceId ?? feature?.sourceId ?? null,
      scalingSourceId,
      selectionCountsByLevel: normalizeScaleValues(group?.selectionCountsByLevel)
    };
  }).filter((group) => group.sourceId);
}

function shouldTreatAsClassGrantFeature(feature, context) {
  if (!feature || !feature.sourceId) return false;
  if ((feature.parentSourceId ?? null) !== (context.classSourceId ?? null)) return false;
  if (feature.featureKind === "subclassFeature") return false;
  return true;
}

function prepareStructuredItemForImport(item, sourceMeta, referencedDocs) {
  const normalizedItem = normalizeWorldItem(item, sourceMeta);
  normalizedItem.system ??= {};
  normalizedItem.system.advancement = normalizeAdvancementStructure(normalizedItem.system.advancement);

  const docsBySourceId = new Map();
  for (const doc of referencedDocs) {
    const sourceId = doc?.getFlag?.(MODULE_ID, "sourceId");
    if (sourceId) docsBySourceId.set(sourceId, doc);
  }

  const unresolved = [];
  resolveAdvancementDocumentReferences(normalizedItem.system.advancement, docsBySourceId, unresolved);

  return { item: normalizedItem, unresolved };
}

async function syncDocumentAdvancementReferences(documents) {
  const docs = ensureArray(documents).filter((document) => document?.documentName === "Item");
  if (!docs.length) return 0;

  const docsBySourceId = new Map();
  for (const document of docs) {
    const sourceId = document.getFlag?.(MODULE_ID, "sourceId") ?? null;
    if (sourceId) docsBySourceId.set(sourceId, document);
  }

  let updated = 0;
  for (const document of docs) {
    const advancement = normalizeAdvancementStructure(document.system?.advancement);
    if (!Object.keys(advancement).length) continue;

    const unresolved = [];
    const changed = resolveAdvancementDocumentReferences(advancement, docsBySourceId, unresolved);
    if (!changed) continue;

    const systemData = typeof document.system?.toObject === "function"
      ? document.system.toObject()
      : foundry.utils.deepClone(document.system ?? {});
    delete systemData.advancement;
    systemData["==advancement"] = advancement;
    await document.update({ system: systemData });
    updated += 1;

    if (unresolved.length) {
      warn("Some advancement references could not be resolved after import", {
        document: document.name,
        unresolved
      });
    }
  }

  return updated;
}

function resolveAdvancementDocumentReferences(advancement, docsBySourceId, unresolved = []) {
  let changed = false;

  for (const [advancementId, advancementEntry] of Object.entries(advancement ?? {})) {
    if (!advancementEntry || typeof advancementEntry !== "object") continue;

    if (advancementEntry.type === "ItemGrant") {
      const resolution = resolveItemGrantAdvancementReferences(advancementEntry, docsBySourceId, unresolved, advancementId);
      if (resolution.changed) changed = true;
      continue;
    }

    if (advancementEntry.type === "ItemChoice") {
      const resolution = resolveItemChoiceAdvancementReferences(advancementEntry, docsBySourceId, unresolved, advancementId);
      if (resolution.changed) changed = true;
    }
  }

  return changed;
}

function resolveItemGrantAdvancementReferences(advancementEntry, docsBySourceId, unresolved, advancementId) {
  const configuredItems = Array.isArray(advancementEntry.configuration?.items)
    ? advancementEntry.configuration.items
    : [];
  const sourceItems = dedupeSourceIds([
    ...configuredItems.map((configuredItem) => trimString(configuredItem?.sourceId)).filter(Boolean),
    ...ensureArray(advancementEntry.flags?.[MODULE_ID]?.sourceItems)
  ]);

  const resolvedItems = [];
  let changed = false;

  for (const configuredItem of configuredItems) {
    if (configuredItem?.uuid) {
      resolvedItems.push({
        uuid: configuredItem.uuid,
        optional: configuredItem.optional ?? false
      });
      continue;
    }

    const sourceId = trimString(configuredItem?.sourceId);
    if (!sourceId) {
      unresolved.push(`${advancementId}:missing-sourceId`);
      continue;
    }

    const referencedDoc = docsBySourceId.get(sourceId);
    if (!referencedDoc?.uuid) {
      unresolved.push(sourceId);
      continue;
    }

    resolvedItems.push({
      uuid: referencedDoc.uuid,
      optional: configuredItem.optional ?? false
    });
    changed = true;
  }

  for (const sourceId of sourceItems) {
    if (!sourceId || resolvedItems.some((entry) => entry.uuid === docsBySourceId.get(sourceId)?.uuid)) continue;
    const referencedDoc = docsBySourceId.get(sourceId);
    if (!referencedDoc?.uuid) {
      unresolved.push(sourceId);
      continue;
    }

    resolvedItems.push({
      uuid: referencedDoc.uuid,
      optional: advancementEntry.configuration?.optional ?? false
    });
    changed = true;
  }

  if (changed) advancementEntry.configuration.items = resolvedItems;
  return { changed };
}

function resolveItemChoiceAdvancementReferences(advancementEntry, docsBySourceId, unresolved, advancementId) {
  const configuredPool = Array.isArray(advancementEntry.configuration?.pool)
    ? advancementEntry.configuration.pool
    : [];
  const sourcePool = dedupeSourceIds([
    ...configuredPool.map((configuredItem) => trimString(configuredItem?.sourceId)).filter(Boolean),
    ...ensureArray(advancementEntry.flags?.[MODULE_ID]?.sourcePool)
  ]);

  const resolvedPool = [];
  let changed = false;

  for (const configuredItem of configuredPool) {
    if (configuredItem?.uuid) {
      resolvedPool.push({ uuid: configuredItem.uuid });
      continue;
    }

    const sourceId = trimString(configuredItem?.sourceId);
    if (!sourceId) {
      unresolved.push(`${advancementId}:missing-sourceId`);
      continue;
    }

    const referencedDoc = docsBySourceId.get(sourceId);
    if (!referencedDoc?.uuid) {
      unresolved.push(sourceId);
      continue;
    }

    resolvedPool.push({ uuid: referencedDoc.uuid });
    changed = true;
  }

  for (const sourceId of sourcePool) {
    if (!sourceId || resolvedPool.some((entry) => entry.uuid === docsBySourceId.get(sourceId)?.uuid)) continue;
    const referencedDoc = docsBySourceId.get(sourceId);
    if (!referencedDoc?.uuid) {
      unresolved.push(sourceId);
      continue;
    }

    resolvedPool.push({ uuid: referencedDoc.uuid });
    changed = true;
  }

  if (changed) advancementEntry.configuration.pool = resolvedPool;
  return { changed };
}

function normalizeAdvancementStructure(advancement) {
  if (!advancement) return {};
  if (typeof advancement?.toObject === "function") {
    return normalizeAdvancementStructure(advancement.toObject());
  }
  if (advancement instanceof Map) {
    return Object.fromEntries([...advancement.entries()].map(([id, entry]) => [
      id,
      {
        ...foundry.utils.deepClone(entry),
        _id: entry?._id ?? id
      }
    ]));
  }
  if (!Array.isArray(advancement) && typeof advancement === "object") {
    return foundry.utils.deepClone(advancement);
  }

  const mapped = {};
  for (const entry of advancement) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry._id ?? foundry.utils.randomID();
    mapped[id] = {
      ...foundry.utils.deepClone(entry),
      _id: id
    };
  }
  return mapped;
}

async function upsertWorldItem(item, { folderPath = null } = {}) {
  const clone = foundry.utils.deepClone(item);
  if (folderPath) {
    const folder = await ensureFolderPath(folderPath, "Item");
    if (folder) clone.folder = folder.id;
  }

  const existing = findMatchingWorldItem(clone);
  applyImportAuditMetadata(clone, { existing, importMode: "world" });
  if (!existing) {
    const [created] = await Item.createDocuments([clone]);
    return created;
  }

  const updateData = {
    _id: existing.id,
    ...clone
  };
  const updated = await existing.update(updateData);
  return updated ?? existing;
}

async function upsertActorItem(actor, item) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor) return null;

  const clone = normalizeEmbeddedItem(item);
  applyReferenceNormalization(clone, { actor: targetActor });
  const existing = findMatchingActorItem(targetActor, clone);
  sanitizeEmbeddedActorProgressionItem(clone, { existingItem: existing });
  applyImportAuditMetadata(clone, { existing, importMode: "actor" });

  if (!existing) {
    const [created] = await targetActor.createEmbeddedDocuments("Item", [clone]);
    return created ?? null;
  }

  const updateData = buildEmbeddedActorItemUpdateData(existing.id, clone);
  const [updated] = await targetActor.updateEmbeddedDocuments("Item", [updateData]);
  return updated ?? targetActor.items.get(existing.id) ?? existing;
}

function buildEmbeddedActorItemUpdateData(existingId, clone) {
  const updateData = {
    _id: existingId,
    ...clone
  };

  if (["class", "subclass"].includes(clone?.type) && clone?.system && Object.hasOwn(clone.system, "advancement")) {
    const system = foundry.utils.deepClone(clone.system);
    const advancement = system.advancement;
    delete system.advancement;
    system["==advancement"] = advancement;
    updateData.system = system;
  }

  return updateData;
}

function sanitizeEmbeddedActorProgressionItem(item, { existingItem = null } = {}) {
  if (!item || !["class", "subclass"].includes(item.type)) return item;

  item.system ??= {};
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};

  const advancementMeta = rekeyEmbeddedActorAdvancements(filterEmbeddedActorAdvancements(item.system.advancement), {
    existingItem
  });
  item.system.advancement = advancementMeta.advancement;
  item.flags[MODULE_ID].advancementIdMap = advancementMeta.idMap;

  return item;
}

function findMatchingWorldItem(item) {
  const entityId = getModuleEntityId(item);
  if (entityId) {
    const byEntityId = game.items.find((existing) => getModuleEntityId(existing) === entityId);
    if (byEntityId) return byEntityId;
  }

  const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? null;
  if (sourceId) {
    const bySourceId = game.items.find((existing) => existing.getFlag(MODULE_ID, "sourceId") === sourceId);
    if (bySourceId) return bySourceId;
  }

  const identifier = getModuleIdentifier(item);
  if (identifier) {
    const byIdentifier = game.items.find((existing) =>
      existing.type === item.type
      && getModuleIdentifier(existing) === identifier
    );
    if (byIdentifier) return byIdentifier;
  }

  return game.items.find((existing) => existing.type === item.type && existing.name === item.name) ?? null;
}

function normalizeWorldItem(item, sourceMeta = null) {
  const clone = foundry.utils.deepClone(item ?? {});
  clone.flags ??= {};
  clone.flags[MODULE_ID] ??= {};

  const fallbackSourceId = sourceMeta?.id && clone.name
    ? `${sourceMeta.id}:${clone.type ?? "item"}:${clone.name}`
    : null;

  const rawSourceId = trimString(clone.sourceId);
  const sourceBookId =
    trimString(clone.flags[MODULE_ID].sourceBookId)
    || trimString(sourceMeta?.sourceId)
    || (looksLikeSourceBookId(rawSourceId) ? rawSourceId : null);

  const sourceId =
    clone.flags[MODULE_ID].sourceId
    ?? (!looksLikeSourceBookId(rawSourceId) ? rawSourceId : null)
    ?? fallbackSourceId;

  if (sourceId) clone.flags[MODULE_ID].sourceId = sourceId;
  if (sourceBookId) clone.flags[MODULE_ID].sourceBookId = sourceBookId;
  if (clone.flags[MODULE_ID].entityId == null && clone.id != null) clone.flags[MODULE_ID].entityId = String(clone.id);
  if (clone.flags[MODULE_ID].identifier == null) {
    const identifier = trimString(clone.system?.identifier ?? clone.identifier);
    if (identifier) clone.flags[MODULE_ID].identifier = identifier;
  }

  clone.flags[MODULE_ID].sourceType ??= getDefaultSourceType(clone);
  applySourceMetadata(clone.flags[MODULE_ID], { sourceMeta });

  delete clone.sourceId;
  delete clone.id;
  delete clone._id;
  delete clone.folder;
  delete clone.ownership;
  delete clone.sort;
  delete clone.items;

  if (clone.type === "class") {
    normalizeClassItem(clone);
  }

  applyReferenceNormalization(clone, { sourceMeta });

  return clone;
}

function normalizeClassItem(item) {
  item.system ??= {};

  if (typeof item.system.wealth === "string") {
    item.system.wealth = normalizeWealthFormula(item.system.wealth);
  } else if (item.system.wealth == null) {
    item.system.wealth = "";
  }
}

function prepareEmbeddedActorClassItem(classItem, { targetLevel = 1, existingItem = null, payloadMeta = null, importSelection = null } = {}) {
  const item = normalizeEmbeddedItem(classItem);
  item.system ??= {};
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};
  item.system.levels = normalizeClassLevel(targetLevel, item.system.levels);
  const advancementMeta = rekeyEmbeddedActorAdvancements(filterEmbeddedActorAdvancements(item.system.advancement), {
    existingItem
  });
  item.system.advancement = advancementMeta.advancement;
  item.flags[MODULE_ID].advancementIdMap = advancementMeta.idMap;
  item.flags[MODULE_ID].sourceType = "class";
  applyPayloadMetadata(item.flags[MODULE_ID], {
    payloadMeta,
    importMode: "actor",
    existingFlags: existingItem?.flags?.[MODULE_ID] ?? null
  });
  if (importSelection) {
    item.flags[MODULE_ID].importSelections = sanitizeClassImportSelection(importSelection);
  }
  return item;
}

function prepareEmbeddedActorSubclassItem(subclassItem, { existingItem = null, payloadMeta = null, classSourceId = null } = {}) {
  const item = normalizeEmbeddedItem(subclassItem);
  item.system ??= {};
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};
  const advancementMeta = rekeyEmbeddedActorAdvancements(filterEmbeddedActorAdvancements(item.system.advancement), {
    existingItem
  });
  item.system.advancement = advancementMeta.advancement;
  item.flags[MODULE_ID].advancementIdMap = advancementMeta.idMap;
  if (classSourceId) item.flags[MODULE_ID].classSourceId = classSourceId;
  item.flags[MODULE_ID].sourceType = "subclass";
  applyPayloadMetadata(item.flags[MODULE_ID], {
    payloadMeta,
    importMode: "actor",
    existingFlags: existingItem?.flags?.[MODULE_ID] ?? null
  });
  return item;
}

function normalizeEmbeddedActorFeature(item, classSourceId, { existingItem = null, payloadMeta = null } = {}) {
  const clone = normalizeEmbeddedItem(item);
  clone.flags ??= {};
  clone.flags[MODULE_ID] ??= {};
  if (classSourceId) clone.flags[MODULE_ID].classSourceId = classSourceId;
  clone.flags[MODULE_ID].sourceType ??= "classFeature";
  applyPayloadMetadata(clone.flags[MODULE_ID], {
    payloadMeta,
    importMode: "actor",
    existingFlags: existingItem?.flags?.[MODULE_ID] ?? null
  });
  return clone;
}

function normalizeWealthFormula(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const normalized = raw
    .replace(/[x\u00d7]/gi, "*")
    .replace(/\b(?:cp|sp|ep|gp|pp)\b/gi, "")
    .replace(/\s+/g, "");

  if (!normalized) return "";
  if (typeof globalThis.Roll?.validate === "function" && !globalThis.Roll.validate(normalized)) {
    warn("Discarding invalid class wealth formula during import", { raw, normalized });
    return "";
  }

  return normalized;
}

function resolveTargetActor(actor) {
  return actor?.documentName === "Actor" ? actor : actor?.actor ?? null;
}

function normalizeEmbeddedItem(item) {
  const clone = foundry.utils.deepClone(item ?? {});
  delete clone._id;
  delete clone.folder;
  delete clone.ownership;
  delete clone.pack;
  delete clone.sort;
  delete clone._stats;
  return clone;
}

function findMatchingActorItem(actor, item) {
  const entityId = getModuleEntityId(item);
  if (entityId) {
    const byEntityId = actor.items.find((existing) => getModuleEntityId(existing) === entityId);
    if (byEntityId) return byEntityId;
  }

  const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? null;
  if (sourceId) {
    const bySourceId = actor.items.find((existing) => existing.getFlag(MODULE_ID, "sourceId") === sourceId);
    if (bySourceId) return bySourceId;
  }

  const identifier = getModuleIdentifier(item);
  if (identifier) {
    const byIdentifier = actor.items.find((existing) =>
      existing.type === item.type
      && getModuleIdentifier(existing) === identifier
    );
    if (byIdentifier) return byIdentifier;
  }

  return actor.items.find((existing) => existing.type === item.type && existing.name === item.name) ?? null;
}

function collectGrantedFeatureSourceIds(advancement, targetLevel) {
  const desired = new Set();
  for (const advancementEntry of Object.values(normalizeAdvancementStructure(advancement))) {
    if (!advancementEntry || advancementEntry.type !== "ItemGrant") continue;
    const level = Number(advancementEntry.level ?? 0);
    if (level > targetLevel) continue;

    const configuredItems = Array.isArray(advancementEntry.configuration?.items)
      ? advancementEntry.configuration.items
      : [];

    for (const configuredItem of configuredItems) {
      const sourceId = configuredItem?.sourceId ?? null;
      if (sourceId) desired.add(sourceId);
    }
  }

  return desired;
}

function filterEmbeddedActorAdvancements(advancement) {
  const filtered = {};
  for (const [id, advancementEntry] of Object.entries(normalizeAdvancementStructure(advancement))) {
    if (!advancementEntry || advancementEntry.type === "ItemGrant") continue;
    filtered[id] = foundry.utils.deepClone(advancementEntry);
  }
  return filtered;
}

function rekeyEmbeddedActorAdvancements(advancement, { existingItem = null } = {}) {
  const remapped = {};
  const existingIdMap = getExistingAdvancementIdMap(existingItem);
  const idMap = {};
  const existingAdvancements = getExistingAdvancementsBySourceId(existingItem);
  const usedIds = new Set(Object.values(existingIdMap).filter(isValidFoundryId));

  for (const [id, advancementEntry] of Object.entries(normalizeAdvancementStructure(advancement))) {
    const sourceAdvancementId = getSourceAdvancementId(id, advancementEntry);
    let newId = existingIdMap[sourceAdvancementId];
    if (!isValidFoundryId(newId) || (usedIds.has(newId) && existingAdvancements.get(sourceAdvancementId)?._id !== newId)) {
      newId = getNextFoundryId(usedIds);
    }
    usedIds.add(newId);
    idMap[sourceAdvancementId] = newId;

    const clone = foundry.utils.deepClone(advancementEntry);
    clone._id = newId;
    clone.flags ??= {};
    clone.flags[MODULE_ID] ??= {};
    clone.flags[MODULE_ID].sourceAdvancementId = sourceAdvancementId;

    const existingAdvancement = existingAdvancements.get(sourceAdvancementId);
    if (existingAdvancement?.value !== undefined) {
      clone.value = foundry.utils.deepClone(existingAdvancement.value);
    }

    remapped[newId] = clone;
  }
  return { advancement: remapped, idMap };
}

function getExistingAdvancementIdMap(existingItem) {
  const fromFlags = foundry.utils.deepClone(existingItem?.flags?.[MODULE_ID]?.advancementIdMap ?? {});
  for (const [foundryId, advancementEntry] of Object.entries(normalizeAdvancementStructure(existingItem?.system?.advancement))) {
    const sourceAdvancementId = advancementEntry?.flags?.[MODULE_ID]?.sourceAdvancementId ?? null;
    if (sourceAdvancementId && !fromFlags[sourceAdvancementId] && isValidFoundryId(foundryId)) {
      fromFlags[sourceAdvancementId] = foundryId;
    }
  }
  return fromFlags;
}

function getExistingAdvancementsBySourceId(existingItem) {
  const mapped = new Map();
  for (const [foundryId, advancementEntry] of Object.entries(normalizeAdvancementStructure(existingItem?.system?.advancement))) {
    const sourceAdvancementId = advancementEntry?.flags?.[MODULE_ID]?.sourceAdvancementId ?? advancementEntry?._id ?? foundryId;
    if (!sourceAdvancementId) continue;
    mapped.set(sourceAdvancementId, {
      ...foundry.utils.deepClone(advancementEntry),
      _id: advancementEntry?._id ?? foundryId
    });
  }
  return mapped;
}

function getSourceAdvancementId(id, advancementEntry) {
  return advancementEntry?.flags?.[MODULE_ID]?.sourceAdvancementId
    ?? advancementEntry?._id
    ?? id;
}

function getNextFoundryId(usedIds) {
  let id = foundry.utils.randomID();
  while (usedIds.has(id)) id = foundry.utils.randomID();
  return id;
}

function isValidFoundryId(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{16}$/.test(value);
}

function normalizeClassLevel(targetLevel, fallback = 1) {
  const normalized = Number(targetLevel ?? fallback ?? 1);
  if (!Number.isFinite(normalized)) return 1;
  return clampValue(Math.round(normalized), 1, 20);
}

async function pruneActorImportedItems(actor, {
  classSourceId,
  sourceType,
  desiredSourceIds,
  itemType = "feat"
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !classSourceId || !sourceType) return 0;

  const removableIds = targetActor.items
    .filter((item) =>
      item.type === itemType
      && item.getFlag(MODULE_ID, "sourceType") === sourceType
      && item.getFlag(MODULE_ID, "classSourceId") === classSourceId
      && !(desiredSourceIds?.has(item.getFlag(MODULE_ID, "sourceId")) ?? false)
    )
    .map((item) => item.id);

  if (!removableIds.length) return 0;
  await targetActor.deleteEmbeddedDocuments("Item", removableIds);
  return removableIds.length;
}

async function applyActorSkillSelections(actor, skillSelections = []) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor) return 0;

  const updates = {};
  let applied = 0;
  for (const slug of [...new Set(ensureArray(skillSelections).map((value) => normalizeSkillSlug(value)).filter(Boolean))]) {
    const currentValue = Number(targetActor.system?.skills?.[slug]?.value ?? 0);
    if (currentValue >= 1) continue;
    updates[`system.skills.${slug}.value`] = 1;
    applied += 1;
  }

  if (!applied) return 0;
  await targetActor.update(updates);
  return applied;
}

async function syncActorClassAdvancements(actor, actorClassItem, sourceAdvancement, {
  classSourceId = null,
  targetLevel = 1,
  existingClassLevel = 0,
  hpMode = null,
  hpCustomFormula = null,
  skillSelections = [],
  hpResolution = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !actorClassItem) return actorClassItem;

  const currentClassItem = targetActor.items.get(actorClassItem.id) ?? actorClassItem;
  const resolvedAdvancement = buildEmbeddedActorAdvancementStructure(sourceAdvancement, {
    actor: targetActor,
    classSourceId,
    targetLevel
  });
  const advancementMeta = rekeyEmbeddedActorAdvancements(resolvedAdvancement, {
    existingItem: currentClassItem
  });
  await applyHitPointModeToAdvancements(advancementMeta.advancement, {
    actor: targetActor,
    classItem: currentClassItem,
    currentLevel: existingClassLevel,
    targetLevel,
    hpMode,
    hpCustomFormula,
    hpResolution
  });
  applySkillSelectionsToAdvancements(advancementMeta.advancement, {
    skillSelections
  });
  log("Prepared actor class advancement update", {
    actorName: targetActor.name,
    className: currentClassItem.name,
    classSourceId,
    targetLevel,
    existingClassLevel,
    before: getHitPointAdvancementSnapshot(currentClassItem),
    after: getHitPointAdvancementSnapshot({ system: { advancement: advancementMeta.advancement } })
  });

  const moduleFlags = foundry.utils.deepClone(currentClassItem.flags?.[MODULE_ID] ?? {});
  moduleFlags.advancementIdMap = advancementMeta.idMap;

  const [updatedClassItem] = await targetActor.updateEmbeddedDocuments("Item", [{
    _id: currentClassItem.id,
    system: {
      "==advancement": advancementMeta.advancement
    },
    flags: {
      [MODULE_ID]: moduleFlags
    }
  }]);

  const syncedClassItem = updatedClassItem ?? targetActor.items.get(currentClassItem.id) ?? currentClassItem;
  log("Persisted actor class advancement update", {
    actorName: targetActor.name,
    className: syncedClassItem.name,
    classSourceId,
    persisted: getHitPointAdvancementSnapshot(syncedClassItem)
  });
  await linkActorGrantedFeaturesToAdvancements(targetActor, syncedClassItem, { classSourceId });
  return syncedClassItem;
}

function buildEmbeddedActorAdvancementStructure(sourceAdvancement, { actor, classSourceId = null, targetLevel = 1 } = {}) {
  const actorFeaturesBySourceId = buildActorFeatureSourceMap(actor, { classSourceId });
  const resolved = {};

  for (const [id, advancementEntry] of Object.entries(normalizeAdvancementStructure(sourceAdvancement))) {
    if (!advancementEntry) continue;

    const clone = foundry.utils.deepClone(advancementEntry);
    if (clone.type === "ItemGrant") {
      const level = Number(clone.level ?? 0);
      if (level > targetLevel) continue;

      const configuredItems = Array.isArray(clone.configuration?.items)
        ? clone.configuration.items
        : [];
      const resolvedConfiguredItems = [];
      const added = {};

      for (const configuredItem of configuredItems) {
        const sourceId = configuredItem?.sourceId ?? null;
        if (!sourceId) continue;

        const actorFeature = actorFeaturesBySourceId.get(sourceId);
        if (!actorFeature) continue;

        resolvedConfiguredItems.push({
          uuid: actorFeature.uuid,
          sourceId,
          optional: configuredItem.optional ?? false
        });
        added[actorFeature.id] = actorFeature.uuid;
      }

      clone.configuration ??= {};
      clone.configuration.items = resolvedConfiguredItems;
      clone.configuration.optional ??= false;
      clone.value ??= {};
      clone.value.added = added;
    }

    resolved[id] = clone;
  }

  return resolved;
}

async function applyHitPointModeToAdvancements(advancement, {
  actor = null,
  classItem = null,
  currentLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null,
  hpResolution = null
} = {}) {
  if (!advancement || typeof advancement !== "object") return;
  const resolved = hpResolution ?? await resolveHitPointImport({
    actor,
    classItem,
    currentLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });
  const normalizedMode = resolved.hpMeta.hpMode;
  const hpMeta = resolved.hpMeta;
  const hpGainData = resolved.hpGainData;
  const advancementValues = resolved.advancementValues;

  for (const advancementEntry of Object.values(advancement)) {
    if (advancementEntry?.type !== "HitPoints") continue;
    const hpValues = foundry.utils.deepClone(advancementEntry.value ?? {});

    if (normalizedMode === "none") {
      advancementEntry.value = hpValues;
      continue;
    }

    for (const [level, value] of Object.entries(advancementValues)) {
      hpValues[level] = value;
    }

    advancementEntry.value = hpValues;
  }
}

function applySkillSelectionsToAdvancements(advancement, { skillSelections = [] } = {}) {
  if (!advancement || typeof advancement !== "object") return;
  const normalizedSelections = [...new Set(ensureArray(skillSelections).map((value) => normalizeSkillSlug(value)).filter(Boolean))];
  for (const advancementEntry of Object.values(advancement)) {
    if (advancementEntry?.type !== "Trait") continue;
    const advancementKind = advancementEntry?.flags?.[MODULE_ID]?.advancementKind ?? null;
    if (advancementKind !== "skills") continue;

    advancementEntry.value ??= {};
    advancementEntry.value.chosen = normalizedSelections.map((slug) => `skills:${slug}`);
  }
}

async function applyActorHitPointIncrease(actor, classItem, {
  existingClassLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null,
  hpResolution = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !classItem) return 0;

  const resolved = hpResolution ?? await resolveHitPointImport({
    actor: targetActor,
    classItem,
    currentLevel: existingClassLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });
  const hpGainData = resolved.hpGainData;

  if (!hpGainData.total) return 0;

  const currentValue = Number(targetActor.system?.attributes?.hp?.value ?? 0) || 0;
  const rawMaxOverride = targetActor._source?.system?.attributes?.hp?.max;
  const hasMaxOverride = rawMaxOverride != null;
  const currentMax = hasMaxOverride ? (Number(rawMaxOverride) || 0) : null;
  const hpMeta = resolved.hpMeta;

  const updates = {
    "system.attributes.hp.value": (hpMeta.isFirstHpGain ? 0 : currentValue) + hpGainData.total
  };

  const shouldSetMax = hasMaxOverride
    || trimString(hpMode) !== "average"
    || hpMeta.actorClassCount > 1;
  if (shouldSetMax) {
    const nextMax = currentMax == null
      ? updates["system.attributes.hp.value"]
      : (hpMeta.isFirstHpGain ? 0 : currentMax) + hpGainData.total;
    updates["system.attributes.hp.max"] = nextMax;
  }

  log("Applying actor HP update", {
    actorName: targetActor.name,
    className: classItem.name,
    existingClassLevel,
    targetLevel,
    hpMode,
    hpCustomFormula,
    hpMeta: summarizeHpMeta(hpMeta),
    hpGainData: summarizeHpGainData(hpGainData),
    currentHp: {
      value: currentValue,
      rawMaxOverride
    },
    updates
  });
  await targetActor.update(updates);

  return hpGainData.total;
}

function getHitPointGainByLevel({
  actor = null,
  classItem = null,
  currentLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null
} = {}) {
  const hpData = buildHitPointComputationData({
    actor,
    classItem,
    currentLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });

  return buildHitPointAdvancementValues(hpData);
}

function hasHitPointAdvancement(advancement) {
  return Object.values(normalizeAdvancementStructure(advancement)).some((entry) => entry?.type === "HitPoints");
}

async function resolveHitPointImport({
  actor = null,
  classItem = null,
  currentLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null
} = {}) {
  const hpMeta = buildHitPointComputationData({
    actor,
    classItem,
    currentLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });
  const hpGainData = await evaluateHitPointIncrease({
    actor,
    classItem,
    currentLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });
  const advancementValues = buildHitPointAdvancementValues(hpMeta, hpGainData);

  return {
    hpMeta,
    hpGainData,
    advancementValues
  };
}

function buildHitPointAdvancementValues(hpData, hpGainData = null) {
  const values = {};
  if (hpData.isFirstHpGain && hpData.hpMode !== "none") values["1"] = "max";

  for (let level = hpData.startingLevel; level <= hpData.targetLevel; level += 1) {
    switch (hpData.hpMode) {
      case "average": {
        const raw = Math.ceil(hpData.hitDieNumber * ((hpData.hitDieFaces + 1) / 2));
        values[`${level}`] = raw;
        break;
      }
      case "minimum":
        values[`${level}`] = hpData.hitDieNumber;
        break;
      case "maximum":
        values[`${level}`] = hpData.hitDieNumber * hpData.hitDieFaces;
        break;
      case "none":
        break;
      case "roll":
      case "custom": {
        const raw = hpGainData?.byLevel?.[`${level}`]?.raw;
        if (raw != null) values[`${level}`] = raw;
        break;
      }
      default: {
        const raw = Math.ceil(hpData.hitDieNumber * ((hpData.hitDieFaces + 1) / 2));
        values[`${level}`] = raw;
        break;
      }
    }
  }

  return values;
}

function summarizeHpMeta(hpMeta = {}) {
  return {
    currentClassLevel: hpMeta.currentClassLevel ?? null,
    targetLevel: hpMeta.targetLevel ?? null,
    hitDieFaces: hpMeta.hitDieFaces ?? null,
    hitDieNumber: hpMeta.hitDieNumber ?? null,
    isFirstHpGain: hpMeta.isFirstHpGain ?? null,
    conMod: hpMeta.conMod ?? null,
    hpMode: hpMeta.hpMode ?? null,
    hpCustomFormula: hpMeta.hpCustomFormula ?? null,
    startingLevel: hpMeta.startingLevel ?? null,
    actorClassCount: hpMeta.actorClassCount ?? null
  };
}

function summarizeHpGainData(hpGainData = null) {
  if (!hpGainData) return null;
  return {
    total: hpGainData.total ?? 0,
    isFirstHpGain: hpGainData.isFirstHpGain ?? null,
    byLevel: Object.fromEntries(Object.entries(hpGainData.byLevel ?? {}).map(([level, value]) => [
      level,
      {
        total: value?.total ?? null,
        raw: value?.raw ?? null
      }
    ]))
  };
}

function getHitPointAdvancementSnapshot(itemLike) {
  const advancementEntries = Object.entries(normalizeAdvancementStructure(itemLike?.system?.advancement));
  const tuple = advancementEntries.find(([, entry]) => entry?.type === "HitPoints");
  if (!tuple) return null;

  const [id, entry] = tuple;
  return {
    id,
    _id: entry?._id ?? id,
    value: foundry.utils.deepClone(entry?.value ?? {}),
    configuration: foundry.utils.deepClone(entry?.configuration ?? {}),
    flags: foundry.utils.deepClone(entry?.flags ?? {})
  };
}

async function evaluateHitPointIncrease({
  actor = null,
  classItem = null,
  currentLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null
} = {}) {
  const hpData = buildHitPointComputationData({
    actor,
    classItem,
    currentLevel,
    targetLevel,
    hpMode,
    hpCustomFormula
  });

  if (hpData.startingLevel > hpData.targetLevel) {
    return { total: 0, byLevel: {}, isFirstHpGain: hpData.isFirstHpGain };
  }

  const byLevel = {};
  let total = 0;

  if (hpData.isFirstHpGain && hpData.hpMode !== "none") {
    const levelOneRaw = hpData.hitDieNumber * hpData.hitDieFaces;
    const levelOneGain = Math.max(levelOneRaw + hpData.conMod, 1);
    byLevel["1"] = {
      total: levelOneGain,
      raw: levelOneRaw
    };
    total += levelOneGain;
  }

  for (let level = hpData.startingLevel; level <= hpData.targetLevel; level += 1) {
    const result = await evaluateHitPointGainForLevel(hpData, level);
    if (!result) continue;
    byLevel[`${level}`] = result;
    total += result.total;
  }

  return { total, byLevel, isFirstHpGain: hpData.isFirstHpGain };
}

function buildHitPointComputationData({
  actor = null,
  classItem = null,
  currentLevel = 0,
  targetLevel = 1,
  hpMode = "average",
  hpCustomFormula = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  const currentClassLevel = Math.max(0, Number(currentLevel ?? 0) || 0);
  const desiredTargetLevel = normalizeClassLevel(targetLevel, classItem?.system?.levels);
  const hitDieFaces = getClassItemHitDieFaces(classItem);
  const hitDieNumber = Math.max(1, Number(classItem?.system?.hd?.number ?? 1) || 1);
  const actorClassCount = targetActor?.items?.filter?.((item) => item.type === "class")?.length ?? 0;
  const isFirstHpGain = currentClassLevel === 0 && actorClassCount <= 1;
  const conMod = getActorConModifier(targetActor);
  const startingLevel = currentClassLevel + (isFirstHpGain ? 2 : 1);

  return {
    actor: targetActor,
    classItem,
    actorClassCount,
    currentClassLevel,
    targetLevel: desiredTargetLevel,
    hitDieFaces,
    hitDieNumber,
    isFirstHpGain,
    conMod,
    hpMode: trimString(hpMode) || "average",
    hpCustomFormula: trimString(hpCustomFormula) || null,
    startingLevel,
    levelResults: {}
  };
}

async function evaluateHitPointGainForLevel(hpData, level) {
  switch (hpData.hpMode) {
    case "average": {
      const raw = Math.ceil(hpData.hitDieNumber * ((hpData.hitDieFaces + 1) / 2));
      return { total: Math.max(raw + hpData.conMod, 1), raw };
    }
    case "minimum": {
      const raw = hpData.hitDieNumber;
      return { total: Math.max(raw + hpData.conMod, 1), raw };
    }
    case "maximum": {
      const raw = hpData.hitDieNumber * hpData.hitDieFaces;
      return { total: Math.max(raw + hpData.conMod, 1), raw };
    }
    case "roll":
    case "custom": {
      const formulaRaw = hpData.hpMode === "roll"
        ? `${hpData.hitDieNumber}d${hpData.hitDieFaces}`
        : getResolvedHpCustomFormula(hpData.hpCustomFormula, hpData);
      const formula = `${formulaRaw} + ${hpData.conMod}`;
      const roll = new Roll(formula, hpData.actor?.getRollData?.() ?? {});
      await roll.evaluate();
      const total = Math.max(Number(roll.total ?? 0), 1);
      const raw = Math.max(total - hpData.conMod, 1);
      hpData.levelResults[`${level}`] = { total, raw };
      await roll.toMessage({
        flavor: `HP Increase (Level ${level})`,
        sound: null,
        speaker: {
          actor: hpData.actor?.id ?? null,
          alias: hpData.actor?.name ?? "Actor",
          scene: null,
          token: null
        }
      });
      return hpData.levelResults[`${level}`];
    }
    case "none":
      return { total: 0, raw: 0 };
    default: {
      const raw = Math.ceil(hpData.hitDieNumber * ((hpData.hitDieFaces + 1) / 2));
      return { total: Math.max(raw + hpData.conMod, 1), raw };
    }
  }
}

function getResolvedHpCustomFormula(formula, hpData) {
  const fallback = getDefaultHpCustomFormulaFromHitDie(hpData);
  const normalizedFormula = trimString(formula);
  const template = !normalizedFormula
    ? fallback
    : (normalizedFormula === "1d8min5" && fallback !== normalizedFormula ? fallback : normalizedFormula);
  return template
    .replace(/@hd\.number/g, String(hpData.hitDieNumber))
    .replace(/@hd\.faces/g, String(hpData.hitDieFaces))
    .replace(/`@hd\.number`/g, String(hpData.hitDieNumber))
    .replace(/`@hd\.faces`/g, String(hpData.hitDieFaces));
}

function getDefaultHpCustomFormulaFromHitDie({ hitDieNumber = 1, hitDieFaces = 8 } = {}) {
  const number = Math.max(1, Number(hitDieNumber ?? 1) || 1);
  const faces = Math.max(1, Number(hitDieFaces ?? 8) || 8);
  const average = Math.ceil((faces + 1) / 2);
  return `${number}d${faces}min${average}`;
}

function getActorConModifier(actor) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor) return 0;
  const explicit = Number(targetActor.system?.abilities?.con?.mod ?? NaN);
  if (Number.isFinite(explicit)) return explicit;
  const score = Number(targetActor.system?.abilities?.con?.value ?? 10) || 10;
  return Math.floor((score - 10) / 2);
}

function getClassItemHitDieFaces(classItem) {
  const flaggedValue = Number(classItem?.flags?.[MODULE_ID]?.hitDieValue ?? 0);
  if (Number.isFinite(flaggedValue) && flaggedValue > 0) return flaggedValue;

  return parseHitDieFaces(classItem?.system?.hd?.denomination ?? classItem?.system?.hd?.faces ?? null);
}

function parseHitDieFaces(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = /^d(\d+)$/.exec(text);
  if (match) return Math.max(1, Number(match[1]) || 6);

  const numeric = Number(value ?? 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  return 6;
}

function buildActorFeatureSourceMap(actor, { classSourceId = null } = {}) {
  const targetActor = resolveTargetActor(actor);
  const mapped = new Map();
  if (!targetActor) return mapped;

  const featureItems = targetActor.items.filter((item) =>
    item.type === "feat"
    && (!classSourceId || item.getFlag(MODULE_ID, "classSourceId") === classSourceId)
  );

  for (const item of featureItems) {
    const sourceId = item.getFlag(MODULE_ID, "sourceId");
    if (sourceId) mapped.set(sourceId, item);
  }

  return mapped;
}

async function linkActorGrantedFeaturesToAdvancements(actor, classItem, { classSourceId = null } = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !classItem) return 0;

  const sourceIdToAdvancementId = new Map();
  for (const [advancementId, advancementEntry] of Object.entries(normalizeAdvancementStructure(classItem.system?.advancement))) {
    if (!advancementEntry || advancementEntry.type !== "ItemGrant") continue;

    const configuredItems = Array.isArray(advancementEntry.configuration?.items)
      ? advancementEntry.configuration.items
      : [];
    for (const configuredItem of configuredItems) {
      const sourceId = configuredItem?.sourceId ?? null;
      if (sourceId) sourceIdToAdvancementId.set(sourceId, advancementEntry._id ?? advancementId);
    }
  }

  if (!sourceIdToAdvancementId.size) return 0;

  const updates = targetActor.items
    .filter((item) =>
      item.type === "feat"
      && (!classSourceId || item.getFlag(MODULE_ID, "classSourceId") === classSourceId)
    )
    .map((item) => {
      const sourceId = item.getFlag(MODULE_ID, "sourceId") ?? null;
      const advancementId = sourceId ? sourceIdToAdvancementId.get(sourceId) : null;
      if (!advancementId) return null;

      return {
        _id: item.id,
        flags: {
          dnd5e: {
            sourceId: item.uuid,
            advancementOrigin: `${classItem.id}.${advancementId}`
          }
        }
      };
    })
    .filter(Boolean);

  if (!updates.length) return 0;
  await targetActor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyImportAuditMetadata(item, { existing = null, importMode = null } = {}) {
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};

  const moduleFlags = item.flags[MODULE_ID];
  const existingFlags = existing?.flags?.[MODULE_ID] ?? {};
  const timestamp = new Date().toISOString();

  moduleFlags.importedAt = existingFlags.importedAt ?? moduleFlags.importedAt ?? timestamp;
  moduleFlags.lastSyncedAt = timestamp;
  moduleFlags.importMode = importMode ?? moduleFlags.importMode ?? existingFlags.importMode ?? null;
  moduleFlags.moduleVersion = game.modules.get(MODULE_ID)?.version ?? existingFlags.moduleVersion ?? null;
}

function applySourceMetadata(flags, { sourceMeta = null } = {}) {
  if (!flags || !sourceMeta) return;

  if (sourceMeta.sourceId && flags.sourceBookId == null) flags.sourceBookId = sourceMeta.sourceId;
  if (sourceMeta.system && flags.sourceSystem == null) flags.sourceSystem = sourceMeta.system;
  if (sourceMeta.entity && flags.sourceEntity == null) flags.sourceEntity = sourceMeta.entity;
  if (sourceMeta.id && flags.sourceRecordId == null) flags.sourceRecordId = sourceMeta.id;
  if (sourceMeta.rules && flags.rules == null) flags.rules = sourceMeta.rules;
  if (sourceMeta.revision != null && flags.revision == null) flags.revision = sourceMeta.revision;
}

function applyPayloadMetadata(flags, { payloadMeta = null, importMode = null, existingFlags = null } = {}) {
  if (!flags) return;

  const priorFlags = existingFlags ?? {};
  if (payloadMeta?.kind && flags.payloadKind == null) flags.payloadKind = payloadMeta.kind;
  if (payloadMeta?.schemaVersion != null && flags.schemaVersion == null) flags.schemaVersion = payloadMeta.schemaVersion;
  applySourceMetadata(flags, { sourceMeta: payloadMeta?.source ?? null });

  if (priorFlags.sourceBookId && flags.sourceBookId == null) flags.sourceBookId = priorFlags.sourceBookId;
  if (priorFlags.payloadKind && flags.payloadKind == null) flags.payloadKind = priorFlags.payloadKind;
  if (priorFlags.schemaVersion != null && flags.schemaVersion == null) flags.schemaVersion = priorFlags.schemaVersion;
  if (priorFlags.sourceSystem && flags.sourceSystem == null) flags.sourceSystem = priorFlags.sourceSystem;
  if (priorFlags.sourceEntity && flags.sourceEntity == null) flags.sourceEntity = priorFlags.sourceEntity;
  if (priorFlags.sourceRecordId && flags.sourceRecordId == null) flags.sourceRecordId = priorFlags.sourceRecordId;
  if (priorFlags.rules && flags.rules == null) flags.rules = priorFlags.rules;
  if (priorFlags.revision != null && flags.revision == null) flags.revision = priorFlags.revision;
  if (priorFlags.importMode && flags.importMode == null) flags.importMode = priorFlags.importMode;
  if (importMode) flags.importMode = importMode;
}

function getDefaultSourceType(item) {
  if (item?.type === "class") return "class";
  if (item?.type === "subclass") return "subclass";
  return item?.flags?.[MODULE_ID]?.sourceType ?? "item";
}

export async function fetchClassCatalog(url) {
  const payload = await fetchJson(url);
  if (!payload) return null;

  if (payload.kind !== "dauligor.class-catalog.v1") {
    notifyWarn(`Catalog at ${url} did not return dauligor.class-catalog.v1.`);
    return null;
  }

  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return {
    ...payload,
    entries: entries
      .filter((entry) => entry?.payloadUrl && entry?.type === "class")
      .map((entry) => ({
        ...entry,
        payloadUrl: resolveCatalogUrl(url, entry.payloadUrl)
      }))
  };
}

export async function fetchJson(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(error);
    warn("Failed to fetch JSON", { url, error });
    ui.notifications?.error(`Could not fetch JSON from ${url}`);
    return null;
  }
}

function resolveCatalogUrl(catalogUrl, payloadUrl) {
  if (!payloadUrl) return payloadUrl;
  if (/^(https?:)?\/\//i.test(payloadUrl) || payloadUrl.startsWith("/") || payloadUrl.startsWith("modules/")) {
    return payloadUrl;
  }

  const normalizedCatalogUrl = catalogUrl.replace(/\\/g, "/");
  const lastSlashIndex = normalizedCatalogUrl.lastIndexOf("/");
  if (lastSlashIndex === -1) return payloadUrl;
  return `${normalizedCatalogUrl.slice(0, lastSlashIndex + 1)}${payloadUrl}`;
}

async function ensureFolderPath(path, type) {
  const parts = String(path ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  let parentId = null;
  let current = null;
  for (const part of parts) {
    current = game.folders.find((folder) =>
      folder.type === type
      && folder.name === part
      && (folder.folder?.id ?? null) === parentId
    ) ?? null;

    if (!current) {
      current = await Folder.create({
        name: part,
        type,
        folder: parentId
      });
    }

    parentId = current.id;
  }

  return current;
}

function buildSemanticSourceMeta(payload) {
  const classData = payload?.class ?? {};
  const revision = Number.parseInt(payload?._meta?.version ?? payload?.source?.revision ?? 1, 10);
  const sourceBookId = trimString(payload?.source?.sourceId ?? classData.sourceId) || null;
  return {
    system: payload?.source?.system ?? "dauligor",
    entity: "class",
    id: trimString(classData.id) || resolveSemanticEntitySourceId("class", classData, { sourceBookId }),
    sourceId: sourceBookId,
    rules: payload?.source?.rules ?? "2014",
    revision: Number.isFinite(revision) ? revision : 1
  };
}

function buildFoundrySourceData(sourceMeta, sourceRecord = null) {
  return {
    custom: "",
    book: trimString(sourceRecord?.name ?? sourceRecord?.book ?? DEFAULT_SOURCE_BOOK),
    page: sourceRecord?.page != null ? String(sourceRecord.page) : "0",
    license: trimString(sourceRecord?.license ?? ""),
    rules: sourceMeta?.rules ?? "2014",
    revision: sourceMeta?.revision ?? 1
  };
}

function buildFoundrySpellcastingData(spellcasting) {
  const normalizedAbility = normalizeAbilityCode(spellcasting?.ability);
  const progression = trimString(spellcasting?.progression).toLowerCase() || "none";
  return {
    progression,
    ability: normalizedAbility ?? "",
    preparation: {
      formula: trimString(spellcasting?.spellsKnownFormula ?? ""),
      mode: normalizeSpellPreparationMode(spellcasting?.type)
    }
  };
}

function normalizeSpellPreparationMode(type) {
  const normalized = trimString(type).toLowerCase();
  if (normalized === "prepared") return "prepared";
  return "always";
}

function normalizeHitDie(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? `d${numeric}` : "d6";
}

function buildSemanticClassDescription(context) {
  const { classData } = context;
  const sections = [];

  if (classData.description) sections.push(normalizeHtmlBlock(classData.description));
  if (classData.lore) sections.push(renderNamedHtmlSection("Lore", classData.lore));
  if (classData.spellcasting?.description) sections.push(renderNamedHtmlSection("Spellcasting", classData.spellcasting.description));
  if (classData.multiclassing) sections.push(renderNamedHtmlSection("Multiclassing", classData.multiclassing));
  if (classData.startingEquipment) sections.push(renderNamedHtmlSection("Starting Equipment", classData.startingEquipment));

  return sections.filter(Boolean).join("") || `<p>${foundry.utils.escapeHTML(trimString(classData.name) || "Class")}</p>`;
}

function renderNamedHtmlSection(title, content) {
  const body = normalizeHtmlBlock(content);
  if (!body) return "";
  return `<h2>${foundry.utils.escapeHTML(title)}</h2>${body}`;
}

function normalizeHtmlBlock(value) {
  const text = trimString(value);
  if (!text) return "";
  if (looksLikeHtml(text)) return text;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${foundry.utils.escapeHTML(part).replace(/\n/g, "<br>")}</p>`);

  return paragraphs.join("");
}

function looksLikeHtml(value) {
  return /<\s*[a-z][^>]*>/i.test(String(value ?? ""));
}

function buildSemanticFeatureName(feature) {
  const baseName = trimString(feature?.name) || "Feature";
  if (feature?.featureKind === "subclassChoice" && Number(feature?.level ?? 0) > 1) {
    return `${baseName} (Level ${Number(feature.level)})`;
  }
  return baseName;
}

function buildSemanticFeatureRequirement(feature, context) {
  const level = Number(feature?.level ?? 0);
  const ownerName = (feature?.parentSourceId && feature.parentSourceId !== context.classSourceId)
    ? trimString(context.subclassesBySourceId.get(feature.parentSourceId)?.name) || trimString(context.classData.name)
    : trimString(context.classData.name);

  if (!ownerName || level <= 0) return ownerName || "";
  return `${ownerName} ${level}`;
}

function buildSemanticOptionRequirement(optionItem, context, feature = null) {
  const className = trimString(context.classData?.name) || "Class";
  const featureLevel = Number(feature?.level ?? 0);
  const optionLevel = Number(optionItem?.levelPrerequisite ?? 0);
  const minLevel = Math.max(featureLevel, optionLevel);
  if (minLevel > 0) return `${className} ${minLevel}`;
  return className;
}

function extractSpellcastingScaleValues(levels, key) {
  const values = {};
  for (const [level, data] of Object.entries(levels ?? {})) {
    if (data?.[key] == null) continue;
    values[level] = normalizeNumericValue(data[key]);
  }
  return values;
}

function normalizeScaleValues(values) {
  const normalized = {};
  for (const [level, value] of Object.entries(values ?? {})) {
    const numericLevel = Number(level);
    if (!Number.isFinite(numericLevel) || numericLevel <= 0) continue;
    normalized[String(numericLevel)] = normalizeNumericValue(value);
  }
  return normalized;
}

function normalizeNumericValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function normalizeScaleIdentifier(sourceIdOrName) {
  const sourceId = trimString(sourceIdOrName);
  if (!sourceId) return null;
  if (sourceId.startsWith("scale-")) return sourceId.slice("scale-".length);
  return slugify(sourceId);
}

function looksLikeSourceBookId(value) {
  const normalized = trimString(value);
  return Boolean(normalized) && /^source[-:]/i.test(normalized);
}

function resolveSemanticEntitySourceId(prefix, entity, { sourceBookId = null } = {}) {
  const explicitSourceId = trimString(entity?.sourceId);
  if (explicitSourceId && explicitSourceId !== sourceBookId && !looksLikeSourceBookId(explicitSourceId)) {
    return explicitSourceId;
  }

  const normalizedIdentifier = normalizeSemanticIdentifier(
    entity?.identifier ?? entity?.name ?? entity?.id,
    prefix
  );
  if (normalizedIdentifier) return `${prefix}-${normalizedIdentifier}`;

  return explicitSourceId && explicitSourceId !== sourceBookId ? explicitSourceId : "";
}

function normalizeSemanticIdentifier(value, prefix = null) {
  const text = trimString(value);
  if (!text) return "";
  if (prefix && text.startsWith(`${prefix}-`)) return slugify(text.slice(prefix.length + 1));
  return slugify(text);
}

function buildSemanticSourceId(prefix, entity) {
  const identifier = trimString(entity?.identifier);
  const base = identifier || slugify(trimString(entity?.name));
  return base ? `${prefix}-${base}` : "";
}

function getModuleEntityId(item) {
  if (!item) return null;
  if (typeof item.getFlag === "function") {
    return item.getFlag(MODULE_ID, "entityId")
      ?? item.getFlag(MODULE_ID, "sourceRecordId")
      ?? null;
  }

  return item.flags?.[MODULE_ID]?.entityId
    ?? item.flags?.[MODULE_ID]?.sourceRecordId
    ?? null;
}

function getModuleIdentifier(item) {
  if (!item) return null;
  if (typeof item.getFlag === "function") {
    return item.getFlag(MODULE_ID, "identifier")
      ?? item.system?.identifier
      ?? null;
  }

  return item.flags?.[MODULE_ID]?.identifier
    ?? item.system?.identifier
    ?? null;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAbilityList(values) {
  return ensureArray(values)
    .map((value) => normalizeAbilityCode(value))
    .filter(Boolean);
}

function normalizeAbilityCode(value) {
  const normalized = trimString(value).toLowerCase();
  return normalized || null;
}

function buildAdvancementId(...parts) {
  const collapsed = parts
    .flat()
    .filter(Boolean)
    .map((part) => slugify(part))
    .filter(Boolean)
    .join("-");

  const tokens = collapsed.split("-").filter(Boolean);
  if (!tokens.length) return foundry.utils.randomID();

  return tokens
    .map((token, index) => index === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1))
    .join("");
}

function indexBy(items, key) {
  const map = new Map();
  for (const item of ensureArray(items)) {
    const value = item?.[key];
    if (value != null && value !== "") map.set(value, item);
  }
  return map;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeImagePath(value, fallback) {
  const text = trimString(value);
  return text || fallback;
}

function collectBundleSupportItems(payload) {
  return [
    ...ensureArray(payload.classFeatures),
    ...ensureArray(payload.subclassFeatures),
    ...ensureArray(payload.optionItems)
  ];
}

function countBundleItems(payload, key) {
  return ensureArray(payload?.[key]).length;
}
