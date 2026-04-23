import { notifyInfo, notifyWarn, warn } from "./utils.js";

const SPELL_POINTS_MODULE_ID = "dnd5e-spellpoints";
const SPELL_POINTS_PACK_ID = "dnd5e-spellpoints.module-items";
const SPELL_POINTS_ITEM_ID = "LUSjG8364p7LFY1u";
const SPELL_POINTS_SOURCE_ID = `Compendium.${SPELL_POINTS_PACK_ID}.Item.${SPELL_POINTS_ITEM_ID}`;

export async function maybeOfferSpellPointsSupport({ actor = null, importedClassItem = null } = {}) {
  if (!isSpellPointsModuleActive()) return false;
  if (!isSupportedActor(actor)) return false;
  if (!actorShouldUseSpellPoints(actor, importedClassItem)) return false;

  const existingItem = findSpellPointsItem(actor);
  if (existingItem) return false;

  const shouldAdd = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Spell Points: ${actor.name}` },
    content: `
      <p><strong>Advanced Magic - Spell Points System 5e</strong> is active.</p>
      <p>${foundry.utils.escapeHTML(actor.name)} has spellcasting support but does not currently have a spell-points item.</p>
      <p>Add the module's default <strong>Spell Points</strong> item to this actor now?</p>
      <p class="hint">Dauligor will only attach the item. The Advanced Magic module will continue to own spell-point math, casting costs, and per-actor configuration.</p>
    `,
    yes: { label: "Add Spell Points Item" },
    no: { label: "Not Now" },
    modal: true,
    rejectClose: false
  });

  if (!shouldAdd) return false;

  const createdItem = await createSpellPointsItem(actor);
  if (!createdItem) return false;

  notifyInfo(`Added "${createdItem.name}" to "${actor.name}" for Advanced Magic spell-point support.`);
  return true;
}

function isSpellPointsModuleActive() {
  return game.modules.get(SPELL_POINTS_MODULE_ID)?.active === true;
}

function isSupportedActor(actor) {
  return actor?.documentName === "Actor" && actor.type === "character";
}

function actorShouldUseSpellPoints(actor, importedClassItem = null) {
  const items = [
    ...actor.items.filter((item) => item.type === "class" || item.type === "subclass")
  ];

  if (importedClassItem?.id && !items.some((item) => item.id === importedClassItem.id)) {
    items.push(importedClassItem);
  }

  return items.some((item) => getSpellcastingProgression(item) !== "none");
}

function getSpellcastingProgression(item) {
  return String(item?.system?.spellcasting?.progression ?? "")
    .trim()
    .toLowerCase() || "none";
}

function findSpellPointsItem(actor) {
  if (!actor?.items) return null;

  if (typeof globalThis.getSpellPointsItem === "function") {
    try {
      const resolved = globalThis.getSpellPointsItem(actor);
      if (resolved) return resolved;
    } catch (error) {
      warn("Failed to use spell-points module helper getSpellPointsItem", { actor, error });
    }
  }

  const flaggedItemId = actor.flags?.dnd5espellpoints?.item;
  if (flaggedItemId) {
    const flaggedItem = actor.items.get(flaggedItemId);
    if (flaggedItem) return flaggedItem;
  }

  const resourceName = getConfiguredSpellPointsName();
  return actor.items.find((item) =>
    (item.type === "feat" || item.type === "class")
    && (
      item.flags?.core?.sourceId === SPELL_POINTS_SOURCE_ID
      || item.system?.source?.custom === resourceName
    ));
}

function getConfiguredSpellPointsName() {
  return game.settings.get(SPELL_POINTS_MODULE_ID, "settings")?.spResource || "Spell Points";
}

async function createSpellPointsItem(actor) {
  const existingItem = findSpellPointsItem(actor);
  if (existingItem) return existingItem;

  const pack = game.packs.get(SPELL_POINTS_PACK_ID);
  if (!pack) {
    notifyWarn("Advanced Magic spell-points compendium was not found.");
    return null;
  }

  let sourceDoc;
  try {
    sourceDoc = await pack.getDocument(SPELL_POINTS_ITEM_ID);
  } catch (error) {
    warn("Failed to load spell-points item from compendium", { actor, error });
    notifyWarn("Could not load the Advanced Magic spell-points item from its compendium.");
    return null;
  }

  if (!sourceDoc) {
    notifyWarn("Advanced Magic spell-points item could not be found in its compendium.");
    return null;
  }

  const itemData = sourceDoc.toObject();
  delete itemData._id;
  itemData.flags ??= {};
  itemData.flags.core ??= {};
  itemData.flags.core.sourceId ??= sourceDoc.uuid ?? SPELL_POINTS_SOURCE_ID;

  try {
    const created = await actor.createEmbeddedDocuments("Item", [itemData]);
    return findSpellPointsItem(actor) ?? created?.[0] ?? null;
  } catch (error) {
    warn("Failed to create spell-points item on actor", { actor, error });
    notifyWarn(`Could not add the Advanced Magic spell-points item to "${actor.name}".`);
    return null;
  }
}
