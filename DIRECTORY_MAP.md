# Project Directory Map

Technical structure and file resolution guide.

## 1. Environment & Configuration (Root)

| File | Type | Description |
| :--- | :--- | :--- |
| `firestore.rules` | Rules | Server-side authorization logic. |
| `firebase-blueprint.json` | JSON | IR for Firestore entity definitions. |
| `firebase-applet-config.json`| JSON | Project-specific Firebase credentials. |
| `AGENTS.md` | MD | Technical instructions for AI agents. |
| `docs/` | DIR | Modular technical documentation. |
| `docs/architecture/` | DIR | Contains logic, design philosophy, and integration rules (e.g., `foundry-integration.md`). |
| `schemas/` | DIR | Technical specifications for Firestore collections. |

## 2. Core Logic (`src/`)

| Path | Primary Exports |
| :--- | :--- |
| `src/App.tsx` | Global routing table; top-level React state. |
| `src/index.css` | TAILWIND directives; theme variable definitions. |
| `src/lib/firebase.ts` | Firebase connection; username-to-email mapping utility. |
| `src/lib/bbcode.ts` | BBCode tag definitions and parsing logic. |

## 3. UI Layer (`src/components/`)

| Path | Purpose |
| :--- | :--- |
| `src/components/Navbar.tsx` | Fixed header component. |
| `src/components/Sidebar.tsx` | Navigation menu component. |
| `src/components/MarkdownEditor.tsx` | TipTap-based rich text editor. |
| `src/components/BBCodeRenderer.tsx` | BBCode-to-React conversion component. |
| `src/components/ui/` | shadcn/ui shared components. |

## 4. Feature Implementation (`src/pages/`)

| Domain | Directory | Active Files |
| :--- | :--- | :--- |
| **Core** | `src/pages/core/` | `Home.tsx`, `Map.tsx`, `Profile.tsx`, `Settings.tsx` |
| **Wiki** | `src/pages/wiki/` | `Wiki.tsx`, `LoreArticle.tsx`, `LoreEditor.tsx` |
| **Compendium** | `src/pages/compendium/` | `ClassList.tsx`, `ClassView.tsx`, `ClassEditor.tsx`, `SubclassEditor.tsx` |
| **Scaling** | `src/pages/compendium/scaling/` | `SpellcastingScalingEditor.tsx`, `ScalingEditor.tsx` |
| **Admin** | `src/pages/admin/` | `AdminUsers.tsx`, `AdminCampaigns.tsx` |
| **Characters** | `src/pages/characters/` | `CharacterList.tsx`, `CharacterBuilder.tsx` |
| **Sources** | `src/pages/sources/` | `Sources.tsx`, `SourceDetail.tsx`, `SourceEditor.tsx` |

## 5. Technical Decision Matrix

| Task | Procedure |
| :--- | :--- |
| **Routing** | Update `Routes` in `src/App.tsx`. |
| **Navigation** | Modify `NAV_ITEMS` in `src/components/Sidebar.tsx`. |
| **Styling** | Modify variables in `src/index.css`. |
| **Schema Change** | Update `schemas/` -> `firebase-blueprint.json` -> `firestore.rules`. |
| **BBCode Expansion** | Update `src/lib/bbcode.ts` and `src/components/BBCodeRenderer.tsx`. |
| **Auth Debugging**| Verify mapping in `src/lib/firebase.ts` and `onAuthStateChanged` in `App.tsx`. |
