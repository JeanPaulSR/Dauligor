import { CLASS_CATALOG_FILE, MODULE_ID, SETTINGS } from "./constants.js";
import { exportApplicationWindow, exportSpellFolder } from "./export-service.js";
import { openFeatureManager } from "./feature-manager-app.js";
import { openDauligorImporter } from "./importer-app.js";
import { initializeSocket } from "./import-service.js";
import { openSpellPreparationManager } from "./spell-preparation-app.js";
import { log, notifyWarn } from "./utils.js";

Hooks.once("init", () => {
  log("Initializing");
  registerSettings();
  registerKeybindings();
  registerSheetControls();
  registerSpellTabControls();
  registerLauncherControl();
  registerSettingsUiButtons();
  registerSidebarButtons();
  registerRestBarControls();
});

Hooks.once("ready", () => {
  initializeSocket();
  patchDnd5eRemoteItemImages();
  registerCustomFeatureTypeLabels();
});

Hooks.on("createItem", (item) => {
  registerFeatureTypeLabelFromItem(item);
});

Hooks.on("updateItem", (item) => {
  registerFeatureTypeLabelFromItem(item);
});

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.defaultImportUrl, {
    name: "Default import URL",
    hint: "Used as the pre-filled URL when importing JSON into a character sheet.",
    scope: "world",
    config: true,
    type: String,
    default: "http://127.0.0.1:3000/sample-character.json"
  });

  game.settings.register(MODULE_ID, SETTINGS.defaultClassCatalogUrl, {
    name: "Default class catalog URL",
    hint: "Used by the Dauligor class importer browser. Start with the bundled module fixture, then point it at the real app endpoint later.",
    scope: "world",
    config: true,
    type: String,
    default: CLASS_CATALOG_FILE
  });

  game.settings.register(MODULE_ID, SETTINGS.defaultClassFolderPath, {
    name: "Default class folder path",
    hint: "Used by the Dauligor importer when saving class and class-feature world items.",
    scope: "world",
    config: true,
    type: String,
    default: "Classes"
  });

  game.settings.register(MODULE_ID, SETTINGS.apiEndpointMode, {
    name: "API Endpoint Mode",
    hint: "Choose between local development or production servers.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "local": "Local Development (http://localhost:3000)",
      "production": "Production (https://www.dauligor.com)"
    },
    default: "local"
  });
}

function isAbsoluteHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/**
 * dnd5e's BaseActorSheet._prepareItemFeature normally runs `img` through
 * `foundry.utils.getRoute`, which prefixes a leading slash and breaks absolute
 * `https://images.dauligor.com/...` URLs we ship for class/subclass items.
 * Wrap it via libWrapper so we cooperate with any other module that wraps
 * the same method instead of clobbering its prototype.
 */
function patchDnd5eRemoteItemImages() {
  if (typeof libWrapper === "undefined") {
    notifyWarn("libWrapper is not available; remote class/subclass image rewrite is disabled.");
    return;
  }

  const target = "dnd5e.applications.actor.BaseActorSheet.prototype._prepareItemFeature";
  try {
    libWrapper.register(MODULE_ID, target, async function (wrapped, item, ctx, ...args) {
      const result = await wrapped(item, ctx, ...args);
      if (["class", "subclass"].includes(item?.type) && isAbsoluteHttpUrl(item?.img)) {
        ctx.prefixedImage = item.img.trim();
      }
      return result;
    }, "WRAPPER");
    log("Registered libWrapper for remote class/subclass image handling.");
  } catch (error) {
    console.error(`[${MODULE_ID}] libWrapper registration failed for ${target}:`, error);
  }
}

function registerCustomFeatureTypeLabels() {
  const collections = [
    game.items?.contents ?? [],
    ...game.actors.contents.map((actor) => actor.items.contents)
  ];

  for (const items of collections) {
    for (const item of items) {
      registerFeatureTypeLabelFromItem(item);
    }
  }
}

function registerFeatureTypeLabelFromItem(item) {
  if (item?.type !== "feat") return;

  const flags = item.flags?.[MODULE_ID] ?? {};
  const typeValue = flags.featureTypeValue;
  const subtype = flags.featureTypeSubtype;
  const label = flags.featureTypeLabel;
  if (!typeValue || !subtype || !label) return;

  const typeConfig = CONFIG.DND5E?.featureTypes?.[typeValue];
  if (!typeConfig) return;
  typeConfig.subtypes ??= {};
  if (!typeConfig.subtypes[subtype]) typeConfig.subtypes[subtype] = label;
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "openImporter", {
    name: "Open Dauligor Importer",
    editable: [],
    restricted: true,
    onDown: () => {
      openDauligorImporter();
      return true;
    }
  });
}

function registerSheetControls() {
  Hooks.on("getHeaderControlsBaseActorSheet", (sheet, controls) => {
    if (sheet.document?.type === "character" && getDauligorLevelableClasses(sheet.document).length) {
      injectControl(controls, {
        action: `${MODULE_ID}.level-up`,
        label: "Dauligor Level Up",
        icon: "fas fa-circle-up",
        onClick: async () => openDauligorLevelUp(sheet.document)
      });
    }

    injectControl(controls, {
      action: `${MODULE_ID}.open-importer-actor`,
      label: "Dauligor Import",
      icon: "fas fa-book",
      onClick: async () => openDauligorImporter({ actor: sheet.document })
    });

    injectControl(controls, {
      action: `${MODULE_ID}.open-options-actor`,
      label: "Dauligor Options",
      icon: "fas fa-screwdriver-wrench",
      onClick: async () => openLauncher({ actor: sheet.document })
    });
  });
}

/**
 * Inject a Dauligor Feature Manager button into the dnd5e 5.x character
 * header's rest-button bar (next to Short Rest / Long Rest), so the
 * primary entry point is a visible icon in the sheet body rather than
 * something buried behind the kebab/header-controls menu.
 *
 * Anchor: the dnd5e character header renders
 *   `.sheet-header-buttons > button.{long|short}-rest.gold-button`
 * inside `systems/dnd5e/templates/actors/character-header.hbs`. We
 * append a sibling `<button class="gold-button">` so it picks up
 * dnd5e's native styling automatically.
 *
 * Hooks: dnd5e 5.x sheets extend `ApplicationV2Mixin(ActorSheetV2)`,
 * so the legacy `renderActorSheet` hook never fires. AppV2's render
 * hook chain runs once per class in the prototype chain — we listen
 * on the dnd5e-specific class hooks (most specific first) plus
 * `renderApplicationV2` as a backstop.
 */
function registerRestBarControls() {
  const inject = (appLike, htmlLike) =>
    injectFeatureManagerRestButton(appLike, resolveHookRoot(htmlLike));
  Hooks.on("renderCharacterActorSheet", inject);
  Hooks.on("renderBaseActorSheet", inject);
  Hooks.on("renderApplicationV2", inject);
}

function injectFeatureManagerRestButton(appLike, root) {
  const actor = resolveActorDocument(appLike?.document ?? appLike?.actor ?? appLike);
  if (!actor || actor.type !== "character") return;
  if (!root) return;

  // Search both the immediate hook-root and the broader window — AppV2
  // hooks sometimes pass `.window-content` instead of the outer
  // application element. `.sheet-header-buttons` lives inside the
  // window content either way, but widen the search to be safe.
  const restBar = root.querySelector?.(".sheet-header-buttons")
    ?? root.closest?.(".application")?.querySelector?.(".sheet-header-buttons")
    ?? (appLike?.id ? document.querySelector(`#${appLike.id} .sheet-header-buttons`) : null);
  if (!restBar) return;
  if (restBar.querySelector(`[data-${MODULE_ID}-feature-manager]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gold-button dauligor-rest-bar-button";
  button.setAttribute(`data-${MODULE_ID}-feature-manager`, "true");
  button.setAttribute("aria-label", "Dauligor Feature Manager");
  button.setAttribute("data-tooltip", "Dauligor Feature Manager");
  button.innerHTML = `<i class="fas fa-toolbox" inert></i>`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openFeatureManager(actor, { scope: "long-rest" });
  });
  restBar.appendChild(button);
  log(`Feature Manager rest-bar button injected for "${actor.name}"`);
}

function registerLauncherControl() {
  Hooks.on("getHeaderControlsSettings", (_app, controls) => {
    injectControl(controls, {
      action: `${MODULE_ID}.launcher`,
      label: "Dauligor",
      icon: "fas fa-plug",
      onClick: async () => openLauncher()
    });
  });
}

function registerSidebarButtons() {
  Hooks.on("renderActorDirectory", (_app, html) => {
    injectSidebarDirectoryButtons(resolveHookRoot(html), { directoryType: "Actor" });
  });

  Hooks.on("renderItemDirectory", (_app, html) => {
    injectSidebarDirectoryButtons(resolveHookRoot(html), { directoryType: "Item" });
  });
}

function registerSettingsUiButtons() {
  Hooks.on("renderSettingsConfig", (_app, html) => {
    injectSettingsButtons(resolveHookRoot(html));
  });

  Hooks.on("renderActiveEffectConfig", (app, html) => {
    injectWindowExportButton(app, resolveHookRoot(html));
  });

  Hooks.on("renderApplicationV2", (app, element) => {
    const root = resolveHookRoot(element);
    injectSpellTabButton(app, root);
    injectWindowExportButton(app, root);

    const isSettingsConfig = app?.constructor?.name === "SettingsConfig" || app?.id === "settings";
    if (!isSettingsConfig) return;
    injectSettingsButtons(root);
  });
}

function registerSpellTabControls() {
  Hooks.on("renderActorSheet", (sheet, html) => {
    injectSpellTabButton(sheet, resolveHookRoot(html));
  });
}

async function openLauncher({ actor = null } = {}) {
  const actorDoc = resolveActorDocument(actor);
  const buttons = [
    {
      action: "import",
      label: "Import",
      icon: "fas fa-book",
      callback: async () => actorDoc ? openDauligorImporter({ actor: actorDoc }) : openDauligorImporter()
    }
  ];

  if (actorDoc) {
    buttons.push({
      action: "actor-tools",
      label: "Actor Tools",
      icon: "fas fa-user-gear",
      callback: async () => openActorToolsHub(actorDoc)
    });
  }

  buttons.push(
    {
      action: "character-creator",
      label: "Character Creator",
      icon: "fas fa-user-plus",
      callback: async () => openUnderConstructionDialog("Character Creator")
    },
    {
      action: "hp-gain-behavior",
      label: "HP Gain Behavior",
      icon: "fas fa-heart-circle-bolt",
      callback: async () => openUnderConstructionDialog("HP Gain Behavior")
    },
    {
      action: "spell-points-behavior",
      label: "Spell Points Behavior",
      icon: "fas fa-wand-sparkles",
      callback: async () => openSpellPointsBehaviorDialog()
    },
    {
      action: "loot-generator",
      label: "Loot Generator",
      icon: "fas fa-coins",
      callback: async () => openUnderConstructionDialog("Loot Generator")
    },
    {
      action: "equipment-shop",
      label: "Equipment Shop",
      icon: "fas fa-cart-shopping",
      callback: async () => openUnderConstructionDialog("Equipment Shop")
    },
    {
      action: "close",
      label: "Close",
      default: true
    }
  );

  new foundry.applications.api.DialogV2({
    window: { title: actorDoc ? `Dauligor Options: ${actorDoc.name}` : "Dauligor Options" },
    content: `
      <p>Implemented now:</p>
      <ul>
        <li><strong>Import</strong>${actorDoc ? "</li><li><strong>Level Up</strong> from character sheets" : ""}</li>
      </ul>
      <p>The remaining entries here are placeholders and currently under construction.</p>
    `,
    buttons,
    rejectClose: false,
    modal: true
  }).render({ force: true });
}

async function openActorToolsHub(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor) {
    notifyWarn("Open actor tools from an actor sheet.");
    return;
  }

  new foundry.applications.api.DialogV2({
    window: { title: `Actor Tools: ${actor.name}` },
    content: `
      <p><strong>Prepare Spells</strong> is now available as a first-pass manager for current actor spell items.</p>
      <p>The remaining actor-side tools here are still under construction.</p>
    `,
    buttons: [
      {
        action: "item-cleaner",
        label: "Item Cleaner",
        icon: "fas fa-trash-can",
        callback: async () => openUnderConstructionDialog("Item Cleaner", actor.name)
      },
      {
        action: "prepare-spells",
        label: "Prepare Spells",
        icon: "fas fa-book-open",
        callback: async () => openSpellPreparationManager(actor)
      },
      {
        action: "feature-manager",
        label: "Feature Manager",
        icon: "fas fa-toolbox",
        callback: async () => openFeatureManager(actor, { scope: "long-rest" })
      },
      {
        action: "polymorpher",
        label: "Polymorpher",
        icon: "fas fa-paw",
        callback: async () => openUnderConstructionDialog("Polymorpher", actor.name)
      },
      {
        action: "show-players",
        label: "Show Players",
        icon: "fas fa-eye",
        callback: async () => openUnderConstructionDialog("Show Players", actor.name)
      },
      {
        action: "close",
        label: "Close",
        default: true
      }
    ],
    rejectClose: false,
    modal: true
  }).render({ force: true });
}

async function openUnderConstructionDialog(featureName, actorName = "") {
  const actorLine = actorName ? `<p><strong>Context:</strong> ${foundry.utils.escapeHTML(actorName)}</p>` : "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: featureName },
    content: `
      <p><strong>Under Construction</strong></p>
      <p>${foundry.utils.escapeHTML(featureName)} is not implemented yet.</p>
      ${actorLine}
    `,
    ok: {
      label: "Close"
    },
    rejectClose: false,
    modal: true
  });
}

async function openSpellPointsBehaviorDialog() {
  const spellPointsModule = game.modules.get("dnd5e-spellpoints");
  const isInstalled = Boolean(spellPointsModule);
  const isActive = Boolean(spellPointsModule?.active);
  const version = spellPointsModule?.version ?? "not installed";
  const statusLabel = isActive
    ? "Active"
    : (isInstalled ? "Installed but disabled" : "Not installed");

  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Spell Points Behavior" },
    content: `
      <p><strong>Detected module:</strong> Advanced Magic - Spell Points System 5e (<code>dnd5e-spellpoints</code>)</p>
      <p><strong>Status:</strong> ${foundry.utils.escapeHTML(statusLabel)}${isInstalled ? ` (${foundry.utils.escapeHTML(version)})` : ""}</p>
      <hr />
      <p><strong>Recommended Dauligor integration model</strong></p>
      <ol>
        <li>Create or attach the spell-points item on spellcasting actors. The module is item-centered, not class-centered.</li>
        <li>Let Advanced Magic own current and maximum spell points on that item. Dauligor should not keep a parallel actor-side spell-point pool.</li>
        <li>Keep imported class and subclass spellcasting progression native on the class items. Advanced Magic recalculates from class levels and spellcasting progression.</li>
        <li>If per-actor spell-point rules are needed, write them onto the spell-points item using <code>flags.spellpoints.override</code> and <code>flags.spellpoints.config</code>.</li>
        <li>If Dauligor authors formulas, normalize semantic references into native Foundry roll-data paths before saving them into the spell-points item configuration.</li>
      </ol>
      <p><strong>Safe behavior for Dauligor</strong></p>
      <ul>
        <li>Import classes and subclasses normally.</li>
        <li>Do not remove or zero spell slots just because spell points are enabled.</li>
        <li>Do not overwrite the spell-points item on every import if it already exists.</li>
        <li>Prefer importing the module compendium item or cloning its shape, instead of inventing a different resource item.</li>
      </ul>
      <p><strong>Current implementation</strong></p>
      <ul>
        <li>After a successful actor-side class import, Dauligor checks whether <code>dnd5e-spellpoints</code> is active.</li>
        <li>If the actor now has spellcasting support and no spell-points item, Dauligor offers to add the module's default compendium item.</li>
        <li>If the item already exists, Dauligor leaves it alone.</li>
      </ul>
      <p><strong>Next implementation target</strong></p>
      <p>Add actor-side support for editing per-item spell-point overrides from Dauligor, while still leaving spell-point math to Advanced Magic.</p>
    `,
    ok: {
      label: "Close"
    },
    rejectClose: false,
    modal: true
  });
}

function injectControl(controls, {
  action,
  label,
  icon = "fas fa-file-export",
  onClick
}) {
  if (controls.some((it) => it.action === action)) return;
  controls.unshift({
    action,
    label,
    icon,
    visible: () => game.user?.isGM ?? false,
    onClick
  });
}

function resolveHookRoot(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  if (value?.jquery && value[0] instanceof HTMLElement) return value[0];
  if (value?.element instanceof HTMLElement) return value.element;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

function injectSettingsButtons(root) {
  if (!game.user?.isGM) return;
  if (!root || root.querySelector?.(`[data-${MODULE_ID}-tools]`)) return;

  const importUrlInput = root.querySelector(`input[name="${MODULE_ID}.${SETTINGS.defaultImportUrl}"]`);
  const classCatalogInput = root.querySelector(`input[name="${MODULE_ID}.${SETTINGS.defaultClassCatalogUrl}"]`);
  const anchor = classCatalogInput?.closest?.(".form-group") ?? importUrlInput?.closest?.(".form-group");
  if (!anchor?.parentElement) return;

  const wrapper = document.createElement("div");
  wrapper.className = "form-group";
  wrapper.setAttribute(`data-${MODULE_ID}-tools`, "true");
  wrapper.innerHTML = `
    <label>Dauligor Tools</label>
    <div class="form-fields" style="gap: 0.5rem; flex-wrap: wrap;">
      <button type="button" data-action="open-importer">
        <i class="fas fa-book"></i> Open Importer
      </button>
      <button type="button" data-action="open-options">
        <i class="fas fa-screwdriver-wrench"></i> Open Options
      </button>
    </div>
    <p class="hint">Import is live. The remaining tools are visible here as under-construction placeholders.</p>
  `;

  wrapper.querySelector(`[data-action="open-importer"]`)?.addEventListener("click", async () => {
    await openDauligorImporter();
  });
  wrapper.querySelector(`[data-action="open-options"]`)?.addEventListener("click", async () => {
    await openLauncher();
  });

  anchor.insertAdjacentElement("afterend", wrapper);
}

function injectSidebarDirectoryButtons(root, { directoryType = "" } = {}) {
  if (!game.user?.isGM) return;
  if (!root || root.querySelector?.(`[data-${MODULE_ID}-sidebar-tools]`)) return;

  const anchor = root.querySelector(".header-actions.action-buttons") ?? root.querySelector(".header-actions");
  if (!anchor?.parentElement) return;

  const wrapper = document.createElement("div");
  wrapper.className = "header-actions action-buttons dauligor-directory-tools";
  wrapper.setAttribute(`data-${MODULE_ID}-sidebar-tools`, "true");
  const exportSpellButton = directoryType === "Item"
    ? `
    <button type="button" class="dauligor-directory-tools__button" data-action="export-spell-folder" title="Export a Foundry spell folder for Dauligor spell import research">
      <i class="fas fa-wand-magic-sparkles"></i>
      <span>Export Spell Folder</span>
    </button>
  `
    : "";

  wrapper.innerHTML = `
    <button type="button" class="dauligor-directory-tools__button dauligor-directory-tools__button--primary" data-action="open-importer" title="Open Dauligor Importer">
      <i class="fas fa-book"></i>
      <span>Dauligor Import</span>
    </button>
    ${exportSpellButton}
    <button type="button" class="dauligor-directory-tools__button dauligor-directory-tools__button--icon" data-action="open-options" title="Open Dauligor Options">
      <i class="fas fa-screwdriver-wrench"></i>
    </button>
  `;

  wrapper.querySelector(`[data-action="open-importer"]`)?.addEventListener("click", async () => {
    await openDauligorImporter();
  });
  wrapper.querySelector(`[data-action="export-spell-folder"]`)?.addEventListener("click", async () => {
    await promptAndExportSpellFolder();
  });
  wrapper.querySelector(`[data-action="open-options"]`)?.addEventListener("click", async () => {
    await openLauncher();
  });

  anchor.insertAdjacentElement("afterend", wrapper);
}

function getItemFolderPath(folder) {
  if (!folder) return "";

  const parts = [];
  let current = folder;
  while (current) {
    parts.unshift(current.name ?? "");
    current = current.folder ?? null;
  }

  return parts.filter(Boolean).join("/");
}

function collectSpellFolderChoices() {
  const folders = Array.from(game.folders ?? [])
    .filter((folder) => folder.type === "Item")
    .map((folder) => {
      const descendants = new Set([folder.id]);
      const queue = [folder.id];
      while (queue.length) {
        const parentId = queue.shift();
        for (const candidate of Array.from(game.folders ?? [])) {
          if (candidate.type !== "Item") continue;
          if ((candidate.folder?.id ?? null) !== parentId) continue;
          if (descendants.has(candidate.id)) continue;
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }

      const spellCount = Array.from(game.items ?? []).filter((item) =>
        item.type === "spell"
        && descendants.has(item.folder?.id ?? "")
      ).length;

      return {
        folder,
        path: getItemFolderPath(folder),
        spellCount
      };
    })
    .filter((entry) => entry.spellCount > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  return folders;
}

async function promptAndExportSpellFolder() {
  const choices = collectSpellFolderChoices();
  if (!choices.length) {
    notifyWarn("No Item folders with spell items were found in this world.");
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.spellCount} spells)`)}
    </option>
  `).join("");

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Export Spell Folder" },
      content: `
        <div class="form-group">
          <label>Spell folder</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all native Foundry spell items in the selected Item folder as a Dauligor research/import batch.</p>
        </div>
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" name="includeSubfolders" checked>
            <span>Include subfolders</span>
          </label>
        </div>
      `,
      ok: {
        label: "Export",
        callback: (_event, button) => ({
          folderId: button.form.elements.folderId.value,
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked)
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected spell folder could not be found.");
    return;
  }

  await exportSpellFolder(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

function injectSpellTabButton(appLike, root) {
  const actor = resolveActorDocument(appLike?.document ?? appLike?.actor ?? appLike);
  if (!actor || actor.type !== "character") return;
  if (!root) return;

  const spellsTab = root.querySelector(`[data-tab="spells"]`);
  if (!spellsTab) return;
  if (spellsTab.querySelector?.(`[data-${MODULE_ID}-spell-tab-tools]`)) return;

  const topSection = spellsTab.querySelector(`section.top`);
  const inventorySection = spellsTab.querySelector(`.inventory-element`);

  const wrapper = document.createElement("div");
  wrapper.className = "dauligor-spell-tab-tools";
  wrapper.setAttribute(`data-${MODULE_ID}-spell-tab-tools`, "true");
  wrapper.innerHTML = `
    <button type="button" class="dauligor-spell-tab-tools__button" data-action="open-spell-manager">
      <i class="fas fa-book-open"></i>
      <span>Dauligor Prepare Spells</span>
    </button>
  `;

  wrapper.querySelector(`[data-action="open-spell-manager"]`)?.addEventListener("click", async () => {
    await openSpellPreparationManager(actor);
  });

  if (topSection?.parentElement === spellsTab) {
    topSection.insertAdjacentElement("afterend", wrapper);
    return;
  }

  if (inventorySection?.parentElement) {
    inventorySection.insertAdjacentElement("beforebegin", wrapper);
    return;
  }

  spellsTab.prepend(wrapper);
}

function shouldExposeWindowExport(app) {
  if (!game.user?.isGM) return false;
  if (!app) return false;

  const constructorName = String(app.constructor?.name ?? "");
  const documentName = String(app.document?.documentName ?? app.object?.documentName ?? "");

  if (documentName === "Item" || documentName === "Activity" || documentName === "ActiveEffect") return true;
  if (constructorName.includes("ActiveEffect")) return true;
  if (constructorName.includes("ActivitySheet")) return true;
  if (constructorName.includes("AttackSheet")) return true;
  if (constructorName.includes("CastSheet")) return true;
  if (constructorName.includes("CheckSheet")) return true;
  if (constructorName.includes("DamageSheet")) return true;
  if (constructorName.includes("EnchantSheet")) return true;
  if (constructorName.includes("ForwardSheet")) return true;
  if (constructorName.includes("HealSheet")) return true;
  if (constructorName.includes("Order")) return true;
  if (constructorName.includes("SaveSheet")) return true;
  if (constructorName.includes("SummonSheet")) return true;
  if (constructorName.includes("TransformSheet")) return true;
  if (constructorName.includes("UtilitySheet")) return true;
  if (constructorName.includes("ActivityChoiceDialog")) return true;

  return false;
}

function injectWindowExportButton(app, root) {
  if (!shouldExposeWindowExport(app)) return;
  if (!root) return;
  if (root.querySelector?.(`[data-${MODULE_ID}-window-export]`)) return;

  const header = root.querySelector(".window-header");
  if (!header) return;

  const anchor = header.querySelector(".header-control-buttons, .window-controls, .header-actions, .controls");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon";
  button.title = "Temporary Dauligor debug export for this window";
  button.setAttribute(`data-${MODULE_ID}-window-export`, "true");
  button.innerHTML = `<i class="fas fa-file-export"></i>`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await exportApplicationWindow(app);
  });

  if (anchor) {
    anchor.prepend(button);
    return;
  }

  header.append(button);
}

async function openDauligorLevelUp(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor || actor.type !== "character") {
    notifyWarn("Open Dauligor Level Up from a character actor sheet.");
    return;
  }

  const classes = getDauligorLevelableClasses(actor);
  if (!classes.length) {
    notifyWarn("No Dauligor-imported classes were found on this actor. Import a class first, then use Dauligor Level Up.");
    return;
  }

  const selected = classes.length === 1
    ? classes[0]
    : await promptForLevelUpClass(classes);
  if (!selected) return;

  await openDauligorImporter({
    actor,
    modeId: "classes",
    selectedEntryIds: selected.sourceId ? [selected.sourceId] : [],
    targetLevel: selected.nextLevel,
    status: `Level up ${selected.name} from ${selected.currentLevel} to ${selected.nextLevel}, then import the updated class payload.`,
    statusLevel: ""
  });
}

function resolveActorDocument(actorLike) {
  if (!actorLike) return null;
  if (actorLike.documentName === "Actor") return actorLike;
  if (actorLike.actor?.documentName === "Actor") return actorLike.actor;
  return null;
}

function getDauligorLevelableClasses(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor) return [];

  return actor.items
    .filter((item) => item.type === "class")
    .map((item) => {
      const currentLevel = clampActorClassLevel(item.system?.levels ?? 1);
      const sourceId = item.getFlag(MODULE_ID, "sourceId")
        ?? buildClassSourceIdFromIdentifier(item.system?.identifier);
      if (!sourceId || currentLevel >= 20) return null;

      return {
        item,
        name: item.name ?? "Class",
        sourceId,
        currentLevel,
        nextLevel: clampActorClassLevel(currentLevel + 1)
      };
    })
    .filter(Boolean);
}

function buildClassSourceIdFromIdentifier(identifier) {
  const normalized = String(identifier ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `class-${normalized}` : null;
}

function clampActorClassLevel(level) {
  const numeric = Number(level ?? 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(20, Math.max(1, Math.round(numeric)));
}

async function promptForLevelUpClass(classes) {
  const optionsHtml = classes
    .map((classMeta) => `
      <option value="${foundry.utils.escapeHTML(classMeta.sourceId)}">
        ${foundry.utils.escapeHTML(`${classMeta.name} (${classMeta.currentLevel} -> ${classMeta.nextLevel})`)}
      </option>
    `)
    .join("");

  try {
    const selectedSourceId = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Dauligor Level Up" },
      content: `
        <div class="form-group">
          <label>Select the class to level up</label>
          <select name="sourceId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">This opens the Dauligor importer in actor mode and preselects the next level for the chosen class.</p>
        </div>
      `,
      ok: {
        label: "Continue",
        callback: (_event, button) => button.form.elements.sourceId.value
      },
      rejectClose: false,
      modal: true
    });

    return classes.find((classMeta) => classMeta.sourceId === selectedSourceId) ?? null;
  } catch {
    return null;
  }
}
