import { CLASS_CATALOG_FILE, MODULE_ID, SETTINGS } from "./constants.js";
import { registerDauligorCharacterSheet } from "./dauligor-character-sheet.js";
import { exportActorFolder, exportApplicationWindow, exportBackgroundFolder, exportCreatureFolder, exportFeatFolder, exportItemFolder, exportRaceFolder, exportSpellFolder } from "./export-service.js";
import { openFeatureManager, promptLongRestCommit } from "./feature-manager-app.js";
import { openDauligorImporter } from "./importer-app.js";
import { initializeSocket } from "./import-service.js";
import { openSpellPreparationManager } from "./spell-preparation-app.js";
import { openDauligorGmConsole } from "./gm-app.js";
import { openDauligorCharacterCreator } from "./character-creator-app.js";
import { openDauligorLauncher } from "./launcher-app.js";
import { openDauligorLibrary, openDauligorCampaigns } from "./dauligor-viewer.js";
import { registerRefEnrichers, registerRefClickHandler } from "./ref-enricher.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import { isLoggedIn, getDisplayName, getProfile, login, logout } from "./auth-service.js";

Hooks.once("init", () => {
  log("Initializing");
  registerSettings();
  registerKeybindings();
  registerSheetControls();
  registerSpellTabControls();
  registerLauncherControl();
  registerSettingsUiButtons();
  registerLoginChatPrompt();
  registerSidebarButtons();
  registerRestBarControls();
  registerGmConsoleControl();
  registerLongRestCommitHook();
  // Make @article / &rule refs clickable everywhere Foundry enriches text
  // (journals, item/actor descriptions, chat) — not just inside the viewer.
  registerRefEnrichers();
  // Register the opt-in "Dauligor Sheet (D&D 5e)" alt character
  // sheet. Users select it per-actor via the sheet picker; non-opted
  // actors keep dnd5e's stock sheet (where the DOM-injected
  // per-class Prepare buttons still apply).
  registerDauligorCharacterSheet();
});

Hooks.once("ready", () => {
  initializeSocket();
  patchDnd5eRemoteItemImages();
  registerCustomFeatureTypeLabels();
  registerLongRestIntercept();
  // Delegated click routing for enriched refs rendered outside the viewer.
  registerRefClickHandler();
  // Nudge un-authenticated users to log into their Dauligor account (once — a
  // prior card suppresses re-posting on reload).
  if (!isLoggedIn() && !hasLoginPromptCard()) postLoginChatCard();
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

  // Shared ability-score roll pool for the Character Creator. World-scoped
  // so every client sees the same sets; hidden from the settings UI
  // (managed entirely from the creator's Ability Scores step). Its
  // onChange fires on every client when the GM writes the pool, which the
  // creator listens on (via ability-roll-pool's onRollPoolChanged) to
  // re-render the ability step live across the table.
  game.settings.register(MODULE_ID, SETTINGS.abilityRollPool, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => Hooks.callAll(`${MODULE_ID}.rollPoolChanged`)
  });

  // GM allow-list of source slugs the Character Creator offers. Empty = all
  // sources (default). config:false — managed by the Campaign Sources picker
  // (Dauligor Tools), since Foundry's settings UI can't render a multi-source
  // checkbox list. The creator re-reads it each open (it's a fresh instance).
  game.settings.register(MODULE_ID, SETTINGS.enabledSources, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Per-user Dauligor account session (native-auth JWT + profile), stored as a
  // JSON string. client scope = private to each user's browser, never
  // world-shared. Managed by the account dialog / auth-service.js.
  game.settings.register(MODULE_ID, SETTINGS.session, {
    scope: "client",
    config: false,
    type: String,
    default: ""
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

/**
 * Intercept dnd5e's long-rest flow so the player goes through the
 * Dauligor Feature Manager Overview tab instead of dnd5e's built-in
 * LongRestDialog. The FM Overview shows queued advancements + a
 * "Take Long Rest" button that bypasses this intercept by passing
 * `dialog: false`.
 *
 * Why `dnd5e.preLongRest` and not libWrapper:
 *   The sheet's Long Rest button calls
 *   `actor.initiateRest({ type: "long" })`, NOT `actor.longRest()`.
 *   `longRest` is a thin wrapper around `initiateRest` for
 *   programmatic callers — wrapping it never sees the button click.
 *   `dnd5e.preLongRest` fires from inside `initiateRest` and
 *   returning `false` cancels the entire rest (including the
 *   native dialog), giving us a clean intercept point that catches
 *   both the button AND any programmatic `actor.longRest()` call.
 *
 * Routing:
 *   - `config.dialog === false`        → pass through (our FM button
 *                                          fires the rest with this).
 *   - non-character actors             → pass through (NPCs keep
 *                                          dnd5e's default flow).
 *   - default (button / macro path)    → open FM at Overview tab,
 *                                          return false to cancel
 *                                          dnd5e's flow. User clicks
 *                                          Take Long Rest in our UI
 *                                          to actually rest.
 *
 * Source ref: dnd5e v5.3.x `module/documents/actor/actor.mjs:2185`
 * fires `Hooks.call("dnd5e.preLongRest", actor, config)`.
 */
function registerLongRestIntercept() {
  Hooks.on("dnd5e.preLongRest", (actor, config) => {
    // Pass-through: our Take Long Rest button uses dialog:false,
    // so this branch lets that flow proceed through dnd5e's normal
    // rest mechanics (HP recovery, slots, etc.).
    if (config?.dialog === false) return; // undefined → don't cancel
    // Non-character actors (NPCs) keep dnd5e's default flow.
    if (actor?.type !== "character") return;
    // Divert to FM Overview. Returning false cancels the rest
    // (including dnd5e's LongRestDialog). The user clicks Take
    // Long Rest in our UI to re-enter with dialog:false.
    try {
      openFeatureManager(actor, { tab: "overview" });
    } catch (err) {
      console.warn(`${MODULE_ID} | preLongRest intercept open-FM failed`, err);
      // If the FM can't open (mid-init?), fall through to dnd5e's
      // default flow so the user can still rest.
      return;
    }
    return false; // cancel
  });
  log("Registered dnd5e.preLongRest intercept.");
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

/**
 * Register a GM-only scene controls toolbar button that opens the
 * Dauligor GM Console.
 *
 * Foundry v13's `getSceneControlButtons` hook passes an OBJECT keyed
 * by control name (this changed from v12's array form). Each entry
 * is a category card; each category carries `tools` (object keyed by
 * tool name). The category is visible iff `visible === true`, so we
 * gate on `game.user.isGM`. Tools with `button: true` fire `onChange`
 * on click without staying "active" (which is what we want — open the
 * window then immediately reset state).
 *
 * Reference:
 *   https://foundryvtt.com/api/functions/hookEvents.getSceneControlButtons.html
 *   https://foundryvtt.com/api/interfaces/foundry.SceneControl.html
 *   https://foundryvtt.com/api/interfaces/foundry.SceneControlTool.html
 */
function registerGmConsoleControl() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const isGm = game.user?.isGM === true;
    const key = `${MODULE_ID}-gm`;
    const entry = {
      name: key,
      title: "Dauligor GM Console",
      icon: "fas fa-shield-halved",
      order: 99,
      visible: isGm,
      tools: {
        open: {
          name: "open",
          title: "Open Dauligor GM Console",
          icon: "fas fa-window-maximize",
          order: 0,
          button: true,
          visible: isGm,
          onChange: () => openDauligorGmConsole()
        }
      }
    };
    // v13 object form (canonical):
    if (controls && typeof controls === "object" && !Array.isArray(controls)) {
      controls[key] = entry;
      return;
    }
    // v12 array form fallback — kept defensive in case a fork / patch
    // restores the legacy shape. v13 normally never hits this branch.
    if (Array.isArray(controls)) {
      controls.push({ ...entry, tools: Object.values(entry.tools) });
    }
  });
}

/**
 * Register the `dnd5e.restCompleted` hook so Dauligor pops the
 * Feature Manager + a confirm dialog after every long rest. The
 * dialog shows queued Spells changes (audit log from the FM's
 * embedded Prepare Spells mount) and gives the player a chance to
 * Save / Discard / Make more changes before the rest "finalizes".
 *
 * Short rests are intentionally NOT intercepted — the FM scope is
 * long-rest + level-up.
 *
 * dnd5e fires `dnd5e.restCompleted` with `(actor, result, config)`
 * where `result.longRest === true` for long rests. Older dnd5e
 * versions fired separate `dnd5e.longRestCompleted` events; support
 * both names with the same handler.
 */
function registerLongRestCommitHook() {
  const handler = async (actor, result, _config) => {
    if (!actor) return;
    // dnd5e v5.x: `result.longRest` is true for long rests, false for
    // short. Some older payloads use `result.type === "long"` — accept
    // either as the long-rest signal.
    const isLongRest = result?.longRest === true
      || result?.type === "long"
      || result?.longRest === undefined; // defensive fallback
    if (!isLongRest) return;
    if (actor.type !== "character") return;
    try {
      await promptLongRestCommit(actor);
    } catch (err) {
      console.warn(`${MODULE_ID} | long-rest commit prompt failed`, err);
    }
  };
  Hooks.on("dnd5e.restCompleted", handler);
  // Back-compat with older dnd5e versions that fired a dedicated
  // long-rest hook. v5.x merged into `restCompleted` but the legacy
  // name is still emitted by some forks / patches.
  Hooks.on("dnd5e.longRestCompleted", (actor, result) => handler(actor, { ...result, longRest: true }));
}

function registerSidebarButtons() {
  Hooks.on("renderActorDirectory", (_app, html) => {
    injectSidebarDirectoryButtons(resolveHookRoot(html));
  });

  Hooks.on("renderItemDirectory", (_app, html) => {
    injectSidebarDirectoryButtons(resolveHookRoot(html));
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
  const actions = [
    {
      id: "import",
      label: "Import",
      icon: "fas fa-book",
      hint: "Bring in classes, spells, feats, and more.",
      status: "ready",
      onSelect: async () => actorDoc ? openDauligorImporter({ actor: actorDoc }) : openDauligorImporter()
    },
    {
      id: "character-creator",
      label: "Character Creator",
      icon: "fas fa-user-plus",
      hint: actorDoc ? "Guided walkthrough applied to this actor." : "Guided walkthrough that builds a new character.",
      status: "ready",
      onSelect: async () => openDauligorCharacterCreator(actorDoc ? { actor: actorDoc } : {})
    },
    {
      id: "dauligor-library",
      label: "Dauligor Library",
      icon: "fas fa-book-open",
      hint: isLoggedIn()
        ? "Browse references, articles, and lore from the app."
        : "Log in to browse references, articles, and lore.",
      status: "ready",
      onSelect: async () => openDauligorLibrary()
    },
    {
      id: "dauligor-campaigns",
      label: "Dauligor Campaigns",
      icon: "fas fa-dragon",
      hint: isLoggedIn()
        ? "Open your campaign home pages."
        : "Log in to view your campaign home pages.",
      status: "ready",
      onSelect: async () => openDauligorCampaigns()
    },
    {
      id: "dauligor-account",
      label: isLoggedIn() ? `Account: ${getDisplayName() || "signed in"}` : "Log in to Dauligor",
      icon: "fas fa-user-lock",
      hint: isLoggedIn() ? "Manage your Dauligor account or log out." : "Log in to load references, articles, and campaign content.",
      status: "ready",
      onSelect: async () => openDauligorAccountDialog()
    }
  ];

  if (actorDoc) {
    actions.push({
      id: "actor-tools",
      label: "Actor Tools",
      icon: "fas fa-user-gear",
      hint: "Prepare spells, feature manager, and more.",
      status: "ready",
      onSelect: async () => openActorToolsHub(actorDoc)
    });
  }

  // Export Tools (GM only) — the Foundry→Dauligor folder export utilities,
  // grouped into a sub-launcher (moved here from the directory sidebars).
  if (game.user?.isGM) {
    actions.push({
      id: "export-tools",
      label: "Export Tools",
      icon: "fas fa-file-export",
      hint: "Export Foundry folders for Dauligor import research.",
      status: "ready",
      onSelect: async () => openExportToolsLauncher()
    });
  }

  actions.push(
    {
      id: "hp-gain-behavior",
      label: "HP Gain Behavior",
      icon: "fas fa-heart-circle-bolt",
      hint: "Configure how hit points are gained on level up.",
      status: "soon",
      onSelect: async () => openUnderConstructionDialog("HP Gain Behavior")
    },
    {
      id: "spell-points-behavior",
      label: "Spell Points Behavior",
      icon: "fas fa-wand-sparkles",
      hint: "Integrate with the Spell Points module.",
      status: "ready",
      onSelect: async () => openSpellPointsBehaviorDialog()
    },
    {
      id: "loot-generator",
      label: "Loot Generator",
      icon: "fas fa-coins",
      hint: "Roll up treasure and loot.",
      status: "soon",
      onSelect: async () => openUnderConstructionDialog("Loot Generator")
    },
    {
      id: "equipment-shop",
      label: "Equipment Shop",
      icon: "fas fa-cart-shopping",
      hint: "Browse and buy gear.",
      status: "soon",
      onSelect: async () => openUnderConstructionDialog("Equipment Shop")
    }
  );

  return openDauligorLauncher({
    title: actorDoc ? `Dauligor Options: ${actorDoc.name}` : "Dauligor Options",
    intro: actorDoc
      ? "Tools for this character. Greyed entries are coming soon."
      : "Greyed entries are coming soon.",
    actions
  });
}

async function openActorToolsHub(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor) {
    notifyWarn("Open actor tools from an actor sheet.");
    return;
  }

  return openDauligorLauncher({
    title: `Actor Tools: ${actor.name}`,
    intro: "Per-character tools. Greyed entries are coming soon.",
    actions: [
      {
        id: "prepare-spells",
        label: "Prepare Spells",
        icon: "fas fa-book-open",
        hint: "Manage this actor's prepared spells.",
        status: "ready",
        onSelect: async () => openSpellPreparationManager(actor)
      },
      {
        id: "feature-manager",
        label: "Feature Manager",
        icon: "fas fa-toolbox",
        hint: "Overview, features, and long-rest tools.",
        status: "ready",
        onSelect: async () => openFeatureManager(actor, { scope: "long-rest" })
      },
      {
        id: "item-cleaner",
        label: "Item Cleaner",
        icon: "fas fa-trash-can",
        hint: "Tidy up duplicate or orphaned items.",
        status: "soon",
        onSelect: async () => openUnderConstructionDialog("Item Cleaner", actor.name)
      },
      {
        id: "polymorpher",
        label: "Polymorpher",
        icon: "fas fa-paw",
        hint: "Transform into another creature.",
        status: "soon",
        onSelect: async () => openUnderConstructionDialog("Polymorpher", actor.name)
      },
      {
        id: "show-players",
        label: "Show Players",
        icon: "fas fa-eye",
        hint: "Display this sheet to your players.",
        status: "soon",
        onSelect: async () => openUnderConstructionDialog("Show Players", actor.name)
      }
    ]
  });
}

// Sub-launcher grouping the Foundry → Dauligor folder export tools (research /
// import-prep). Moved out of the directory sidebars to keep those uncluttered;
// reached via Dauligor Options → Export Tools (GM only). Each tile prompts its
// own folder picker, so it works regardless of which directory is open.
async function openExportToolsLauncher() {
  return openDauligorLauncher({
    title: "Dauligor Export Tools",
    intro: "Export a Foundry folder as a Dauligor research / import batch.",
    actions: [
      { id: "export-spell", label: "Spell Folder", icon: "fas fa-wand-magic-sparkles", hint: "Native spell items.", status: "ready", onSelect: () => promptAndExportSpellFolder() },
      { id: "export-feat", label: "Feat Folder", icon: "fas fa-medal", hint: "Class / race / background / general feats.", status: "ready", onSelect: () => promptAndExportFeatFolder() },
      { id: "export-item", label: "Item Folder", icon: "fas fa-box-archive", hint: "Weapons, armor, consumables, tools, loot.", status: "ready", onSelect: () => promptAndExportItemFolder() },
      { id: "export-background", label: "Background Folder", icon: "fas fa-scroll", hint: "Captures startingEquipment / wealth shapes.", status: "ready", onSelect: () => promptAndExportBackgroundFolder() },
      { id: "export-race", label: "Race Folder", icon: "fas fa-dragon", hint: "Captures movement / senses / creature-type.", status: "ready", onSelect: () => promptAndExportRaceFolder() },
      { id: "export-creature", label: "Creature Folder", icon: "fas fa-dragon", hint: "Full NPC stat blocks + embedded items.", status: "ready", onSelect: () => promptAndExportCreatureFolder() },
      { id: "export-actor", label: "Actor Folder", icon: "fas fa-users", hint: "Characters / NPCs / vehicles / groups.", status: "ready", onSelect: () => promptAndExportActorFolder() },
    ],
  });
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

// GM picker for the campaign's enabled sources. Writes a slug allow-list to
// SETTINGS.enabledSources; the Character Creator scopes its content to it (empty
// = all). Mirrors how the import wizard loads only selected sources — keeps the
// creator fast + reliable instead of fanning out across every source.
async function openCampaignSourcesDialog() {
  if (!game.user?.isGM) {
    notifyWarn("Only the GM can configure campaign sources.");
    return;
  }
  const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
  const host = mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";

  let sources = [];
  try {
    const res = await fetch(`${host}/api/module/sources/catalog.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload?.kind === "dauligor.source-catalog.v1") {
      sources = (Array.isArray(payload.entries) ? payload.entries : [])
        .map((e) => ({ slug: String(e?.slug ?? "").toLowerCase(), name: String(e?.name ?? e?.slug ?? "") }))
        .filter((s) => s.slug)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch (err) {
    log("campaign-sources: catalog fetch failed", err);
    notifyWarn("Couldn't load the source catalog — check the API Endpoint Mode setting and that the app is reachable.");
    return;
  }
  if (!sources.length) {
    notifyWarn("No sources available from the catalog.");
    return;
  }

  const current = new Set((game.settings.get(MODULE_ID, SETTINGS.enabledSources) || []).map(String));
  const allEnabled = current.size === 0; // empty setting = all sources
  const checkboxes = sources.map((s) => `
    <label class="dauligor-source-picker__row">
      <input type="checkbox" name="src" value="${foundry.utils.escapeHTML(s.slug)}" ${allEnabled || current.has(s.slug) ? "checked" : ""} />
      <span class="dauligor-source-picker__name">${foundry.utils.escapeHTML(s.name)}</span>
      <span class="dauligor-source-picker__slug">${foundry.utils.escapeHTML(s.slug)}</span>
    </label>`).join("");

  // Wire the Select all / none helpers once the next DialogV2 renders.
  Hooks.once("renderDialogV2", (_app, element) => {
    const root = element instanceof HTMLElement ? element : (element?.[0] ?? element?.element ?? null);
    if (!root?.querySelectorAll) return;
    const setAll = (v) => root.querySelectorAll('input[name="src"]').forEach((c) => { c.checked = v; });
    root.querySelector('[data-act="all"]')?.addEventListener("click", () => setAll(true));
    root.querySelector('[data-act="none"]')?.addEventListener("click", () => setAll(false));
  });

  let result;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Campaign Sources" },
      classes: ["dauligor-importer-app", "dauligor-importer-app--campaign-sources"],
      position: { width: 540 },
      content: `
        <div class="dauligor-source-picker">
          <p class="dauligor-source-picker__hint">Choose which sources the Character Creator offers (backgrounds, species, feats, classes). Fewer sources load faster. Leaving every source checked includes everything (the default) and auto-includes sources added later.</p>
          <div class="dauligor-source-picker__tools">
            <button type="button" data-act="all"><i class="fas fa-check-double"></i> Select all</button>
            <button type="button" data-act="none"><i class="fas fa-xmark"></i> Select none</button>
          </div>
          <div class="dauligor-source-picker__grid">
            ${checkboxes}
          </div>
        </div>
      `,
      ok: {
        label: "Save",
        callback: (_event, button) =>
          Array.from(button.form.querySelectorAll('input[name="src"]:checked')).map((i) => i.value)
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return;
  }
  if (result == null) return; // dismissed

  const total = sources.length;
  // All checked (or none) → store [] meaning "all sources": future-proof and
  // never strands the creator with an empty pool.
  const toSave = (result.length === 0 || result.length >= total) ? [] : result;
  await game.settings.set(MODULE_ID, SETTINGS.enabledSources, toSave);
  notifyInfo(toSave.length
    ? `Campaign sources: ${toSave.length} of ${total} enabled. Reopen the Character Creator to apply.`
    : "Campaign sources: all sources enabled.");
}

// Dauligor account login / status — per-user, native auth. Opened from the
// launcher. Logged out → username+password → POST /api/auth/login (auth-service).
// Logged in → status + Log out. Reuses the dauligor-importer-app window theme.
async function openDauligorAccountDialog() {
  const DialogV2 = foundry.applications.api.DialogV2;
  const themeClasses = ["dauligor-importer-app", "dauligor-importer-app--campaign-sources"];

  if (isLoggedIn()) {
    const who = getDisplayName() || "your account";
    const role = getProfile()?.role;
    let out = null;
    try {
      out = await DialogV2.prompt({
        window: { title: "Dauligor Account" },
        classes: themeClasses,
        position: { width: 440 },
        content: `<div class="dauligor-source-picker">
          <p class="dauligor-source-picker__hint">Logged in as <strong>${foundry.utils.escapeHTML(who)}</strong>${role ? ` <span style="opacity:.6;">(${foundry.utils.escapeHTML(String(role))})</span>` : ""}. Close this to stay signed in, or log out below.</p>
        </div>`,
        ok: { label: "Log out", icon: "fas fa-right-from-bracket", callback: () => "logout" },
        rejectClose: false,
        modal: true,
      });
    } catch {
      return;
    }
    if (out === "logout") {
      await logout();
      notifyInfo("Logged out of Dauligor.");
    }
    return;
  }

  let result;
  try {
    result = await DialogV2.prompt({
      window: { title: "Log in to Dauligor" },
      classes: themeClasses,
      position: { width: 440 },
      content: `<div class="dauligor-source-picker">
        <p class="dauligor-source-picker__hint">Log in with your Dauligor account to load references, articles, and campaign content inside Foundry.</p>
        <label style="display:flex; flex-direction:column; gap:3px; font-size:12px;">Username
          <input type="text" name="username" autofocus autocomplete="username" />
        </label>
        <label style="display:flex; flex-direction:column; gap:3px; font-size:12px;">Password
          <input type="password" name="password" autocomplete="current-password" />
        </label>
      </div>`,
      ok: {
        label: "Log in",
        icon: "fas fa-right-to-bracket",
        callback: (_event, button) => ({
          username: button.form.elements.username.value,
          password: button.form.elements.password.value,
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }
  if (!result || !result.username || !result.password) return;
  try {
    const profile = await login(result.username, result.password);
    notifyInfo(`Logged in as ${profile?.display_name || profile?.username || result.username}.`);
  } catch (err) {
    notifyWarn(err?.message || "Login failed.");
  }
}

// A whispered chat card that nudges the user to log into their Dauligor account,
// with a button that opens the login dialog. Posted on ready when logged out.
async function postLoginChatCard() {
  try {
    const content = `
      <div class="dauligor-login-card">
        <p class="dauligor-login-card__msg"><i class="fas fa-dragon"></i> Log in to your <strong>Dauligor</strong> account to load references, articles, and campaign content in Foundry.</p>
        <button type="button" class="dauligor-login-card__btn" data-action="dauligor-login"><i class="fas fa-right-to-bracket"></i> Log in to Dauligor</button>
      </div>`;
    await ChatMessage.create({
      content,
      whisper: [game.user.id],
      speaker: { alias: "Dauligor" },
      flags: { [MODULE_ID]: { loginPrompt: true } },
    });
  } catch (err) {
    log("auth: failed to post login chat card", err);
  }
}

// True when a login-prompt card already exists for this user — so reloading while
// logged out doesn't keep stacking duplicate nudges in the chat log.
function hasLoginPromptCard() {
  try {
    return (game.messages ?? []).some((m) =>
      m.getFlag?.(MODULE_ID, "loginPrompt") && (m.whisper ?? []).includes(game.user.id));
  } catch {
    return false;
  }
}

// Bind the login button on any rendered Dauligor login card. v13:
// renderChatMessageHTML passes a raw HTMLElement (jQuery is gone in AppV2) — we
// still normalize defensively.
function registerLoginChatPrompt() {
  Hooks.on("renderChatMessageHTML", (_message, html) => {
    const el = html instanceof HTMLElement ? html : (html?.[0] ?? null);
    const btn = el?.querySelector?.(`[data-action="dauligor-login"]`);
    if (btn) btn.addEventListener("click", () => openDauligorAccountDialog());
  });
  // Let other Dauligor windows (e.g. the Library viewer) request the account /
  // login dialog without importing main.js — avoids a circular import.
  Hooks.on(`${MODULE_ID}.requestLogin`, () => openDauligorAccountDialog());
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
      <button type="button" data-action="campaign-sources">
        <i class="fas fa-book-atlas"></i> Campaign Sources
      </button>
      <button type="button" data-action="open-options">
        <i class="fas fa-screwdriver-wrench"></i> Open Options
      </button>
    </div>
    <p class="hint">Campaign Sources controls which sourcebooks the Character Creator offers (fewer sources load faster).</p>
  `;

  wrapper.querySelector(`[data-action="open-importer"]`)?.addEventListener("click", async () => {
    await openDauligorImporter();
  });
  wrapper.querySelector(`[data-action="campaign-sources"]`)?.addEventListener("click", async () => {
    await openCampaignSourcesDialog();
  });
  wrapper.querySelector(`[data-action="open-options"]`)?.addEventListener("click", async () => {
    await openLauncher();
  });

  anchor.insertAdjacentElement("afterend", wrapper);
}

function injectSidebarDirectoryButtons(root) {
  if (!game.user?.isGM) return;
  if (!root || root.querySelector?.(`[data-${MODULE_ID}-sidebar-tools]`)) return;

  const anchor = root.querySelector(".header-actions.action-buttons") ?? root.querySelector(".header-actions");
  if (!anchor?.parentElement) return;

  const wrapper = document.createElement("div");
  wrapper.className = "header-actions action-buttons dauligor-directory-tools";
  wrapper.setAttribute(`data-${MODULE_ID}-sidebar-tools`, "true");
  // Import + Options only. The folder-export tools moved into the Dauligor
  // Options launcher ("Export Tools", GM only) so the directory header stays
  // uncluttered; the pickers there work regardless of which directory is open.
  wrapper.innerHTML = `
    <button type="button" class="dauligor-directory-tools__button dauligor-directory-tools__button--primary" data-action="open-importer" title="Open Dauligor Importer">
      <i class="fas fa-book"></i>
      <span>Dauligor Import</span>
    </button>
    <button type="button" class="dauligor-directory-tools__button dauligor-directory-tools__button--icon" data-action="open-options" title="Open Dauligor Options">
      <i class="fas fa-screwdriver-wrench"></i>
    </button>
  `;

  wrapper.querySelector(`[data-action="open-importer"]`)?.addEventListener("click", async () => {
    await openDauligorImporter();
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

// Feat folder choices — same shape as the spell variant, just
// counting `item.type === "feat"` instead. Folders with zero feats
// are filtered out so the dropdown stays tight.
function collectFeatFolderChoices() {
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

      const featCount = Array.from(game.items ?? []).filter((item) =>
        item.type === "feat"
        && descendants.has(item.folder?.id ?? "")
      ).length;

      return {
        folder,
        path: getItemFolderPath(folder),
        featCount,
      };
    })
    .filter((entry) => entry.featCount > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  return folders;
}

async function promptAndExportFeatFolder() {
  const choices = collectFeatFolderChoices();
  if (!choices.length) {
    notifyWarn("No Item folders with feat items were found in this world.");
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.featCount} feats)`)}
    </option>
  `).join("");

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Export Feat Folder" },
      content: `
        <div class="form-group">
          <label>Feat folder</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all native Foundry feat items in the selected Item folder as a Dauligor research/import batch. Feats cover class features, race features, background features, and general feats.</p>
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
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked),
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected feat folder could not be found.");
    return;
  }

  await exportFeatFolder(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

// ─── Background + Race folder export pickers ────────────────────────
//
// Backgrounds and races are their own Foundry Item document types. These
// pickers mirror the feat picker but count `item.type === "background"` /
// `"race"`. Export-first: the goal is to hand the Dauligor app the real
// Foundry shapes (startingEquipment / wealth for backgrounds; movement /
// senses / creature-type for races) so it can build dedicated columns
// before the import round-trip is wired.

function collectItemTypeFolderChoices(docType) {
  return Array.from(game.folders ?? [])
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
      const count = Array.from(game.items ?? []).filter((item) =>
        item.type === docType && descendants.has(item.folder?.id ?? "")
      ).length;
      return { folder, path: getItemFolderPath(folder), count };
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function promptAndExportFeatFamilyFolder({ docType, noun, title, exportFn }) {
  const choices = collectItemTypeFolderChoices(docType);
  if (!choices.length) {
    notifyWarn(`No Item folders with ${noun} were found in this world.`);
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.count} ${noun})`)}
    </option>
  `).join("");

  const label = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} folder`;
  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `
        <div class="form-group">
          <label>${label}</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all native Foundry ${docType} items in the selected Item folder, capturing the full Foundry shape so the Dauligor app can model its ${noun} table.</p>
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
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked),
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected folder could not be found.");
    return;
  }

  await exportFn(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

function promptAndExportBackgroundFolder() {
  return promptAndExportFeatFamilyFolder({
    docType: "background",
    noun: "backgrounds",
    title: "Export Background Folder",
    exportFn: exportBackgroundFolder,
  });
}

function promptAndExportRaceFolder() {
  return promptAndExportFeatFamilyFolder({
    docType: "race",
    noun: "races",
    title: "Export Race Folder",
    exportFn: exportRaceFolder,
  });
}

// ─── Item folder export ─────────────────────────────────────────────
//
// Same shape as the feat + spell folder pickers. The set of item.types
// counted here MUST stay in sync with ITEM_FOLDER_TYPES in
// export-service.js (weapon / equipment / consumable / tool / loot /
// container / backpack). If a folder mixes class/subclass/spell/feat
// docs alongside physical items, only the physical ones are counted —
// the other types have their own dedicated exporters.

const ITEM_FOLDER_EXPORT_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

function collectItemFolderChoices() {
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

      const itemCount = Array.from(game.items ?? []).filter((item) =>
        ITEM_FOLDER_EXPORT_TYPES.includes(item.type)
        && descendants.has(item.folder?.id ?? "")
      ).length;

      return {
        folder,
        path: getItemFolderPath(folder),
        itemCount,
      };
    })
    .filter((entry) => entry.itemCount > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  return folders;
}

async function promptAndExportItemFolder() {
  const choices = collectItemFolderChoices();
  if (!choices.length) {
    notifyWarn("No Item folders with physical items (weapons / armor / consumables / tools / loot / containers) were found in this world.");
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.itemCount} items)`)}
    </option>
  `).join("");

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Export Item Folder" },
      content: `
        <div class="form-group">
          <label>Item folder</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all physical Foundry items in the selected folder as a Dauligor research/import batch. Covers weapons, armor / worn gear (equipment), consumables, tools, loot, and containers. Spells, feats, classes, subclasses, races, backgrounds, and facilities are excluded — they have their own export paths.</p>
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
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked),
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected item folder could not be found.");
    return;
  }

  await exportItemFolder(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

// ─── Actor folder export ────────────────────────────────────────────
//
// Actor folders live in the Actor directory (their `type` field is
// "Actor", not "Item"). Same dialog shape as the item picker —
// folder dropdown + "include subfolders" checkbox.
//
// The set of actor.type values MUST stay in sync with
// ACTOR_FOLDER_TYPES in export-service.js (character / npc / vehicle
// / group). `encounter` is intentionally excluded — it's an
// org-tool document, not a creature.

const ACTOR_FOLDER_EXPORT_TYPES = ["character", "npc", "vehicle", "group"];

function collectActorFolderChoices() {
  const folders = Array.from(game.folders ?? [])
    .filter((folder) => folder.type === "Actor")
    .map((folder) => {
      const descendants = new Set([folder.id]);
      const queue = [folder.id];
      while (queue.length) {
        const parentId = queue.shift();
        for (const candidate of Array.from(game.folders ?? [])) {
          if (candidate.type !== "Actor") continue;
          if ((candidate.folder?.id ?? null) !== parentId) continue;
          if (descendants.has(candidate.id)) continue;
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }

      const actorCount = Array.from(game.actors ?? []).filter((actor) =>
        ACTOR_FOLDER_EXPORT_TYPES.includes(actor.type)
        && descendants.has(actor.folder?.id ?? "")
      ).length;

      return {
        folder,
        path: getItemFolderPath(folder),  // path traversal works for any Folder type
        actorCount,
      };
    })
    .filter((entry) => entry.actorCount > 0)
    .sort((a, b) => a.path.localeCompare(b.path));

  return folders;
}

async function promptAndExportActorFolder() {
  const choices = collectActorFolderChoices();
  if (!choices.length) {
    notifyWarn("No Actor folders with characters / npcs / vehicles / groups were found in this world.");
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.actorCount} actors)`)}
    </option>
  `).join("");

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Export Actor Folder" },
      content: `
        <div class="form-group">
          <label>Actor folder</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all Foundry actor documents in the selected folder as a Dauligor research/import batch. Covers characters, npcs, vehicles, and groups. Encounter documents (org-tool scaffolds, not creatures) are excluded.</p>
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
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked),
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected actor folder could not be found.");
    return;
  }

  await exportActorFolder(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

// ─── Creature folder export picker ──────────────────────────────────
//
// Actor-folder picker scoped to `npc` only (creatures / monsters). The
// generic actor picker above covers all actor types; this one targets
// stat-block evidence for the future Dauligor creatures table.

function collectCreatureFolderChoices() {
  return Array.from(game.folders ?? [])
    .filter((folder) => folder.type === "Actor")
    .map((folder) => {
      const descendants = new Set([folder.id]);
      const queue = [folder.id];
      while (queue.length) {
        const parentId = queue.shift();
        for (const candidate of Array.from(game.folders ?? [])) {
          if (candidate.type !== "Actor") continue;
          if ((candidate.folder?.id ?? null) !== parentId) continue;
          if (descendants.has(candidate.id)) continue;
          descendants.add(candidate.id);
          queue.push(candidate.id);
        }
      }
      const count = Array.from(game.actors ?? []).filter((actor) =>
        actor.type === "npc" && descendants.has(actor.folder?.id ?? "")
      ).length;
      return { folder, path: getItemFolderPath(folder), count };
    })
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function promptAndExportCreatureFolder() {
  const choices = collectCreatureFolderChoices();
  if (!choices.length) {
    notifyWarn("No Actor folders with creature (npc) actors were found in this world.");
    return;
  }

  const optionsHtml = choices.map((entry) => `
    <option value="${foundry.utils.escapeHTML(entry.folder.id)}">
      ${foundry.utils.escapeHTML(`${entry.path} (${entry.count} creatures)`)}
    </option>
  `).join("");

  let result = null;
  try {
    result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Export Creature Folder" },
      content: `
        <div class="form-group">
          <label>Creature folder</label>
          <select name="folderId" autofocus>
            ${optionsHtml}
          </select>
          <p class="hint">Exports all native Foundry NPC actors in the selected Actor folder — full stat blocks plus embedded items — so the Dauligor app can model a creatures table before the import round-trip is wired.</p>
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
          includeSubfolders: Boolean(button.form.elements.includeSubfolders.checked),
        }),
      },
      rejectClose: false,
      modal: true,
    });
  } catch {
    return;
  }

  const folder = game.folders.get(result?.folderId ?? "");
  if (!folder) {
    notifyWarn("The selected creature folder could not be found.");
    return;
  }

  await exportCreatureFolder(folder, { includeSubfolders: result?.includeSubfolders !== false });
}

function injectSpellTabButton(appLike, root) {
  const actor = resolveActorDocument(appLike?.document ?? appLike?.actor ?? appLike);
  if (!actor || actor.type !== "character") return;
  if (!root) return;

  // Per-class Prepare buttons sit on each `.spellcasting.card` header.
  injectPerClassPrepareButtons(actor, root);

  // Global Prepare-Spells entry point: small book icon on the spells
  // tab's search/filter toolbar (the `.middle` container that wraps
  // `<item-list-controls>`). Replaces the wide
  // "Dauligor Prepare Spells" button we used to sit above the list.
  injectSpellTabToolbarButton(actor, root);
}

/**
 * Inject a single Dauligor book-icon button into the Spells tab's
 * search/filter toolbar. dnd5e renders the toolbar as
 *   <div class="middle">
 *     <item-list-controls for="spells" ...>...</item-list-controls>
 *   </div>
 * — we append our icon as a sibling of `<item-list-controls>` so it
 * sits at the trailing edge of the toolbar row, next to the sort /
 * filter icons that `<item-list-controls>` renders on the right.
 *
 * Clicking opens the Dauligor Prepare Spells manager without a
 * pre-selected class (the per-class chip buttons handle pre-selection
 * for the user). If the toolbar isn't present in the current render
 * (rare — only when the sheet has no spell list at all), we silently
 * skip and the per-class buttons remain as the only entry point.
 */
function injectSpellTabToolbarButton(actor, root) {
  if (!actor || !root) return;
  const spellsTab = root.querySelector(`section.tab[data-tab="spells"], [data-tab="spells"]`);
  if (!spellsTab) return;

  // Prefer the `.middle` wrapper because that's the row-flow container
  // dnd5e uses. Fall back to the item-list-controls element's parent
  // in case the template variant doesn't wrap in `.middle`.
  const toolbar = spellsTab.querySelector(`.middle`)
    ?? spellsTab.querySelector(`item-list-controls`)?.parentElement
    ?? null;
  if (!toolbar) return;
  if (toolbar.querySelector(`:scope > [data-${MODULE_ID}-prepare-toolbar-button]`)) return;

  const button = document.createElement("button");
  button.type = "button";
  // Re-use the same gold-bordered icon-button styling that the
  // per-class chips on `.spellcasting.card` use — same visual
  // language, one less custom CSS class to maintain.
  button.className = "dauligor-class-prepare-button dauligor-class-prepare-button--toolbar";
  button.setAttribute(`data-${MODULE_ID}-prepare-toolbar-button`, "true");
  button.setAttribute("aria-label", "Dauligor Prepare Spells");
  button.setAttribute("data-tooltip", "Dauligor Prepare Spells");
  button.innerHTML = `<i class="fas fa-book-open"></i>`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openSpellPreparationManager(actor);
  });
  toolbar.appendChild(button);
}

/**
 * Injects a small "Prepare" button into each "{ClassName} Spellcasting"
 * card header on the Spells tab. Clicking opens the Dauligor spell
 * preparation manager pre-selected to that class.
 *
 * dnd5e v5.x renders these cards from
 * `templates/actors/tabs/creature-spells.hbs` →
 * `section.tab[data-tab="spells"] .spellcasting.card[data-ability]`.
 * The card has no class-id attribute (dnd5e's `_prepareSpellcasting`
 * only emits `data-ability`), so we match by parsing the `<h3>`
 * heading "{ClassName} Spellcasting" against the actor's class items.
 * Fallback for non-English locales: unique-ability match (only when
 * one class on the actor uses that ability).
 *
 * Earlier revisions also injected on the Features tab's
 * `.class.pill-lg` rows but that was removed — the Spells tab is
 * where the user actually wants the entry point.
 *
 * If no selector matches in a given render the injection silently
 * no-ops and the global "Dauligor Prepare Spells" button on the
 * spells tab remains as a fallback entry point.
 */
function injectPerClassPrepareButtons(actor, root) {
  if (!actor || actor.type !== "character" || !root) return;
  const spellcastingClasses = actor.spellcastingClasses ?? {};
  const classEntries = Object.entries(spellcastingClasses);
  if (!classEntries.length) return;

  // --- Spells tab only — `.spellcasting.card` headers -------------
  // Earlier we also injected on the Features tab's `.class.pill-lg`
  // rows, but the user only wants the icon on the Spells tab to
  // avoid duplicate visual noise next to the dnd5e class roster.
  // We get one card per spellcasting class on the actor. Match each
  // card to a class by heading text first (locale-agnostic for
  // English; the dnd5e i18n key is `DND5E.SpellcastingClass` →
  // "{class} Spellcasting"). If the heading parse misses, fall back
  // to data-ability matching when exactly one class on the actor
  // uses that ability (multi-class with shared ability silently
  // skips — better that than mis-attributing).
  const cards = root.querySelectorAll(`section.tab[data-tab="spells"] .spellcasting.card, .spellcasting.card`);
  for (const card of cards) {
    const header = card.querySelector(".header");
    if (!header) continue;
    if (header.querySelector(`:scope > [data-${MODULE_ID}-prepare-class-button]`)) continue;

    const headingText = String(card.querySelector(".header h3")?.textContent ?? "").trim();
    let matched = null;
    // Heading match (English locale): the card heading is "{class}
    // Spellcasting" per the `DND5E.SpellcastingClass` i18n key. Match
    // by `startsWith(name + " ")` so a class whose name is a prefix
    // of another (e.g. "Bard" vs a hypothetical "Bardlite") doesn't
    // collide. Exact match on the full label is also accepted.
    for (const [identifier, classItem] of classEntries) {
      const name = String(classItem?.name ?? "").trim();
      if (!name) continue;
      if (!headingText) continue;
      if (headingText === name || headingText.startsWith(`${name} `)) {
        matched = { identifier, classItem };
        break;
      }
    }
    // Fallback: data-ability disambiguates only when one class uses
    // it. Locale-safe but less precise.
    if (!matched) {
      const ability = card.dataset?.ability;
      if (ability) {
        const candidates = classEntries.filter(([, cls]) =>
          String(cls?.system?.spellcasting?.ability ?? "") === ability
        );
        if (candidates.length === 1) {
          const [identifier, classItem] = candidates[0];
          matched = { identifier, classItem };
        }
      }
    }
    if (!matched) continue;
    mountClassPrepareButton(header, actor, matched.identifier, matched.classItem, /* anchor= */ header);
  }
}

function mountClassPrepareButton(uniquenessScope, actor, identifier, classItem, anchor) {
  // `uniquenessScope` is where we read for the duplicate-check; the
  // `anchor` is where we actually append. They're usually the same
  // element, but allowing them to differ lets us scope-match inside
  // a parent while injecting into a child.
  if (uniquenessScope.querySelector(`:scope > [data-${MODULE_ID}-prepare-class-button]`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dauligor-class-prepare-button";
  button.setAttribute(`data-${MODULE_ID}-prepare-class-button`, identifier);
  button.setAttribute("aria-label", `Dauligor Prepare ${classItem.name} spells`);
  button.setAttribute("data-tooltip", `Prepare ${classItem.name} spells`);
  button.innerHTML = `<i class="fas fa-book-open"></i>`;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await openSpellPreparationManager(actor, { preselectClassIdentifier: identifier });
  });
  anchor.appendChild(button);
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
