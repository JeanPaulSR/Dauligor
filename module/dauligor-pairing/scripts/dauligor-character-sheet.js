import { DAULIGOR_SPELLS_TAB_TEMPLATE, MODULE_ID } from "./constants.js";
import { openSpellPreparationManager } from "./spell-preparation-app.js";
import { log, notifyWarn } from "./utils.js";

// ─── Class-bundle cache (module-level singleton) ──────────────────────
// The alt sheet needs `class.spellcasting.spellsKnownLevels` (the per-
// level Spells Known scaling) to render "KNOWN  X/Y" on the per-class
// header. New imports stamp this onto the class item directly; older
// imports don't have it. Fetching the bundle at render time fills the
// gap for older imports — without forcing the user to re-import.
//
// Cache lives at module scope so multiple sheet instances (and the
// Prepare Spells manager later, if we choose to migrate it here) share
// the result. Entries:
//   { status: "loading" } | { status: "ready", spellcasting, payload }
//   | { status: "missing", reason } | { status: "error", reason }
const _classBundleCache = new Map();

/** Derive the bundle URL by stripping `/spells.json` off the live
 *  spell-list URL we already store on the class item. The decoupling
 *  refactor split the two endpoints (see project memory).
 */
function _resolveClassBundleUrl(classItem) {
  const spellListUrl = classItem?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
  if (!spellListUrl) return null;
  return String(spellListUrl).replace(/\/spells\.json(\?.*)?$/i, ".json");
}

/**
 * Kick (idempotently) a class-bundle fetch + cache. The `onReady`
 * callback fires once the entry transitions to `"ready"`; used by the
 * alt sheet to call `render()` so the next pass picks up the cap.
 *
 * Returns the current cache entry (which may still be `"loading"`).
 */
function ensureClassBundle(classIdentifier, classItem, onReady) {
  if (!classIdentifier) return null;
  const existing = _classBundleCache.get(classIdentifier);
  if (existing?.status === "ready") return existing;
  if (existing?.status === "loading") return existing;

  const bundleUrl = _resolveClassBundleUrl(classItem);
  if (!bundleUrl) {
    const entry = { status: "missing", reason: "No spellListUrl on class item" };
    _classBundleCache.set(classIdentifier, entry);
    return entry;
  }

  const loadingEntry = { status: "loading" };
  _classBundleCache.set(classIdentifier, loadingEntry);

  (async () => {
    try {
      const response = await fetch(bundleUrl, { cache: "no-store" });
      if (!response.ok) {
        _classBundleCache.set(classIdentifier, { status: "error", reason: `HTTP ${response.status}` });
      } else {
        const payload = await response.json();
        const spellcasting = payload?.class?.spellcasting ?? payload?.spellcasting ?? null;
        _classBundleCache.set(classIdentifier, { status: "ready", spellcasting, payload });
        if (typeof onReady === "function") {
          try { onReady(); } catch (err) { console.warn(`${MODULE_ID} | bundle onReady callback failed`, err); }
        }
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | class bundle fetch failed`, { bundleUrl, err });
      _classBundleCache.set(classIdentifier, { status: "error", reason: err?.message ?? "Network error" });
    }
  })();

  return loadingEntry;
}

/** Read the cached bundle's spellcasting block (or null). */
function getClassBundle(classIdentifier) {
  const entry = _classBundleCache.get(classIdentifier);
  return entry?.status === "ready" ? entry : null;
}

/**
 * Opt-in alt character sheet. Extends dnd5e v5.x's
 * `CharacterActorSheet` and overrides ONLY the Spells PART template
 * (and its data-prep hook) to render a Dauligor-styled Spells tab.
 * Every other PART (Inventory, Features, Effects, Biography, etc.)
 * inherits from the parent unchanged.
 *
 * Registration is `makeDefault: false` — the user opts in per-actor
 * via the sheet config picker (the cog button in the actor sheet
 * header → "Sheet Configuration" → "Dauligor Sheet (D&D 5e)").
 *
 * The subclass is built lazily inside the `init` hook because
 * `dnd5e.applications.actor.CharacterActorSheet` only exists after
 * the dnd5e system's own initialization runs. Defining the class at
 * module top-level would throw a TypeError on import.
 */

let _DauligorCharacterSheet = null;

// ─── Drop-data helpers ───────────────────────────────────────────────
// Used by the spell-row → section/folder drag-drop wiring. dnd5e (and
// Foundry core) drag items by setting a `text/plain` payload on the
// dataTransfer that contains a JSON document descriptor like
// `{"type":"Item","uuid":"Actor.<id>.Item.<id>"}`. We use the presence
// of `text/plain` as a heuristic during dragover (the data itself is
// not readable until drop for security reasons) and parse it on drop.

function _hasFoundryItemDrag(event) {
  const types = event?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("text/plain");
}

function _readDropData(event) {
  try {
    const text = event?.dataTransfer?.getData?.("text/plain");
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Custom-section helpers ──────────────────────────────────────────
// Custom sections are user-defined top-level groupings ("Racial",
// "Feat Spells", etc.) that override the default class grouping for
// any spell whose `flags.dauligor-pairing.customSectionId` matches.
// They persist on the actor flag `customSections: { id, name }[]`.
// Section ids look like `sec_<random>`; folder ids (phase 2) will be
// `fold_<random>`. Both use the same generator below.

const SECTION_ID_PREFIX = "sec_";

function generateSectionId() {
  return SECTION_ID_PREFIX + Math.random().toString(36).slice(2, 10);
}

function readCustomSections(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, "customSections") ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === "object" && typeof s.id === "string")
    .map((s) => ({ id: String(s.id), name: String(s.name ?? "Untitled Section") }));
}

async function writeCustomSections(actor, sections) {
  if (!actor) return;
  await actor.setFlag(MODULE_ID, "customSections", sections);
}

async function createCustomSection(actor, rawName) {
  if (!actor) return null;
  const name = String(rawName ?? "").trim();
  if (!name) return null;
  const existing = readCustomSections(actor);
  // Prevent duplicate names — return existing instead of creating.
  const dup = existing.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (dup) return dup;
  const next = [...existing, { id: generateSectionId(), name }];
  await writeCustomSections(actor, next);
  return next[next.length - 1];
}

async function renameCustomSection(actor, sectionId, rawName) {
  if (!actor || !sectionId) return false;
  const name = String(rawName ?? "").trim();
  if (!name) return false;
  const existing = readCustomSections(actor);
  const idx = existing.findIndex((s) => s.id === sectionId);
  if (idx < 0) return false;
  const next = existing.map((s, i) => (i === idx ? { ...s, name } : s));
  await writeCustomSections(actor, next);
  return true;
}

/**
 * Delete a custom section. Side effects:
 *   - Removes it from `customSections`.
 *   - Drops the folder list keyed under this section's id (folders
 *     can't outlive their parent).
 *   - Clears `customSectionId` / `customFolderId` on every spell that
 *     pointed into this section so they fall back to default
 *     grouping (one bulk `updateEmbeddedDocuments` call).
 */
async function deleteCustomSection(actor, sectionId) {
  if (!actor || !sectionId) return false;
  const sections = readCustomSections(actor).filter((s) => s.id !== sectionId);
  const allFolders = readCustomFolders(actor);
  const folderIdsInSection = new Set((allFolders[sectionId] ?? []).map((f) => f.id));
  const nextFolders = { ...allFolders };
  delete nextFolders[sectionId];

  // Clear spell assignments that referenced this section or any of
  // its folders (one batched item update).
  const spells = actor.itemTypes?.spell ?? [];
  const updates = [];
  for (const spell of spells) {
    const update = { _id: spell.id };
    let touched = false;
    if (spellCustomSectionId(spell) === sectionId) {
      update[`flags.${MODULE_ID}.-=customSectionId`] = null;
      touched = true;
    }
    const fid = spellCustomFolderId(spell);
    if (fid && folderIdsInSection.has(fid)) {
      update[`flags.${MODULE_ID}.-=customFolderId`] = null;
      touched = true;
    }
    if (touched) updates.push(update);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);

  await writeCustomFolders(actor, nextFolders);
  await writeCustomSections(actor, sections);
  return true;
}

function spellCustomSectionId(spell) {
  if (!spell) return null;
  const v = spell.getFlag?.(MODULE_ID, "customSectionId")
    ?? spell.flags?.[MODULE_ID]?.customSectionId
    ?? null;
  return v ? String(v) : null;
}

async function setSpellCustomSection(spell, sectionId) {
  if (!spell) return;
  if (sectionId) await spell.setFlag(MODULE_ID, "customSectionId", String(sectionId));
  else await spell.unsetFlag(MODULE_ID, "customSectionId");
}

/**
 * Prompt the user for a section name (Foundry DialogV2). Resolves to
 * the trimmed name string, or null if the user cancelled / submitted
 * an empty value.
 */
/**
 * Pick the next default name for a new section or folder.
 * Examples:
 *   existing = []                → "Folder"
 *   existing = [{name:"Folder"}] → "Folder 1"
 *   existing = ["Folder","Folder 1"] → "Folder 2"
 * Case-insensitive match against the existing names.
 */
function generateDefaultName(existing, base = "Folder") {
  const names = new Set(
    (Array.isArray(existing) ? existing : [])
      .map((e) => String(e?.name ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const lower = base.toLowerCase();
  if (!names.has(lower)) return base;
  let n = 1;
  while (names.has(`${lower} ${n}`)) n++;
  return `${base} ${n}`;
}

async function promptForSectionName({ title = "New Section", initial = "" } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return null;
  try {
    return await DialogV2.prompt({
      window: { title },
      content: `
        <div class="form-group">
          <label>Section name</label>
          <input type="text" name="dauligorSectionName" value="${foundry.utils.escapeHTML(initial)}" autofocus>
        </div>
      `,
      ok: {
        label: "Create",
        callback: (_event, button) => {
          // Multiple fallbacks: button.form, the closest <form>, then
          // a direct query — DialogV2's internal form wrapping has
          // shifted between Foundry minors. Whatever finds the input
          // wins. Returns the trimmed string ("" for empty input);
          // returning `null` here caused DialogV2 to substitute the
          // button's `action` value ("ok") into the resolved promise.
          const form = button?.form ?? button?.closest?.("form");
          const input = form?.elements?.namedItem?.("dauligorSectionName")
            ?? form?.querySelector?.('input[name="dauligorSectionName"]')
            ?? button?.closest?.(".application")?.querySelector?.('input[name="dauligorSectionName"]');
          return String(input?.value ?? "").trim();
        }
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

/**
 * Prompt the user to pick a destination for a spell — either one of
 * the actor's custom sections, OR "Default (by class)" which clears
 * the override. Resolves to:
 *   { kind: "custom",  sectionId: "sec_xxxx" }
 *   { kind: "default" }
 *   null  (cancelled)
 */
// ─── Custom-folder helpers ───────────────────────────────────────────
// Folders live INSIDE sections (class identifier OR custom section id
// OR "__other__"). They REPLACE level grouping for any spell whose
// `flags.dauligor-pairing.customFolderId` matches an existing folder
// in the spell's current section. Empty folders persist so the user
// can drag spells into them later (Phase 3).

const FOLDER_ID_PREFIX = "fold_";

function generateFolderId() {
  return FOLDER_ID_PREFIX + Math.random().toString(36).slice(2, 10);
}

/** Returns `{ [sectionId]: { id, name }[] }`. Defensive against malformed flag data. */
function readCustomFolders(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, "customFolders") ?? {};
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [sectionId, folders] of Object.entries(raw)) {
    if (!Array.isArray(folders)) continue;
    out[String(sectionId)] = folders
      .filter((f) => f && typeof f === "object" && typeof f.id === "string")
      .map((f) => ({ id: String(f.id), name: String(f.name ?? "Untitled Folder") }));
  }
  return out;
}

function readCustomFoldersForSection(actor, sectionId) {
  const all = readCustomFolders(actor);
  return all[String(sectionId)] ?? [];
}

async function writeCustomFolders(actor, folders) {
  if (!actor) return;
  await actor.setFlag(MODULE_ID, "customFolders", folders);
}

async function createCustomFolder(actor, sectionId, rawName) {
  if (!actor || !sectionId) return null;
  const name = String(rawName ?? "").trim();
  if (!name) return null;
  const all = readCustomFolders(actor);
  const existing = all[String(sectionId)] ?? [];
  const dup = existing.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (dup) return dup;
  const folder = { id: generateFolderId(), name };
  const next = { ...all, [String(sectionId)]: [...existing, folder] };
  await writeCustomFolders(actor, next);
  return folder;
}

async function renameCustomFolder(actor, sectionId, folderId, rawName) {
  if (!actor || !sectionId || !folderId) return false;
  const name = String(rawName ?? "").trim();
  if (!name) return false;
  const all = readCustomFolders(actor);
  const folders = all[String(sectionId)] ?? [];
  const idx = folders.findIndex((f) => f.id === folderId);
  if (idx < 0) return false;
  const nextFolders = folders.map((f, i) => (i === idx ? { ...f, name } : f));
  const next = { ...all, [String(sectionId)]: nextFolders };
  await writeCustomFolders(actor, next);
  return true;
}

async function deleteCustomFolder(actor, sectionId, folderId) {
  if (!actor || !sectionId || !folderId) return false;
  const all = readCustomFolders(actor);
  const folders = (all[String(sectionId)] ?? []).filter((f) => f.id !== folderId);
  const next = { ...all, [String(sectionId)]: folders };
  await writeCustomFolders(actor, next);
  // Clear customFolderId on every spell that pointed here.
  const spells = actor.itemTypes?.spell ?? [];
  const updates = spells
    .filter((spell) => spellCustomFolderId(spell) === folderId)
    .map((spell) => ({
      _id: spell.id,
      [`flags.${MODULE_ID}.-=customFolderId`]: null
    }));
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return true;
}

/** DialogV2 yes/no confirmation. Resolves to `true` if user clicked Yes. */
async function promptForConfirm({ title = "Are you sure?", message = "", yesLabel = "Confirm", noLabel = "Cancel" } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return false;
  try {
    return await DialogV2.confirm({
      window: { title },
      content: `<p>${foundry.utils.escapeHTML(message)}</p>`,
      yes: { label: yesLabel },
      no: { label: noLabel },
      rejectClose: false,
      modal: true
    });
  } catch {
    return false;
  }
}

function spellCustomFolderId(spell) {
  if (!spell) return null;
  const v = spell.getFlag?.(MODULE_ID, "customFolderId")
    ?? spell.flags?.[MODULE_ID]?.customFolderId
    ?? null;
  return v ? String(v) : null;
}

async function setSpellCustomFolder(spell, folderId) {
  if (!spell) return;
  if (folderId) await spell.setFlag(MODULE_ID, "customFolderId", String(folderId));
  else await spell.unsetFlag(MODULE_ID, "customFolderId");
}

async function promptForFolderName({ title = "New Folder", initial = "" } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return null;
  try {
    return await DialogV2.prompt({
      window: { title },
      content: `
        <div class="form-group">
          <label>Folder name</label>
          <input type="text" name="dauligorFolderName" value="${foundry.utils.escapeHTML(initial)}" autofocus>
        </div>
      `,
      ok: {
        label: "Create",
        callback: (_event, button) => {
          const form = button?.form ?? button?.closest?.("form");
          const input = form?.elements?.namedItem?.("dauligorFolderName")
            ?? form?.querySelector?.('input[name="dauligorFolderName"]')
            ?? button?.closest?.(".application")?.querySelector?.('input[name="dauligorFolderName"]');
          return String(input?.value ?? "").trim();
        }
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

/**
 * Prompt to move a spell into a folder. Resolves to:
 *   { kind: "folder", folderId: "fold_xxxx" }
 *   { kind: "default" }   — clear customFolderId (group by level)
 *   null                  — cancelled
 *
 * When the spell's current section has NO folders yet, the dialog
 * first prompts for a new folder name (one-step create + move).
 */
async function promptForMoveFolderDestination(actor, sectionId, { currentId = null } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return null;
  const folders = readCustomFoldersForSection(actor, sectionId);
  if (folders.length === 0) {
    const suggested = generateDefaultName(folders, "Folder");
    const result = await promptForFolderName({
      title: "Create First Folder",
      initial: suggested
    });
    if (result === null || result === undefined) return null;
    const name = String(result).trim() || suggested;
    const created = await createCustomFolder(actor, sectionId, name);
    return created ? { kind: "folder", folderId: created.id } : null;
  }
  const options = [
    `<option value="__default__"${!currentId ? " selected" : ""}>Default — by level</option>`,
    ...folders.map((f) =>
      `<option value="${foundry.utils.escapeHTML(f.id)}"${currentId === f.id ? " selected" : ""}>${foundry.utils.escapeHTML(f.name)}</option>`
    )
  ].join("");
  try {
    return await DialogV2.prompt({
      window: { title: "Move to Folder" },
      content: `
        <div class="form-group">
          <label>Folder</label>
          <select name="destination" autofocus>
            ${options}
          </select>
        </div>
      `,
      ok: {
        label: "Move",
        callback: (_event, button) => {
          const value = String(button.form?.elements?.destination?.value ?? "");
          if (!value || value === "__default__") return { kind: "default" };
          return { kind: "folder", folderId: value };
        }
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

async function promptForMoveSectionDestination(actor, { currentId = null } = {}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return null;
  const sections = readCustomSections(actor);
  const options = [
    `<option value="__default__"${!currentId ? " selected" : ""}>Default — by class</option>`,
    ...sections.map((s) =>
      `<option value="${foundry.utils.escapeHTML(s.id)}"${currentId === s.id ? " selected" : ""}>${foundry.utils.escapeHTML(s.name)}</option>`
    )
  ].join("");
  try {
    return await DialogV2.prompt({
      window: { title: "Move to Section" },
      content: `
        <div class="form-group">
          <label>Section</label>
          <select name="destination" autofocus>
            ${options}
          </select>
        </div>
      `,
      ok: {
        label: "Move",
        callback: (_event, button) => {
          const value = String(button.form?.elements?.destination?.value ?? "");
          if (!value || value === "__default__") return { kind: "default" };
          return { kind: "custom", sectionId: value };
        }
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

/**
 * Build (or return the cached) DauligorCharacterSheet subclass.
 * Returns null if the dnd5e namespace isn't available yet, so callers
 * can gracefully skip registration on non-dnd5e worlds.
 */
function buildDauligorCharacterSheetClass() {
  if (_DauligorCharacterSheet) return _DauligorCharacterSheet;

  const Base = globalThis.dnd5e?.applications?.actor?.CharacterActorSheet;
  if (!Base) {
    log("dnd5e.applications.actor.CharacterActorSheet not found — skipping Dauligor Sheet registration");
    return null;
  }

  class DauligorCharacterSheet extends Base {
    // Merge our additions into the parent's static config. dnd5e
    // declares each PART with a template path and a templates[]
    // preload list — we keep both, swap only the top-level template
    // path for the spells PART. The container/scrollable settings on
    // the parent's spells PART are preserved by spreading.
    static PARTS = {
      ...Base.PARTS,
      spells: {
        ...Base.PARTS.spells,
        template: DAULIGOR_SPELLS_TAB_TEMPLATE,
        // Keep the parent's `templates[]` preload list so the inline
        // partials (inventory.hbs, activity.hbs) stay resolvable if
        // we choose to use them inside our template. Adding our own
        // template path is harmless — preload is idempotent.
        templates: [
          ...(Array.isArray(Base.PARTS.spells.templates) ? Base.PARTS.spells.templates : []),
          DAULIGOR_SPELLS_TAB_TEMPLATE
        ]
      }
    };

    static DEFAULT_OPTIONS = {
      classes: ["dauligor-character-sheet"],
      actions: {
        // Open the Dauligor Prepare Spells manager pre-selected to
        // the class clicked. Action handler `this` is the sheet
        // instance per ApplicationV2 conventions.
        dauligorPrepareClassSpells: async function (event, target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          if (!actor) return;
          // Prefer a class identifier embedded on the button itself
          // (template stamps it). Fallback: match by ability if the
          // identifier wasn't available at render time (defensive).
          let identifier = target?.dataset?.classIdentifier ?? null;
          if (!identifier) {
            const ability = target?.dataset?.ability;
            const classes = actor.spellcastingClasses ?? {};
            const matches = Object.entries(classes).filter(([, cls]) =>
              String(cls?.system?.spellcasting?.ability ?? "") === ability
            );
            if (matches.length === 1) identifier = matches[0][0];
          }
          if (!identifier) {
            await openSpellPreparationManager(actor);
            return;
          }
          await openSpellPreparationManager(actor, { preselectClassIdentifier: identifier });
        },

        // Toggle expand/collapse of a class section in the Spells
        // tab. State is persisted on the actor as
        // `flags.dauligor-pairing.collapsedClasses` (a string[] of
        // collapsed class identifiers) so the user's preference
        // survives re-renders, sheet close/reopen, and game reload.
        dauligorToggleClassGroup: async function (event, target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          const identifier = target?.dataset?.classIdentifier;
          if (!actor || !identifier) return;
          const raw = actor.getFlag(MODULE_ID, "collapsedClasses") ?? [];
          const set = new Set(Array.isArray(raw) ? raw.map(String) : []);
          if (set.has(identifier)) set.delete(identifier);
          else set.add(identifier);
          await actor.setFlag(MODULE_ID, "collapsedClasses", [...set]);
        },

        // Toggle expand/collapse of an individual level section
        // (e.g. Bard's Cantrips, Wizard's 1st Level) inside a class
        // group. Persisted as
        // `flags.dauligor-pairing.collapsedSections` (string[] of
        // "<classIdentifier>-<level>" keys).
        dauligorToggleSection: async function (event, target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          const sectionKey = target?.dataset?.sectionKey;
          if (!actor || !sectionKey) return;
          const raw = actor.getFlag(MODULE_ID, "collapsedSections") ?? [];
          const set = new Set(Array.isArray(raw) ? raw.map(String) : []);
          if (set.has(sectionKey)) set.delete(sectionKey);
          else set.add(sectionKey);
          await actor.setFlag(MODULE_ID, "collapsedSections", [...set]);
        },

        // Create a new user-defined custom section. Opens a small
        // dialog for the name, appends an entry to
        // `flags.dauligor-pairing.customSections`, and re-renders.
        // The dialog pre-fills the next available default name
        // ("Section", "Section 1", "Section 2", …); leaving it empty
        // and submitting still creates the folder under that name.
        dauligorCreateSection: async function (event, _target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          if (!actor) return;
          const existing = readCustomSections(actor);
          const suggested = generateDefaultName(existing, "Section");
          const result = await promptForSectionName({
            title: "New Spell Section",
            initial: suggested
          });
          if (result === null || result === undefined) return;
          const name = String(result).trim() || suggested;
          await createCustomSection(actor, name);
        },

        // Open the move-to-section picker for the spell whose row
        // was right-clicked. The action is dispatched from the
        // ContextMenu5e entry wired in `_attachPartListeners`.
        dauligorMoveSpellToSection: async function (event, target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          const itemId = target?.closest?.(".item")?.dataset?.itemId
            ?? target?.dataset?.itemId;
          if (!actor || !itemId) return;
          const spell = actor.items?.get?.(itemId);
          if (!spell || spell.type !== "spell") return;
          const result = await promptForMoveSectionDestination(actor, {
            currentId: spellCustomSectionId(spell)
          });
          if (!result) return;
          if (result.kind === "default") {
            await setSpellCustomSection(spell, null);
          } else if (result.kind === "custom") {
            await setSpellCustomSection(spell, result.sectionId);
          }
        },

        // Right-clicked section header → "Add Folder…" → creates a
        // new folder bound to that section. Reserved as a direct
        // `data-action` dispatch target; the actual UI flow lives in
        // the ContextMenu callback in `_attachSectionHeaderContextMenu`.
        dauligorAddFolder: async function (event, target) {
          event.preventDefault();
          event.stopPropagation();
          const actor = this.document;
          const sectionId = target?.closest?.(".dauligor-character-sheet__class-group")?.dataset?.classIdentifier
            ?? target?.dataset?.classIdentifier;
          if (!actor || !sectionId) return;
          const existing = readCustomFoldersForSection(actor, sectionId);
          const suggested = generateDefaultName(existing, "Folder");
          const result = await promptForFolderName({ title: "New Folder", initial: suggested });
          if (result === null || result === undefined) return;
          const name = String(result).trim() || suggested;
          await createCustomFolder(actor, sectionId, name);
        }
      }
    };

    /**
     * After the spells PART renders, wire native HTML5 drag-and-drop
     * onto each class group header so the user can reorder class
     * sections by dragging them. We don't use the `▲ ▼` arrow
     * pattern — Foundry's own UI uses native dragdrop for sortable
     * lists (inventory items, etc.) and we follow the same idiom.
     *
     * The "__other__" bucket is skipped (not draggable, not droppable)
     * because it's always pinned to the bottom by the renderer.
     */
    _attachPartListeners(partId, htmlElement, options) {
      super._attachPartListeners(partId, htmlElement, options);
      if (partId !== "spells") return;

      // For every class-group section:
      //   - Drag SOURCE = header (only for reorderable sections —
      //     "__other__" is pinned and can't move).
      //   - Drop TARGET = whole section + each items-section card.
      //     Spell drops are accepted on any section including
      //     "__other__"; the section's drag handlers gate class
      //     reorder vs spell drop based on `_dauligorDraggingClass`.
      const groups = htmlElement.querySelectorAll?.(".dauligor-character-sheet__class-group");
      for (const section of groups ?? []) {
        const identifier = section?.dataset?.classIdentifier;
        if (!identifier) continue;

        if (identifier !== "__other__") {
          const header = section.querySelector(".dauligor-character-sheet__class-group-header");
          if (header) {
            header.setAttribute("draggable", "true");
            header.addEventListener("dragstart", (event) => this._onClassDragStart(event, identifier));
            header.addEventListener("dragend",   (event) => this._onClassDragEnd(event));
          }
        }

        section.addEventListener("dragenter", (event) => this._onClassDragEnter(event, section, identifier));
        section.addEventListener("dragover",  (event) => this._onClassDragOver(event, section, identifier));
        section.addEventListener("dragleave", (event) => this._onClassDragLeave(event, section));
        section.addEventListener("drop",      (event) => this._onClassDrop(event, section, identifier));

        // Per-level / per-folder spell-drop targets. The card's
        // handler stopPropagations so the parent section's drop
        // doesn't also fire. Folder cards ALSO act as drag sources
        // (folder reorder) — see the folder-header attach below.
        const cards = section.querySelectorAll(".items-section.card");
        for (const card of cards) {
          card.addEventListener("dragenter", (event) => this._onItemsSectionDragEnter(event, card));
          card.addEventListener("dragover",  (event) => this._onItemsSectionDragOver(event, card));
          card.addEventListener("dragleave", (event) => this._onItemsSectionDragLeave(event, card));
          card.addEventListener("drop",      (event) => this._onItemsSectionDrop(event, card, identifier));
        }

        // Folder reorder — make folder headers draggable so the user
        // can rearrange folders within a section. The drag SOURCE is
        // each folder card's `.items-header` strip; the drop TARGET
        // is any items-section card in the SAME section (the card
        // handlers above already accept folder drags via the
        // `_dauligorDraggingFolder` instance flag).
        const folderHeaders = section.querySelectorAll(
          ".items-section.card[data-section-kind=\"folder\"] .items-header"
        );
        for (const header of folderHeaders) {
          const card = header.closest(".items-section.card");
          const folderId = card?.dataset?.folderId;
          if (!folderId) continue;
          header.setAttribute("draggable", "true");
          header.addEventListener("dragstart", (event) =>
            this._onFolderDragStart(event, identifier, folderId)
          );
          header.addEventListener("dragend", (event) => this._onFolderDragEnd(event, card));
        }
      }

      // Right-click on a section header → "Add Folder..." via
      // dnd5e's ContextMenu5e (extends Foundry's ContextMenu with
      // proper fixed positioning + theming). We use the dnd5e
      // pattern: pass [] for menuItems and populate via `onOpen`
      // by mutating `ui.context.menuItems`.
      //
      // Right-click on a SPELL ROW is NOT attached here — dnd5e
      // already attaches a context menu to inventory items, and our
      // entries are appended via the `dnd5e.getItemContextOptions`
      // hook (registered once at module load by
      // `registerDauligorCharacterSheet`).
      this._attachSectionHeaderContextMenu(htmlElement);
    }

    _attachSectionHeaderContextMenu(htmlElement) {
      const ContextMenu5e = globalThis.dnd5e?.applications?.ContextMenu5e
        ?? foundry.applications?.ux?.ContextMenu;
      if (!ContextMenu5e) return;
      try {
        new ContextMenu5e(
          htmlElement,
          ".dauligor-character-sheet__class-group-header",
          [],
          {
            jQuery: false,
            onOpen: (target) => {
              const section = target?.closest?.(".dauligor-character-sheet__class-group");
              const sectionId = section?.dataset?.classIdentifier;
              if (!sectionId || sectionId === "__other__") {
                ui.context.menuItems = [];
                return;
              }
              const actor = this.document;
              const customSections = readCustomSections(actor);
              const customSection = customSections.find((s) => s.id === sectionId);
              const isCustom = !!customSection;

              const items = [];
              // Add Folder — available on both class + custom sections.
              items.push({
                name: "Add Folder…",
                icon: '<i class="fas fa-folder-plus"></i>',
                callback: async () => {
                  const existing = readCustomFoldersForSection(actor, sectionId);
                  const suggested = generateDefaultName(existing, "Folder");
                  const result = await promptForFolderName({
                    title: "New Folder",
                    initial: suggested
                  });
                  if (result === null || result === undefined) return;
                  const name = String(result).trim() || suggested;
                  await createCustomFolder(actor, sectionId, name);
                }
              });
              // Rename / Delete — custom sections only. Class
              // sections take their name from the class item itself
              // and can't be deleted from this menu.
              if (isCustom) {
                items.push({
                  name: "Rename Section…",
                  icon: '<i class="fas fa-pen"></i>',
                  callback: async () => {
                    const result = await promptForSectionName({
                      title: "Rename Section",
                      initial: customSection.name
                    });
                    if (result === null || result === undefined) return;
                    const name = String(result).trim();
                    // Rename: empty submission is rejected (keep
                    // the current name). The user can still cancel
                    // the dialog if they didn't mean to rename.
                    if (!name) return;
                    await renameCustomSection(actor, sectionId, name);
                  }
                });
                items.push({
                  name: "Delete Section…",
                  icon: '<i class="fas fa-trash"></i>',
                  callback: async () => {
                    const ok = await promptForConfirm({
                      title: "Delete Section",
                      message: `Delete "${customSection.name}"? Spells inside will fall back to their default class grouping; any folders this section contained will be removed.`,
                      yesLabel: "Delete"
                    });
                    if (!ok) return;
                    await deleteCustomSection(actor, sectionId);
                  }
                });
              }
              ui.context.menuItems = items;
            }
          }
        );
      } catch (err) {
        console.warn(`${MODULE_ID} | section-header ContextMenu attach failed`, err);
      }
      this._attachFolderHeaderContextMenu(htmlElement);
    }

    _attachFolderHeaderContextMenu(htmlElement) {
      const ContextMenu5e = globalThis.dnd5e?.applications?.ContextMenu5e
        ?? foundry.applications?.ux?.ContextMenu;
      if (!ContextMenu5e) return;
      try {
        new ContextMenu5e(
          htmlElement,
          // Restrict to the `.items-header` strip of folder cards
          // only. The `.item-list` (spell rows) is a sibling, so
          // right-clicking a spell row never lands on this menu —
          // dnd5e's spell-item menu (with our hook-injected entries)
          // owns those.
          ".items-section.card[data-section-kind=\"folder\"] .items-header",
          [],
          {
            jQuery: false,
            onOpen: (target) => {
              const card = target?.closest?.(".items-section.card");
              const sectionGroup = target?.closest?.(".dauligor-character-sheet__class-group");
              const folderId = card?.dataset?.folderId;
              const sectionId = sectionGroup?.dataset?.classIdentifier;
              if (!folderId || !sectionId) {
                ui.context.menuItems = [];
                return;
              }
              const actor = this.document;
              const folders = readCustomFoldersForSection(actor, sectionId);
              const folder = folders.find((f) => f.id === folderId);
              if (!folder) {
                ui.context.menuItems = [];
                return;
              }
              ui.context.menuItems = [
                {
                  name: "Rename Folder…",
                  icon: '<i class="fas fa-pen"></i>',
                  callback: async () => {
                    const result = await promptForFolderName({
                      title: "Rename Folder",
                      initial: folder.name
                    });
                    if (result === null || result === undefined) return;
                    const name = String(result).trim();
                    if (!name) return; // rename rejects empty input
                    await renameCustomFolder(actor, sectionId, folderId, name);
                  }
                },
                {
                  name: "Delete Folder…",
                  icon: '<i class="fas fa-trash"></i>',
                  callback: async () => {
                    const ok = await promptForConfirm({
                      title: "Delete Folder",
                      message: `Delete folder "${folder.name}"? Spells inside will fall back to level grouping in this section.`,
                      yesLabel: "Delete"
                    });
                    if (!ok) return;
                    await deleteCustomFolder(actor, sectionId, folderId);
                  }
                }
              ];
            }
          }
        );
      } catch (err) {
        console.warn(`${MODULE_ID} | folder-header ContextMenu attach failed`, err);
      }
    }

    _onClassDragStart(event, identifier) {
      // Allow drag from anywhere on the header EXCEPT the Prepare
      // book button (its click handler opens the manager).
      if (event.target?.closest?.(".dauligor-class-prepare-button")) {
        event.preventDefault();
        return;
      }
      // Track the dragged identifier on the sheet instance — the
      // standard Foundry pattern for in-sheet reorders. We don't
      // depend on `dataTransfer.types` in `dragover` because (a)
      // some browsers handle custom MIME types inconsistently
      // during the dragover phase and (b) Foundry's sheet-level
      // drag listeners may interfere. We still write `text/plain`
      // so the browser treats it as a valid drag operation.
      this._dauligorDraggingClass = identifier;
      try {
        event.dataTransfer.setData("text/plain", `dauligor-class:${identifier}`);
        event.dataTransfer.effectAllowed = "move";
      } catch { /* dataTransfer can throw in odd contexts; ignore */ }
      event.currentTarget.classList.add("is-dragging");
    }

    _onClassDragEnd(event) {
      event.currentTarget.classList.remove("is-dragging");
      this._dauligorDraggingClass = null;
      // Clear any lingering drop indicators (in case dragleave
      // didn't fire — happens when dropping off-canvas).
      const root = this._getRootElement?.() ?? this.element;
      root?.querySelectorAll?.(".dauligor-character-sheet__class-group.is-drop-above, .dauligor-character-sheet__class-group.is-drop-below")
        .forEach((el) => el.classList.remove("is-drop-above", "is-drop-below"));
    }

    _onClassDragEnter(event, section, targetIdentifier) {
      // Three drag kinds can reach this element:
      //   - Class reorder (`_dauligorDraggingClass` set)
      //   - Folder reorder (`_dauligorDraggingFolder` set) — handled
      //     by the inner items-section card; we bail here.
      //   - Spell drop (Foundry item drag with text/plain payload)
      if (this._dauligorDraggingFolder) return;
      if (this._dauligorDraggingClass || _hasFoundryItemDrag(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    _onClassDragOver(event, section, targetIdentifier) {
      // Folder-reorder drags are owned by the inner items-section
      // card handler; bail so the event doesn't accidentally mark the
      // whole class section as a drop target.
      if (this._dauligorDraggingFolder) return;
      // ── Class-reorder drag ──
      if (this._dauligorDraggingClass) {
        // Reject reorder drops onto the pinned "Other Spells" bucket.
        if (targetIdentifier === "__other__") {
          section.classList.remove("is-drop-above", "is-drop-below");
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        if (targetIdentifier === this._dauligorDraggingClass) {
          section.classList.remove("is-drop-above", "is-drop-below");
          return;
        }
        const rect = section.getBoundingClientRect();
        const isAbove = event.clientY < rect.top + rect.height / 2;
        section.classList.toggle("is-drop-above", isAbove);
        section.classList.toggle("is-drop-below", !isAbove);
        const root = this._getRootElement?.() ?? this.element;
        root?.querySelectorAll?.(".dauligor-character-sheet__class-group.is-drop-above, .dauligor-character-sheet__class-group.is-drop-below")
          .forEach((el) => {
            if (el !== section) el.classList.remove("is-drop-above", "is-drop-below");
          });
        return;
      }
      // ── Spell drop ──
      // The inner `.items-section.card` has its own dragover handler
      // that calls stopPropagation; we only see drags that fall in
      // the section's gaps (above first level, between cards, in the
      // header strip). Those drops resolve to "section default
      // grouping" (folderId = null).
      if (!_hasFoundryItemDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      section.classList.add("is-spell-drop-target");
    }

    _onClassDragLeave(event, section) {
      // dragleave fires when entering a CHILD too — only clear the
      // indicators when leaving the section entirely. relatedTarget
      // points at the element being entered; if it's still inside
      // the section, suppress the clear.
      if (event.relatedTarget && section.contains(event.relatedTarget)) return;
      section.classList.remove("is-drop-above", "is-drop-below", "is-spell-drop-target");
    }

    async _onClassDrop(event, section, targetIdentifier) {
      // Folder reorders are handled by the items-section card.
      if (this._dauligorDraggingFolder) return;
      // ── Class-reorder drop ──
      if (this._dauligorDraggingClass) {
        // Reject reorder drops onto "Other Spells" (no class-reorder
        // semantics there; the bucket is always last).
        if (targetIdentifier === "__other__") return;
        const draggedIdentifier = this._dauligorDraggingClass;
        event.preventDefault();
        event.stopPropagation();
        this._dauligorDraggingClass = null;
        const isAbove = section.classList.contains("is-drop-above");
        section.classList.remove("is-drop-above", "is-drop-below");
        if (draggedIdentifier === targetIdentifier) return;
        await this._reorderClassRelativeToTarget(
          draggedIdentifier,
          targetIdentifier,
          isAbove ? "before" : "after"
        );
        return;
      }
      // ── Spell drop on section (no specific folder/level) ──
      if (!_hasFoundryItemDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      section.classList.remove("is-spell-drop-target");
      await this._assignSpellFromDrop(event, targetIdentifier, /* folderId */ null);
    }

    /**
     * Drop-target handlers for `.items-section.card`. Three drag
     * kinds can arrive:
     *   1. Folder reorder (our `_dauligorDraggingFolder` flag set).
     *      Only accepted on folder cards in the SAME section.
     *   2. Spell drop (Foundry item drag).
     *   3. Class reorder (handled by the parent section's handler;
     *      we explicitly bail so it bubbles).
     */
    _onItemsSectionDragEnter(event, card) {
      if (this._dauligorDraggingClass) return;
      if (this._dauligorDraggingFolder) {
        if (this._isFolderDropTarget(card)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (!_hasFoundryItemDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    _onItemsSectionDragOver(event, card) {
      if (this._dauligorDraggingClass) return;
      // ── Folder reorder ──
      if (this._dauligorDraggingFolder) {
        if (!this._isFolderDropTarget(card)) {
          card.classList.remove("is-drop-above", "is-drop-below");
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        if (card.dataset?.folderId === this._dauligorDraggingFolder.folderId) {
          card.classList.remove("is-drop-above", "is-drop-below");
          return;
        }
        const rect = card.getBoundingClientRect();
        const isAbove = event.clientY < rect.top + rect.height / 2;
        card.classList.toggle("is-drop-above", isAbove);
        card.classList.toggle("is-drop-below", !isAbove);
        // Clear above/below on every OTHER card in the same section
        // so only the active target shows the line.
        const sectionGroup = card.closest(".dauligor-character-sheet__class-group");
        sectionGroup?.querySelectorAll?.(".items-section.card.is-drop-above, .items-section.card.is-drop-below")
          .forEach((el) => {
            if (el !== card) el.classList.remove("is-drop-above", "is-drop-below");
          });
        return;
      }
      // ── Spell drop ──
      if (!_hasFoundryItemDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("is-spell-drop-target");
    }

    _onItemsSectionDragLeave(event, card) {
      if (event.relatedTarget && card.contains(event.relatedTarget)) return;
      card.classList.remove("is-spell-drop-target", "is-drop-above", "is-drop-below");
    }

    async _onItemsSectionDrop(event, card, parentIdentifier) {
      if (this._dauligorDraggingClass) return;
      // ── Folder reorder ──
      if (this._dauligorDraggingFolder) {
        const dragged = this._dauligorDraggingFolder;
        if (!this._isFolderDropTarget(card)) return;
        event.preventDefault();
        event.stopPropagation();
        this._dauligorDraggingFolder = null;
        const targetFolderId = card.dataset?.folderId;
        const isAbove = card.classList.contains("is-drop-above");
        card.classList.remove("is-drop-above", "is-drop-below");
        if (!targetFolderId || targetFolderId === dragged.folderId) return;
        await this._reorderFolderRelativeToTarget(
          dragged.sectionId,
          dragged.folderId,
          targetFolderId,
          isAbove ? "before" : "after"
        );
        return;
      }
      // ── Spell drop ──
      if (!_hasFoundryItemDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("is-spell-drop-target");
      const folderId = card.dataset?.folderId ?? null;
      await this._assignSpellFromDrop(event, parentIdentifier, folderId);
    }

    /**
     * Is this items-section card a valid drop target for the current
     * folder-reorder drag? Must be a folder card in the SAME section.
     */
    _isFolderDropTarget(card) {
      if (!this._dauligorDraggingFolder) return false;
      if (card.dataset?.sectionKind !== "folder") return false;
      if (!card.dataset?.folderId) return false;
      const sectionGroup = card.closest(".dauligor-character-sheet__class-group");
      const sectionId = sectionGroup?.dataset?.classIdentifier;
      return sectionId === this._dauligorDraggingFolder.sectionId;
    }

    _onFolderDragStart(event, sectionId, folderId) {
      // Don't pick up drags that started on the section toggle button
      // (the collapse caret) — that has its own click behavior.
      if (event.target?.closest?.(".dauligor-character-sheet__section-toggle")) {
        event.preventDefault();
        return;
      }
      // Spell rows inside the folder ARE draggable; the browser fires
      // dragstart on the row itself, not the header, so this handler
      // doesn't fire for spell drags. Defensive belt-and-braces:
      // bail if the target is somewhere inside the item-list.
      if (event.target?.closest?.(".item-list")) {
        event.preventDefault();
        return;
      }
      this._dauligorDraggingFolder = { sectionId, folderId };
      try {
        event.dataTransfer.setData("text/plain", `dauligor-folder:${folderId}`);
        event.dataTransfer.effectAllowed = "move";
      } catch { /* noop */ }
      const card = event.currentTarget?.closest?.(".items-section.card");
      card?.classList?.add("is-dragging");
    }

    _onFolderDragEnd(event, card) {
      card?.classList?.remove("is-dragging");
      this._dauligorDraggingFolder = null;
      const root = this._getRootElement?.() ?? this.element;
      root?.querySelectorAll?.(".items-section.card.is-drop-above, .items-section.card.is-drop-below")
        .forEach((el) => el.classList.remove("is-drop-above", "is-drop-below"));
    }

    async _reorderFolderRelativeToTarget(sectionId, draggedFolderId, targetFolderId, placement) {
      const actor = this.document;
      if (!actor) return;
      const all = readCustomFolders(actor);
      const folders = [...(all[String(sectionId)] ?? [])];
      const draggedIdx = folders.findIndex((f) => f.id === draggedFolderId);
      if (draggedIdx < 0) return;
      const dragged = folders[draggedIdx];
      folders.splice(draggedIdx, 1);
      let targetIdx = folders.findIndex((f) => f.id === targetFolderId);
      if (targetIdx < 0) return;
      if (placement === "after") targetIdx += 1;
      folders.splice(targetIdx, 0, dragged);
      const next = { ...all, [String(sectionId)]: folders };
      await writeCustomFolders(actor, next);
    }

    /**
     * Parse the Foundry item drag payload from the drop event and
     * assign the dropped spell to the target section + folder by
     * updating `customSectionId` / `customFolderId` on the spell.
     *
     * Rejects:
     *   - non-spell items
     *   - spells from other actors / compendium drops (could be
     *     supported later by re-importing; not in scope here)
     *   - folder ids that don't belong to the target section
     */
    async _assignSpellFromDrop(event, targetSectionId, targetFolderId) {
      const data = _readDropData(event);
      if (!data?.uuid) return;
      let doc;
      try {
        doc = await fromUuid(data.uuid);
      } catch {
        return;
      }
      if (!doc || doc.documentName !== "Item" || doc.type !== "spell") return;
      const actor = this.document;
      if (doc.parent !== actor) return;

      const customSections = readCustomSections(actor);
      const customSet = new Set(customSections.map((s) => s.id));
      // Spells dropped on a custom section get the override flag;
      // drops on class or "__other__" headers clear it (so default
      // class attribution decides).
      const nextSectionId = customSet.has(targetSectionId) ? targetSectionId : null;

      // Validate the folder belongs to the target section. If not,
      // the drop clears the folder assignment (level grouping).
      let nextFolderId = null;
      if (targetFolderId) {
        const folders = readCustomFoldersForSection(actor, targetSectionId);
        if (folders.some((f) => f.id === targetFolderId)) {
          nextFolderId = targetFolderId;
        }
      }

      await setSpellCustomSection(doc, nextSectionId);
      await setSpellCustomFolder(doc, nextFolderId);
    }

    async _reorderClassRelativeToTarget(draggedId, targetId, placement) {
      const actor = this.document;
      if (!actor) return;
      const spellcastingClasses = actor.spellcastingClasses ?? {};
      const knownIds = Object.keys(spellcastingClasses);
      const savedRaw = actor.getFlag(MODULE_ID, "classOrder") ?? [];
      const saved = (Array.isArray(savedRaw) ? savedRaw : [])
        .map(String)
        .filter((id) => knownIds.includes(id));
      const missing = knownIds
        .filter((id) => !saved.includes(id))
        .sort((a, b) =>
          String(spellcastingClasses[a]?.name ?? "")
            .localeCompare(String(spellcastingClasses[b]?.name ?? ""))
        );
      const order = [...saved, ...missing];

      const draggedIdx = order.indexOf(draggedId);
      if (draggedIdx < 0) return;
      order.splice(draggedIdx, 1);
      let targetIdx = order.indexOf(targetId);
      if (targetIdx < 0) return;
      if (placement === "after") targetIdx += 1;
      order.splice(targetIdx, 0, draggedId);

      await actor.setFlag(MODULE_ID, "classOrder", order);
    }

    /**
     * Spells-PART context override. dnd5e's `_prepareSpellsContext`
     * (inherited from `BaseActorSheet`) sets `context.sections` to a
     * level-grouped array via `Inventory.prepareSections`. We let it
     * run unchanged so `<item-list-controls>` keeps operating over
     * the full spell pool, then add Dauligor-specific data:
     *
     *   - dauligor.classIdentifierByAbility — map "cha" → "bard" so
     *     the spellcasting-card template stamps the right identifier
     *     onto each per-class Prepare button.
     *   - dauligor.classGroups — re-buckets `context.sections` so the
     *     template can render Class → Level → Spells instead of dnd5e's
     *     default Level → Spells (mixing classes). Sections inside a
     *     class group preserve the original section fields (label,
     *     dataset, columns, pips) so dnd5e's row rendering works
     *     identically; we just narrow `.items` to the spells whose
     *     `system.classIdentifier` (or our flag) matches the class.
     */
    async _prepareSpellsContext(context, options) {
      const result = await super._prepareSpellsContext(context, options);
      // BaseActorSheet returns `context`; defensive in case dnd5e
      // ever switches to returning a fresh object.
      const ctx = result ?? context;

      const actor = this.document;
      const spellcastingClasses = actor?.spellcastingClasses ?? {};

      // --- classIdentifierByAbility for the spellcasting cards ---
      const classIdentifierByAbility = {};
      for (const [identifier, classItem] of Object.entries(spellcastingClasses)) {
        const ability = String(classItem?.system?.spellcasting?.ability ?? "").trim();
        if (ability && !classIdentifierByAbility[ability]) {
          classIdentifierByAbility[ability] = identifier;
        }
      }

      // --- Custom sections + folders (user-defined buckets) -----
      // Sections override class grouping; folders override level
      // grouping inside a section. Both are persisted as named
      // buckets — empty ones still render so the user has a drop
      // target.
      const customSections = readCustomSections(actor);
      const customSectionsById = new Map(customSections.map((s) => [s.id, s]));
      const customFolders = readCustomFolders(actor);
      // folderById["fold_xxx"] = { id, name, sectionId, order }
      const folderById = new Map();
      for (const [secId, folders] of Object.entries(customFolders)) {
        folders.forEach((f, order) =>
          folderById.set(f.id, { ...f, sectionId: String(secId), order })
        );
      }

      // --- Determine which section bucket a spell belongs in ------
      const classOfSpell = (item) => {
        // First check: explicit custom-section override (only if the
        // referenced section still exists — stale flag falls through).
        const customId = item?.getFlag?.(MODULE_ID, "customSectionId")
          ?? item?.flags?.[MODULE_ID]?.customSectionId;
        if (customId && customSectionsById.has(String(customId))) {
          return String(customId);
        }
        // Module flag for class attribution is primary; falls back
        // to dnd5e's derived `system.classIdentifier` getter
        // (resolves from sourceItem = "class:<id>" in v5.3+).
        const flag = item?.getFlag?.(MODULE_ID, "classIdentifier")
          ?? item?.flags?.[MODULE_ID]?.classIdentifier;
        if (flag) return String(flag).trim();
        const derived = item?.system?.classIdentifier;
        if (derived) return String(derived).trim();
        return "__other__";
      };

      const classBuckets = new Map();
      const ensureBucket = (identifier) => {
        if (classBuckets.has(identifier)) return classBuckets.get(identifier);
        let label;
        if (identifier === "__other__") label = "Other Spells";
        else if (customSectionsById.has(identifier)) label = customSectionsById.get(identifier).name;
        else label = spellcastingClasses[identifier]?.name ?? identifier;

        // Pre-create folder entries (in customFolders order) so empty
        // folders still render with their header. `columns` is filled
        // in lazily — the first spell entering the folder copies them
        // from its source dnd5e section; an empty folder stays with
        // `columns = null` and the template's `{{#each columns}}`
        // gracefully iterates nothing.
        const entries = new Map();
        const folders = customFolders[identifier] ?? [];
        folders.forEach((folder, order) => {
          entries.set(`folder:${folder.id}`, {
            kind: "folder",
            folderId: folder.id,
            folderOrder: order,
            label: folder.name,
            items: [],
            columns: null,
            pips: null,
            dataset: {}
          });
        });

        const bucket = {
          classIdentifier: identifier,
          className: label,
          entries
        };
        classBuckets.set(identifier, bucket);
        return bucket;
      };

      // Pre-create buckets for every spellcasting class on the actor.
      // This guarantees the class section ALWAYS renders, even when
      // the actor has zero spells attributed to it yet. Without this,
      // a freshly-imported Bard with no spells would have no Bard
      // section at all — and the user couldn't drag a spell onto it,
      // right-click → Add Folder, or even see that Bard exists in the
      // Spells tab. Empty class sections still emit their stat columns
      // (Attack / DC / Prepared) and the Prepare book button.
      for (const identifier of Object.keys(spellcastingClasses)) {
        ensureBucket(identifier);
      }

      // Pre-create buckets for every custom section so empty ones
      // still survive the filter below.
      for (const cs of customSections) {
        ensureBucket(cs.id);
      }

      const sections = Array.isArray(ctx.sections) ? ctx.sections : [];
      let sampleColumns = null;
      for (const section of sections) {
        // Capture dnd5e's column definitions from the first section
        // we see; we'll reuse them on custom folder entries so they
        // render with the same column layout as level groups.
        if (sampleColumns === null && Array.isArray(section.columns)) {
          sampleColumns = section.columns;
        }
        const level = Number(section?.dataset?.level ?? 0);
        for (const item of (section.items ?? [])) {
          const identifier = classOfSpell(item);
          const bucket = ensureBucket(identifier);

          // Decide folder vs level: only honor `customFolderId` when
          // the referenced folder still belongs to THIS section.
          // Otherwise the spell falls back to level grouping.
          const rawFolderId = item?.getFlag?.(MODULE_ID, "customFolderId")
            ?? item?.flags?.[MODULE_ID]?.customFolderId;
          const folderInfo = rawFolderId ? folderById.get(String(rawFolderId)) : null;
          const useFolder = folderInfo && folderInfo.sectionId === identifier;

          let entry;
          if (useFolder) {
            const key = `folder:${folderInfo.id}`;
            entry = bucket.entries.get(key);
            // Pre-created above; only missing if folder isn't in this
            // bucket's folder list (shouldn't happen given the guard,
            // but defensive).
            if (!entry) {
              entry = {
                kind: "folder",
                folderId: folderInfo.id,
                folderOrder: folderInfo.order ?? Infinity,
                label: folderInfo.name,
                items: [],
                columns: sampleColumns,
                pips: null,
                dataset: {}
              };
              bucket.entries.set(key, entry);
            }
            // Populate columns/dataset on first spell entering the folder.
            if (!entry.columns) entry.columns = section.columns ?? sampleColumns;
            if (!entry.dataset || !Object.keys(entry.dataset).length) {
              entry.dataset = { ...(section.dataset ?? {}) };
            }
          } else {
            const key = `level:${level}`;
            entry = bucket.entries.get(key);
            if (!entry) {
              entry = { ...section, kind: "level", level, items: [] };
              bucket.entries.set(key, entry);
            }
          }
          entry.items.push(item);
        }
      }

      // --- Index spellcasting cards by class identifier ----------
      // `context.spellcasting` is an array of card-data entries
      // (ability/attack/save/preparation/label) prepared upstream by
      // dnd5e. To render the same stats inside each class section
      // header, we cross-reference each card to its class identifier.
      // Match by display name first (the card's `label` is the class
      // name); fall back to ability if names diverge.
      const spellcastingByClassIdentifier = new Map();
      const spellcastingByAbility = new Map();
      for (const sc of (Array.isArray(ctx.spellcasting) ? ctx.spellcasting : [])) {
        const abilityKey = String(sc?.ability?.ability ?? "");
        if (abilityKey && !spellcastingByAbility.has(abilityKey)) {
          spellcastingByAbility.set(abilityKey, sc);
        }
        const cardLabel = String(sc?.label ?? "").trim();
        for (const [identifier, classItem] of Object.entries(spellcastingClasses)) {
          if (String(classItem?.name ?? "").trim() === cardLabel) {
            spellcastingByClassIdentifier.set(identifier, sc);
            break;
          }
        }
      }
      const spellcastingFor = (identifier) => {
        const direct = spellcastingByClassIdentifier.get(identifier);
        if (direct) return direct;
        const ability = String(spellcastingClasses[identifier]?.system?.spellcasting?.ability ?? "");
        return spellcastingByAbility.get(ability) ?? null;
      };

      // --- Collapsed state (persisted on the actor) --------------
      const collapsedRaw = actor?.getFlag?.(MODULE_ID, "collapsedClasses") ?? [];
      const collapsedSet = new Set(Array.isArray(collapsedRaw) ? collapsedRaw.map(String) : []);
      const collapsedSectionsRaw = actor?.getFlag?.(MODULE_ID, "collapsedSections") ?? [];
      const collapsedSectionsSet = new Set(
        Array.isArray(collapsedSectionsRaw) ? collapsedSectionsRaw.map(String) : []
      );

      // --- User-defined section order (persisted on the actor) -----
      // The `classOrder` flag holds an ordered identifier list for
      // BOTH spellcasting classes AND custom sections (since both
      // can be reordered via drag-drop into a single sequence).
      // Effective order = saved order ∩ known ids, then any
      // unrecorded ids appended (classes alphabetically, then custom
      // sections in creation order). `__other__` is always pinned
      // to the end and never appears in the flag.
      const savedOrderRaw = actor?.getFlag?.(MODULE_ID, "classOrder") ?? [];
      const classIds = Object.keys(spellcastingClasses);
      const customIds = customSections.map((s) => s.id);
      const knownIdSet = new Set([...classIds, ...customIds]);

      const savedOrder = (Array.isArray(savedOrderRaw) ? savedOrderRaw : [])
        .map(String)
        .filter((id) => knownIdSet.has(id));
      const missingClassIds = classIds
        .filter((id) => !savedOrder.includes(id))
        .sort((a, b) =>
          String(spellcastingClasses[a]?.name ?? "")
            .localeCompare(String(spellcastingClasses[b]?.name ?? ""))
        );
      const missingCustomIds = customIds.filter((id) => !savedOrder.includes(id));
      const orderedIds = [...savedOrder, ...missingClassIds, ...missingCustomIds];
      if (classBuckets.has("__other__")) orderedIds.push("__other__");

      // --- Emit classGroups -------------------------------------
      // The array name stays `classGroups` for template compatibility
      // but it now holds mixed section kinds:
      //   - class    (a spellcasting class on the actor)
      //   - custom   (a user-defined custom section)
      //   - other    (the "__other__" orphan bucket, pinned at end)
      // The template differentiates via `isCustom` / `isOther` flags
      // and the presence (or absence) of `spellcasting`. Custom and
      // Other sections render with no Attack/DC/Prepared values and
      // no Prepare button.
      //
      // Reorder is via drag-drop (see `_onClassDragStart`) and persists
      // to `flags.dauligor-pairing.classOrder`. EMPTY custom sections
      // ARE emitted (user can drag spells into them later); empty
      // class sections + empty Other are skipped.
      const classGroups = [];
      for (const id of orderedIds) {
        const bucket = classBuckets.get(id);
        if (!bucket) continue;
        const isCustom = customSectionsById.has(id);
        const isOther = id === "__other__";

        // Determine if there's any content (folders + level entries).
        //   - Custom sections: always render (even empty — the user can
        //     drag spells in later).
        //   - Class sections: always render (so a freshly-imported class
        //     with zero spells still shows up; the user shouldn't have
        //     to add a spell before they can SEE the class).
        //   - "__other__": only render when it has at least one entry.
        //     The orphan bucket is meant for spells without class
        //     attribution; empty is the happy path so we hide it.
        const hasFolders = (customFolders[id]?.length ?? 0) > 0;
        const hasAnyEntries = bucket.entries.size > 0;
        if (isOther && !hasAnyEntries) continue;

        // Sort entries: folders first (in customFolders order), then
        // level entries (ascending). Folder collapse-state keys are
        // distinct from level keys: `<classId>-folder-<folderId>` vs
        // `<classId>-<level>`.
        const sortedEntries = [...bucket.entries.values()]
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
            if (a.kind === "folder") return (a.folderOrder ?? 0) - (b.folderOrder ?? 0);
            return (a.level ?? 0) - (b.level ?? 0);
          })
          .map((entry) => {
            const sectionKey = entry.kind === "folder"
              ? `${bucket.classIdentifier}-folder-${entry.folderId}`
              : `${bucket.classIdentifier}-${entry.level}`;
            return {
              ...entry,
              sectionKey,
              collapsed: collapsedSectionsSet.has(sectionKey)
            };
          });

        const classItem = !isCustom && !isOther ? spellcastingClasses[bucket.classIdentifier] : null;
        const prepMax = Number(classItem?.system?.spellcasting?.preparation?.max ?? 0);
        const prepMode = String(classItem?.system?.spellcasting?.preparation?.mode ?? "").toLowerCase();

        // Determine the Dauligor preparation type for the class. The
        // class import stamps `flags.dauligor-pairing.spellcasting.type`
        // ∈ {"prepared","known","spellbook"} on every class item (since
        // commit da73802); older imports fall through to a
        // mode-based heuristic.
        //   - "always" mode → known caster (Bard, Sorcerer, etc.)
        //   - "prepared" mode + Wizard/Artificer identifier → spellbook
        //   - "prepared" mode otherwise → prepared caster
        //
        // dnd5e collapses prepared+spellbook into `mode === "prepared"`
        // (see `normalizeSpellPreparationMode`), so we can't tell them
        // apart from `preparation.mode` alone — the stamped flag is
        // the only reliable source. Reasonable Wizard heuristic for
        // older imports.
        const moduleFlag = classItem?.getFlag?.(MODULE_ID, "spellcasting")
          ?? classItem?.flags?.[MODULE_ID]?.spellcasting
          ?? {};
        const explicitType = String(moduleFlag.type ?? "").toLowerCase();
        let casterKind = null;
        if (explicitType === "prepared" || explicitType === "known" || explicitType === "spellbook") {
          casterKind = explicitType;
        } else if (!isCustom && !isOther) {
          const identifierLower = String(bucket.classIdentifier ?? "").toLowerCase();
          if (prepMode === "always") casterKind = "known";
          else if (identifierLower === "wizard" || identifierLower === "artificer") casterKind = "spellbook";
          else if (prepMode === "prepared" || prepMode === "spell" || prepMode === "leveled" || prepMax > 0) {
            casterKind = "prepared";
          }
        }

        // Stat-column value + max + label per caster kind.
        //   prepared / spellbook: count of currently-prepared spells /
        //     max prepared (dnd5e's `preparation.value` / `.max`).
        //   known: count of owned non-cantrip spells attributed to this
        //     class / cap from `spellsKnownLevels[classLevel].spellsKnown`.
        let casterValue = null;
        let casterMax = null;
        let casterLabel = null;
        if (casterKind === "prepared" || casterKind === "spellbook") {
          casterLabel = casterKind === "spellbook"
            ? game.i18n.localize("DND5E.Prepared")
            : game.i18n.localize("DND5E.Prepared");
          const prepData = spellcastingFor(bucket.classIdentifier)?.preparation;
          casterValue = Number(prepData?.value ?? 0) || 0;
          casterMax = Number.isFinite(Number(prepData?.max)) && Number(prepData?.max) > 0
            ? Number(prepData?.max)
            : (prepMax > 0 ? prepMax : null);
        } else if (casterKind === "known") {
          casterLabel = "Known";
          // Count owned non-cantrip spells attributed to THIS class.
          // Cantrips are always known when on the sheet but don't count
          // against the spells-known cap, so they're excluded here.
          // (A dedicated Cantrips Known column would live as its own
          // header column — not the same axis as the prepared column.)
          casterValue = 0;
          for (const item of (actor.itemTypes?.spell ?? [])) {
            const lv = Number(item?.system?.level ?? 0) || 0;
            if (lv <= 0) continue;
            if (classOfSpell(item) === bucket.classIdentifier) casterValue++;
          }
          // Cap source priority:
          //   1. `flags.dauligor-pairing.spellcasting.spellsKnownLevels`
          //      — stamped at import time. Synchronous, no fetch.
          //   2. Live class-bundle cache. For classes imported before
          //      the flag existed; kick a background fetch and let the
          //      subsequent render pick up the value (the `onReady`
          //      callback calls `this.render()`).
          const classLevel = Number(classItem?.system?.levels ?? 0) || 0;
          const flagLevels = moduleFlag.spellsKnownLevels ?? null;
          let scaling = flagLevels
            ? (flagLevels[classLevel] ?? flagLevels[String(classLevel)] ?? null)
            : null;

          if (!scaling) {
            // No flag — try the bundle cache.
            ensureClassBundle(bucket.classIdentifier, classItem, () => this.render({ parts: ["spells"] }));
            const bundle = getClassBundle(bucket.classIdentifier);
            const sourceId = bundle?.spellcasting?.spellsKnownSourceId
              ?? moduleFlag.spellsKnownSourceId
              ?? null;
            const bundleScalings = bundle?.payload?.spellsKnownScalings ?? null;
            const bundleLevels = sourceId && bundleScalings
              ? (bundleScalings[sourceId]?.levels ?? null)
              : null;
            if (bundleLevels) {
              scaling = bundleLevels[classLevel] ?? bundleLevels[String(classLevel)] ?? null;
            }
          }

          const fromScaling = Number(scaling?.spellsKnown);
          casterMax = Number.isFinite(fromScaling) && fromScaling > 0 ? fromScaling : null;
        }

        // `isPreparedCaster` retained for back-compat with older
        // template snippets; equivalent to "any caster kind that uses
        // a daily prep budget" — i.e. prepared + spellbook, NOT known.
        const isPreparedCaster = casterKind === "prepared" || casterKind === "spellbook";

        classGroups.push({
          classIdentifier: bucket.classIdentifier,
          className: bucket.className,
          spellcasting: isCustom || isOther ? null : spellcastingFor(bucket.classIdentifier),
          isPreparedCaster,
          casterKind,
          casterLabel,
          casterValue,
          casterMax,
          isCustom,
          isOther,
          collapsed: collapsedSet.has(bucket.classIdentifier),
          sections: sortedEntries
        });
      }

      ctx.dauligor = {
        ...(ctx.dauligor ?? {}),
        classIdentifierByAbility,
        classGroups
      };
      return ctx;
    }
  }

  _DauligorCharacterSheet = DauligorCharacterSheet;
  return DauligorCharacterSheet;
}

/**
 * Resolve a spell's effective "section id" — the bucket it renders
 * into. Custom override takes precedence; otherwise the class
 * identifier from `system.sourceItem`; otherwise `"__other__"`.
 * Standalone helper (not a method) so the hook callback can use it
 * without a sheet instance.
 */
function resolveSpellSectionId(actor, spell) {
  if (!spell) return "__other__";
  const customSections = actor ? readCustomSections(actor) : [];
  const customSet = new Set(customSections.map((s) => s.id));
  const customId = spellCustomSectionId(spell);
  if (customId && customSet.has(customId)) return customId;
  const flag = spell?.getFlag?.(MODULE_ID, "classIdentifier")
    ?? spell?.flags?.[MODULE_ID]?.classIdentifier;
  if (flag) return String(flag).trim();
  const derived = spell?.system?.classIdentifier;
  if (derived) return String(derived).trim();
  return "__other__";
}

let _dauligorItemContextHookRegistered = false;

/**
 * Append Dauligor entries ("Move to Section…", "Move to Folder…")
 * to dnd5e's spell-row right-click menu. Only fires when the actor
 * is rendering with our Dauligor sheet — on the default dnd5e sheet
 * the menu stays as dnd5e shipped it.
 */
function registerDauligorItemContextHook() {
  if (_dauligorItemContextHookRegistered) return;
  _dauligorItemContextHookRegistered = true;

  Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
    if (!item || item.type !== "spell") return;
    const actor = item.actor;
    if (!actor) return;
    // Only add our entries when the actor is rendering with the
    // Dauligor sheet. The default dnd5e sheet shouldn't get them
    // (they'd be confusing without our section/folder UI).
    const SheetClass = _DauligorCharacterSheet;
    if (!SheetClass || !(actor.sheet instanceof SheetClass)) return;

    menuItems.push({
      name: "Move to Section…",
      icon: '<i class="fas fa-folder-tree"></i>',
      callback: async () => {
        const result = await promptForMoveSectionDestination(actor, {
          currentId: spellCustomSectionId(item)
        });
        if (!result) return;
        if (result.kind === "default") await setSpellCustomSection(item, null);
        else if (result.kind === "custom") await setSpellCustomSection(item, result.sectionId);
      }
    });

    menuItems.push({
      name: "Move to Folder…",
      icon: '<i class="fas fa-folder"></i>',
      callback: async () => {
        const sectionId = resolveSpellSectionId(actor, item);
        const result = await promptForMoveFolderDestination(actor, sectionId, {
          currentId: spellCustomFolderId(item)
        });
        if (!result) return;
        if (result.kind === "default") await setSpellCustomFolder(item, null);
        else if (result.kind === "folder") await setSpellCustomFolder(item, result.folderId);
      }
    });
  });
}

/**
 * Register the Dauligor character sheet as an opt-in alt sheet for
 * the dnd5e character actor type. Call this from the `init` hook.
 * Safe to call multiple times — re-registration is a no-op once
 * the class is built and the hook is registered.
 */
export function registerDauligorCharacterSheet() {
  const SheetClass = buildDauligorCharacterSheetClass();
  if (!SheetClass) return false;

  try {
    const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
    DocumentSheetConfig.registerSheet(Actor, MODULE_ID, SheetClass, {
      types: ["character"],
      makeDefault: false,
      label: "Dauligor Sheet (D&D 5e)"
    });
    // The item-context hook is wired here (after the sheet class
    // is built) so the `instanceof SheetClass` check inside the
    // hook is valid.
    registerDauligorItemContextHook();
    log("Registered Dauligor Sheet alt sheet for character actors");
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Dauligor Sheet registration failed`, err);
    notifyWarn?.("Failed to register Dauligor Sheet — see console for details.");
    return false;
  }
}
