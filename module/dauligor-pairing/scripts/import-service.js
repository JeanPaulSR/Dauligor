import { MODULE_ID, SAMPLE_FILE, SETTINGS } from "./constants.js";
import { applyReferenceNormalization } from "./reference-service.js";
import { log, notifyInfo, notifyWarn, promptForText, warn } from "./utils.js";

let moduleSocket = null;

export function initializeSocket() {
  if (!globalThis.socketlib) {
    warn("socketlib is not available. GM-routed imports are disabled.");
    return;
  }

  moduleSocket = globalThis.socketlib.registerModule(MODULE_ID);
  moduleSocket.register("importPayloadToActorByUuid", importPayloadToActorByUuid);
  log("Registered socket handlers");
}

export async function promptImportUrlForActor(actor) {
  if (!actor) {
    notifyWarn("Open a character sheet first so there is an actor to import into.");
    return;
  }

  const url = await promptForText({
    title: "Import From URL",
    label: "JSON URL",
    value: game.settings.get(MODULE_ID, SETTINGS.defaultImportUrl),
    hint: "For testing, this can be a localhost endpoint such as http://127.0.0.1:3000/sample-character.json"
  });

  if (!url) return;

  await game.settings.set(MODULE_ID, SETTINGS.defaultImportUrl, url);
  await importFromUrlToActor(actor, url);
}

export async function importFromUrlToActor(actor, url) {
  if (!actor) {
    notifyWarn("No actor was available for import.");
    return;
  }

  let payload;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
    payload = await response.json();
  } catch (error) {
    console.error(error);
    ui.notifications?.error(`Could not fetch import data from ${url}`);
    return;
  }

  log("Fetched import payload", { url, payload });
  await importPayloadToActor(actor, payload);
}

export async function importSampleToActor(actor) {
  if (!actor) {
    notifyWarn("Open a character sheet first so there is an actor to import into.");
    return;
  }

  await importFromUrlToActor(actor, SAMPLE_FILE);
}

export async function importPayloadToActorByUuid(actorUuid, payload) {
  const actor = await fromUuid(actorUuid);
  return importPayloadToActor(actor, payload);
}

export async function importPayloadToActor(actor, payload) {
  if (!actor) {
    notifyWarn("No actor was available for import.");
    return;
  }

  if (!payload || typeof payload !== "object") {
    notifyWarn("The import payload was empty or invalid.");
    return;
  }

  if (payload.kind === "dauligor.character.v1") {
    await importDauligorCharacter(actor, payload);
    return;
  }

  if (payload.kind === "dauligor.item.v1") {
    await upsertActorItems(actor, [normalizeItemPayload(payload.item, payload.source)]);
    notifyInfo(`Imported "${payload.item?.name ?? "item"}" onto ${actor.name}.`);
    return;
  }

  if (payload.type && payload.system) {
    await upsertActorItems(actor, [normalizeItemPayload(payload)]);
    notifyInfo(`Imported "${payload.name ?? "item"}" onto ${actor.name}.`);
    return;
  }

  notifyWarn("The payload format is not supported yet. Expected dauligor.character.v1, dauligor.item.v1, or a Foundry-like item object.");
}

async function importDauligorCharacter(actor, payload) {
  const actorUpdate = foundry.utils.deepClone(payload.actor ?? {});
  delete actorUpdate.items;
  delete actorUpdate._id;
  delete actorUpdate.folder;
  delete actorUpdate.ownership;
  delete actorUpdate.flags;

  if (Object.keys(actorUpdate).length) {
    await actor.update(actorUpdate);
  }

  const items = Array.isArray(payload.items) ? payload.items.map((item) => normalizeItemPayload(item, payload.source)) : [];
  if (items.length) await upsertActorItems(actor, items);

  notifyInfo(`Imported Dauligor test payload into ${actor.name}.`);
  log("Imported Dauligor character payload", { actor, payload });
}

function normalizeItemPayload(item, sourceMeta = null) {
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

  delete clone.sourceId;
  delete clone.id;
  delete clone._id;
  delete clone.folder;
  delete clone.ownership;
  delete clone.sort;
  delete clone.effects;
  delete clone.items;

  applyReferenceNormalization(clone, { sourceMeta });

  return clone;
}

async function upsertActorItems(actor, items) {
  const existing = Array.from(actor.items ?? []);
  const toCreate = [];
  const toUpdate = [];

  for (const item of items) {
    applyReferenceNormalization(item, { actor });
    const entityId = item.flags?.[MODULE_ID]?.entityId ?? null;
    const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? null;
    const identifier = item.flags?.[MODULE_ID]?.identifier ?? item.system?.identifier ?? null;
    const match = existing.find((embedded) => {
      const embeddedEntityId = embedded.getFlag(MODULE_ID, "entityId") ?? null;
      const embeddedSourceId = embedded.getFlag(MODULE_ID, "sourceId");
      const embeddedIdentifier = embedded.getFlag(MODULE_ID, "identifier") ?? embedded.system?.identifier ?? null;
      if (entityId && embeddedEntityId) return embeddedEntityId === entityId;
      if (sourceId && embeddedSourceId) return embeddedSourceId === sourceId;
      if (identifier && embeddedIdentifier && embedded.type === item.type) return embeddedIdentifier === identifier;
      return embedded.name === item.name && embedded.type === item.type;
    });

    if (!match) {
      toCreate.push(item);
      continue;
    }

    toUpdate.push({
      _id: match.id,
      ...item
    });
  }

  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  if (toUpdate.length) await actor.updateEmbeddedDocuments("Item", toUpdate);
}

function looksLikeSourceBookId(value) {
  const normalized = trimString(value);
  return Boolean(normalized) && /^source[-:]/i.test(normalized);
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}
