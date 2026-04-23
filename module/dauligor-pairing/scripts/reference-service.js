import { MODULE_ID } from "./constants.js";

const ENTITY_REFERENCE_PATTERN = /@(?<kind>class|subclass|feature|option|source)\[(?<id>[^[\]]+)\](?:\{(?<label>[^{}]*)\})?/gi;
const SCALAR_REFERENCE_PATTERN = /@(?:prof(?:\.(?:term|flat|dice|multiplier))?|level|ability\.(?:str|dex|con|int|wis|cha)\.(?:score|mod)|attr\.hp\.(?:value|max|temp|tempmax)|class\.[a-z0-9-]+\.(?:level|tier|hit-die|hit-die-faces|hit-die-number)|subclass\.[a-z0-9-]+\.level|scale\.[a-z0-9-]+\.[a-z0-9-]+(?:\.(?:number|die|faces|denom))?)/gi;

const TEXT_REFERENCE_PATH_PATTERNS = [
  /^system\.description\.(value|chat)$/u,
  /^system\.requirements$/u,
  /^system\.activities\.[^.]+\.description\.(value|chat|chatFlavor)$/u
];

const FORMULA_REFERENCE_PATH_PATTERNS = [
  /^system\.uses\.max$/u,
  /^system\.uses\.recovery\.\d+\.formula$/u,
  /^system\.activities\.[^.]+\.uses\.max$/u,
  /^system\.activities\.[^.]+\.uses\.recovery\.\d+\.formula$/u,
  /^system\.activities\.[^.]+\.attack\.bonus$/u,
  /^system\.activities\.[^.]+\.damage\.critical\.bonus$/u,
  /^system\.activities\.[^.]+\.damage\.parts\.\d+\.(?:number|bonus)$/u,
  /^system\.activities\.[^.]+\.damage\.parts\.\d+\.custom\.formula$/u,
  /^system\.activities\.[^.]+\.healing\.bonus$/u,
  /^system\.activities\.[^.]+\.healing\.custom\.formula$/u,
  /^system\.activities\.[^.]+\.save\.dc\.formula$/u,
  /^system\.activities\.[^.]+\.check\.dc\.formula$/u,
  /^system\.activities\.[^.]+\.consumption\.targets\.\d+\.value$/u,
  /^system\.activities\.[^.]+\.consumption\.targets\.\d+\.scaling\.formula$/u,
  /^system\.activities\.[^.]+\.bonuses\.(?:ac|hd|hp|attackDamage|saveDamage|healing)$/u,
  /^system\.activities\.[^.]+\.tempHP$/u,
  /^system\.activities\.[^.]+\.roll\.formula$/u,
  /^system\.activities\.[^.]+\.settings\.(?:minimumAC|tempFormula)$/u
];

export function applyReferenceNormalization(target, options = {}) {
  if (!target || typeof target !== "object") return target;
  const context = buildReferenceContext(options, target);
  walkReferenceTarget(target, context);
  return target;
}

export function collectReferenceUpdates(target, options = {}) {
  if (!target || typeof target !== "object") return {};
  const clone = foundry.utils.deepClone(target);
  const updates = {};
  const context = buildReferenceContext(options, clone);
  walkReferenceTarget(clone, context, updates);
  return updates;
}

export async function syncDocumentReferences(documents, options = {}) {
  const docs = (documents ?? []).filter(Boolean);
  if (!docs.length) return 0;

  let updated = 0;
  for (const document of docs) {
    if (document?.documentName !== "Item") continue;

    const updates = collectReferenceUpdates(document.toObject(), {
      ...options,
      relatedDocuments: [...(options.relatedDocuments ?? []), ...docs]
    });
    if (!Object.keys(updates).length) continue;

    await document.update(updates);
    updated += 1;
  }

  return updated;
}

function walkReferenceTarget(target, context, updates = null, path = []) {
  if (Array.isArray(target)) {
    target.forEach((value, index) => walkReferenceTarget(value, context, updates, [...path, String(index)]));
    return;
  }

  if (!target || typeof target !== "object") return;

  for (const [key, value] of Object.entries(target)) {
    const nextPath = [...path, key];
    if (Array.isArray(value) || (value && typeof value === "object")) {
      walkReferenceTarget(value, context, updates, nextPath);
      continue;
    }

    if (typeof value !== "string" || !value.includes("@")) continue;
    const pathString = nextPath.join(".");
    const normalized = normalizeStringValue(value, pathString, context);
    if (normalized === value) continue;

    target[key] = normalized;
    if (updates) updates[pathString] = normalized;
  }
}

function normalizeStringValue(value, pathString, context) {
  if (isTextReferencePath(pathString)) return normalizeTextReferences(value, context);
  if (isFormulaReferencePath(pathString)) return normalizeFormulaReferences(value, context);
  return value;
}

function normalizeTextReferences(text, context) {
  let normalized = String(text ?? "");
  normalized = normalized.replace(ENTITY_REFERENCE_PATTERN, (match, kind, sourceId, label) =>
    resolveEntityReference(match, kind, sourceId, label, context)
  );
  normalized = normalized.replace(SCALAR_REFERENCE_PATTERN, (match) => {
    const resolved = resolveScalarReference(match, context, { mode: "text" });
    return resolved ?? match;
  });
  return normalized;
}

function normalizeFormulaReferences(text, context) {
  return String(text ?? "").replace(SCALAR_REFERENCE_PATTERN, (match) => {
    const resolved = resolveScalarReference(match, context, { mode: "formula" });
    return resolved ?? match;
  });
}

function resolveEntityReference(match, kind, sourceId, label, context) {
  const resolvedLabel = trimString(label) || trimString(sourceId) || trimString(kind);
  const document = findEntityDocument(kind, sourceId, context);
  if (!document?.uuid) return match;
  return `@UUID[${document.uuid}]{${resolvedLabel}}`;
}

function resolveScalarReference(reference, context, { mode = "formula" } = {}) {
  const ref = trimString(reference).toLowerCase();
  if (!ref.startsWith("@")) return null;

  if (ref === "@prof") return formatScalarResolution("@prof", mode);
  if (ref === "@prof.term") return formatScalarResolution("@prof.term", mode);
  if (ref === "@prof.flat") return formatScalarResolution("@prof.flat", mode);
  if (ref === "@prof.dice") return formatScalarResolution("@prof.dice", mode);
  if (ref === "@prof.multiplier") return formatScalarResolution("@prof.multiplier", mode);
  if (ref === "@level") return formatScalarResolution("@details.level", mode);

  let match = /^@ability\.(str|dex|con|int|wis|cha)\.(score|mod)$/u.exec(ref);
  if (match) {
    const [, ability, property] = match;
    const nativePath = property === "score"
      ? `@abilities.${ability}.value`
      : `@abilities.${ability}.mod`;
    return formatScalarResolution(nativePath, mode);
  }

  match = /^@attr\.hp\.(value|max|temp|tempmax)$/u.exec(ref);
  if (match) {
    const [, property] = match;
    return formatScalarResolution(`@attributes.hp.${property}`, mode);
  }

  match = /^@class\.([a-z0-9-]+)\.(level|tier|hit-die|hit-die-faces|hit-die-number)$/u.exec(ref);
  if (match) {
    const [, classIdentifier, property] = match;
    return resolveClassReference(classIdentifier, property, context, { mode });
  }

  match = /^@subclass\.([a-z0-9-]+)\.level$/u.exec(ref);
  if (match) {
    const [, subclassIdentifier] = match;
    const nativeIdentifier = resolveNativeParentIdentifier("subclass", subclassIdentifier, context);
    return formatScalarResolution(`@subclasses.${nativeIdentifier}.levels`, mode);
  }

  match = /^@scale\.([a-z0-9-]+)\.([a-z0-9-]+)(?:\.(number|die|faces|denom))?$/u.exec(ref);
  if (match) {
    const [, parentIdentifier, scaleIdentifier, property] = match;
    return resolveScaleReference(parentIdentifier, scaleIdentifier, property ?? null, context, { mode });
  }

  return null;
}

function resolveClassReference(classIdentifier, property, context, { mode = "formula" } = {}) {
  const classItem = findClassLikeDocument("class", classIdentifier, context);
  const nativeIdentifier = getDocumentIdentifier(classItem) || slugify(classIdentifier);

  switch (property) {
    case "level":
      return formatScalarResolution(`@classes.${nativeIdentifier}.levels`, mode);
    case "tier":
      return formatScalarResolution(`@classes.${nativeIdentifier}.tier`, mode);
    case "hit-die":
      return formatScalarResolution(`@classes.${nativeIdentifier}.hd.denomination`, mode);
    case "hit-die-faces": {
      const faces = getClassHitDieFaces(classItem);
      return faces != null ? String(faces) : null;
    }
    case "hit-die-number":
      return "1";
    default:
      return null;
  }
}

function resolveScaleReference(parentIdentifier, scaleIdentifier, property, context, { mode = "formula" } = {}) {
  const parentDoc = findClassLikeDocument("class", parentIdentifier, context)
    ?? findClassLikeDocument("subclass", parentIdentifier, context);
  const nativeParent = getDocumentIdentifier(parentDoc) || slugify(parentIdentifier);
  const nativeScale = resolveScaleIdentifier(parentDoc, scaleIdentifier) || slugify(scaleIdentifier);
  const suffix = property ? `.${property}` : "";
  return formatScalarResolution(`@scale.${nativeParent}.${nativeScale}${suffix}`, mode);
}

function formatScalarResolution(value, mode) {
  if (mode === "text") {
    return value.startsWith("@") ? `[[lookup ${value}]]` : String(value);
  }
  return value;
}

function resolveNativeParentIdentifier(kind, identifier, context) {
  const document = findClassLikeDocument(kind, identifier, context);
  return getDocumentIdentifier(document) || slugify(identifier);
}

function resolveScaleIdentifier(document, requestedIdentifier) {
  const normalizedRequested = slugify(requestedIdentifier);
  if (!document) return normalizedRequested || null;

  const advancements = normalizeAdvancementStructure(getDocumentProperty(document, "system.advancement"));
  for (const advancement of Object.values(advancements)) {
    if (advancement?.type !== "ScaleValue") continue;
    const identifier = trimString(advancement?.configuration?.identifier);
    if (identifier && slugify(identifier) === normalizedRequested) return identifier;
  }

  return normalizedRequested || null;
}

function findEntityDocument(kind, sourceId, context) {
  const normalizedSourceId = trimString(sourceId);
  if (!normalizedSourceId || kind === "source") return null;

  const candidates = getDocumentCandidates(context);
  return candidates.find((document) => {
    if (!matchesEntityKind(document, kind)) return false;
    return getDocumentSourceId(document) === normalizedSourceId;
  }) ?? null;
}

function findClassLikeDocument(kind, identifier, context) {
  const normalizedIdentifier = slugify(identifier);
  const sourceIdPrefix = kind === "subclass" ? "subclass-" : "class-";
  const expectedSourceId = `${sourceIdPrefix}${normalizedIdentifier}`;
  const candidates = getDocumentCandidates(context);

  return candidates.find((document) => {
    if (getDocumentType(document) !== kind) return false;

    const sourceId = getDocumentSourceId(document);
    if (sourceId && sourceId === expectedSourceId) return true;

    const docIdentifier = slugify(getDocumentIdentifier(document));
    return docIdentifier === normalizedIdentifier;
  }) ?? null;
}

function matchesEntityKind(document, kind) {
  const type = getDocumentType(document);
  const sourceType = getDocumentSourceType(document);
  switch (kind) {
    case "class":
      return type === "class";
    case "subclass":
      return type === "subclass";
    case "feature":
      return type === "feat" && ["classFeature", "subclassFeature"].includes(sourceType);
    case "option":
      return type === "feat" && sourceType === "classOption";
    default:
      return false;
  }
}

function getDocumentCandidates(context) {
  const candidates = [];
  if (context.currentItem) candidates.push(context.currentItem);
  for (const document of context.relatedDocuments ?? []) candidates.push(document);
  if (context.actor?.items?.size) candidates.push(...context.actor.items.contents);
  if (game?.items?.contents?.length) candidates.push(...game.items.contents);
  return dedupeDocumentCandidates(candidates);
}

function dedupeDocumentCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = candidate.uuid
      ?? candidate.id
      ?? `${getDocumentType(candidate)}:${getDocumentSourceId(candidate) ?? getDocumentIdentifier(candidate) ?? candidate.name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function buildReferenceContext(options, currentItem) {
  return {
    actor: options.actor ?? null,
    sourceMeta: options.sourceMeta ?? null,
    relatedDocuments: options.relatedDocuments ?? [],
    currentItem
  };
}

function isTextReferencePath(pathString) {
  return TEXT_REFERENCE_PATH_PATTERNS.some((pattern) => pattern.test(pathString));
}

function isFormulaReferencePath(pathString) {
  return FORMULA_REFERENCE_PATH_PATTERNS.some((pattern) => pattern.test(pathString));
}

function getDocumentType(document) {
  return document?.type ?? null;
}

function getDocumentSourceType(document) {
  return getFlag(document, "sourceType") ?? null;
}

function getDocumentSourceId(document) {
  return getFlag(document, "sourceId") ?? null;
}

function getDocumentIdentifier(document) {
  return trimString(getFlag(document, "identifier") ?? getDocumentProperty(document, "system.identifier"));
}

function getClassHitDieFaces(document) {
  const flagged = Number(getFlag(document, "hitDieValue") ?? 0);
  if (Number.isFinite(flagged) && flagged > 0) return flagged;

  const denomination = trimString(getDocumentProperty(document, "system.hd.denomination"));
  const match = /^d(\d+)$/u.exec(denomination.toLowerCase());
  if (match) return Number(match[1]) || null;
  return null;
}

function getFlag(document, key) {
  if (!document) return null;
  if (typeof document.getFlag === "function") return document.getFlag(MODULE_ID, key);
  return document.flags?.[MODULE_ID]?.[key] ?? null;
}

function getDocumentProperty(document, keyPath) {
  if (!document) return undefined;
  if (typeof document.toObject === "function") {
    return foundry.utils.getProperty(document.toObject(), keyPath);
  }
  return foundry.utils.getProperty(document, keyPath);
}

function normalizeAdvancementStructure(advancement) {
  if (!advancement) return {};
  if (typeof advancement?.toObject === "function") return normalizeAdvancementStructure(advancement.toObject());
  if (advancement instanceof Map) {
    return Object.fromEntries([...advancement.entries()].map(([id, entry]) => [
      id,
      {
        ...foundry.utils.deepClone(entry),
        _id: entry?._id ?? id
      }
    ]));
  }
  if (!Array.isArray(advancement) && typeof advancement === "object") return foundry.utils.deepClone(advancement);

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

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
