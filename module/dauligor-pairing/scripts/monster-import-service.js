// Imports a Foundry NPC actor from the Monster Browser's
// `dauligor.monster-actor.v1` bundle.
//
// Contract: handoffs/foundry-module/2026-06-10-from-monster-browser-npc-actor-import.md
//           + reply 2026-06-12-reply-monster-browser-npc-actor-import.md.
//
// The app side (monster-browser) reconstructs the full dnd5e v5 `npc` `system.*`
// shape and emits each stat-block trait/action as a `feat` Item whose
// `system.activities` is our SemanticActivity keyed-map. The module's job is
// **create-actor + reuse the EXISTING converter** — no new conversion code:
//   bundle -> Actor.create({ type:"npc", system, items }) where each item's
//   activities/effects run through normalizeSemanticActivityCollection /
//   normalizeSemanticItemEffects (the same path normalizeWorldItem uses for
//   items/feats/classes).
//
// OWNER REQUIREMENT: monster import is GM-ONLY and creates a WORLD `npc` actor.
// It is NEVER embedded onto a player's character sheet (players import Items,
// not monsters). So unlike the item/feat/spell importers (which target a
// selected actor), this importer's target is the world Actors directory.

import { MODULE_ID } from "./constants.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import {
  buildItemIdRemap,
  hasSemanticActivities,
  normalizeSemanticActivityCollection,
  normalizeSemanticItemEffects,
} from "./class-import-service.js";

export const MONSTER_BUNDLE_KIND = "dauligor.monster-actor.v1";

/**
 * Convert one bundle item (a `feat` Item carrying SemanticActivity) into a
 * Foundry-ready embedded item. Mirrors the activity/effect conversion in
 * `normalizeWorldItem` but WITHOUT the class/world-item flag machinery — an npc
 * stat-block item just needs its semantic activities + effects made native, and
 * to keep its section/provenance flags (`plutonium.page`, `dauligor-pairing`).
 */
export function normalizeMonsterItem(item) {
  const clone = foundry.utils.deepClone(item ?? {});
  delete clone._id;
  delete clone.id;
  delete clone.ownership;
  delete clone.sort;

  const activities = clone.system?.activities;
  if (activities && hasSemanticActivities(activities)) {
    // Same remap basis the feature/item paths use: keys from BOTH activities and
    // effects so an effect referenced by an activity keeps a stable rekeyed id.
    const idMaps = buildItemIdRemap({ activities, effects: clone.effects });
    const converted = normalizeSemanticActivityCollection(activities, idMaps);
    if (converted) clone.system.activities = converted;
    if (Array.isArray(clone.effects) && clone.effects.length) {
      clone.effects = normalizeSemanticItemEffects(clone.effects, idMaps);
    }
  }

  // Preserve the section tag (monsterTrait/Action/Bonus/Reaction/Legendary/Lair/
  // Regional via `flags.plutonium.page`) + tag our provenance. MODULE_ID is the
  // same `dauligor-pairing` namespace the bundle already writes, so merge.
  clone.flags ??= {};
  const ours = clone.flags[MODULE_ID] ?? {};
  clone.flags[MODULE_ID] = { entityKind: "monster-feature", ...ours };

  return clone;
}

/**
 * Assemble world-Actor creation data (`type:"npc"`) from a monster bundle.
 * `bundle.actor.system` is already in dnd5e v5 npc shape (the app reconstructed
 * it as the inverse of the export read); pass it through and only normalize the
 * embedded items' activities/effects. `prototypeToken` / `img` ride through when
 * present so the portrait + token land.
 */
export function buildMonsterActorData(bundle) {
  const src = bundle?.actor ?? {};
  const items = (Array.isArray(src.items) ? src.items : []).map(normalizeMonsterItem);

  const actorData = {
    name: src.name || "Imported Monster",
    type: "npc",
    system: foundry.utils.deepClone(src.system ?? {}),
    items,
    flags: foundry.utils.deepClone(src.flags ?? {}),
  };
  if (src.img) actorData.img = src.img;
  if (src.prototypeToken) actorData.prototypeToken = foundry.utils.deepClone(src.prototypeToken);

  // Provenance under our flag namespace: dbId = the original Foundry actor id
  // (so a re-export onto the same actor is matchable), plus the source slug.
  actorData.flags[MODULE_ID] = {
    ...(actorData.flags[MODULE_ID] ?? {}),
    entityKind: "monster",
    schemaVersion: 1,
    dbId: bundle?.dbId ?? actorData.flags[MODULE_ID]?.dbId ?? null,
    sourceId: bundle?.sourceId ?? actorData.flags[MODULE_ID]?.sourceId ?? null,
  };

  return actorData;
}

/**
 * Import a monster bundle as a WORLD `npc` Actor. GM-ONLY. Returns the created
 * Actor, or null on refusal/failure. Never embeds onto a player's sheet.
 *
 * @param {object} bundle - a `dauligor.monster-actor.v1` payload
 * @param {object} [opts]
 * @param {boolean} [opts.render=true] - open the new actor's sheet after import
 * @param {string|null} [opts.folder=null] - target Actors folder id
 */
export async function importMonsterActor(bundle, { render = true, folder = null } = {}) {
  if (!game.user?.isGM) {
    notifyWarn("Only a GM can import monsters — they create world NPC actors, not character-sheet items.");
    return null;
  }
  if (!bundle || typeof bundle !== "object" || bundle.kind !== MONSTER_BUNDLE_KIND) {
    notifyWarn(`Not a monster bundle (expected ${MONSTER_BUNDLE_KIND}).`);
    return null;
  }

  const actorData = buildMonsterActorData(bundle);
  if (folder) actorData.folder = folder;

  let actor;
  try {
    actor = await Actor.create(actorData);
  } catch (err) {
    console.error("[dauligor] monster import: Actor.create failed", err);
    notifyWarn(`Couldn't create the monster actor "${actorData.name}".`);
    return null;
  }
  if (!actor) {
    notifyWarn(`Monster import returned no actor for "${actorData.name}".`);
    return null;
  }

  // Phase 2 (deferred): bundle.spellcasting[] -> resolve each spell by identifier
  // from /api/module/<source>/spells.json and embed as `spell` Items (no dupe).
  // Non-casters have spellcasting: []. Tracked in the reply handoff.

  log(`Imported monster "${actor.name}" as an npc actor`, { id: actor.id, items: actorData.items.length });
  notifyInfo(`Imported "${actor.name}" as an NPC (${actorData.items.length} action/trait item(s)).`);
  if (render && actor.sheet) actor.sheet.render(true);
  return actor;
}

/**
 * Fetch a monster bundle by URL, then import it as a world npc (GM-only).
 * URL shape: `/api/module/<source>/monsters/<identifier>.json`.
 */
export async function importMonsterFromUrl(url, opts = {}) {
  if (!game.user?.isGM) {
    notifyWarn("Only a GM can import monsters.");
    return null;
  }
  let bundle;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = await res.json();
  } catch (err) {
    console.error("[dauligor] monster import: fetch failed", err);
    notifyWarn(`Couldn't fetch the monster bundle from ${url}.`);
    return null;
  }
  return importMonsterActor(bundle, opts);
}
