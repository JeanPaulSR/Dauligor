# UI Entry Points & Visibility Model

Every way a user reaches a Dauligor tool inside Foundry, and the GM-vs-player
visibility rules for each. Keep this in sync when adding or gating UI — it is the
reference for "who can see what" so access isn't accidentally broken or widened.

**Related docs**
- [`page-system.md`](page-system.md) (Library), [`import-wizard.md`](import-wizard.md) (importer), [`native-auth.md`](native-auth.md) (login card/dialog).

## Visibility tiers

| Tier | Meaning |
|---|---|
| **All users** | Every connected user, GM or player. |
| **Owner-or-GM** | A user who owns the actor whose sheet is open (or any GM). |
| **GM-only** | `game.user.isGM` only. |

## Entry points

| Entry point | Hook / location | Opens | Visibility |
|---|---|---|---|
| **Launcher** ("Dauligor Options") | actor sheet header control; settings header control; sidebar button | `openLauncher` (role-aware tiles) | sheet header: **owner-or-GM**; settings + sidebar: **GM-only** |
| **Dauligor Import** | actor sheet header control | the import wizard for that actor | **owner-or-GM** |
| **Dauligor Level Up** | actor sheet header control (when the actor has levelable Dauligor classes) | level-up via the importer | **GM-only** |
| **Feature Manager** | rest-bar button on the character sheet; `Actor Tools` launcher tile; long-rest intercept | `openFeatureManager(actor)` | the character sheet's viewer (owner/GM) |
| **Sidebar directory buttons** | `renderActorDirectory` / `renderItemDirectory` | Dauligor Import + Options | **GM-only** (whole injection returns early for non-GM) |
| **Dauligor Tools** (settings) | `renderSettingsConfig` | Open Importer, Campaign Sources, Open Options | **GM-only** |
| **GM Console** | scene-controls toolbar (`getSceneControlButtons`) | `openDauligorGmConsole` | **GM-only** |
| **Open Importer keybinding** | `game.keybindings` (`restricted: true`) | the import wizard | **GM-only** (restricted keybinding) |
| **Login chat card** | `ready` hook, when logged out | the account dialog | **All users** (whispered per user) |

The gate for header controls is `injectControl`'s `visible` predicate — **GM-only
by default**; callers pass `visible: () => isGM || sheet.document?.isOwner` for the
player-facing controls (Options, Import).

## Launcher tiles (`openLauncher`)

`openLauncher` builds a role-aware tile set:

| Tile | Visibility |
|---|---|
| Import | All users |
| Character Creator | All users |
| Dauligor Library | All users |
| Dauligor Campaigns | All users |
| Account (log in / status) | All users |
| Actor Tools | All users (only when opened with an actor) |
| **Export Tools** | **GM-only** |
| HP Gain Behavior · Spell Points Behavior · Loot Generator · Equipment Shop | **GM-only** (config / "soon" tools) |

A player reaches the launcher from **their own character sheet header** (Dauligor
Options), so they get Import, Character Creator, Library, Campaigns, Account, and
Actor Tools for their own character; the GM-only tiles stay hidden. The intro
caption is tailored (players have no greyed "soon" tiles).

## Export Tools (sub-launcher)

`openExportToolsLauncher` is a GM-only sub-launcher grouping the seven Foundry →
Dauligor folder-export tools (Spell / Feat / Item / Background / Race / Creature /
Actor folders). It was moved out of the directory sidebars (which now show only
Import + Options) so the sidebar header stays uncluttered; each tile prompts its
own folder picker, so it works regardless of which directory is open.

## Feature Manager placeholder cards

Three Feature Manager tabs are informational placeholders rendered by
`_renderPlaceholderTab({ title, message, hint, status })` (an optional `status`
badge; an optional `hint`):

| Tab | Status | Description |
|---|---|---|
| Crafting Projects | **In Progress** | "Track downtime crafting projects and queue up crafting ahead of time." |
| Feat Picks | — | "Retrain your feats on level up." · hint: "Integrates with the existing importer level-up flow." |
| Class Advancement | — | "Replace current Advancements with new ones on level up." · hint: "Integrates with the existing importer level-up flow." |

## Policy: gate at the entry, not inside the tool

The tools themselves are **permission-agnostic** — e.g. the import wizard shows
every import type to every user. What actually succeeds is governed by Foundry's
own permission system (a player can embed items on their own actor; creating world
items needs the world's "Create New Items" permission). Do **not** re-introduce
per-type role gates inside a tool; restrict access at the entry point (the `visible`
predicate / a GM-only injection) instead, and let Foundry enforce the rest.

## Reasoned decisions

- **Players reach tools from their own sheet, not the sidebar/settings.** The
  sidebar, settings, scene-controls, and keybinding entries are GM-authoring
  surfaces and stay GM-only; the per-character sheet header is the player's door
  to the launcher (and thus the Library, Creator, Account, and Actor Tools).
- **Export + config tools are GM-only** because they are authoring/research and
  world-configuration utilities, not player-facing content.
- The exact set of GM-only vs all-user items above is the confirmed model — change
  it only on request.
