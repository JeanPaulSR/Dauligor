import { CLASS_CATALOG_FILE, CLASS_OPTIONS_TEMPLATE, MODULE_ID, SETTINGS, SOURCE_LIBRARY_FILE } from "./constants.js";
import { applyReferenceNormalization, syncDocumentReferences } from "./reference-service.js";
import { log, notifyInfo, notifyWarn, warn } from "./utils.js";

const DEFAULT_CLASS_ICON = "icons/svg/item-bag.svg";
const DEFAULT_SUBCLASS_ICON = "icons/svg/upgrade.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";
const DEFAULT_OPTION_ICON = "icons/svg/upgrade.svg";
const DEFAULT_SOURCE_BOOK = "Dauligor";
const FEATURE_SUPPORTED_ADVANCEMENT_TYPES = new Set(["AbilityScoreImprovement", "ItemChoice", "ItemGrant", "ScaleValue", "Trait"]);
const SUPPORTED_SEMANTIC_ACTIVITY_TYPES = new Set(["attack", "cast", "check", "damage", "enchant", "forward", "heal", "save", "summon", "transform", "utility"]);
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

  const supportOptionItems = ensureArray(payload.optionItems).map((item) => {
    const normalized = normalizeWorldItem(item, payload.source);
    applyPayloadMetadata(normalized.flags?.[MODULE_ID], { payloadMeta: payload, importMode: "world" });
    return normalized;
  });
  const importedSupportDocs = [];
  for (const supportItem of supportOptionItems) {
    importedSupportDocs.push(await upsertWorldItem(supportItem));
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
    importSelection: workflow.selection,
    referencedDocs: importedSupportDocs,
    proficiencyMode: workflow.proficiencyMode
  });
  // Stamp the spell-list endpoint URL on the class item flag so the
  // sheet-side spell preparation manager can fetch the live pool
  // without re-running the catalog lookup. URL is derived by stripping
  // `.json` from the class bundle URL and appending `/spells.json` —
  // same transformation `fetchClassSpellList` does. The bundle URL was
  // stashed on the payload by `_ensureVariantPayload`; if it's missing
  // (raw filesystem import path, etc.) the flag stays unset and the
  // sheet manager falls back to a "Re-import to see the live spell
  // list" hint.
  const classBundleUrl = payload?._dauligorBundleUrl;
  if (classBundleUrl) {
    const spellListUrl = String(classBundleUrl).replace(/\.json(\?.*)?$/i, "/spells.json");
    preparedClass.flags = preparedClass.flags ?? {};
    preparedClass.flags[MODULE_ID] = preparedClass.flags[MODULE_ID] ?? {};
    preparedClass.flags[MODULE_ID].spellListUrl = spellListUrl;
  }
  const actorClassDoc = await upsertActorItem(targetActor, preparedClass);
  if (!actorClassDoc) {
    notifyWarn(`Failed to import "${classItem.name ?? entry?.name ?? "class"}" onto "${targetActor.name}".`);
    return null;
  }

  const importedFeatures = [];
  for (const featureItem of workflow.importClassFeatureItems) {
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
      classSourceId,
      referencedDocs: importedSupportDocs
    });
    subclassDoc = await upsertActorItem(targetActor, preparedSubclass);
    if (!subclassDoc) {
      notifyWarn(`Failed to import subclass "${workflow.selectedSubclassItem.name}" onto "${targetActor.name}".`);
    }
  }

  const importedSubclassFeatures = [];
  for (const featureItem of workflow.importSubclassFeatureItems) {
    const existingFeature = findMatchingActorItem(targetActor, featureItem);
    importedSubclassFeatures.push(await upsertActorItem(targetActor, normalizeEmbeddedActorFeature(featureItem, classSourceId, {
      existingItem: existingFeature,
      payloadMeta: payload
    })));
  }

  const importedOptionItems = [];
  for (const optionItem of workflow.importOptionItems) {
    const existingOptionItem = findMatchingActorItem(targetActor, optionItem);
    importedOptionItems.push(await upsertActorItem(targetActor, normalizeEmbeddedActorFeature(optionItem, classSourceId, {
      existingItem: existingOptionItem,
      payloadMeta: payload
    })));
  }

  // Cantrips + spells-known picked in runSpellSelectionStep. Each
  // selection is a flag.dauligor-pairing.sourceId; we match against
  // the `classSpellItems` summaries on the workflow, fetch the FULL
  // spell item per pick (the summary lacks `system` / effects to keep
  // the picker payload light), then embed the matching items as
  // Foundry spell documents on the actor. Already-on-actor sourceIds
  // get skipped naturally because `upsertActorItem` is idempotent
  // (updates the existing item rather than creating a duplicate).
  // Skipped when the selection arrays are empty (the common case for
  // non-spellcasting class imports or when the player chose Skip in
  // the picker).
  const importedSpellItems = [];
  const spellSelections = workflow.selection?.spellSelections ?? null;
  if (spellSelections && Array.isArray(workflow.classSpellItems)) {
    const selectedSourceIds = new Set([
      ...ensureArray(spellSelections.cantripSourceIds).map(String),
      ...ensureArray(spellSelections.spellSourceIds).map(String),
    ]);
    if (selectedSourceIds.size > 0) {
      // The bundle URL ride-along was stashed on the payload by
      // `_ensureVariantPayload` (see importer-app.js). It's the only
      // way for code at this depth to reconstruct the per-spell
      // endpoint without threading the URL through the workflow.
      const bundleUrl = payload?._dauligorBundleUrl ?? null;
      for (const summary of workflow.classSpellItems) {
        const summaryFlags = summary?.flags?.[MODULE_ID] ?? {};
        const sourceId = trimString(summaryFlags.sourceId);
        if (!sourceId || !selectedSourceIds.has(sourceId)) continue;

        // Fetch the full spell item (with system block + effects) on
        // demand. The summary alone is too thin to embed — dnd5e
        // would render a name-only spell with no description,
        // activities, materials, etc. Fall back to the summary if
        // the fetch fails so the embed at least produces a valid
        // (if hollow) spell document.
        const dbId = trimString(summaryFlags.dbId);
        let fullSpell = null;
        if (bundleUrl && dbId) {
          fullSpell = await fetchFullSpellItem(bundleUrl, dbId);
        }
        if (!fullSpell) {
          warn("Spell embed: full-item fetch failed, embedding summary as-is (description/activities will be missing)", {
            sourceId, dbId,
          });
        }
        const spellItem = fullSpell ?? summary;

        // Reuse the world-item normalizer so the spell picks up the
        // standard source/book/audit flags. Spells need no class-
        // sourceId attribution like features do — they live alongside
        // the class item, not under it.
        const normalized = normalizeWorldItem(spellItem, payload.source);
        applyPayloadMetadata(normalized.flags?.[MODULE_ID], { payloadMeta: payload, importMode: "actor" });
        // Stash the granting class so the actor sheet (and the
        // Dauligor app's downstream tooling) can attribute the spell
        // back to its source. Mirrors the granted_by_* shape used on
        // the app side (see character_spells columns).
        normalized.flags = normalized.flags ?? {};
        normalized.flags[MODULE_ID] = normalized.flags[MODULE_ID] ?? {};
        normalized.flags[MODULE_ID].grantedByClassSourceId = classSourceId;
        importedSpellItems.push(await upsertActorItem(targetActor, normalized));
      }
    }
  }

  // Post-embed: wire option items that declare a Uses Feature to consume
  // from the matching actor item (Battle Master maneuvers → Superiority
  // Dice pool, etc.) and inherit that feature's damage scaling. Runs
  // here because dnd5e's `consumption.targets[].target` uses a
  // relativeUUID (`Item.<actor-item-id>`) which only exists after both
  // sides are embedded.
  await wireOptionUsesFeatures(targetActor, importedOptionItems, [
    ...importedFeatures,
    ...importedSubclassFeatures
  ]);

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
    toolSelections: workflow.selection.toolSelections,
    savingThrowSelections: workflow.selection.savingThrowSelections,
    languageSelections: workflow.selection.languageSelections,
    hpResolution,
    referencedDocs: importedSupportDocs
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
      targetLevel: classLevel,
      referencedDocs: importedSupportDocs
    });
  }
  const appliedClassTraits = workflow.isMulticlassImport
    ? await applyActorTraitProfile(targetActor, workflow.semanticClassData?.multiclassProficiencies, {
      skillSelections: workflow.selection.skillSelections,
      toolSelections: workflow.selection.toolSelections
    })
    : await applyActorTraitAdvancements(targetActor, syncedClassDoc ?? actorClassDoc);
  const appliedSubclassTraits = syncedSubclassDoc
    ? await applyActorTraitAdvancements(targetActor, syncedSubclassDoc)
    : 0;
  let appliedFeatureTraits = 0;
  for (const featureDoc of [...importedFeatures, ...importedSubclassFeatures, ...importedOptionItems].filter(Boolean)) {
    appliedFeatureTraits += await applyActorTraitAdvancements(targetActor, featureDoc);
  }
  const appliedSkillChoices = await applyActorSkillSelections(targetActor, workflow.selection.skillSelections);
  const appliedToolChoices = await applyActorToolSelections(targetActor, workflow.selection.toolSelections);
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
  const openedAsiFlows = await promptActorAbilityScoreImprovements(targetActor, syncedClassDoc ?? actorClassDoc, {
    existingClassLevel: workflow.existingClassLevel,
    targetLevel: classLevel,
    entry,
    payload,
    classSourceId
  });

  notifyInfo(
    `Imported "${(syncedClassDoc ?? actorClassDoc).name}" to "${targetActor.name}" at class level ${classLevel}`
    + ` with ${importedFeatures.length} class feature item(s), ${importedSubclassFeatures.length} subclass feature item(s),`
    + ` and ${importedOptionItems.length} selected option item(s).`
    + `${appliedHpIncrease ? ` Applied ${appliedHpIncrease} hit point(s).` : ""}`
    + `${appliedClassTraits ? ` Applied ${appliedClassTraits} class trait advancement change(s).` : ""}`
    + `${appliedSubclassTraits ? ` Applied ${appliedSubclassTraits} subclass trait advancement change(s).` : ""}`
    + `${appliedFeatureTraits ? ` Applied ${appliedFeatureTraits} feature trait advancement change(s).` : ""}`
    + `${appliedSkillChoices ? ` Applied ${appliedSkillChoices} skill proficiency selection(s).` : ""}`
    + `${removedFeatures ? ` Removed ${removedFeatures} class feature item(s).` : ""}`
    + `${removedSubclassFeatures ? ` Removed ${removedSubclassFeatures} subclass feature item(s).` : ""}`
    + `${removedOptionItems ? ` Removed ${removedOptionItems} class option item(s).` : ""}`
    + `${removedSubclassItems ? ` Removed ${removedSubclassItems} subclass item(s).` : ""}`
    + `${openedAsiFlows ? ` Resolved ${openedAsiFlows} Dauligor ability score improvement step(s).` : ""}`
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
    appliedClassTraits,
    appliedSubclassTraits,
    appliedSkillChoices,
    openedAsiFlows,
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
  const storedProficiencyMode = trimString(existingClassItem?.getFlag?.(MODULE_ID, "proficiencyMode")) || null;
  const existingOtherClasses = targetActor
    ? targetActor.items.filter((item) =>
      item.type === "class"
      && item.id !== existingClassItem?.id
      && (Number(item.system?.levels ?? 0) || 0) > 0)
    : [];
  const requestedTargetLevel = normalizeClassLevel(targetLevel, classItem.system?.levels);
  const normalizedTargetLevel = normalizeClassLevel(Math.max(existingClassLevel, requestedTargetLevel), classItem.system?.levels);
  const existingSelections = sanitizeClassImportSelection(existingClassItem?.getFlag(MODULE_ID, "importSelections") ?? {});
  const semanticClassData = getSemanticClassData(supportedPayload);
  const isExistingClassImport = existingClassLevel > 0;
  const proficiencyMode = storedProficiencyMode === "multiclass"
    ? "multiclass"
    : (!isExistingClassImport && existingOtherClasses.length > 0 ? "multiclass" : "primary");
  const isMulticlassImport = proficiencyMode === "multiclass";
  const proficiencySource = getClassImportProficiencySource(semanticClassData, { isMulticlassImport });

  const classFeatures = ensureArray(bundle.classFeatures).map((item) => normalizeWorldItem(item, bundle.source));
  const subclassItems = ensureArray(bundle.subclassItems).map((item) => normalizeWorldItem(item, bundle.source));
  const subclassFeatures = ensureArray(bundle.subclassFeatures).map((item) => normalizeWorldItem(item, bundle.source));
  const optionItems = ensureArray(bundle.optionItems).map((item) => normalizeWorldItem(item, bundle.source));

  // Synthesize a Spellcasting feature item from `class.spellcasting.*`
  // so it lands on the actor as a real `feat` document rather than
  // hiding inside the class item's description HTML. See
  // `buildSyntheticSpellcastingFeature` for the rationale. The synth's
  // sourceId is layered into `desiredClassFeatureIds` below once we
  // know the import has crossed `class.spellcasting.level`.
  const syntheticSpellcastingFeature = buildSyntheticSpellcastingFeature({
    semanticClassData,
    classSourceId,
    sourceBookId: bundle.source?.sourceId ?? null
  });
  if (syntheticSpellcastingFeature) {
    classFeatures.push(syntheticSpellcastingFeature);
  }

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

  const optionGroups = normalizeClassOptionGroups(
    classItem.flags?.[MODULE_ID]?.optionGroups,
    classItem.system?.advancement
  )
    .map((group) => {
      // All options the group owns ship through to the picker — the
      // option-picker UI is responsible for displaying higher-level
      // options as locked rather than hiding them. Players want to
      // see "what's coming next level" alongside what they can pick
      // right now, with the locked entries clearly marked so they
      // know it's a level-gate not a permanent block.
      const availableOptions = optionItems
        .filter((item) => (item.flags?.[MODULE_ID]?.groupSourceId ?? null) === group.sourceId)
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
      classData: proficiencySource,
      requestedSelections,
      existingSelections
    }),
    toolSelections: getInitialToolSelections({
      classData: proficiencySource,
      requestedSelections,
      existingSelections
    })
  };

  const desiredClassFeatureIds = collectGrantedFeatureSourceIds(classItem.system?.advancement, normalizedTargetLevel);
  // The synthetic Spellcasting feature has no `ItemGrant` row in
  // `class.system.advancement`, so it never makes it into the set
  // above. Route it in manually when the import has reached the level
  // the class actually gains spellcasting — same level-gate semantics
  // as the real ItemGrant rows.
  if (syntheticSpellcastingFeature) {
    const synthLevel = Number(syntheticSpellcastingFeature.flags?.[MODULE_ID]?.level ?? 1) || 1;
    const synthSourceId = syntheticSpellcastingFeature.flags?.[MODULE_ID]?.sourceId;
    if (synthSourceId && synthLevel <= normalizedTargetLevel) {
      desiredClassFeatureIds.add(synthSourceId);
    }
  }
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
  const skillChoices = buildSkillChoiceConfig(proficiencySource);
  const toolChoices = buildToolChoiceConfig(proficiencySource);

  const allAdvancements = [
    ...Object.values(normalizeAdvancementStructure(classItem?.system?.advancement))
  ].filter(Boolean);

  const extraSkills = collectTraitAdvancementChoices(allAdvancements, "skills");
  if (extraSkills.choiceCount > 0) {
    skillChoices.choiceCount += extraSkills.choiceCount;
    for (const opt of extraSkills.options) {
      if (!skillChoices.options.includes(opt)) {
        skillChoices.options.push(opt);
      }
      if (!skillChoices.allOptions.includes(opt)) {
        skillChoices.allOptions.push(opt);
      }
      skillChoices.availableSet.add(opt);
    }
  }

  const extraTools = collectTraitAdvancementChoices(allAdvancements, "tools");
  if (extraTools.choiceCount > 0) {
    toolChoices.choiceCount += extraTools.choiceCount;
    for (const opt of extraTools.options) {
      if (!toolChoices.options.includes(opt)) {
        toolChoices.options.push(opt);
      }
      if (!toolChoices.allOptions.includes(opt)) {
        toolChoices.allOptions.push(opt);
      }
      toolChoices.availableSet.add(opt);
    }
  }
  // Sort by (grant level ascending, then editor-side sort key) so the
  // level-by-level prompt loop in importer-app.js can iterate features
  // in chronological order without re-sorting per iteration, and the
  // embed phase below applies them to the actor in the same order
  // they're shown on a class's level-up table.
  const featureLevelOf = (item) => Number(item?.flags?.[MODULE_ID]?.level ?? 0) || 0;
  const featureSortOf = (item) => Number(item?.flags?.[MODULE_ID]?.sort ?? item?.sort ?? 0) || 0;
  const sortByLevelThenSort = (a, b) => {
    const lvlDiff = featureLevelOf(a) - featureLevelOf(b);
    if (lvlDiff !== 0) return lvlDiff;
    return featureSortOf(a) - featureSortOf(b);
  };
  const importClassFeatureItems = desiredClassFeatureItems
    .filter((item) =>
      shouldImportProgressionItem(item, {
        actor: targetActor,
        existingClassLevel
      }))
    .sort(sortByLevelThenSort);
  const importSubclassFeatureItems = desiredSubclassFeatureItems
    .filter((item) =>
      shouldImportProgressionItem(item, {
        actor: targetActor,
        existingClassLevel
      }))
    .sort(sortByLevelThenSort);
  const importOptionItems = selectedOptionItems.filter((item) =>
    shouldImportProgressionItem(item, {
      actor: targetActor,
      existingClassLevel
    }));
  const levelRows = buildClassLevelRows({
    classFeatures,
    subclassFeatures,
    selectedSubclassSourceId: selectedSubclassItem?.flags?.[MODULE_ID]?.sourceId ?? null,
    includeSubclass: normalizedSelection.includeSubclass,
    // Lock every level up to and including the actor's current class
    // level — those are already imported. With existingClassLevel=3,
    // pass minimumLevel=4 so `locked: level < minimumLevel` marks 1-3
    // as locked rows; level 4+ remain selectable.
    minimumLevel: existingClassLevel > 0 ? existingClassLevel + 1 : 1,
    targetLevel: normalizedTargetLevel
  });
  const spellcastingRows = buildCurrentSpellcastingProgressionRows(supportedPayload, semanticClassData);

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
    isExistingClassImport,
    isMulticlassImport,
    proficiencyMode,
    proficiencySource,
    classFeatures,
    subclassItems,
    subclassFeatures,
    optionItems,
    optionGroups,
    // Pre-resolved `spellRule` allowlists from the class export — each
    // ruleId maps to spell sourceIds the rule covers at bake time. The
    // option-picker hands this through to the requirements walker so
    // `spellRule` leaves can auto-evaluate ("does the actor know any
    // matching spell?") without re-running the tag-query matcher in JS.
    // See `src/lib/classExport.ts` for how the allowlist is built.
    spellRuleAllowlists: payload.spellRuleAllowlists ?? {},
    // Rule id → display name, used by the picker's pill renderer so
    // spellRule pills show "Knows Fire Spells" instead of "(spell rule)".
    spellRuleNameById: payload.spellRuleNameById ?? {},
    // Per-class master spell list, baked at export time as an array of
    // Foundry-ready spell items (`{ name, type:'spell', system, flags }`).
    // The importer's runSpellSelectionStep uses this to render the
    // cantrip / spells-known picker and to embed chosen spells onto the
    // actor at level-up. Empty array when the class hasn't been curated
    // in /compendium/spell-lists yet.
    classSpellItems: ensureArray(payload.classSpellItems),
    // Class bundle URL stashed by `_ensureVariantPayload` so the
    // picker's detail panel + the embed phase can derive the
    // per-spell endpoint URL (`/api/module/spells/<dbId>.json`).
    // Null when the payload arrived through a path that didn't run
    // through that fetch (e.g. raw filesystem import). Downstream
    // code handles null by falling back to the summary as-is.
    bundleUrl: payload?._dauligorBundleUrl ?? null,
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
    toolChoices,
    levelRows,
    spellcastingRows,
    importClassFeatureItems,
    importSubclassFeatureItems,
    importOptionItems,
    startingEquipment: semanticClassData?.startingEquipment ?? "",
    choiceAdvancements: (function () {
      // Tag each feature-attached advancement with the owner item's
      // sourceId + grant level so the importer-app.js prompt loop can
      // gate by "is this feature being granted at this level?" Without
      // this attribution, a Pact Boon ItemChoice would look identical
      // to a class-root ItemChoice and we'd lose the link to whether
      // the feature is actually present.
      const tagOwner = (item) => (adv) => ({
        ...adv,
        _ownerSourceId: item?.flags?.[MODULE_ID]?.sourceId ?? null,
        _ownerLevel: Number(item?.flags?.[MODULE_ID]?.level ?? 0) || 0,
        _ownerType: item?.flags?.[MODULE_ID]?.sourceType ?? null
      });
      const featureAdvancements = [
        ...desiredClassFeatureItems,
        ...desiredSubclassFeatureItems,
        ...selectedOptionItems
      ].flatMap(item =>
        Object.values(normalizeAdvancementStructure(item?.system?.advancement)).map(tagOwner(item))
      );
      const advancements = [
        ...Object.values(normalizeAdvancementStructure(classItem?.system?.advancement)),
        ...Object.values(normalizeAdvancementStructure(selectedSubclassItem?.system?.advancement)),
        ...featureAdvancements
      ].filter(Boolean);
      return advancements.filter(adv => {
        if (adv?.type !== "Trait" && adv?.type !== "ItemChoice") return false;
        const level = Number(adv.level ?? 1) || 1;
        if (level > normalizedTargetLevel) return false;
        if (adv.type === "Trait") {
          const choices = Array.isArray(adv.configuration?.choices) ? adv.configuration.choices : [];
          if (choices.some(c => c.count > 0 && Array.isArray(c.pool) && c.pool.length > 0)) return true;
          if (adv.configuration?.type && Number(adv.configuration?.choiceCount) > 0 && Array.isArray(adv.configuration?.options) && adv.configuration.options.length > 0) return true;
          return false;
        }
        if (adv.type === "ItemChoice") {
          // Two pool shapes are supported in dnd5e 5.x ItemChoice:
          //   - inline `configuration.choices[].pool` (array-form, with
          //     per-entry count + UUID pool — used by some legacy or
          //     hand-authored entries)
          //   - reference to one of our Modular Option Groups via
          //     `configuration.optionGroupId` (Dauligor's canonical
          //     path for Pact Boon / Eldritch Invocations / Battle
          //     Master Maneuvers / etc.) — count lives in
          //     `configuration.choices` keyed by level
          const choices = Array.isArray(adv.configuration?.choices)
            ? adv.configuration.choices
            : Object.values(adv.configuration?.choices ?? {});
          const hasInlinePool = choices.some(c => Number(c?.count || 0) > 0 && Array.isArray(c?.pool) && c.pool.length > 0);
          if (hasInlinePool) return true;
          const optionGroupSourceId = trimString(adv.configuration?.optionGroupId);
          if (!optionGroupSourceId) return false;
          // Option-group-backed: include when at least one choice tier
          // has a count > 0. Pool resolution happens at prompt time via
          // workflow.optionGroups lookup.
          return choices.some(c => Number(c?.count || 0) > 0);
        }
        return false;
      });
    })()
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

  // Spell picks from runSpellSelectionStep. Two parallel arrays so the
  // embed phase can apply cantrip-cap and spell-cap logic separately if
  // it ever needs to. Strings are normalised so the embed sees the same
  // sourceId shape regardless of how the caller passed them in.
  const rawSpellSelections = selection?.spellSelections ?? null;
  const spellSelections = rawSpellSelections && typeof rawSpellSelections === "object"
    ? {
      cantripSourceIds: [...new Set(ensureArray(rawSpellSelections.cantripSourceIds).map((id) => trimString(id)).filter(Boolean))],
      spellSourceIds: [...new Set(ensureArray(rawSpellSelections.spellSourceIds).map((id) => trimString(id)).filter(Boolean))],
    }
    : { cantripSourceIds: [], spellSourceIds: [] };

  return {
    includeSubclass: selection?.includeSubclass === undefined ? null : Boolean(selection.includeSubclass),
    subclassSourceId: trimString(selection?.subclassSourceId) || null,
    optionSelections,
    hpMode: trimString(selection?.hpMode) || null,
    hpCustomFormula: trimString(selection?.hpCustomFormula) || null,
    spellMode: trimString(selection?.spellMode) || null,
    spellSelections,
    skillSelections: [...new Set(ensureArray(selection?.skillSelections).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))],
    toolSelections: [...new Set(ensureArray(selection?.toolSelections).map((slug) => normalizeToolSlug(slug)).filter(Boolean))],
    savingThrowSelections: [...new Set(ensureArray(selection?.savingThrowSelections).map((code) => normalizeAbilityCode(code)).filter(Boolean))],
    languageSelections: [...new Set(ensureArray(selection?.languageSelections).map((slug) => slugify(trimString(slug))).filter(Boolean))],
    traitSelections: typeof selection?.traitSelections === "object" ? foundry.utils.deepClone(selection.traitSelections) : {}
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

function getInitialToolSelections({ classData = null, requestedSelections = {}, existingSelections = {} } = {}) {
  const toolConfig = buildToolChoiceConfig(classData);
  const requested = requestedSelections.toolSelections?.length ? requestedSelections.toolSelections : existingSelections.toolSelections ?? [];
  const selected = new Set(toolConfig.fixed);
  for (const slug of requested) {
    if (toolConfig.availableSet.has(slug)) selected.add(slug);
  }
  return [...selected];
}

function normalizeToolSlug(slug) {
  const s = slugify(trimString(slug));
  if (!s) return null;
  if (s === "thief") return "thieves";
  return s;
}

function getClassImportProficiencySource(classData, { isMulticlassImport = false } = {}) {
  if (!classData || typeof classData !== "object") return null;
  if (!isMulticlassImport) return classData;

  const multiclassProficiencies = classData.multiclassProficiencies;
  if (!multiclassProficiencies || typeof multiclassProficiencies !== "object") return classData;

  return {
    proficiencies: multiclassProficiencies
  };
}

function collectTraitAdvancementChoices(advancements, traitType) {
  let choiceCount = 0;
  const options = [];

  for (const adv of ensureArray(advancements)) {
    if (adv?.type !== "Trait") continue;

    // Format 1: choices array with pool containing prefixed strings
    const choices = ensureArray(adv.configuration?.choices);
    if (choices.length > 0) {
      for (const c of choices) {
        if (c.count > 0 && Array.isArray(c.pool) && c.pool.length > 0) {
          const isMatch = c.pool.some(entry => {
            if (typeof entry !== "string") return false;
            if (traitType === "skills" && entry.startsWith("skill:")) return true;
            if (traitType === "tools" && entry.startsWith("tool:")) return true;
            return false;
          });
          if (isMatch) {
            choiceCount += Number(c.count) || 0;
            for (const entry of c.pool) {
              if (typeof entry !== "string") continue;
              if (traitType === "skills" && entry.startsWith("skill:")) {
                options.push(entry.replace("skill:", ""));
              } else if (traitType === "tools" && entry.startsWith("tool:")) {
                options.push(entry.replace("tool:", ""));
              }
            }
          }
        }
      }
    }

    // Format 2: Direct trait configuration type matches the requested traitType
    if (adv.configuration?.type === traitType && Number(adv.configuration?.choiceCount) > 0) {
      console.log(`[Dauligor Importer] Found direct trait choice matching format 2: id=${adv._id}, title=${adv.title}, type=${adv.configuration.type}, choiceCount=${adv.configuration.choiceCount}`);
      choiceCount += Number(adv.configuration.choiceCount) || 0;
      const opts = ensureArray(adv.configuration.options);
      for (const opt of opts) {
        if (typeof opt === "string" && opt) {
          options.push(opt);
        }
      }
    }
  }
  return { choiceCount, options };
}

function buildSkillChoiceConfig(classData) {
  const skills = classData?.proficiencies?.skills ?? classData?.skills ?? {};
  const fixed = [...new Set(ensureArray(skills.fixed ?? skills.fixedIds).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))];
  const options = [...new Set(ensureArray(skills.options ?? skills.optionIds).map((slug) => normalizeSkillSlug(slug)).filter(Boolean))];
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

function buildToolChoiceConfig(classData) {
  const tools = classData?.proficiencies?.tools ?? classData?.tools ?? {};
  const fixed = [...new Set(ensureArray(tools.fixed ?? tools.fixedIds).map((slug) => normalizeToolSlug(slug)).filter(Boolean))];
  const options = [...new Set(ensureArray(tools.options ?? tools.optionIds).map((slug) => normalizeToolSlug(slug)).filter(Boolean))];
  const allOptions = [...new Set([...fixed, ...options])];
  const availableSet = new Set(allOptions);

  return {
    choiceCount: Math.max(0, Number(tools.choiceCount ?? 0) || 0),
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

function shouldImportProgressionItem(item, { actor = null, existingClassLevel = 0 } = {}) {
  if (!item) return false;
  if (existingClassLevel <= 0) return true;

  const unlockLevel = getProgressionItemLevel(item);
  if (unlockLevel > existingClassLevel) return true;

  const targetActor = resolveTargetActor(actor);
  if (!targetActor) return false;
  return !findMatchingActorItem(targetActor, item);
}

function getProgressionItemLevel(item) {
  return Number(
    item?.flags?.[MODULE_ID]?.levelPrerequisite
    ?? item?.flags?.[MODULE_ID]?.level
    ?? 0
  ) || 0;
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

function normalizeClassOptionGroups(groups, advancement = null) {
  return ensureArray(groups)
    .map((group) => {
      const sourceId = trimString(group?.sourceId) || null;
      const configuredCounts = normalizeScaleValues(group?.selectionCountsByLevel);
      const derivedCounts = Object.keys(configuredCounts).length
        ? configuredCounts
        : deriveOptionGroupSelectionCounts(sourceId, advancement);

      return {
        sourceId,
        featureSourceId: trimString(group?.featureSourceId) || null,
        // Forwarded from the export's metadata builder. Set when the
        // group originates on a subclass-root advancement; the importer
        // skips the prompt when it doesn't match the chosen subclass.
        subclassSourceId: trimString(group?.subclassSourceId) || null,
        scalingSourceId: trimString(group?.scalingSourceId) || null,
        selectionCountsByLevel: derivedCounts,
        name: trimString(group?.name) || null
      };
    })
    .filter((group) => group.sourceId);
}

function deriveOptionGroupSelectionCounts(groupSourceId, advancement) {
  const normalizedGroupSourceId = trimString(groupSourceId);
  if (!normalizedGroupSourceId) return {};

  for (const advancementEntry of Object.values(normalizeAdvancementStructure(advancement))) {
    if (advancementEntry?.type !== "ItemChoice") continue;

    const entryGroupId = trimString(
      advancementEntry?.flags?.[MODULE_ID]?.optionGroupSourceId
      ?? advancementEntry?.configuration?.optionGroupSourceId
      ?? advancementEntry?.configuration?.optionGroupId
    );
    if (entryGroupId !== normalizedGroupSourceId) continue;

    const normalized = {};
    for (const [level, data] of Object.entries(advancementEntry?.configuration?.choices ?? {})) {
      const numericLevel = Number(level);
      const count = Math.max(0, Number(data?.count ?? 0) || 0);
      if (!Number.isFinite(numericLevel) || numericLevel <= 0 || count <= 0) continue;
      normalized[String(numericLevel)] = count;
    }
    return normalized;
  }

  return {};
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
  const levels = getSpellsKnownScalingLevels(payload, classData);
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

function buildCurrentSpellcastingProgressionRows(payload, classData) {
  const knownLevels = getSpellsKnownScalingLevels(payload, classData);
  const alternativeLevels = getAlternativeSpellcastingLevels(payload, classData);
  const levelSet = new Set([
    ...Object.keys(knownLevels),
    ...Object.keys(alternativeLevels)
  ]);
  if (!levelSet.size) return [];

  return [...levelSet]
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level) && level > 0)
    .sort((left, right) => left - right)
    .map((level) => {
      const knownData = knownLevels[String(level)] ?? {};
      const alternativeData = alternativeLevels[String(level)] ?? {};
      const slotCount = Number(alternativeData?.slotCount ?? 0) || 0;
      const slotLevel = Number(alternativeData?.slotLevel ?? 0) || 0;

      return {
        level,
        cantrips: knownData?.cantrips ?? "-",
        spells: knownData?.spellsKnown ?? "-",
        slots: slotCount > 0 && slotLevel > 0 ? `${slotLevel}:${slotCount}` : "-"
      };
    });
}

function getSpellsKnownScalingLevels(payload, classData) {
  const sourceId = trimString(
    classData?.spellcasting?.spellsKnownSourceId
    ?? classData?.spellsKnownSourceId
  );
  const levels = sourceId
    ? payload?.spellsKnownScalings?.[sourceId]?.levels
    : null;
  return levels && typeof levels === "object" ? levels : {};
}

function getAlternativeSpellcastingLevels(payload, classData) {
  const sourceId = trimString(
    classData?.spellcasting?.altProgressionSourceId
    ?? classData?.altProgressionSourceId
  );
  const levels = sourceId
    ? payload?.alternativeSpellcastingScalings?.[sourceId]?.levels
    : null;
  return levels && typeof levels === "object" ? levels : {};
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

  console.log("===[Advancement Import Tracing]===");
  console.log("All root class advancements count:", ensureArray(classData?.advancements).length);
  console.log("All subclasses advancements count:", subclasses.flatMap(sub => ensureArray(sub?.advancements)).length);
  console.log("All root class advancements details:", classData?.advancements);
  console.log("All subclass advancements details:", subclasses.flatMap(sub => ensureArray(sub?.advancements)));
  console.log("All individual feature advancements details:", features.flatMap(f => ensureArray(f?.advancements).map(adv => ({ featName: f.name, adv }))));

  const isFeatureAttachedAdvancement = (adv) => {
    const id = trimString(adv?._id);
    const featSourceId = trimString(adv?.featureSourceId);
    return featSourceId && !id.startsWith("inherent-");
  };

  const featureAttachedAdvancements = [
    ...ensureArray(classData?.advancements).filter(isFeatureAttachedAdvancement),
    ...subclasses.flatMap(sub => ensureArray(sub?.advancements).filter(isFeatureAttachedAdvancement))
  ];

  console.log("Identified feature-attached advancements:", featureAttachedAdvancements.map(a => ({ id: a?._id, type: a?.type, featId: a?.featureSourceId })));

  const featureAdvancementsBySourceId = new Map();
  for (const adv of featureAttachedAdvancements) {
    const featSourceId = trimString(adv?.featureSourceId);
    if (!featureAdvancementsBySourceId.has(featSourceId)) {
      featureAdvancementsBySourceId.set(featSourceId, []);
    }
    featureAdvancementsBySourceId.get(featSourceId).push(adv);
  }

  // Keep feature attached advancements on class/subclass so Foundry can store and use them properly
  const normalizedFeatures = features.map(feature => {
    const featureSourceId = feature?.sourceId ?? buildSemanticSourceId(
      feature?.featureKind === "subclassFeature" ? "subclass-feature" : "class-feature",
      feature
    );
    if (featureAdvancementsBySourceId.has(featureSourceId)) {
      console.log(`Distributing advancements to feature [${feature.name} / ${featureSourceId}]:`, featureAdvancementsBySourceId.get(featureSourceId).map(a => a?._id));
      return {
        ...feature,
        advancements: [
          ...ensureArray(feature.advancements),
          ...featureAdvancementsBySourceId.get(featureSourceId)
        ]
      };
    }
    return feature;
  });
  console.log("===================================");

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
    features: normalizedFeatures,
    scalingColumns,
    uniqueOptionGroups,
    uniqueOptionItems,
    sourceMeta,
    sourceBookId,
    classSourceId,
    classIdentifier: normalizeSemanticIdentifier(classData.identifier ?? classData.name ?? classData.id, "class"),
    featuresById: indexBy(normalizedFeatures, "id"),
    featuresBySourceId: indexBy(normalizedFeatures, "sourceId"),
    subclassesById: indexBy(subclasses, "id"),
    subclassesBySourceId: indexBy(subclasses, "sourceId"),
    scalingColumnsById: indexBy(scalingColumns, "id"),
    scalingColumnsBySourceId: indexBy(scalingColumns, "sourceId"),
    optionGroupsById: indexBy(uniqueOptionGroups, "id"),
    optionGroupsBySourceId: indexBy(uniqueOptionGroups, "sourceId")
  };

  const classFeatures = normalizedFeatures
    .filter((feature) => shouldTreatAsClassGrantFeature(feature, context))
    .map((feature) => createSemanticFeatureItem(feature, context, { sourceType: "classFeature" }));

  const subclassFeatures = normalizedFeatures
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
    optionItems,
    // Forward the Foundry-side ride-along fields from the input
    // payload. `_dauligorBundleUrl` is stashed on the raw payload
    // by `_ensureVariantPayload` (in importer-app.js) when the
    // class bundle is fetched. Without this forwarding, the
    // class-bundle returned here loses the URL and downstream
    // code (`importClassBundleToActor` stamping `spellListUrl`
    // on the actor's class item; the picker's lazy description
    // fetch) silently degrades — the sheet manager then shows
    // "Re-import to populate the available-spells list" forever
    // because no re-import EVER stamps the flag.
    _dauligorBundleUrl: payload?._dauligorBundleUrl ?? null
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
      spellcasting: buildFoundrySpellcastingData(classData.spellcasting, {
        classIdentifier
      }),
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
  const spellcastingMeta = normalizeSpellcastingModuleFlags(classData.spellcasting);
  if (spellcastingMeta) item.flags[MODULE_ID].spellcasting = spellcastingMeta;

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

  const subclassIdentifier = normalizeSemanticIdentifier(subclass.identifier ?? subclassSourceId ?? subclass.name, "subclass");

  const item = {
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
      identifier: subclassIdentifier,
      classIdentifier: context.classIdentifier,
      description: {
        value: normalizeHtmlBlock(subclass.description) || `<p>${foundry.utils.escapeHTML(trimString(subclass.name) || "Subclass")} imported from Dauligor.</p>`,
        chat: ""
      },
      source: buildFoundrySourceData(sourceMeta, context.payload?.source ?? null),
      spellcasting: buildFoundrySpellcastingData(subclass?.spellcasting, {
        classIdentifier: context.classIdentifier,
        subclassIdentifier
      }),
      advancement: Object.keys(rootAdvancement).length
        ? rootAdvancement
        : buildSemanticSubclassAdvancement(subclass, context)
    }
  };
  const spellcastingMeta = normalizeSpellcastingModuleFlags(subclass?.spellcasting);
  if (spellcastingMeta) item.flags[MODULE_ID].spellcasting = spellcastingMeta;
  return item;
}

function createSemanticFeatureItem(feature, context, { sourceType = "classFeature" } = {}) {
  const sourceId = feature?.sourceId ?? buildSemanticSourceId(sourceType === "subclassFeature" ? "subclass-feature" : "class-feature", feature);
  const classSourceId = feature?.classSourceId ?? context.classSourceId ?? null;
  const parentSourceId = feature?.parentSourceId ?? null;
  const requirementLabel = buildSemanticFeatureRequirement(feature, context);
  const featureType = buildSemanticFeatureTypeData({
    sourceType,
    feature
  });

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
  if (featureType?.label) flags.featureTypeLabel = featureType.label;
  if (featureType?.subtype) flags.featureTypeSubtype = featureType.subtype;
  if (featureType?.value) flags.featureTypeValue = featureType.value;

  if (parentSourceId && parentSourceId !== classSourceId) {
    flags.subclassSourceId = parentSourceId;
  }
  if (Array.isArray(feature?.uniqueOptionGroupIds) && feature.uniqueOptionGroupIds.length) {
    flags.uniqueOptionGroupIds = feature.uniqueOptionGroupIds.map((groupId) => {
      const group = context.optionGroupsById.get(groupId);
      return group?.sourceId ?? groupId;
    });
  }
  // Stash the pre-built `@scale.<class>.<id>` formulas authored via the
  // feature's Quantity / Scaling Column links. `usesScaleFormula` feeds
  // `system.uses.max` below; `scaleFormula` is metadata for activity
  // damage/dice formulas to reference (the activity authoring layer can
  // pick this up later, or the user can paste it manually).
  if (trimString(feature?.usesScaleFormula)) {
    flags.usesScaleFormula = feature.usesScaleFormula;
  }
  if (trimString(feature?.scaleFormula)) {
    flags.scaleFormula = feature.scaleFormula;
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
    requirements: requirementLabel,
    type: featureType
  };
  const uses = normalizeSemanticUses(feature?.usage ?? feature?.uses);
  if (uses) system.uses = uses;
  // Auto-populate uses.max from the Quantity Column when the author
  // didn't enter a Max manually. Lets a Battle Master feature with a
  // Quantity Column linked to "Superiority Dice" come out with
  // `system.uses.max = "@scale.fighter.superiority-dice"` without any
  // formula typing on the editor side. We don't touch a manually-set
  // max — authors can override the auto value by filling the field.
  if (trimString(feature?.usesScaleFormula) && !trimString(system.uses?.max)) {
    system.uses = system.uses ?? { spent: 0 };
    system.uses.max = feature.usesScaleFormula;
  }

  // Build a coordinated id remap across this feature's activities +
  // effects + activity sub-profiles. The two normalizers below both
  // consume the same maps so `activity.effects[]._id` → item-level
  // AE `_id` references survive the rekey. See `buildItemIdRemap`.
  const idMaps = buildItemIdRemap(feature?.automation);
  const activities = normalizeSemanticActivityCollection(feature?.automation?.activities, idMaps);
  if (activities && Object.keys(activities).length) system.activities = activities;

  // Advancements only natively belong to Class, Subclass, and Background items in Foundry.
  // Including them on a feature (feat type) throws validation errors if the IDs aren't 16 chars.
  // const advancement = normalizeSemanticFeatureAdvancements(feature, context);
  // if (advancement && Object.keys(advancement).length) system.advancement = advancement;

  return {
    name: buildSemanticFeatureName(feature),
    type: "feat",
    img: normalizeImagePath(
      feature?.imageUrl
      ?? feature?.iconUrl
      ?? feature?.img
      ?? feature?.image,
      DEFAULT_FEATURE_ICON
    ),
    // Item-level Active Effects authored in the feature's Effects tab.
    // Foundry creates embedded ActiveEffect documents from this array
    // when the item embeds; effects with transfer=true then propagate
    // to the actor automatically. Routed through the same idMaps so
    // `_id`s match the references in the activity collection above.
    effects: normalizeSemanticItemEffects(feature?.automation?.effects, idMaps),
    flags: {
      [MODULE_ID]: flags
    },
    system
  };
}

/**
 * Build a synthetic "Spellcasting" feature item from the class's
 * `class.spellcasting.*` block.
 *
 * The Dauligor ClassEditor's Spellcasting tab is conceptually one big
 * feature on the class — name, ability, progression, formula,
 * description — but it ships through the export as a metadata block on
 * the class item (`class.spellcasting.*`) rather than as a real feature
 * row in the class advancement tree. The Foundry-side embed phase
 * therefore never creates a "Spellcasting" feat item on the actor; the
 * block survives only as `flags.dauligor-pairing.spellcasting` + an
 * HTML section appended to the class item description.
 *
 * That makes the spellcasting block effectively invisible on the
 * features list at the top of the dnd5e character sheet. Authors expect
 * it to look the same as Sorcery Points / Bardic Inspiration / etc.,
 * which are real `feat` items.
 *
 * This helper synthesizes a Foundry-ready feature item with a stable
 * sourceId (`<classSourceId>:spellcasting`) so the bridge embed +
 * prune passes pick it up via the same `desiredFeatureSourceIds` path
 * as authored class features. No advancements attached — the prompt
 * loop walks past it as a no-op.
 *
 * Returns null when the class has no spellcasting enabled.
 */
function buildSyntheticSpellcastingFeature({ semanticClassData, classSourceId, sourceBookId }) {
  const spellcasting = semanticClassData?.spellcasting;
  if (!spellcasting || !spellcasting.hasSpellcasting) return null;
  if (!classSourceId) return null;

  const level = Number(spellcasting.level ?? 1) || 1;
  const descriptionHtml = normalizeHtmlBlock(spellcasting.description)
    || `<p>This class can cast spells.</p>`;

  // Per-class identity is critical. With one global "spellcasting"
  // identifier and name, a second spellcasting class import would match
  // the first class's synth via `findMatchingActorItem` step 3
  // (identifier+type) — both items have `identifier: "spellcasting"`
  // and `type: "feat"` — and overwrite it instead of creating a second
  // synth. Cleric+Wizard would end up with one Spellcasting item
  // carrying Wizard data, which defeats the per-class state model we
  // need for tracking which spells are loaded for each class.
  //
  // We derive a class slug from the semantic class data and stamp it
  // into the identifier (`spellcasting-cleric`) and the visible name
  // (`Cleric Spellcasting`). Each class then owns its own synth and
  // none of the four matching paths collide across classes.
  const classNameRaw = trimString(semanticClassData?.name);
  const classSlug = normalizeSemanticIdentifier(
    semanticClassData?.identifier ?? classNameRaw ?? semanticClassData?.id,
    "class"
  ) || "class";
  const displayName = classNameRaw
    ? `${classNameRaw} Spellcasting`
    : "Spellcasting";

  // Compose a single unique identity string the synth uses for both
  // sourceId and the entityId/sourceRecordId pair. The two latter fields
  // would otherwise be auto-populated by `applyPayloadMetadata` →
  // `applySourceMetadata` using the bundle's source.id — which is the
  // CLASS's own app record id. That would cause `getModuleEntityId` on
  // the synth to return the same id as the class item already on the
  // actor, and `findMatchingActorItem` step 1 (entityId, no type
  // filter) would match the class item — Foundry then rejects the
  // update because the document type would change from "class" to
  // "feat". Pre-populating these flags with a synth-specific value
  // short-circuits `applySourceMetadata`'s `== null` guard.
  const syntheticId = `${classSourceId}:spellcasting`;

  return {
    name: displayName,
    type: "feat",
    img: DEFAULT_FEATURE_ICON,
    flags: {
      [MODULE_ID]: {
        sourceId: syntheticId,
        sourceBookId: sourceBookId ?? null,
        entityId: syntheticId,
        sourceRecordId: syntheticId,
        identifier: `spellcasting-${classSlug}`,
        classSourceId,
        sourceType: "classFeature",
        featureKind: "spellcasting",
        synthesized: true,
        level,
        featureTypeValue: "class",
        featureTypeLabel: "Class Feature"
      }
    },
    system: {
      identifier: `spellcasting-${classSlug}`,
      description: {
        value: descriptionHtml,
        chat: ""
      },
      type: {
        value: "class",
        subtype: ""
      }
    }
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
  const featureType = buildSemanticFeatureTypeData({
    sourceType: "classOption",
    optionGroup: group,
    optionItem
  });

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
  if (featureType?.label) flags.featureTypeLabel = featureType.label;
  if (featureType?.subtype) flags.featureTypeSubtype = featureType.subtype;
  if (featureType?.value) flags.featureTypeValue = featureType.value;
  if (optionItem?.levelPrerequisite != null) flags.levelPrerequisite = optionItem.levelPrerequisite;
  if (optionItem?.levelPrereqIsTotal != null) flags.levelPrereqIsTotal = !!optionItem.levelPrereqIsTotal;
  // Back-compat: old exports shipped a flat `requiresOptionIds` array;
  // new exports (post 2026-05-10 requirements-tree migration) ship
  // `requirementsTree` instead. We forward whichever is present so the
  // importer's option-picker (runOptionGroupStep) can read either
  // shape — the picker prefers the tree and falls back to the flat
  // array via `treeFromFlatRequiresOptionIds()` in
  // requirements-walker.js.
  if (Array.isArray(optionItem?.requiresOptionIds) && optionItem.requiresOptionIds.length) {
    flags.requiresOptionIds = [...optionItem.requiresOptionIds];
  }
  if (optionItem?.requirementsTree) {
    flags.requirementsTree = optionItem.requirementsTree;
  }
  // Flat string-prereq carried forward for back-compat. New exports
  // embed this as a `string` leaf inside the tree (see editor's
  // seedTreeFromFlatColumns), but legacy bundles need the raw column
  // so the importer can still surface "Member of the Crimson Order"
  // style narrative gates in the picker hint.
  if (trimString(optionItem?.stringPrerequisite)) {
    flags.stringPrerequisite = optionItem.stringPrerequisite;
  }
  // Tagged at export time when the granting ItemChoice/ItemGrant
  // advancement declares a Uses Feature. The bridge's post-embed pass
  // looks this up and rewires the option's activity consumption.targets[]
  // to consume from the matching actor item, plus copies that feature's
  // scaleFormula onto this option for damage-formula authoring.
  if (trimString(optionItem?.usesFeatureSourceId)) {
    flags.usesFeatureSourceId = optionItem.usesFeatureSourceId;
  }
  // Per-grant Damage Scaling Column the granting advancement attached
  // to this option (advancement.optionScalingColumnId at authoring →
  // resolved to `@scale.<class>.<column>` at export). Highest-priority
  // input to @scale.linked substitution: when set, this wins over the
  // uses-feature's scale and over the linked feature's own scale.
  // Lets the same shared Trip Attack feature resolve to
  // @scale.barbarian.superiority-dice when granted by Reaver and
  // @scale.fighter.superiority-dice when granted by Battle Master.
  if (trimString(optionItem?.optionScaleFormula)) {
    flags.optionScaleFormula = optionItem.optionScaleFormula;
  }

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
    requirements: buildSemanticOptionRequirement(optionItem, context, feature),
    type: featureType
  };
  const uses = normalizeSemanticUses(optionItem?.usage ?? optionItem?.uses);
  if (uses) system.uses = uses;

  // Same coordinated rekey as features — see buildItemIdRemap header
  // for why this exists.
  const idMaps = buildItemIdRemap(optionItem?.automation);
  const activities = normalizeSemanticActivityCollection(optionItem?.automation?.activities, idMaps);
  if (activities && Object.keys(activities).length) system.activities = activities;

  // Advancements only natively belong to Class, Subclass, and Background items in Foundry.
  // Including them on a feature (feat type) throws validation errors if the IDs aren't 16 chars.
  // const advancement = normalizeSemanticFeatureAdvancements(optionItem, context);
  // if (advancement && Object.keys(advancement).length) system.advancement = advancement;

  return {
    name: trimString(optionItem?.name) || "Class Option",
    type: "feat",
    img: normalizeImagePath(
      optionItem?.imageUrl
      ?? optionItem?.iconUrl
      ?? optionItem?.img
      ?? optionItem?.image,
      DEFAULT_OPTION_ICON
    ),
    // Item-level Active Effects authored in the option's Effects tab —
    // mostly used by Invocations (e.g. Agonizing Blast adds CHA to
    // Eldritch Blast damage via a `system.bonuses.msak.damage` change
    // with transfer=true) and Infusions (which apply effects to the
    // infused target item rather than the infusion itself). Routed
    // through the same idMaps so `_id`s match references in activities.
    effects: normalizeSemanticItemEffects(optionItem?.automation?.effects, idMaps),
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
  return normalizeSemanticFeatureTraitAdvancement(base, advancement, context);
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
  const traitType = trimString(configuration?.type);

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
    applyTraitAdvancementKindTag(base, traitType);
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
  applyTraitAdvancementKindTag(base, traitType);
  return base;
}

function applyTraitAdvancementKindTag(base, traitType) {
  const kindMap = { skills: "skills", saves: "savingThrows", tools: "tools", languages: "languages" };
  const kind = kindMap[traitType];
  if (!kind) return;
  base.flags ??= {};
  base.flags[MODULE_ID] ??= {};
  base.flags[MODULE_ID].advancementKind = kind;
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

/**
 * Build a coordinated old→new id remap for every authored `_id` inside
 * a feature/option-item/spell's `automation` block, then run the
 * normalizers with the maps so cross-references survive the rekey.
 *
 * Why this exists: the web editor was authoring activity and item-level
 * Active Effect `_id`s as short (~9-char) random strings — e.g.
 * `Math.random().toString(36).slice(2, 11)`. dnd5e 5.x's
 * `MidiAttackActivity` / `MidiUtilityActivity` / etc. validators
 * require document `_id`s to be **exactly 16 alphanumeric characters**
 * (see PseudoDocument + DataModel validation in foundry.mjs), so the
 * embed step blew up:
 *
 *   DataModelValidationError: MidiAttackActivity [1chgd6sx3] validation
 *     errors: _id: must be a valid 16-character alphanumeric ID
 *
 * Fixing per-id (regenerate when malformed) would silently strand
 * references — an activity's `effects: [{ _id: <old> }]` array points
 * at item-level Active Effect `_id`s by value; a `forward`-type
 * activity references another activity by id; `summon` / `transform`
 * profiles each carry their own `_id`. If the activity's `_id` got
 * regenerated but the AE's old `_id` was rewritten independently, the
 * effects[] entry would dangle. The coordinated remap below
 * guarantees: walk every authored `_id` once, build a single
 * old→new map, then re-emit references using that map.
 *
 * The maps are scoped per-item — IDs only collide within one item's
 * activity / effect collections, so a per-item map is sufficient.
 */
/**
 * Deterministic mapping from any string to a Foundry-valid 16-char
 * alphanumeric id. Used for stale/malformed authored ids so they
 * regenerate to the SAME value on every import — making the actor's
 * activity / effect `_id`s stable across re-imports (a player
 * leveling up a month later sees the same activity ids they had at
 * the original import).
 *
 * Why not just `foundry.utils.randomID()`? Random regeneration would
 * churn activity ids on every level-up — player macros, Midi-QOL
 * workflow flags, and DAE effects that reference an activity by id
 * would all dangle after each import. With the deterministic
 * fallback, the actor sees the SAME activity id on every re-import
 * of a given (stale) bundle, so those external references survive.
 *
 * Algorithm: FNV-1a 32-bit hash of the input seeds a small LCG that
 * draws 16 chars from the Foundry alphabet (`[A-Za-z0-9]`). Same
 * input → same output, no async / no Web Crypto required.
 *
 * Collision risk: not a cryptographic hash. With 62^16 ≈ 4.8e28
 * possible outputs and ~20 ids per item in the worst case, the
 * per-item collision probability is negligible. If two activities
 * within a single item ever DID hash to the same output, the
 * `normalized[mapped._id] = mapped` reduce would silently dedupe to
 * the last writer — surfaceable as a missing activity. Mitigation:
 * re-edit the affected activity in the webapp, which regenerates a
 * fresh `makeFoundryId()` via `handleAddActivity`'s replacement.
 */
function deterministicFoundryId(seed) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const input = String(seed ?? "");
  if (!input) return foundry.utils.randomID();
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  let out = "";
  let lcg = hash || 1;
  for (let i = 0; i < 16; i++) {
    lcg = (lcg * 1103515245 + 12345) >>> 0;
    out += ALPHABET[lcg % ALPHABET.length];
  }
  return out;
}

function buildItemIdRemap(automation) {
  const activityIdMap = new Map();
  const effectIdMap = new Map();
  // summon/transform profiles are activity-internal, but we hoist the
  // map to item-scope so we don't need to thread a third map through
  // the call chain — the keys are unique enough across the item.
  const profileIdMap = new Map();

  const remapOne = (raw, into) => {
    const oldId = String(raw ?? "").trim();
    if (!oldId) return;
    if (into.has(oldId)) return;
    // Deterministic fallback for malformed ids — see
    // `deterministicFoundryId` for the rationale. The actor's
    // activity / effect `_id`s now stay stable across re-imports
    // even when the source bundle's authored ids are too short.
    const newId = /^[A-Za-z0-9]{16}$/.test(oldId) ? oldId : deterministicFoundryId(oldId);
    into.set(oldId, newId);
  };

  const rawActivities = Array.isArray(automation?.activities)
    ? automation.activities
    : Object.values(automation?.activities ?? {});
  for (const activity of rawActivities) {
    remapOne(activity?.id ?? activity?._id, activityIdMap);
    // summon/transform profiles ride inside the activity payload.
    for (const profile of ensureArray(activity?.summon?.profiles)) {
      remapOne(profile?._id, profileIdMap);
    }
    for (const profile of ensureArray(activity?.transform?.profiles)) {
      remapOne(profile?._id, profileIdMap);
    }
  }

  for (const effect of ensureArray(automation?.effects)) {
    remapOne(effect?._id, effectIdMap);
  }

  return { activityIdMap, effectIdMap, profileIdMap };
}

/**
 * Resolve an authored id through a remap. Falls back to a fresh
 * randomID() when the input is empty or unknown — covers cases like
 * a `forward.activity.id` pointing at an activity that was filtered
 * out (e.g. unsupported kind), which is a malformed reference but
 * shouldn't break the import.
 */
function resolveRemappedId(map, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return foundry.utils.randomID();
  if (map?.has(s)) return map.get(s);
  // Fallback — the source-side id wasn't seen in the remap pass (e.g.
  // a stale forward reference pointing at a filtered-out activity).
  // Pass valid ids through unchanged, otherwise use the deterministic
  // mapping so re-imports of the same stale id resolve to the same
  // new id (identity-stable, see `deterministicFoundryId`).
  return /^[A-Za-z0-9]{16}$/.test(s) ? s : deterministicFoundryId(s);
}

function normalizeSemanticActivityCollection(activities, idMaps) {
  const entries = Array.isArray(activities)
    ? activities
    : activities && typeof activities === "object"
      ? Object.values(activities)
      : [];
  const normalized = {};

  entries.forEach((activity, index) => {
    const mapped = normalizeSemanticActivity(activity, index, idMaps);
    if (!mapped) return;
    normalized[mapped._id] = mapped;
  });

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeSemanticActivity(activity, index = 0, idMaps = {}) {
  const type = trimString(activity?.kind ?? activity?.type).toLowerCase();
  if (!SUPPORTED_SEMANTIC_ACTIVITY_TYPES.has(type)) return null;

  // Resolve the activity's own _id through the remap so cross-refs
  // (forward.activity.id) line up with the same final value.
  const id = resolveRemappedId(idMaps.activityIdMap, activity?.id ?? activity?._id);
  const normalized = {
    type,
    _id: id,
    img: normalizeImagePath(activity?.img, `systems/dnd5e/icons/svg/activity/${type}.svg`),
    sort: Number.isFinite(Number(activity?.sort)) ? Number(activity.sort) : index * 100000,
    activation: normalizeSemanticActivation(activity?.activation),
    consumption: normalizeSemanticConsumption(activity?.consumption),
    description: normalizeSemanticActivityDescription(activity),
    duration: normalizeSemanticDuration(activity?.duration),
    // Activity-level effect refs point at item-level Active Effect
    // `_id`s. Rewire them through `effectIdMap` so the references
    // survive the rekey above.
    effects: normalizeSemanticActivityEffects(activity?.effects, idMaps),
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
        normalized.effects = normalizeSemanticActivityEffects(activity?.enchant?.effects, idMaps);
      }
      break;
    case "forward":
      // `forward.activity.id` references another activity on the same
      // item by `_id`. Rewire through `activityIdMap` so it points at
      // the post-remap value.
      normalized.activity = {
        id: resolveRemappedId(idMaps.activityIdMap, activity?.activity?.id)
      };
      break;
    case "heal":
      normalized.healing = normalizeSemanticHealing(activity?.healing);
      break;
    case "save":
      normalized.save = normalizeSemanticSave(activity?.save);
      break;
    case "summon":
      Object.assign(normalized, normalizeSemanticSummon(activity?.summon, idMaps));
      break;
    case "transform":
      Object.assign(normalized, normalizeSemanticTransform(activity?.transform, idMaps));
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
    spellSlot: consumption?.spellSlot ?? true,
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

function normalizeSemanticActivityEffects(effects, idMaps = {}) {
  return ensureArray(effects).map((effect) => ({
    // Activity-effect refs point at item-level AE `_id`s — rewire
    // through the effect map so the activity sees the post-remap id.
    _id: resolveRemappedId(idMaps.effectIdMap, effect?._id),
    level: foundry.utils.deepClone(effect?.level ?? {}),
    riders: foundry.utils.deepClone(effect?.riders ?? {})
  }));
}

// Item-level Active Effects (the full document shape) — distinct from the
// activity-level shape above which only references AEs by _id. Used for
// "always-on while owned" patterns like Agonizing Blast: transfer=true,
// disabled=false, and Foundry copies the effect onto the actor when the
// feature embeds. `transfer=false` keeps the effect stored on the item
// only; it's then a candidate for per-use application via activities.
//
// Canonical shape per Foundry v13:
//   { _id, name, img, description, disabled, transfer, tint, duration,
//     changes:[{key,value,mode (0-5),priority}], statuses, type, sort,
//     flags }
// dnd5e 5.x effect `type` defaults to "base"; the system may register
// custom types ("enchantment") that we pass through verbatim.
function normalizeSemanticItemEffects(effects, idMaps = {}) {
  return ensureArray(effects).map((effect) => {
    if (!effect || typeof effect !== "object") return null;
    return {
      // Route through the shared effect remap so the activity-effect
      // refs in `normalizeSemanticActivityEffects` resolve to the same
      // post-remap value. Falls back to `ensureSemanticEffectId` when
      // no map is provided (legacy callers / direct invocations).
      _id: idMaps.effectIdMap
        ? resolveRemappedId(idMaps.effectIdMap, effect?._id)
        : ensureSemanticEffectId(effect?._id),
      name: trimString(effect?.name) || "Unnamed Effect",
      img: trimString(effect?.img) || trimString(effect?.icon) || "icons/svg/aura.svg",
      description: typeof effect?.description === "string" ? effect.description : "",
      disabled: Boolean(effect?.disabled),
      // Authoring default is true (always-on while feature is owned).
      // Effects applied per-use via an activity should be authored with
      // transfer=false so they stay scoped to the item.
      transfer: effect?.transfer !== undefined ? Boolean(effect.transfer) : true,
      tint: trimString(effect?.tint) || "#ffffff",
      duration: {
        seconds: effect?.duration?.seconds ?? null,
        rounds: effect?.duration?.rounds ?? null,
        turns: effect?.duration?.turns ?? null,
        startTime: effect?.duration?.startTime ?? null,
        startRound: effect?.duration?.startRound ?? null,
        startTurn: effect?.duration?.startTurn ?? null
      },
      changes: ensureArray(effect?.changes).map((change) => ({
        key: trimString(change?.key),
        // Foundry accepts string values; numbers get coerced. Keep as string
        // so dice formulas like "1d6" round-trip without surprise.
        value: typeof change?.value === "string" ? change.value : String(change?.value ?? ""),
        // CONST.ACTIVE_EFFECT_MODES: 0 Custom, 1 Multiply, 2 Add (default),
        // 3 Downgrade, 4 Upgrade, 5 Override.
        mode: Number.isFinite(Number(change?.mode)) ? Number(change.mode) : 2,
        // null is legitimate (Foundry assigns a default per mode at apply
        // time); pass through. Otherwise coerce to number.
        priority: change?.priority == null ? null : Number(change.priority)
      })).filter((change) => change.key),
      statuses: Array.isArray(effect?.statuses) ? effect.statuses.map(String).filter(Boolean) : [],
      type: trimString(effect?.type) || "base",
      sort: Number.isFinite(Number(effect?.sort)) ? Number(effect.sort) : 0,
      flags: effect?.flags && typeof effect.flags === "object"
        ? foundry.utils.deepClone(effect.flags)
        : {}
    };
  }).filter(Boolean);
}

function ensureSemanticEffectId(raw) {
  // Foundry requires document IDs to be exactly 16 alphanumeric chars.
  // The web editor's pre-`makeFoundryId()` code path (now replaced)
  // used `Math.random().toString(36).slice(2, 18)`, which produced
  // shorter ids when the random float happened to start with `0.0…`.
  // Pass valid ids through unchanged; for malformed ids fall back to
  // the deterministic mapping so re-imports of the same stale id
  // produce the same actor-side `_id`. See `deterministicFoundryId`.
  //
  // Pure callers (no shared idMaps) still land here — the determinism
  // means they too get stable ids across re-imports of the same
  // bundle, even though they don't participate in the cross-reference
  // map.
  const s = String(raw ?? "");
  if (/^[A-Za-z0-9]{16}$/.test(s)) return s;
  if (!s) return foundry.utils.randomID();
  return deterministicFoundryId(s);
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
    prompt: target?.prompt ?? true
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

function normalizeSemanticSummon(summon, idMaps = {}) {
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
      // Profile _ids are activity-internal but still need to be valid
      // 16-char alphanumeric for dnd5e's validator. Route through the
      // shared profile map so any author-side cross-reference (if a
      // future feature ever points at a profile by id) survives.
      _id: resolveRemappedId(idMaps.profileIdMap, profile?._id),
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

function normalizeSemanticTransform(transform, idMaps = {}) {
  return {
    profiles: ensureArray(transform?.profiles).map((profile) => ({
      name: trimString(profile?.name),
      // Same rationale as summon profiles — must round-trip as 16-char
      // alphanumeric. See `buildItemIdRemap`.
      _id: resolveRemappedId(idMaps.profileIdMap, profile?._id),
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

  const spellsKnownLevels = getSpellsKnownScalingLevels(context.payload, context.classData);
  if (spellsKnownLevels && typeof spellsKnownLevels === "object" && Object.keys(spellsKnownLevels).length) {
    const cantripValues = extractSpellcastingScaleValues(spellsKnownLevels, "cantrips");
    if (Object.keys(cantripValues).length) {
      advancements.push(createScaleValueAdvancement({
        ownerSourceId: classSourceId,
        sourceScaleId: `${classSourceId}:cantrips-known`,
        title: "Cantrips Known",
        identifier: "cantrips-known",
        values: cantripValues
      }));
    }

    const spellValues = extractSpellcastingScaleValues(spellsKnownLevels, "spellsKnown");
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
    const scalingValues = scalingSourceId
      ? normalizeScaleValues(context.scalingColumnsBySourceId.get(scalingSourceId)?.values)
      : {};

    return {
      sourceId: group?.sourceId ?? null,
      name: trimString(group?.name) || null,
      featureSourceId: group?.featureSourceId ?? feature?.sourceId ?? null,
      // Set when the group is referenced from a subclass-root advancement
      // (Battle Master Maneuvers, Eldritch Knight pools, etc.) so the
      // runtime can suppress the prompt for non-matching subclasses.
      // Empty/null for class-root and feature-owned groups.
      subclassSourceId: trimString(group?.subclassSourceId) || null,
      scalingSourceId,
      selectionCountsByLevel: Object.keys(scalingValues).length
        ? scalingValues
        : normalizeScaleValues(group?.selectionCountsByLevel)
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

  // Embedded-collection replace semantics — see
  // `applyCollectionReplaceSemantics`. Without `==` prefixes on
  // `effects`, `system.activities`, and `system.advancement`, a
  // re-bake's stale entries would accumulate on the world item.
  const updateData = applyCollectionReplaceSemantics({
    _id: existing.id,
    ...clone
  }, clone);
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

/**
 * Build the `update()` payload for an existing item, ensuring every
 * embedded *collection* on the item replaces cleanly rather than
 * mergeObject-merges with the prior state.
 *
 * Foundry's `mergeObject` (used by `Document#update`) recurses by
 * default — for plain fields that's fine, but for collections like
 * `system.advancement`, `system.activities`, and the top-level
 * `effects[]` array it means "this update adds to / overrides
 * matching keys but leaves un-touched keys intact." On a re-import
 * where the source bundle no longer contains an activity / effect
 * that an earlier import shipped, the stale entry would linger on
 * the actor's item document forever.
 *
 * Foundry's documented workaround: prefix the key with `==` in the
 * update payload to force overwrite rather than recursive merge.
 * Apply it to every collection that's an authoring surface — system
 * advancement (class/subclass only), system activities (any item
 * that runs activities), and the top-level effects array.
 *
 * For brand-new items, this isn't relevant (Foundry's `create`
 * pipeline doesn't merge — it just writes the shape we passed).
 */
function applyCollectionReplaceSemantics(updateData, clone) {
  // Top-level `effects[]` — embedded Active Effect documents on the
  // item. Without `==effects`, the old effect docs would persist
  // and the new ones would be added on top.
  if (Array.isArray(clone?.effects)) {
    delete updateData.effects;
    updateData["==effects"] = clone.effects;
  }

  // `system.activities` and `system.advancement` need the `==`
  // prefix INSIDE the system object. We deep-clone system once and
  // mutate that copy.
  if (clone?.system && typeof clone.system === "object") {
    let systemMutated = false;
    const system = foundry.utils.deepClone(clone.system);

    if (Object.hasOwn(system, "activities")) {
      const activities = system.activities;
      delete system.activities;
      system["==activities"] = activities;
      systemMutated = true;
    }

    // advancement is class/subclass-only; on a feat-typed item it
    // doesn't exist in the canonical shape (and Foundry rejects it).
    if (["class", "subclass"].includes(clone?.type) && Object.hasOwn(system, "advancement")) {
      const advancement = system.advancement;
      delete system.advancement;
      system["==advancement"] = advancement;
      systemMutated = true;
    }

    if (systemMutated) updateData.system = system;
  }

  return updateData;
}

function buildEmbeddedActorItemUpdateData(existingId, clone) {
  const updateData = {
    _id: existingId,
    ...clone
  };
  return applyCollectionReplaceSemantics(updateData, clone);
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

function prepareEmbeddedActorClassItem(classItem, { targetLevel = 1, existingItem = null, payloadMeta = null, importSelection = null, referencedDocs = [], proficiencyMode = null } = {}) {
  const item = normalizeEmbeddedItem(classItem);
  item.system ??= {};
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};
  item.system.levels = normalizeClassLevel(targetLevel, item.system.levels);
  if (referencedDocs.length) {
    const docsBySourceId = new Map();
    for (const doc of referencedDocs) {
      const sourceId = doc?.getFlag?.(MODULE_ID, "sourceId");
      if (sourceId) docsBySourceId.set(sourceId, doc);
    }
    resolveAdvancementDocumentReferences(item.system.advancement, docsBySourceId, []);
  }
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
  if (proficiencyMode) item.flags[MODULE_ID].proficiencyMode = proficiencyMode;
  if (importSelection) {
    item.flags[MODULE_ID].importSelections = sanitizeClassImportSelection(importSelection);
  }
  return item;
}

function prepareEmbeddedActorSubclassItem(subclassItem, { existingItem = null, payloadMeta = null, classSourceId = null, referencedDocs = [] } = {}) {
  const item = normalizeEmbeddedItem(subclassItem);
  item.system ??= {};
  item.flags ??= {};
  item.flags[MODULE_ID] ??= {};
  if (referencedDocs.length) {
    const docsBySourceId = new Map();
    for (const doc of referencedDocs) {
      const sourceId = doc?.getFlag?.(MODULE_ID, "sourceId");
      if (sourceId) docsBySourceId.set(sourceId, doc);
    }
    resolveAdvancementDocumentReferences(item.system.advancement, docsBySourceId, []);
  }
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
    if (existingAdvancement?.value !== undefined && clone.type !== "Subclass") {
      if (clone.type === "Trait") {
        clone.value ??= {};
        clone.value.chosen = [...new Set([
          ...ensureArray(existingAdvancement.value?.chosen),
          ...ensureArray(clone.value?.chosen)
        ])].filter(Boolean);
      } else {
        clone.value = foundry.utils.deepClone(existingAdvancement.value);
      }
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

// Author-facing placeholder for "the inherited scale formula". Used in
// authored damage / dice formulas (`@scale.linked + @mod`) so the same
// feature can be reused across grants — e.g. the Trip Attack feature
// shipped to a Battle Master Fighter resolves @scale.linked to
// `@scale.fighter.superiority-dice`, while the same feature shipped via
// a Reaver subclass grant resolves to `@scale.barbarian.superiority-dice`.
const LINKED_SCALE_TOKEN = "@scale.linked";
const LINKED_SCALE_RE = /@scale\.linked\b/g;

/**
 * For each option item that declares `flags.<MODULE_ID>.usesFeatureSourceId`,
 * find the matching uses-feature actor item by sourceId, then:
 *
 *   1. Rewrite each activity's `consumption.targets[]` so any
 *      type=`itemUses` target (or, if none, a freshly-added target)
 *      points at the uses-feature via Foundry's `Item.<id>` relative
 *      UUID. This makes the option draw from the shared pool on use.
 *   2. Copy the uses-feature's `scaleFormula` flag onto the option so
 *      a future activity-authoring pass (or the user) can write damage
 *      formulas without typing the @scale path.
 *   3. Substitute `@scale.linked` in every damage formula, bonus, and
 *      consumption-scaling formula with the resolved scaleFormula. The
 *      resolved formula comes from the uses-feature's flag (set when
 *      that feature has a Scaling Column attached) or, if absent, the
 *      option's own scaleFormula flag (inherited from the linked
 *      feature at export time).
 *
 * No-ops cleanly when no option declares a uses feature, when the
 * referenced feature isn't embedded on the actor, or when an option
 * has no activities. Updates are batched per option document.
 */
async function wireOptionUsesFeatures(actor, optionDocs, candidateFeatureDocs) {
  if (!actor) return;
  const featureBySourceId = new Map();
  for (const doc of ensureArray(candidateFeatureDocs)) {
    const sid = doc?.getFlag?.(MODULE_ID, "sourceId");
    if (sid) featureBySourceId.set(sid, doc);
  }

  for (const optionDoc of ensureArray(optionDocs)) {
    if (!optionDoc) continue;
    const usesFeatureSourceId = optionDoc.getFlag?.(MODULE_ID, "usesFeatureSourceId");
    const usesFeatureDoc = usesFeatureSourceId ? featureBySourceId.get(usesFeatureSourceId) : null;
    if (usesFeatureSourceId && !usesFeatureDoc) {
      log("wireOptionUsesFeatures: uses feature not on actor", {
        optionName: optionDoc.name,
        usesFeatureSourceId
      });
    }

    // Resolve which formula `@scale.linked` should expand to. Priority:
    //   1. The granting advancement's per-grant `optionScaleFormula`
    //      flag (set explicitly via "Damage Scaling Column" on the
    //      ItemChoice / ItemGrant). Wins because the granter is the
    //      authority on which class's scaling to use — same shared
    //      group resolves Barbarian vs Fighter superiority dice
    //      depending on who granted the option.
    //   2. The uses-feature's `scaleFormula` flag (implicit pairing —
    //      "consume from this feature, scale by what that feature
    //      scales by").
    //   3. The option's own `scaleFormula` flag (set in
    //      createSemanticOptionItem from the linked-feature's
    //      `scaleFormula` when the option points at a feature row).
    // No-op when none are set.
    const resolvedScaleFormula = trimString(
      optionDoc.getFlag?.(MODULE_ID, "optionScaleFormula")
      ?? usesFeatureDoc?.getFlag?.(MODULE_ID, "scaleFormula")
      ?? optionDoc.getFlag?.(MODULE_ID, "scaleFormula")
    );

    const relativeTarget = usesFeatureDoc ? `Item.${usesFeatureDoc.id}` : null;
    const updates = {};

    // Walk activities once, applying both passes.
    const activities = optionDoc.system?.activities ?? {};
    const activityKeys = Object.keys(activities);
    for (const key of activityKeys) {
      const activity = activities[key];
      if (!activity) continue;

      // PASS 1 — consumption rewrite. Only when we have a uses-feature.
      if (relativeTarget) {
        const targets = ensureArray(activity?.consumption?.targets);
        const itemUsesIdx = targets.findIndex((t) => t?.type === "itemUses");
        const nextTargets = targets.map((t) => ({ ...t }));
        if (itemUsesIdx >= 0) {
          nextTargets[itemUsesIdx] = {
            ...nextTargets[itemUsesIdx],
            target: relativeTarget,
            value: nextTargets[itemUsesIdx].value || "1"
          };
        } else {
          nextTargets.push({
            type: "itemUses",
            target: relativeTarget,
            value: "1",
            scaling: { mode: "", formula: "" }
          });
        }
        updates[`system.activities.${key}.consumption.targets`] = nextTargets;
      }

      // PASS 2 — @scale.linked substitution. Walks the activity recursively
      // and replaces every occurrence of the placeholder in any string
      // value. Single string-token substitution can't accidentally match
      // anything else, so the recursive walk is safe.
      if (resolvedScaleFormula) {
        const substituted = substituteLinkedScale(activity, resolvedScaleFormula);
        if (substituted !== activity) {
          updates[`system.activities.${key}`] = substituted;
        }
      }
    }

    // Stash the resolved formula on the option's flag for downstream
    // tooling, when it came from the uses-feature path. (Options that
    // already inherited via createSemanticOptionItem have it set.)
    const inheritedScaleFormula = usesFeatureDoc?.getFlag?.(MODULE_ID, "scaleFormula");
    if (inheritedScaleFormula && !optionDoc.getFlag?.(MODULE_ID, "scaleFormula")) {
      updates[`flags.${MODULE_ID}.scaleFormula`] = inheritedScaleFormula;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await optionDoc.update(updates);
        log("wireOptionUsesFeatures: linked option to uses feature / substituted scale", {
          option: optionDoc.name,
          usesFeature: usesFeatureDoc?.name ?? null,
          relativeTarget,
          resolvedScaleFormula: resolvedScaleFormula || null
        });
      } catch (error) {
        console.warn(`${MODULE_ID} | wireOptionUsesFeatures update failed`, error, {
          option: optionDoc.name,
          updates
        });
      }
    }
  }
}

/**
 * Recursively replace every `@scale.linked` token in string fields of
 * `value` with `formula`. Returns a new structure when any replacement
 * happens, otherwise returns `value` unchanged so callers can detect
 * no-op via `===`. Handles plain objects and arrays; passes primitives
 * through untouched.
 */
function substituteLinkedScale(value, formula) {
  if (typeof value === "string") {
    if (!value.includes(LINKED_SCALE_TOKEN)) return value;
    return value.replace(LINKED_SCALE_RE, formula);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const replaced = substituteLinkedScale(entry, formula);
      if (replaced !== entry) changed = true;
      return replaced;
    });
    return changed ? next : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      const replaced = substituteLinkedScale(v, formula);
      if (replaced !== v) changed = true;
      next[k] = replaced;
    }
    return changed ? next : value;
  }
  return value;
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

  console.log("applyActorSkillSelections input:", {
    actorName: targetActor.name,
    skillSelections
  });

  const updates = {};
  let applied = 0;
  for (const slug of [...new Set(ensureArray(skillSelections).map((value) => normalizeSkillSlug(value)).filter(Boolean))]) {
    const currentValue = Number(targetActor.system?.skills?.[slug]?.value ?? 0);
    console.log(`Checking skill ${slug}: current value = ${currentValue}`);
    if (currentValue >= 1) continue;
    updates[`system.skills.${slug}.value`] = 1;
    applied += 1;
  }

  console.log("applyActorSkillSelections generated updates:", updates);

  if (!applied) return 0;
  await targetActor.update(updates);
  return applied;
}

async function applyActorToolSelections(actor, toolSelections = []) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor) return 0;

  console.log("applyActorToolSelections input:", {
    actorName: targetActor.name,
    toolSelections
  });

  const updates = {};
  let applied = 0;
  for (const slug of [...new Set(ensureArray(toolSelections).map((value) => normalizeToolSlug(value)).filter(Boolean))]) {
    const currentValue = Number(targetActor.system?.tools?.[slug]?.value ?? 0);
    console.log(`Checking tool ${slug}: current value = ${currentValue}`);
    if (currentValue >= 1) continue;
    updates[`system.tools.${slug}.value`] = 1;

    const abilityPath = `system.tools.${slug}.ability`;
    const existingAbility = updates[abilityPath] ?? foundry.utils.getProperty(targetActor, abilityPath);
    const defaultAbility = CONFIG.DND5E?.tools?.[slug]?.ability;
    if (!existingAbility && defaultAbility) updates[abilityPath] = defaultAbility;

    applied += 1;
  }

  console.log("applyActorToolSelections generated updates:", updates);

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
  skillSelections = null,
  toolSelections = null,
  savingThrowSelections = null,
  languageSelections = null,
  traitSelections = null,
  hpResolution = null,
  referencedDocs = []
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !actorClassItem) return actorClassItem;

  const currentClassItem = targetActor.items.get(actorClassItem.id) ?? actorClassItem;
  const importSelections = sanitizeClassImportSelection(currentClassItem.getFlag?.(MODULE_ID, "importSelections") ?? {});
  const resolvedSkillSelections = skillSelections ?? importSelections.skillSelections;
  const resolvedToolSelections = toolSelections ?? importSelections.toolSelections;
  const resolvedSavingThrowSelections = savingThrowSelections ?? importSelections.savingThrowSelections;
  const resolvedLanguageSelections = languageSelections ?? importSelections.languageSelections;
  const resolvedTraitSelections = traitSelections ?? importSelections.traitSelections;
  const resolvedAdvancement = buildEmbeddedActorAdvancementStructure(sourceAdvancement, {
    actor: targetActor,
    classSourceId,
    targetLevel,
    selectedSubclassSourceId: importSelections.subclassSourceId,
    optionSelections: importSelections.optionSelections,
    traitSelections: resolvedTraitSelections
  });
  if (referencedDocs.length) {
    const docsBySourceId = new Map();
    for (const doc of referencedDocs) {
      const sourceId = doc?.getFlag?.(MODULE_ID, "sourceId");
      if (sourceId) docsBySourceId.set(sourceId, doc);
    }
    resolveAdvancementDocumentReferences(resolvedAdvancement, docsBySourceId, []);
  }
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
    skillSelections: resolvedSkillSelections
  });
  applyToolSelectionsToAdvancements(advancementMeta.advancement, {
    toolSelections: resolvedToolSelections
  });
  applySavingThrowSelectionsToAdvancements(advancementMeta.advancement, {
    savingThrowSelections: resolvedSavingThrowSelections
  });
  applyLanguageSelectionsToAdvancements(advancementMeta.advancement, {
    languageSelections: resolvedLanguageSelections
  });
  applyTraitSelectionsToAdvancements(advancementMeta.advancement, {
    traitSelections: resolvedTraitSelections
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

async function applyActorTraitAdvancements(actor, item) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !item) return 0;

  const updates = {};
  let changed = 0;

  const advancements = Object.values(normalizeAdvancementStructure(item.system?.advancement))
    .filter(adv => adv && adv.type === "Trait")
    .sort((a, b) => (Number(a?.level ?? 0) - Number(b?.level ?? 0)));

  for (const advancementEntry of advancements) {
    const chosen = new Set([
      ...ensureArray(advancementEntry?.configuration?.grants),
      ...ensureArray(advancementEntry?.value?.chosen)
    ].map((entry) => trimString(entry)).filter(Boolean));

    for (const key of chosen) {
      changed += applyTraitKeyToActorUpdate(updates, targetActor, key, advancementEntry?.configuration?.mode);
    }
  }

  if (!changed) return 0;
  await targetActor.update(updates);
  return changed;
}

async function applyActorTraitProfile(actor, profile, { skillSelections = [], toolSelections = [] } = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !profile || typeof profile !== "object") return 0;

  const updates = {};
  let changed = 0;
  const selectedSkills = [...new Set(ensureArray(skillSelections).map((value) => normalizeSkillSlug(value)).filter(Boolean))];
  const selectedTools = [...new Set(ensureArray(toolSelections).map((value) => slugify(trimString(value))).filter(Boolean))];
  const traitKeys = [
    ...buildTraitKeysFromProfileBlock("savingThrows", profile?.savingThrows),
    ...buildTraitKeysFromProfileBlock("armor", profile?.armor),
    ...buildTraitKeysFromProfileBlock("weapons", profile?.weapons),
    ...buildTraitKeysFromProfileBlock("tools", profile?.tools, { selectedOptionIds: selectedTools }),
    ...buildTraitKeysFromProfileBlock("languages", profile?.languages),
    ...buildTraitKeysFromProfileBlock("skills", profile?.skills, { selectedOptionIds: selectedSkills })
  ];

  for (const key of traitKeys) {
    changed += applyTraitKeyToActorUpdate(updates, targetActor, key, "default");
  }

  if (!changed) return 0;
  await targetActor.update(updates);
  return changed;
}

function buildTraitKeysFromProfileBlock(type, block, { selectedOptionIds = [] } = {}) {
  if (!block || typeof block !== "object") return [];

  const choiceCount = Math.max(0, Number(block.choiceCount ?? 0) || 0);
  const implicitOptionIds = choiceCount > 0 ? [] : ensureArray(block.optionIds);
  const values = [
    ...ensureArray(block.categoryIds),
    ...ensureArray(block.fixedIds),
    ...implicitOptionIds,
    ...(type === "skills" ? selectedOptionIds : []),
    ...(type === "tools" ? selectedOptionIds : [])
  ];

  return [...new Set(values
    .map((value) => normalizeProfileTraitKey(type, value))
    .filter(Boolean))];
}

function normalizeProfileTraitKey(type, value) {
  const raw = trimString(value);
  if (!raw) return null;

  switch (type) {
    case "skills": {
      const skill = normalizeSkillSlug(raw);
      return skill ? `skills:${skill}` : null;
    }

    case "savingThrows": {
      const ability = normalizeAbilityCode(raw);
      return ability ? `saves:${ability}` : null;
    }

    case "armor":
      return raw.startsWith("armor:") ? raw : `armor:${raw}`;

    case "weapons":
      return raw.startsWith("weapon:") ? raw : `weapon:${raw}`;

    case "tools":
      return raw.startsWith("tool:") ? raw : `tool:${raw}`;

    case "languages":
      return raw.startsWith("languages:") ? raw : `languages:${raw}`;

    default:
      return raw;
  }
}

function applyTraitKeyToActorUpdate(updates, actor, key, mode = "default") {
  const normalizedKey = trimString(key);
  if (!normalizedKey) return 0;

  const segments = normalizedKey.split(":");
  const trait = segments.shift();
  const value = segments.pop();
  if (!trait || !value) return 0;

  if (trait === "skills" || trait === "saves" || trait === "tool") {
    const keyPath = trait === "skills"
      ? `system.skills.${value}.value`
      : trait === "saves"
        ? `system.abilities.${value}.proficient`
        : `system.tools.${value}.value`;
    const existingValue = Number(updates[keyPath] ?? foundry.utils.getProperty(actor, keyPath) ?? 0) || 0;
    let nextValue = existingValue;

    if (mode === "expertise" || mode === "forcedExpertise") nextValue = 2;
    else if (mode === "upgrade") nextValue = existingValue === 0 ? 1 : 2;
    else nextValue = Math.max(existingValue, 1);

    if (nextValue !== existingValue) updates[keyPath] = nextValue;

    if (trait === "tool") {
      const abilityPath = `system.tools.${value}.ability`;
      const existingAbility = updates[abilityPath] ?? foundry.utils.getProperty(actor, abilityPath);
      const defaultAbility = CONFIG.DND5E?.tools?.[value]?.ability;
      if (!existingAbility && defaultAbility) updates[abilityPath] = defaultAbility;
    }

    return 1;
  }

  const listPath = trait === "weapon"
    ? "system.traits.weaponProf.value"
    : trait === "armor"
      ? "system.traits.armorProf.value"
      : trait === "languages"
        ? "system.traits.languages.value"
        : null;
  if (!listPath) return 0;

  const existingValues = updates[listPath] ?? foundry.utils.getProperty(actor, listPath) ?? [];
  const nextSet = new Set(Array.isArray(existingValues) ? existingValues : Array.from(existingValues));
  const before = nextSet.size;
  nextSet.add(value);
  if (nextSet.size !== before) updates[listPath] = Array.from(nextSet);
  return 1;
}

function buildEmbeddedActorAdvancementStructure(sourceAdvancement, {
  actor,
  classSourceId = null,
  targetLevel = 1,
  selectedSubclassSourceId = null,
  optionSelections = {},
  traitSelections = {}
} = {}) {
  const actorFeaturesBySourceId = buildActorFeatureSourceMap(actor, { classSourceId });
  const actorSubclassesBySourceId = buildActorItemSourceMap(actor, {
    classSourceId,
    itemTypes: ["subclass"]
  });
  const selectedOptionSourceIds = new Set(
    Object.values(optionSelections ?? {})
      .flat()
      .map((value) => trimString(value))
      .filter(Boolean)
  );
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
    else if (clone.type === "ItemChoice") {
      const configuredPool = Array.isArray(clone.configuration?.pool)
        ? clone.configuration.pool
        : [];
      const resolvedPool = [];
      const seenUuids = new Set();
      const addPoolEntry = (entry) => {
        const uuid = trimString(entry?.uuid);
        if (!uuid || seenUuids.has(uuid)) return;
        seenUuids.add(uuid);
        resolvedPool.push(entry);
      };

      for (const configuredItem of configuredPool) {
        addPoolEntry(foundry.utils.deepClone(configuredItem));
      }

      const added = {};
      for (const sourceId of selectedOptionSourceIds) {
        const actorFeature = actorFeaturesBySourceId.get(sourceId);
        if (!actorFeature) continue;

        addPoolEntry({
          uuid: actorFeature.uuid,
          sourceId
        });
        added[actorFeature.id] = actorFeature.uuid;
      }

      clone.configuration ??= {};
      clone.configuration.pool = resolvedPool;
      clone.value ??= {};
      clone.value.added = added;
      clone.value.replaced ??= {};
    }
    else if (clone.type === "Subclass") {
      const actorSubclass = selectedSubclassSourceId
        ? actorSubclassesBySourceId.get(selectedSubclassSourceId)
        : null;
      clone.value ??= {};
      clone.value.document = actorSubclass?.id ?? null;
      clone.value.uuid = actorSubclass?.uuid ?? null;
    }
    else if (clone.type === "Trait") {
      const selections = ensureArray(traitSelections?.[id] ?? traitSelections?.[clone._id]);
      if (selections.length) {
        clone.value ??= {};
        clone.value.chosen = [...new Set([
          ...ensureArray(clone.value?.chosen),
          ...selections
        ])].filter(Boolean);
      }
    }

    resolved[id] = clone;
  }

  return resolved;
}

async function promptActorAbilityScoreImprovements(actor, actorClassItem, {
  existingClassLevel = 0,
  targetLevel = 1,
  entry = null,
  payload = null,
  classSourceId = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !actorClassItem || targetLevel <= existingClassLevel) return 0;
  if (game.settings.get("dnd5e", "disableAdvancements")) return 0;

  let currentClassItem = targetActor.items.get(actorClassItem.id) ?? actorClassItem;
  const pendingAsiEntries = Object.entries(normalizeAdvancementStructure(currentClassItem.system?.advancement))
    .filter(([, advancementEntry]) => {
      if (advancementEntry?.type !== "AbilityScoreImprovement") return false;
      const level = Number(advancementEntry.level ?? 0);
      if (level <= existingClassLevel || level > targetLevel) return false;
      return !hasResolvedAbilityScoreImprovementChoice(advancementEntry);
    })
    .sort((left, right) => Number(left[1]?.level ?? 0) - Number(right[1]?.level ?? 0));

  if (!pendingAsiEntries.length) return 0;

  let featCatalog = null;
  let resolvedCount = 0;
  for (const [advancementId, advancementEntry] of pendingAsiEntries) {
    const featAllowed = advancementEntry?.configuration?.featAllowed !== false;
    if (featAllowed && featCatalog == null) {
      featCatalog = await fetchDauligorFeatCatalog({ entry, payload });
    }

    const selection = await promptForDauligorAbilityScoreImprovement({
      actor: targetActor,
      classItem: currentClassItem,
      advancementEntry,
      featCatalog: featAllowed ? (featCatalog ?? []) : []
    });
    if (!selection) {
      notifyWarn(`Skipped unresolved ability score improvement at class level ${Number(advancementEntry?.level ?? 0) || "?"}.`);
      break;
    }

    currentClassItem = await applyActorAbilityScoreImprovementChoice(targetActor, currentClassItem, {
      advancementId,
      advancementEntry,
      selection,
      classSourceId
    });
    resolvedCount += 1;
  }

  return resolvedCount;
}

function hasResolvedAbilityScoreImprovementChoice(advancementEntry) {
  if (advancementEntry?.type !== "AbilityScoreImprovement") return false;

  const choiceType = trimString(advancementEntry?.value?.type);
  if (choiceType === "feat") {
    return Object.keys(advancementEntry?.value?.feat ?? {}).length > 0;
  }
  if (choiceType === "asi") {
    return Object.values(advancementEntry?.value?.assignments ?? {})
      .some((value) => (Number(value ?? 0) || 0) > 0);
  }
  return false;
}

async function fetchDauligorFeatCatalog({ entry = null, payload = null } = {}) {
  const catalogUrl = trimString(entry?.featCatalogUrl)
    || trimString(payload?.featCatalogUrl)
    || trimString(payload?.source?.featCatalogUrl)
    || "";
  if (!catalogUrl) return [];

  const catalogPayload = await fetchJson(catalogUrl);
  if (!catalogPayload) return [];
  if (catalogPayload.kind !== "dauligor.item-catalog.v1") {
    notifyWarn(`Feat catalog at ${catalogUrl} did not return dauligor.item-catalog.v1.`);
    return [];
  }

  return ensureArray(catalogPayload.entries)
    .filter((catalogEntry) => catalogEntry?.payloadUrl && catalogEntry?.type === "feat")
    .map((catalogEntry) => ({
      ...catalogEntry,
      payloadUrl: resolveCatalogUrl(catalogUrl, catalogEntry.payloadUrl)
    }))
    .sort((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? "")));
}

async function promptForDauligorAbilityScoreImprovement({
  actor,
  classItem,
  advancementEntry,
  featCatalog = []
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || advancementEntry?.type !== "AbilityScoreImprovement") return null;

  const level = Number(advancementEntry.level ?? 0) || 0;
  const points = Math.max(0, Number(advancementEntry?.configuration?.points ?? 2) || 0);
  const perAbilityCap = Math.max(0, Number(advancementEntry?.configuration?.cap ?? points ?? 2) || 0);
  const featAllowed = advancementEntry?.configuration?.featAllowed !== false && featCatalog.length > 0;
  const defaultType = featAllowed && hasResolvedAbilityScoreImprovementChoice(advancementEntry)
    ? trimString(advancementEntry?.value?.type) || "asi"
    : "asi";
  let promptState = getAbilityScoreImprovementPromptState({
    actor: targetActor,
    advancementEntry,
    featCatalog,
    defaultType
  });

  while (true) {
    const response = await DauligorAbilityScoreImprovementApp.prompt({
      actor: targetActor,
      classItem,
      advancementEntry,
      featCatalog,
      points,
      perAbilityCap,
      featAllowed,
      state: promptState
    });

    if (!response || response.status === "cancelled") return null;
    promptState = foundry.utils.deepClone(response.state ?? promptState);

    if (response.type === "feat") {
      if (!featAllowed) {
        notifyWarn("No Dauligor feat catalog is available for this ability score improvement.");
        continue;
      }

      const featSourceId = trimString(response.featSourceId);
      const featEntry = featCatalog.find((catalogEntry) => trimString(catalogEntry?.sourceId) === featSourceId);
      if (!featEntry?.payloadUrl) {
        notifyWarn("Choose a Dauligor feat before continuing.");
        continue;
      }

      return {
        type: "feat",
        featEntry
      };
    }

    const assignments = {};
    let assignedPoints = 0;
    let invalid = false;
    for (const [abilityKey, abilityData] of Object.entries(CONFIG.DND5E?.abilities ?? {})) {
      const requested = Math.max(0, Math.floor(Number(response.assignments?.[abilityKey] ?? 0) || 0));
      if (!requested) continue;

      const abilityValue = Number(targetActor.system?.abilities?.[abilityKey]?.value ?? 0) || 0;
      const abilityCap = Math.max(
        Number(targetActor.system?.abilities?.[abilityKey]?.max ?? 20) || 20,
        Number(advancementEntry?.configuration?.max ?? Number.NEGATIVE_INFINITY)
      );
      const allowedForAbility = Math.max(0, Math.min(perAbilityCap, abilityCap - abilityValue));
      if (requested > allowedForAbility) {
        notifyWarn(`${abilityData?.label ?? abilityKey.toUpperCase()} can only gain up to ${allowedForAbility} point(s) here.`);
        invalid = true;
        break;
      }

      assignments[abilityKey] = requested;
      assignedPoints += requested;
    }
    if (invalid) continue;

    if (assignedPoints !== points) {
      notifyWarn(`Spend exactly ${points} ability score point(s) before continuing.`);
      continue;
    }

    return {
      type: "asi",
      assignments
    };
  }
}

function getAbilityScoreImprovementPromptState({
  actor,
  advancementEntry,
  featCatalog = [],
  defaultType = "asi"
} = {}) {
  const assignments = {};
  for (const abilityKey of Object.keys(CONFIG.DND5E?.abilities ?? {})) {
    const saved = Number(advancementEntry?.value?.assignments?.[abilityKey] ?? 0) || 0;
    if (saved > 0) assignments[abilityKey] = saved;
  }

  const featSourceId = trimString(Object.values(advancementEntry?.value?.feat ?? {})[0])
    || trimString(Object.keys(advancementEntry?.value?.feat ?? {})[0])
    || "";
  const resolvedFeatEntry = featCatalog.find((catalogEntry) =>
    trimString(catalogEntry?.sourceId) === featSourceId
    || trimString(catalogEntry?.payloadUrl) === featSourceId
  );

  return {
    type: defaultType,
    assignments,
    featSourceId: trimString(resolvedFeatEntry?.sourceId) || "",
    status: "",
    statusLevel: ""
  };
}

function getAbilityScorePromptAbilityRows(actor, advancementEntry, perAbilityCap, assignments = {}) {
  return Object.entries(CONFIG.DND5E?.abilities ?? {}).map(([abilityKey, abilityData]) => {
    const abilityValue = Number(actor?.system?.abilities?.[abilityKey]?.value ?? 0) || 0;
    const abilityCap = Math.max(
      Number(actor?.system?.abilities?.[abilityKey]?.max ?? 20) || 20,
      Number(advancementEntry?.configuration?.max ?? Number.NEGATIVE_INFINITY)
    );
    const currentAssignment = Math.max(0, Math.floor(Number(assignments?.[abilityKey] ?? 0) || 0));
    const allowedForAbility = Math.max(0, Math.min(perAbilityCap, abilityCap - abilityValue));

    return {
      key: abilityKey,
      label: abilityData?.label ?? abilityKey.toUpperCase(),
      current: abilityValue,
      cap: abilityCap,
      assigned: currentAssignment,
      maxAssignable: allowedForAbility
    };
  });
}

class DauligorAbilityScoreImprovementApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({
    actor = null,
    classItem = null,
    advancementEntry = null,
    featCatalog = [],
    points = 2,
    perAbilityCap = 2,
    featAllowed = false,
    state = null
  } = {}) {
    super({
      id: `${MODULE_ID}-asi-${foundry.utils.randomID()}`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--asi"],
      window: {
        title: `${classItem?.name ?? "Class"} Ability Score Improvement`,
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        width: Math.min(window.innerWidth - 120, 960),
        height: Math.min(window.innerHeight - 120, 760)
      }
    });

    this._template = CLASS_OPTIONS_TEMPLATE;
    this._actor = actor ?? null;
    this._classItem = classItem ?? null;
    this._advancementEntry = advancementEntry ?? null;
    this._featCatalog = ensureArray(featCatalog);
    this._points = Math.max(0, Number(points ?? 0) || 0);
    this._perAbilityCap = Math.max(0, Number(perAbilityCap ?? 0) || 0);
    this._featAllowed = Boolean(featAllowed);
    this._state = foundry.utils.deepClone(state ?? {});
    this._resolved = false;
    this._waitPromise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  static async prompt(config = {}) {
    const app = new this(config);
    app.render({ force: true });
    return app.wait();
  }

  wait() {
    return this._waitPromise;
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    const shouldResolve = !this._resolved;
    const result = await super.close(options);
    if (shouldResolve) {
      this._resolved = true;
      this._resolve({ status: "cancelled" });
    }
    return result;
  }

  _resolveAndClose(result) {
    if (this._resolved) return;
    this._resolved = true;
    this._resolve(result);
    this.close();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  _getAbilityRows() {
    return getAbilityScorePromptAbilityRows(
      this._actor,
      this._advancementEntry,
      this._perAbilityCap,
      this._state.assignments ?? {}
    );
  }

  _getAssignedPoints() {
    return Object.values(this._state.assignments ?? {})
      .reduce((total, value) => total + Math.max(0, Number(value ?? 0) || 0), 0);
  }

  _getRemainingPoints() {
    return this._points - this._getAssignedPoints();
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderPrompt();
  }

  _renderPrompt() {
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;

    const level = Number(this._advancementEntry?.level ?? 0) || 0;
    this._toolbarRegion.innerHTML = `
      <div class="dauligor-class-options__toolbar dauligor-asi__toolbar">
        <div>
          <span class="dauligor-class-browser__step">Resolve Advancement</span>
          <h2 class="dauligor-class-browser__title">${foundry.utils.escapeHTML(this._advancementEntry?.title ?? "Ability Score Improvement")}</h2>
          <p class="dauligor-class-browser__subtitle">Level ${level || "?"} for ${foundry.utils.escapeHTML(this._classItem?.name ?? "Class")} on ${foundry.utils.escapeHTML(this._actor?.name ?? "Actor")}.</p>
        </div>
        <div class="dauligor-class-options__toolbar-meta">
          <div>
            <span class="dauligor-class-browser__summary-label">Points</span>
            <span class="dauligor-class-browser__summary-value">${this._points}</span>
          </div>
          <div>
            <span class="dauligor-class-browser__summary-label">Per Ability Cap</span>
            <span class="dauligor-class-browser__summary-value">${this._perAbilityCap}</span>
          </div>
          <div>
            <span class="dauligor-class-browser__summary-label">Mode</span>
            <span class="dauligor-class-browser__summary-value">${this._state.type === "feat" ? "Feat" : "ASI"}</span>
          </div>
        </div>
      </div>
    `;
  }

  _renderBody() {
    if (!this._bodyRegion) return;

    const remainingPoints = this._getRemainingPoints();
    const abilityRows = this._getAbilityRows();
    const selectedFeat = this._featCatalog.find((entry) => trimString(entry?.sourceId) === trimString(this._state.featSourceId));
    const featOptions = this._featCatalog.length
      ? this._featCatalog.map((catalogEntry) => `
        <option value="${foundry.utils.escapeHTML(trimString(catalogEntry?.sourceId))}" ${trimString(this._state.featSourceId) === trimString(catalogEntry?.sourceId) ? "selected" : ""}>
          ${foundry.utils.escapeHTML(trimString(catalogEntry?.name) || trimString(catalogEntry?.sourceId) || "Feat")}
        </option>
      `).join("")
      : `<option value="">No Dauligor feats available</option>`;

    this._bodyRegion.innerHTML = `
      <div class="dauligor-class-options__body dauligor-asi__body">
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Choose Resolution</h3>
            <p>Use a direct ability score improvement or swap this level-up into a Dauligor feat import.</p>
          </header>
          <div class="dauligor-asi__mode-grid">
            <button type="button" class="dauligor-asi__mode-card ${this._state.type === "asi" ? "is-active" : ""}" data-action="set-type" data-type="asi">
              <span class="dauligor-asi__mode-title">Ability Score Improvement</span>
              <span class="dauligor-asi__mode-copy">${remainingPoints} point(s) remaining.</span>
            </button>
            <button type="button" class="dauligor-asi__mode-card ${this._state.type === "feat" ? "is-active" : ""}" data-action="set-type" data-type="feat" ${this._featAllowed ? "" : "disabled"}>
              <span class="dauligor-asi__mode-title">Feat</span>
              <span class="dauligor-asi__mode-copy">${this._featAllowed ? "Import from the Dauligor feat catalog." : "No feat catalog is available for this source yet."}</span>
            </button>
          </div>
        </section>
        <div class="dauligor-asi__content-grid">
          <section class="dauligor-class-options__section ${this._state.type === "asi" ? "is-active" : ""}">
            <header class="dauligor-class-options__section-head">
              <h3>Ability Scores</h3>
              <p>Spend exactly ${this._points} point(s). Each ability can gain up to ${this._perAbilityCap} point(s) from this ASI.</p>
            </header>
            <div class="dauligor-asi__ability-grid">
              ${abilityRows.map((row) => `
                <article class="dauligor-asi__ability-card ${row.assigned > 0 ? "is-raised" : ""}">
                  <div class="dauligor-asi__ability-head">
                    <span class="dauligor-asi__ability-name">${foundry.utils.escapeHTML(row.label)}</span>
                    <span class="dauligor-asi__ability-meta">${row.current} to ${row.current + row.assigned} / ${row.cap}</span>
                  </div>
                  <div class="dauligor-asi__ability-controls">
                    <button type="button" class="dauligor-asi__ability-button" data-action="adjust-ability" data-ability="${row.key}" data-delta="-1" ${row.assigned > 0 ? "" : "disabled"}>-</button>
                    <span class="dauligor-asi__ability-value">+${row.assigned}</span>
                    <button type="button" class="dauligor-asi__ability-button" data-action="adjust-ability" data-ability="${row.key}" data-delta="1" ${row.assigned < row.maxAssignable && remainingPoints > 0 ? "" : "disabled"}>+</button>
                  </div>
                  <div class="dauligor-asi__ability-foot">Can assign up to ${row.maxAssignable}</div>
                </article>
              `).join("")}
            </div>
          </section>
          <section class="dauligor-class-options__section ${this._state.type === "feat" ? "is-active" : ""}">
            <header class="dauligor-class-options__section-head">
              <h3>Dauligor Feat</h3>
              <p>Choose the feat to import in place of an ability score increase.</p>
            </header>
            <div class="dauligor-asi__feat-panel">
              <label class="dauligor-class-browser__field">
                <span class="dauligor-class-browser__field-label">Feat</span>
                <select class="dauligor-class-browser__input" data-action="select-feat" ${this._featAllowed ? "" : "disabled"}>
                  <option value="">Select a feat</option>
                  ${featOptions}
                </select>
              </label>
              <div class="dauligor-asi__feat-preview ${selectedFeat ? "" : "is-empty"}">
                <div class="dauligor-asi__feat-preview-title">${foundry.utils.escapeHTML(selectedFeat?.name ?? "No feat selected")}</div>
                <div class="dauligor-asi__feat-preview-meta">${foundry.utils.escapeHTML(trimString(selectedFeat?.sourceId) || "Choose a feat from the Dauligor catalog.")}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    this._bodyRegion.querySelectorAll(`[data-action="set-type"]`).forEach((button) => {
      button.addEventListener("click", () => {
        const nextType = trimString(button.dataset.type) || "asi";
        if (nextType === "feat" && !this._featAllowed) return;
        this._state.type = nextType;
        this._state.status = "";
        this._state.statusLevel = "";
        this._renderPrompt();
      });
    });
    this._bodyRegion.querySelectorAll(`[data-action="adjust-ability"]`).forEach((button) => {
      button.addEventListener("click", () => {
        const abilityKey = trimString(button.dataset.ability);
        const delta = Number(button.dataset.delta ?? 0) || 0;
        if (!abilityKey || !delta) return;

        const current = Number(this._state.assignments?.[abilityKey] ?? 0) || 0;
        const row = this._getAbilityRows().find((entry) => entry.key === abilityKey);
        if (!row) return;

        const nextValue = clampValue(current + delta, 0, row.maxAssignable);
        this._state.assignments ??= {};
        if (nextValue > 0) this._state.assignments[abilityKey] = nextValue;
        else delete this._state.assignments[abilityKey];
        this._state.status = "";
        this._state.statusLevel = "";
        this._renderPrompt();
      });
    });
    this._bodyRegion.querySelector(`[data-action="select-feat"]`)?.addEventListener("change", (event) => {
      this._state.featSourceId = trimString(event.currentTarget.value);
      this._state.status = "";
      this._state.statusLevel = "";
      this._renderPrompt();
    });
  }

  _renderFooter() {
    if (!this._footerRegion) return;

    this._footerRegion.innerHTML = `
      <div class="dauligor-class-options__footer">
        <div class="dauligor-class-options__footer-fields">
          <div class="dauligor-class-browser__status ${this._state.statusLevel ? `dauligor-class-browser__status--${this._state.statusLevel}` : ""}">
            ${this._state.status ? foundry.utils.escapeHTML(this._state.status) : ""}
          </div>
        </div>
        <div class="dauligor-class-options__footer-actions">
          <div class="dauligor-class-browser__actions">
            <button type="button" class="dauligor-class-browser__button" data-action="cancel">Cancel</button>
            <button type="button" class="dauligor-class-browser__button dauligor-class-browser__button--primary" data-action="apply">Apply Choice</button>
          </div>
        </div>
      </div>
    `;

    this._footerRegion.querySelector(`[data-action="cancel"]`)?.addEventListener("click", () => {
      this._resolveAndClose({ status: "cancelled" });
    });
    this._footerRegion.querySelector(`[data-action="apply"]`)?.addEventListener("click", () => {
      this._resolveAndClose({
        status: "confirmed",
        type: this._state.type === "feat" ? "feat" : "asi",
        featSourceId: trimString(this._state.featSourceId),
        assignments: foundry.utils.deepClone(this._state.assignments ?? {}),
        state: foundry.utils.deepClone(this._state)
      });
    });
  }
}

async function applyActorAbilityScoreImprovementChoice(actor, classItem, {
  advancementId = null,
  advancementEntry = null,
  selection = null,
  classSourceId = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  let currentClassItem = targetActor?.items?.get(classItem?.id) ?? classItem;
  if (!targetActor || !currentClassItem || !advancementId || advancementEntry?.type !== "AbilityScoreImprovement" || !selection) {
    return currentClassItem;
  }

  const nextValue = {};
  if (selection.type === "feat") {
    const featDoc = await importDauligorFeatToActor(targetActor, selection.featEntry, {
      classSourceId,
      advancementSourceId: getSourceAdvancementId(advancementId, advancementEntry)
    });
    if (!featDoc) return currentClassItem;
    nextValue.type = "feat";
    nextValue.feat = {
      [featDoc.id]: featDoc.uuid
    };
  } else {
    const assignments = foundry.utils.deepClone(selection.assignments ?? {});
    const currentConMod = getActorConModifier(targetActor);
    const abilityUpdates = {};
    for (const [abilityKey, delta] of Object.entries(assignments)) {
      const increment = Number(delta ?? 0) || 0;
      if (!increment) continue;
      const currentValue = Number(targetActor.system?.abilities?.[abilityKey]?.value ?? 0) || 0;
      abilityUpdates[`system.abilities.${abilityKey}.value`] = currentValue + increment;
    }

    if (!foundry.utils.isEmpty(abilityUpdates)) {
      await targetActor.update(abilityUpdates);
      const nextConMod = getActorConModifier(targetActor);
      const conDelta = nextConMod - currentConMod;
      if (conDelta) {
        await applyActorConHitPointAdjustment(targetActor, conDelta);
      }
    }

    nextValue.type = "asi";
    nextValue.assignments = assignments;
  }

  const advancement = foundry.utils.deepClone(normalizeAdvancementStructure(currentClassItem.system?.advancement));
  const currentAdvancementEntry = advancement[advancementId];
  if (!currentAdvancementEntry) return currentClassItem;
  currentAdvancementEntry.value = nextValue;

  const [updatedClassItem] = await targetActor.updateEmbeddedDocuments("Item", [{
    _id: currentClassItem.id,
    system: {
      "==advancement": advancement
    }
  }]);

  return updatedClassItem ?? targetActor.items.get(currentClassItem.id) ?? currentClassItem;
}

async function importDauligorFeatToActor(actor, featEntry, {
  classSourceId = null,
  advancementSourceId = null
} = {}) {
  const targetActor = resolveTargetActor(actor);
  if (!targetActor || !featEntry?.payloadUrl) return null;

  const featPayload = await fetchJson(featEntry.payloadUrl);
  if (!featPayload) return null;

  const rawFeat = featPayload.kind === "dauligor.item.v1"
    ? featPayload.item
    : featPayload;
  if (!rawFeat || rawFeat.type !== "feat" || !rawFeat.system) {
    notifyWarn(`Feat payload for "${featEntry?.name ?? "feat"}" was not a supported feat item.`);
    return null;
  }

  const normalizedFeat = normalizeWorldItem(rawFeat, featPayload.source);
  normalizedFeat.flags ??= {};
  normalizedFeat.flags[MODULE_ID] ??= {};
  normalizedFeat.flags[MODULE_ID].sourceType = "feat";
  if (classSourceId) normalizedFeat.flags[MODULE_ID].grantedByClassSourceId = classSourceId;
  if (advancementSourceId) normalizedFeat.flags[MODULE_ID].grantedByAdvancementId = advancementSourceId;

  return upsertActorItem(targetActor, normalizedFeat);
}

async function applyActorConHitPointAdjustment(actor, conDelta) {
  const targetActor = resolveTargetActor(actor);
  const numericDelta = Number(conDelta ?? 0) || 0;
  if (!targetActor || !numericDelta) return 0;

  const totalClassLevels = targetActor.items
    .filter((item) => item.type === "class")
    .reduce((total, item) => total + (Number(item.system?.levels ?? 0) || 0), 0);
  if (!totalClassLevels) return 0;

  const hpDelta = totalClassLevels * numericDelta;
  if (!hpDelta) return 0;

  targetActor.reset?.();
  const currentValue = Number(targetActor.system?.attributes?.hp?.value ?? 0) || 0;
  const rawMaxOverride = targetActor._source?.system?.attributes?.hp?.max;
  const updates = {
    "system.attributes.hp.value": Math.max(currentValue + hpDelta, 0)
  };
  if (rawMaxOverride != null) {
    updates["system.attributes.hp.max"] = (Number(rawMaxOverride) || 0) + hpDelta;
  }

  await targetActor.update(updates);
  return hpDelta;
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
    const mode = advancementEntry?.configuration?.mode || "default";
    if (mode !== "default") continue;
    const advancementKind = advancementEntry?.flags?.[MODULE_ID]?.advancementKind ?? null;
    const configType = advancementEntry?.configuration?.type ?? null;
    if (advancementKind !== "skills" && configType !== "skills") continue;

    advancementEntry.value ??= {};
    advancementEntry.value.chosen = normalizedSelections.map((slug) => `skills:${slug}`);
  }
}

function applyToolSelectionsToAdvancements(advancement, { toolSelections = [] } = {}) {
  if (!advancement || typeof advancement !== "object") return;
  const normalizedSelections = [...new Set(ensureArray(toolSelections).map((slug) => normalizeToolSlug(slug)).filter(Boolean))];
  if (!normalizedSelections.length) return;
  for (const advancementEntry of Object.values(advancement)) {
    if (advancementEntry?.type !== "Trait") continue;
    const mode = advancementEntry?.configuration?.mode || "default";
    if (mode !== "default") continue;
    const advancementKind = advancementEntry?.flags?.[MODULE_ID]?.advancementKind ?? null;
    const configType = advancementEntry?.configuration?.type ?? null;
    if (advancementKind !== "tools" && configType !== "tools") continue;

    advancementEntry.value ??= {};
    advancementEntry.value.chosen = normalizedSelections.map((slug) => `tool:${slug}`);
  }
}

function applySavingThrowSelectionsToAdvancements(advancement, { savingThrowSelections = [] } = {}) {
  if (!advancement || typeof advancement !== "object") return;
  const normalizedSelections = [...new Set(ensureArray(savingThrowSelections).map((code) => normalizeAbilityCode(code)).filter(Boolean))];
  if (!normalizedSelections.length) return;
  for (const advancementEntry of Object.values(advancement)) {
    if (advancementEntry?.type !== "Trait") continue;
    const mode = advancementEntry?.configuration?.mode || "default";
    if (mode !== "default") continue;
    if (advancementEntry?.flags?.[MODULE_ID]?.advancementKind !== "savingThrows") continue;

    advancementEntry.value ??= {};
    advancementEntry.value.chosen = normalizedSelections.map((ability) => `saves:${ability}`);
  }
}

function applyLanguageSelectionsToAdvancements(advancement, { languageSelections = [] } = {}) {
  if (!advancement || typeof advancement !== "object") return;
  const normalizedSelections = [...new Set(ensureArray(languageSelections).map((slug) => slugify(trimString(slug))).filter(Boolean))];
  if (!normalizedSelections.length) return;
  for (const advancementEntry of Object.values(advancement)) {
    if (advancementEntry?.type !== "Trait") continue;
    const mode = advancementEntry?.configuration?.mode || "default";
    if (mode !== "default") continue;
    if (advancementEntry?.flags?.[MODULE_ID]?.advancementKind !== "languages") continue;

    advancementEntry.value ??= {};
    advancementEntry.value.chosen = normalizedSelections.map((slug) => `languages:${slug}`);
  }
}

function applyTraitSelectionsToAdvancements(advancement, { traitSelections = {} } = {}) {
  if (!advancement || typeof advancement !== "object") return;
  for (const [id, advancementEntry] of Object.entries(advancement)) {
    if (advancementEntry?.type !== "Trait" && advancementEntry?.type !== "ItemChoice") continue;
    const originalAdvancementId = advancementEntry?.flags?.[MODULE_ID]?.sourceAdvancementId || advancementEntry?.flags?.[MODULE_ID]?.semanticAdvancementId || id;
    const selections = ensureArray(traitSelections?.[id] ?? traitSelections?.[originalAdvancementId]);
    if (selections.length) {
      advancementEntry.value ??= {};
      if (advancementEntry.type === "Trait") {
        advancementEntry.value.chosen = [...new Set([
          ...ensureArray(advancementEntry.value?.chosen),
          ...selections
        ])].filter(Boolean);
      } else if (advancementEntry.type === "ItemChoice") {
        advancementEntry.value.added ??= {};
        for (const sel of selections) {
          advancementEntry.value.added[sel] = sel;
        }
      }
    }
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

  targetActor.reset?.();
  const currentValue = Number(targetActor.system?.attributes?.hp?.value ?? 0) || 0;
  const rawMaxOverride = targetActor._source?.system?.attributes?.hp?.max;
  const hasMaxOverride = rawMaxOverride != null;
  const hpMeta = resolved.hpMeta;

  const updates = {
    "system.attributes.hp.value": (hpMeta.isFirstHpGain ? 0 : currentValue) + hpGainData.total
  };

  if (hasMaxOverride) {
    const currentMax = Number(rawMaxOverride) || 0;
    updates["system.attributes.hp.max"] = (hpMeta.isFirstHpGain ? 0 : currentMax) + hpGainData.total;
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
      rawMaxOverride,
      computedMax: targetActor.system?.attributes?.hp?.max ?? null
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
  return buildActorItemSourceMap(actor, {
    classSourceId,
    itemTypes: ["feat"]
  });
}

function buildActorItemSourceMap(actor, { classSourceId = null, itemTypes = [] } = {}) {
  const targetActor = resolveTargetActor(actor);
  const mapped = new Map();
  if (!targetActor) return mapped;
  const allowedTypes = new Set(ensureArray(itemTypes).filter(Boolean));

  const matchingItems = targetActor.items.filter((item) =>
    (!allowedTypes.size || allowedTypes.has(item.type))
    && (!classSourceId || item.getFlag(MODULE_ID, "classSourceId") === classSourceId)
  );

  for (const item of matchingItems) {
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

/**
 * Fetch the per-class curated spell list from its dedicated endpoint.
 *
 * The class bundle URL is `.../phb/classes/wizard.json`; the spell
 * list lives at `.../phb/classes/wizard/spells.json`. The server
 * serves this endpoint live from D1 with a 60s HTTP cache, so spell
 * curation + tag-driven rule recompute reach the importer without
 * requiring a class rebake.
 *
 * Returns the `spells[]` array of lightweight summaries (no `system`
 * block, no `effects`). The picker reads from `flags.dauligor-pairing.*`
 * which carries everything it needs (level, school, sourceId, dbId,
 * ritual, concentration, etc.). The embed phase fetches the full
 * spell item via `fetchFullSpellItem(dbId, classBundleUrl)` for
 * each spell the user actually picks.
 *
 * Returns `[]` when the endpoint 404s or the response is malformed.
 * The class import flow treats an empty list as "no picker fires"
 * so this matches the pre-decoupling behavior for classes without
 * a curated list.
 */
export async function fetchClassSpellList(classBundleUrl) {
  if (!classBundleUrl) return [];
  // Class URL ends in `.json`. Drop the suffix and append
  // `/spells.json` for the spell-list endpoint. Both URLs share the
  // same source-slug + class-identifier prefix.
  const trimmed = String(classBundleUrl).replace(/\.json(\?.*)?$/i, "");
  if (trimmed === classBundleUrl) {
    // Path didn't end in `.json` (unexpected shape) — bail.
    warn("fetchClassSpellList: class bundle URL doesn't end in .json", { classBundleUrl });
    return [];
  }
  const spellListUrl = `${trimmed}/spells.json`;

  const payload = await fetchJson(spellListUrl);
  if (!payload) return [];

  if (payload.kind !== "dauligor.class-spell-list.v1") {
    warn("fetchClassSpellList: response is not dauligor.class-spell-list.v1", {
      spellListUrl,
      kind: payload?.kind,
    });
    return [];
  }
  return Array.isArray(payload.spells) ? payload.spells : [];
}

/**
 * Derive the per-spell endpoint URL from the class bundle URL.
 *
 * The class bundle lives at `.../api/module/<source>/classes/<class>.json`;
 * the per-spell endpoint lives at `.../api/module/spells/<dbId>.json`.
 * Both share the same `/api/module/` root, so we strip the
 * source/class tail from the class URL to find the module root.
 *
 * Returns null when the input URL doesn't match the expected shape.
 */
function deriveSpellEndpointUrl(classBundleUrl, dbId) {
  if (!classBundleUrl || !dbId) return null;
  // Match `.../api/module/...` and snip everything after `/api/module/`.
  const match = String(classBundleUrl).match(/^(.*\/api\/module\/)/i);
  if (!match) {
    warn("deriveSpellEndpointUrl: class bundle URL does not contain '/api/module/'", { classBundleUrl });
    return null;
  }
  return `${match[1]}spells/${encodeURIComponent(dbId)}.json`;
}

/**
 * Fetch the full Foundry-ready spell item by DB id.
 *
 * The class spell-list endpoint ships lightweight summaries
 * (~700 bytes per spell); the picker uses those for row render and
 * filter chips. When the user picks spells, the embed phase fetches
 * the full item — including `system.description.value`,
 * `system.activities`, `system.materials`, etc. — from this
 * endpoint and writes it to the actor.
 *
 * Per-fetch is one D1 row lookup, ~3-5 KB response. For a typical
 * level-1 Wizard pick (2 cantrips + 6 spells = 8 fetches) the total
 * is comparable to a single full-pool ship in the old design, but
 * avoids the cost when the user doesn't import that pool.
 *
 * Returns the spell item (suitable for `createEmbeddedDocuments`)
 * or null if the fetch fails. Failures are non-fatal — the caller
 * can fall back to the summary it already has, but the actor's
 * spell item will lack description / activities / etc.
 */
export async function fetchFullSpellItem(classBundleUrl, dbId) {
  const url = deriveSpellEndpointUrl(classBundleUrl, dbId);
  if (!url) return null;

  const payload = await fetchJson(url);
  if (!payload) return null;

  if (payload.kind !== "dauligor.spell-item.v1") {
    warn("fetchFullSpellItem: response is not dauligor.spell-item.v1", {
      url,
      kind: payload?.kind,
    });
    return null;
  }
  return payload.spell ?? null;
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

function buildFoundrySpellcastingData(spellcasting, {
  classIdentifier = null,
  subclassIdentifier = null
} = {}) {
  const normalizedAbility = normalizeAbilityCode(spellcasting?.ability);
  const progression = trimString(spellcasting?.progression).toLowerCase() || "none";
  const preparationFormula = normalizePreparedSpellFormula(spellcasting, {
    ability: normalizedAbility,
    classIdentifier,
    subclassIdentifier
  });
  return {
    progression,
    ability: normalizedAbility ?? "",
    preparation: preparationFormula
      ? { formula: preparationFormula }
      : {}
  };
}

function normalizeSpellcastingModuleFlags(spellcasting) {
  if (!spellcasting || typeof spellcasting !== "object") return null;

  const metadata = {};
  if (spellcasting.isRitualCaster != null) {
    metadata.isRitualCaster = Boolean(spellcasting.isRitualCaster);
  }

  const progressionTypeSourceId = trimString(spellcasting.progressionTypeSourceId);
  if (progressionTypeSourceId) metadata.progressionTypeSourceId = progressionTypeSourceId;

  const progressionTypeIdentifier = trimString(spellcasting.progressionTypeIdentifier);
  if (progressionTypeIdentifier) metadata.progressionTypeIdentifier = progressionTypeIdentifier;

  const progressionFormula = trimString(spellcasting.progressionFormula);
  if (progressionFormula) metadata.progressionFormula = progressionFormula;

  const spellsKnownSourceId = trimString(spellcasting.spellsKnownSourceId);
  if (spellsKnownSourceId) metadata.spellsKnownSourceId = spellsKnownSourceId;

  const altProgressionSourceId = trimString(spellcasting.altProgressionSourceId);
  if (altProgressionSourceId) metadata.altProgressionSourceId = altProgressionSourceId;

  return Object.keys(metadata).length ? metadata : null;
}

/**
 * Map a Dauligor spellcasting `type` ("prepared" / "known" / "spellbook")
 * to dnd5e's `system.spellcasting.preparation.mode` semantics.
 *
 *   - "prepared"  (Cleric, Druid, Paladin)        → "prepared"
 *   - "spellbook" (Wizard)                         → "prepared"
 *     Wizard's spellbook IS the prepared model in dnd5e — the spellbook
 *     holds the pool, the user prepares a subset each day with a
 *     formula-driven cap (INT mod + level). Mapping spellbook → "always"
 *     would tell dnd5e "no prep needed" and drop the formula entirely.
 *   - "known"     (Bard, Sorcerer, Warlock, Ranger) → "always"
 *     Known spells are always available; no daily prep step.
 *
 * Used by `normalizePreparedSpellFormula` to gate whether the class
 * item ships a `preparation.formula` (only the formula-bearing types
 * — "prepared" and "spellbook" — need one).
 */
function normalizeSpellPreparationMode(type) {
  const normalized = trimString(type).toLowerCase();
  if (normalized === "prepared" || normalized === "spellbook") return "prepared";
  return "always";
}

function normalizePreparedSpellFormula(spellcasting, {
  ability = null,
  classIdentifier = null,
  subclassIdentifier = null
} = {}) {
  if (normalizeSpellPreparationMode(spellcasting?.type) !== "prepared") return "";

  const rawFormula = trimString(spellcasting?.spellsKnownFormula ?? "");
  if (!rawFormula) return "";
  if (rawFormula.includes("@")) return rawFormula;

  const levelPath = classIdentifier
    ? `@classes.${classIdentifier}.levels`
    : (subclassIdentifier ? `@subclasses.${subclassIdentifier}.levels` : "@item.levels");
  const abilityPath = ability ? `@abilities.${ability}.mod` : "";
  if (!abilityPath) return "";

  const abilityTokenPattern = getAbilityFormulaTokenPattern(ability);
  const normalized = rawFormula.toLowerCase().replace(/\s+/g, " ").trim();
  const patterns = [
    new RegExp(`^${abilityTokenPattern}(?: modifier)? \\+ (?:your )?level$`, "i"),
    new RegExp(`^(?:your )?level \\+ ${abilityTokenPattern}(?: modifier)?$`, "i"),
    new RegExp(`^${abilityTokenPattern}(?: modifier)? \\+ (?:your )?[a-z-]+ level$`, "i"),
    new RegExp(`^(?:your )?[a-z-]+ level \\+ ${abilityTokenPattern}(?: modifier)?$`, "i")
  ];

  if (patterns.some((pattern) => pattern.test(normalized))) {
    return `${abilityPath} + ${levelPath}`;
  }

  return "";
}

function getAbilityFormulaTokenPattern(ability) {
  const aliases = {
    str: ["str", "strength"],
    dex: ["dex", "dexterity"],
    con: ["con", "constitution"],
    int: ["int", "intelligence"],
    wis: ["wis", "wisdom"],
    cha: ["cha", "charisma"]
  };

  return `(?:${(aliases[ability] ?? [ability])
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})`;
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
  if (looksLikeBbcode(text)) return bbcodeToFoundryHtml(text);
  if (looksLikeMarkdown(text)) return markdownToFoundryHtml(text);
  return plainTextToHtml(text);
}

function looksLikeHtml(value) {
  return /<\s*[a-z][^>]*>/i.test(String(value ?? ""));
}

function looksLikeBbcode(value) {
  return /\[(?:\/)?(?:b|i|u|s|h[1-4]|left|center|right|justify|indent|ul|ol|li|quote|code|br|hr|small|sub|sup|url|table|tr|th|td|spoiler)\b/i
    .test(String(value ?? ""));
}

function looksLikeMarkdown(value) {
  const str = String(value ?? "");
  // Block markdown — lines starting with #/*/-/+/<n>./> (headings,
  // lists, blockquotes).
  if (/^(?:\s{0,3}(?:#{1,4}\s|\* |\-\s|\+\s|\d+\.\s|> ))/m.test(str)) return true;
  // Inline markdown — bold/italic markers anywhere in the text.
  // We also need this branch because descriptions like "Your
  // knowledge of dark alchemy… ***Latent Mutagens.*** You inoculate…"
  // carry no line-starting markdown but still need the asterisks
  // converted. Without this check the text falls through to
  // `plainTextToHtml` which just wraps in <p> and escapes the
  // asterisks literally — rendering "***Latent Mutagens.***" in
  // the importer's description panes instead of bold-italic.
  if (/\*\*\*[^*\s][^*]*?\*\*\*/.test(str)) return true;  // ***bold italic***
  if (/\*\*[^*\s][^*]*?\*\*/.test(str)) return true;       // **bold**
  if (/___[^_\s][^_]*?___/.test(str)) return true;         // ___bold italic___
  if (/__[^_\s][^_]*?__/.test(str)) return true;           // __bold__
  if (/`[^`\n]+`/.test(str)) return true;                  // `code`
  return false;
}

function plainTextToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${foundry.utils.escapeHTML(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function bbcodeToFoundryHtml(text) {
  let html = foundry.utils.escapeHTML(text);

  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<del>$1</del>");
  html = html.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, "<h1>$1</h1>");
  html = html.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, "<h2>$1</h2>");
  html = html.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, "<h3>$1</h3>");
  html = html.replace(/\[h4\]([\s\S]*?)\[\/h4\]/gi, "<h4>$1</h4>");
  html = html.replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '<p style="text-align: left">$1</p>');
  html = html.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<p style="text-align: center">$1</p>');
  html = html.replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<p style="text-align: right">$1</p>');
  html = html.replace(/\[justify\]([\s\S]*?)\[\/justify\]/gi, '<p style="text-align: justify">$1</p>');
  html = html.replace(/\[indent\]([\s\S]*?)\[\/indent\]/gi, '<div style="padding-left: 2rem">$1</div>');
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, "<blockquote>$1</blockquote>");
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "<code>$1</code>");
  html = html.replace(/\[br\]/gi, "<br/>");
  html = html.replace(/\[hr\]/gi, "<hr/>");
  html = html.replace(/\[small\]([\s\S]*?)\[\/small\]/gi, "<small>$1</small>");
  html = html.replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, "<sub>$1</sub>");
  html = html.replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, "<sup>$1</sup>");
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  for (let i = 0; i < 6; i += 1) {
    html = html.replace(/\[li\]((?:(?!\[li\]|\[\/li\])[\s\S])*)\[\/li\]/gi, "<li>$1</li>");
    html = html.replace(/\[ul\]((?:(?!\[ul\]|\[\/ul\])[\s\S])*)\[\/ul\]/gi, "<ul>$1</ul>");
    html = html.replace(/\[ol\]((?:(?!\[ol\]|\[\/ol\])[\s\S])*)\[\/ol\]/gi, "<ol>$1</ol>");
  }

  html = html.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, "<table>$1</table>");
  html = html.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi, "<tr>$1</tr>");
  html = html.replace(/\[th(?:\s+([^\]]+))?\]([\s\S]*?)\[\/th\]/gi, (match, attrs, content) =>
    buildBbcodeTableCell("th", attrs, content));
  html = html.replace(/\[td(?:\s+([^\]]+))?\]([\s\S]*?)\[\/td\]/gi, (match, attrs, content) =>
    buildBbcodeTableCell("td", attrs, content));

  const blocks = html
    .replace(/<(h[1-4]|p|div|blockquote|ul|ol|li|hr|table|tr|th|td)([^>]*)>([\s\S]*?)<\/\1>/gi, (match) => `\n\n${match.trim()}\n\n`)
    .replace(/<hr([^>]*)\/?>/gi, "\n\n<hr$1/>\n\n")
    .split(/\n\n+/);

  return blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (/^<(h[1-4]|div|blockquote|ul|ol|li|p|hr|table|tr|th|td)/i.test(trimmed)) {
      return trimmed.replace(/>\s+\n/g, ">").replace(/\n\s+</g, "<");
    }
    return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("");
}

function buildBbcodeTableCell(tagName, attrs, content) {
  let htmlAttrs = "";
  if (attrs) {
    const colspan = attrs.match(/colspan=?["']?(\d+)["']?/i);
    if (colspan) htmlAttrs += ` colspan="${colspan[1]}"`;
    const rowspan = attrs.match(/rowspan=?["']?(\d+)["']?/i);
    if (rowspan) htmlAttrs += ` rowspan="${rowspan[1]}"`;
  }
  return `<${tagName}${htmlAttrs}>${content}</${tagName}>`;
}

function markdownToFoundryHtml(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${applyInlineMarkdown(foundry.utils.escapeHTML(paragraph.join(" ").trim()))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${applyInlineMarkdown(foundry.utils.escapeHTML(heading[2].trim()))}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(applyInlineMarkdown(foundry.utils.escapeHTML(bullet[1].trim())));
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(applyInlineMarkdown(foundry.utils.escapeHTML(numbered[1].trim())));
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push("<hr/>");
      continue;
    }

    if (listType) flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

function applyInlineMarkdown(text) {
  // Order matters: triple-marker (bold+italic) MUST run before
  // the double-marker rules, otherwise `**bold**` would match
  // the inner `**` of `***bold-italic***` and leave a stray `*`
  // on each side.
  return String(text ?? "")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
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

function buildSemanticFeatureTypeData({ sourceType = "classFeature", feature = null, optionGroup = null, optionItem = null } = {}) {
  if (sourceType === "classOption") {
    const label = trimString(optionGroup?.name) || trimString(optionItem?.name) || "Class Option";
    return {
      value: "class",
      subtype: normalizeSemanticFeatureSubtype(label),
      label
    };
  }

  return {
    value: "class",
    subtype: "",
    label: "Class Feature"
  };
}

function normalizeSemanticFeatureSubtype(label) {
  const raw = trimString(label);
  if (!raw) return "";

  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nativeSubtypes = {
    "arcane shot": "arcaneShot",
    "artificer infusion": "artificerInfusion",
    "channel divinity": "channelDivinity",
    "defensive tactic": "defensiveTactic",
    "eldritch invocation": "eldritchInvocation",
    "elemental discipline": "elementalDiscipline",
    "fighting style": "fightingStyle",
    "hunter's prey": "huntersPrey",
    "hunters prey": "huntersPrey",
    "ki": "ki",
    "maneuver": "maneuver",
    "metamagic": "metamagic",
    "multiattack": "multiattack",
    "pact boon": "pact",
    "psionic power": "psionicPower",
    "rune": "rune",
    "superior hunter's defense": "superiorHuntersDefense",
    "superior hunters defense": "superiorHuntersDefense"
  };

  if (nativeSubtypes[normalized]) return nativeSubtypes[normalized];

  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

function buildSemanticOptionRequirement(optionItem, context, feature = null) {
  // Prefer the rich text the editor produces from the option's
  // requirementsTree (see src/lib/classExport.ts where
  // `opt.requirements` is set to `formatRequirementText(remapped)`).
  // That string includes class/level + every other authored prereq
  // ("Warlock 5 and Pact of the Blade and Knows Booming Blade"),
  // which is what Foundry's item card should display in
  // `system.requirements`. Falls back to the simple "Warlock 5"
  // construction for older bundles that predate the tree.
  const rich = trimString(optionItem?.requirements);
  if (rich) return rich;
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
  const text = trimString(value).replace(/^\/+(https?:\/\/)/i, "$1");
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
