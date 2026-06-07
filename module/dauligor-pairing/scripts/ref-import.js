// On-demand import of compendium-backed references (Plutonium-style).
//
// A reference like `@spell[dispel-magic]` is a portal to an entity on the Dauligor
// site — it never needs the entity to already exist in this world, and it never
// dangles. Two interactions, mirroring how Foundry treats a content-link:
//   • CLICK → fetch the full Foundry-ready item and open it in a TEMPORARY item
//     sheet (the real dnd5e sheet, activities and all) — nothing is added to the
//     world, exactly like opening a compendium item's sheet.
//   • DRAG → the link carries the built item as a Foundry `{type:"Item", data}`
//     drop payload, so dropping it on an actor sheet (or the Items sidebar)
//     imports it through Foundry's own drop handling.
//
// The item data is the same `dauligor.spell-item.v1` payload the Spell importer
// uses (`/api/module/<kind>/<dbId>.json`, public/CORS-open), so both the preview
// sheet and the dropped item are fully functional (description, activities,
// materials). The slug→dbId step reuses `resolveReferences` (the authed query the
// hover card already runs).

import { resolveReferences } from "./content-service.js";
import { fetchJson } from "./class-import-service.js";
import { resolveApiHost } from "./auth-service.js";
import { log } from "./utils.js";

// Reference kinds we can build a Foundry item for → the public per-entity endpoint
// (`/api/module/<path>/<dbId>.json`), its payload `kind`, and the field holding the
// Foundry-ready item. Each is a Foundry Item, so the temp-sheet + drop flow is
// identical regardless of kind. Backgrounds + species (races) live in the feats
// table app-side, but export as Foundry `background`/`race` items here.
const IMPORT_ENDPOINTS = {
  spell:      { path: "spells",      payloadKind: "dauligor.spell-item.v1",      field: "spell" },
  item:       { path: "items",       payloadKind: "dauligor.item-item.v1",       field: "item" },
  background: { path: "backgrounds", payloadKind: "dauligor.background-item.v1", field: "background" },
  species:    { path: "races",       payloadKind: "dauligor.race-item.v1",       field: "race" },
  race:       { path: "races",       payloadKind: "dauligor.race-item.v1",       field: "race" },
  feat:       { path: "feats",       payloadKind: "dauligor.feat-item.v1",       field: "feat" },
};

export function isImportableKind(kind) {
  return Object.prototype.hasOwnProperty.call(IMPORT_ENDPOINTS, String(kind || ""));
}

// Built Foundry item data cached by `kind:id` (null = resolved-but-missing), so
// hover → drag → click never refetch the same entity.
const _itemCache = new Map();

export function clearReferenceItemCache() { _itemCache.clear(); }

/**
 * Resolve a reference's slug → DB id (authed query, same as the hover card), then
 * fetch the full Foundry-ready item from the public module endpoint. Returns the
 * item data object (suitable for `new Item(...)` / a drop payload) or null.
 */
export async function fetchReferencedItemData(kind, id) {
  const k = String(kind || "");
  const i = String(id || "");
  if (!isImportableKind(k) || !i) return null;
  const key = `${k}:${i}`;
  if (_itemCache.has(key)) return _itemCache.get(key);

  let data = null;
  try {
    const map = await resolveReferences([{ kind: k, id: i }]);
    const docId = map.get(key)?.docId;
    if (docId) {
      const cfg = IMPORT_ENDPOINTS[k];
      const url = `${resolveApiHost()}/api/module/${cfg.path}/${encodeURIComponent(docId)}.json`;
      const payload = await fetchJson(url);
      if (payload && payload.kind === cfg.payloadKind) {
        data = payload[cfg.field] ?? null;
      } else if (payload) {
        log(`ref-import: unexpected payload kind for ${key}`, payload?.kind);
      }
    }
  } catch (err) {
    log(`ref-import: fetch failed for ${key}`, err);
    data = null;
  }
  _itemCache.set(key, data);
  return data;
}

/** Warm the cache (called on hover) so a later drag/click is instant. */
export function prefetchReferencedItem(kind, id) {
  if (!isImportableKind(kind) || !id) return;
  const key = `${kind}:${id}`;
  if (_itemCache.has(key)) return;
  fetchReferencedItemData(kind, id).catch(() => {});
}

/** Synchronous cache read — used at `dragstart` (which can't await). */
export function getCachedReferencedItemData(kind, id) {
  return _itemCache.get(`${kind}:${id}`) ?? null;
}

// A fresh top-level id + no source audit flags — a clean throwaway for the temp
// preview / drop payload that can't collide with a world item of the same id.
function prepItemData(data) {
  const clone = foundry.utils.deepClone(data);
  clone._id = foundry.utils.randomID();
  return clone;
}

/**
 * CLICK: open the referenced item in a TEMPORARY sheet (not imported anywhere).
 * Returns true when handled (caller skips its website fallback), false to fall back.
 */
export async function openReferencedItem(kind, id) {
  if (!isImportableKind(kind)) return false;
  const data = await fetchReferencedItemData(kind, id);
  if (!data) return false;
  try {
    const ItemImpl = (globalThis.CONFIG?.Item?.documentClass) || globalThis.Item;
    if (!ItemImpl) return false;
    const temp = new ItemImpl(prepItemData(data));
    temp.sheet?.render(true);
    return true;
  } catch (err) {
    log(`ref-import: failed to open temp item for ${kind}:${id}`, err);
    return false;
  }
}

/**
 * CLICK for an `@class[…]` reference: open the standalone class-DETAIL window (the
 * shared ClassView — NOT a temp item, NOT the full creator). Dynamic import so this
 * module carries no static dependency on the detail app. Returns true when invoked.
 */
export async function openClassReference(id) {
  const cid = String(id || "");
  if (!cid) return false;
  try {
    const mod = await import("./class-detail-app.js");
    await mod.openDauligorClassDetail(cid);
    return true;
  } catch (err) {
    log("ref-import: openClassReference failed", err);
    return false;
  }
}

/**
 * Register the global drag handlers for reference links: enable dragging +
 * prefetch on hover (so the payload is ready at the synchronous `dragstart`), and
 * stamp the Foundry `{type:"Item", data}` payload on drag. Call once in `ready`.
 */
export function registerReferenceImports() {
  // Enable drag + warm the cache the moment the cursor enters an importable ref
  // (pointerover fires on entry, before any mousedown/drag).
  document.addEventListener("pointerover", (ev) => {
    const a = ev.target?.closest?.("a.dauligor-ref[data-ref-kind]");
    if (!a) return;
    const kind = a.dataset.refKind;
    if (!isImportableKind(kind) || !a.dataset.refId) return;
    if (!a.draggable) a.draggable = true;
    prefetchReferencedItem(kind, a.dataset.refId);
  });

  document.addEventListener("dragstart", (ev) => {
    const a = ev.target?.closest?.("a.dauligor-ref[data-ref-kind]");
    if (!a) return;
    const kind = a.dataset.refKind;
    const id = a.dataset.refId;
    if (!isImportableKind(kind) || !id) return;
    const data = getCachedReferencedItemData(kind, id);
    if (!data) return; // not prefetched yet — let the browser do its default
    try {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", data: prepItemData(data) }));
      ev.dataTransfer.effectAllowed = "copy";
    } catch (err) {
      log("ref-import: dragstart setData failed", err);
    }
  });

  log("Registered Dauligor reference imports (click-to-open + drag-to-import).");
}
