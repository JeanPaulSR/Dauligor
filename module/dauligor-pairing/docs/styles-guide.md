# Dauligor Pairing — Styles Guide

How the module's CSS is organized, where each component lives, and the
conventions to follow when adding or changing styles. Companion to the
component code in `scripts/`.

> The former monolithic `styles/dauligor-importer.css` (7,228 lines) was split
> into the per-area files below on 2026-05-30. If you're looking for a class,
> use the **Component → file map**.

## Load order (fixed in `module.json`)

CSS cascade depends on load order, so the `styles[]` array order is deliberate:

1. `tokens.css` — design tokens (must load first; everything references them)
2. `base.css` — cross-cutting primitives (resets, the canonical button, animations)
3. `importer-wizard.css`
4. `class-browser.css`
5. `option-picker.css`
6. `asi.css`
7. `overview.css`
8. `spell-manager.css`
9. `feature-manager.css`
10. `section-filter.css`
11. `feat-browser.css`
12. `character-sheet.css`
13. `directory-tools.css`
14. `gm-console.css`
15. `character-creator.css`
16. `launcher.css`
17. `responsive.css` — **all `@media` blocks, loaded last** so they override

Components 3–14 are BEM-isolated (`.dauligor-<block>__element`), so their order
relative to each other rarely matters. `tokens`/`base` first and `responsive`
last are the load-order rules that *do* matter.

## Component → file map

| Component block(s) | File | What it is |
|---|---|---|
| token definitions (`--dauligor-*`) | `tokens.css` | the palette + button tokens + accent-tint channels; also `.dauligor-section-filter`'s local search-width var |
| `__button` base, box-sizing reset, `dauligor-chat-spell-change`, `@keyframes`, `.application` / non-`dauligor` base, **`.dauligor-detail*`** (shared detail pane) | `base.css` | shared primitives |
| `importer`, `importer-app`, `importer-window`, `wizard`, `sequence`, `class-options` | `importer-wizard.css` | the import wizard window, its chrome + state modifiers, the sequenced actor-import flow, class-options regions |
| `class-browser`, `subclass-preview` | `class-browser.css` | the class browser + subclass preview popup |
| `option-picker` | `option-picker.css` | the option-group picker (shared by importer + feature manager) |
| `asi` | `asi.css` | the custom ability-score-improvement app |
| `overview` | `overview.css` | the import overview/summary surface |
| `spell-manager`, `spell-picker` | `spell-manager.css` | the Prepare Spells manager + Spell Browser (largest file) |
| `feature-manager` | `feature-manager.css` | the post-import Feature Manager (Overview/Features/Spells tabs) |
| `section-filter` | `section-filter.css` | the shared tri-state filter panel |
| `feat-browser` | `feat-browser.css` | the feat / background / race browser |
| `character-sheet`, `class-prepare-button`, `pairing` | `character-sheet.css` | the alt character sheet + the neutral Prepare button |
| `directory-tools`, `spell-tab-tools` | `directory-tools.css` | injected sidebar / sheet-tab buttons |
| `gm-console` | `gm-console.css` | the GM console window |
| `character-creator` | `character-creator.css` | the Character Creator walkthrough wizard |
| `launcher` | `launcher.css` | the Dauligor Options / Actor Tools hub window (tile menu) |
| all `@media` | `responsive.css` | responsive overrides for every window |

> New blocks must also be added to the **token roots** in `tokens.css` (the
> vars-only list) so `var(--dauligor-…)` resolves on a standalone window —
> `character-creator` + `launcher` are registered there. Forgetting this is
> why a new window can render with the right markup but no theme.

**Fast lookup:** to find a class, `grep -rn "dauligor-<block>__" styles/`. The
block prefix maps to a file via the table above.

## Design tokens (`tokens.css`)

Defined on the themed window roots (and a vars-only block that makes them
available to standalone windows). Reference with `var(--dauligor-…)`.

| Token | Value | Use |
|---|---|---|
| `--dauligor-border` | `#5c5c5c` | borders/dividers |
| `--dauligor-panel` | `#1f1f1f` | window background |
| `--dauligor-panel-alt` | `#252525` | alt panel |
| `--dauligor-panel-soft` | `#313131` | raised/soft panel |
| `--dauligor-text` | `#c9c7c0` | body text |
| `--dauligor-text-muted` | `#9a978f` | secondary text |
| `--dauligor-accent` | `#8f8a79` | accent |
| `--dauligor-accent-strong` | `#c9c7c0` | strong accent |
| `--dauligor-success` / `-warning` / `-danger` | `#7ea86f` / `#9e7f49` / `#a5645a` | status |
| `--dauligor-include*` / `-exclude*` | (tri-state filter) | section-filter include/exclude states |
| **`--dauligor-accent-tint`** | `170, 130, 80` | **RGB channels** — warm tan tint, used as `rgba(var(--dauligor-accent-tint), α)` for soft borders/fills at per-use alpha |
| **`--dauligor-accent-gold`** | `181, 136, 56` | RGB channels — stronger gold tint, same pattern |
| `--dauligor-btn-bg` / `-btn-hover-bg` / `-btn-border` / `-btn-border-hover` | (Foundry-derived) | button surfaces; pull from dnd5e v5 vars with hardcoded fallbacks |

> The two tint channels replaced a set of phantom tokens
> (`--dauligor-border-soft`, `-surface-muted`, `-accent-soft`, `-surface-hover`)
> that were referenced but never defined. Always reference them as
> `rgba(var(--dauligor-accent-tint, 170, 130, 80), α)` — the fallback keeps the
> color alive if a window doesn't inherit the token.

## Conventions

- **Naming: BEM.** `.dauligor-<block>__<element>--<modifier>`. One block per
  window/app. New window ⇒ new block ⇒ new file (add it to `module.json` in the
  components section and to the map above).
- **Canonical button.** The flat-button *visual identity* (token bg/border,
  square corners, gold hover, disabled state) lives in **`base.css`** and is
  shared by `wizard` / `class-browser` / `spell-tab-tools` / `spell-manager`
  buttons. Don't redefine the button look in a component file — add your
  selector to the canonical rule in `base.css` and keep only *layout* deltas
  (icon+label flex, grid, full-width) locally. Button **variants** currently sit
  with their window: `--primary` (importer-wizard.css), `--icon` / `--active`
  (class-browser.css), `--wide` (spell-manager.css). `directory-tools__button`
  is intentionally *not* canonical — it inherits Foundry's native sidebar button.
- **Colors → tokens.** Use `var(--dauligor-…)` (or the `rgba(var(--…-tint), α)`
  pattern). Hardcode a hex only for a genuine one-off shade not in the palette.
- **`@media` → `responsive.css`.** Put responsive overrides there (loaded last),
  not inline in a component file.
- **Cross-block "bridge" selectors** (e.g.
  `.dauligor-importer-app--sequence-prompt .dauligor-class-options__region`,
  `.dauligor-feature-manager__spells-host > .dauligor-spell-manager`,
  `.dauligor-asi__toolbar .dauligor-class-browser__subtitle`) live in the file
  of the **containing** (leftmost) block. Keep it that way so the override stays
  predictable.

## Window model (AppV2 sizing + layout) — follow this for every new window

All Dauligor windows use one model. Diverging from it is what caused the
launcher's content to collapse/overlap before it was rebuilt to match. New
windows MUST follow it:

1. **Fixed numeric height.** `position: { width: <n>, height: <n> }` — both
   numbers. `height: "auto"` is **not** honoured by this AppV2 setup (the
   `applyCenteredPositionToFrame` helper bails on a non-finite height, and the
   frame never grows to content). If a window should size to its content,
   compute a numeric height up front (see `launcher-app.js` `launcherHeight()`),
   don't rely on auto. Stamp it on the frame in a `_renderFrame` override with
   `applyCenteredPositionToFrame` (copy from feat-browser / launcher).

2. **Standard content classes.** `classes: ["dauligor-importer-app", "<block>"]`
   and `contentClasses: ["dauligor-importer-window", …]`. Together these make
   `.window-content` a `display:flex; flex-direction:column; overflow:hidden;
   padding:0; min-height:0` box (rules live in importer-wizard.css). Don't omit
   them and hand-roll the content box — that's the trap the launcher fell into.

3. **Shell fills, regions scroll — the `min-height:0` chain.** The template's
   root shell is `height:100%; display:flex (or grid); min-height:0` so it fills
   the fixed-height content box. Fixed bits (toolbars, footers, intros) are
   `flex:0 0 auto`; the area that should scroll is `flex:1 1 auto; min-height:0;
   overflow:auto`. **`min-height:0` on every flex/grid ancestor of a scroll
   region is mandatory** — without it the region can't shrink, so it either
   overflows the frame or compresses its children (text overlap). Grid rows that
   must shrink use `minmax(0, 1fr)`, not `1fr`.

Reference implementations: `.dauligor-importer` (importer-wizard.css),
`.dauligor-spell-manager` (spell-manager.css), `.dauligor-character-creator__shell`
(character-creator.css), `.dauligor-launcher__shell` (launcher.css).

## Caveat after the split

The reorg gathered interleaved rules into per-component files. It's
content-identical (verified: byte count + brace balance preserved), but the
cascade source-order changed, so two spots are worth an eyeball in a live
Foundry world:

- **`responsive.css` loads last** — at narrow window widths, a `@media` override
  now wins over any equal-specificity normal rule that originally came *after*
  it. Check the importer / spell-manager layouts at `< 1120px` and `< 920px`.
- Bridge selectors (above) — confirm the embedded spell manager (in the Feature
  Manager) and the sequence/subclass-preview importer states still look right.
