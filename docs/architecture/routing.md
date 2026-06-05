# Routing

`react-router-dom` (v7, browser mode) wired up in [src/App.tsx](../../src/App.tsx). One route table, one source of truth.

## Adding a new route

1. Create the page component under `src/pages/<domain>/<PageName>.tsx`.
2. Register it in the `Routes` block in `App.tsx`.
3. Add a navigation entry in `NAV_ITEMS` in [src/components/Sidebar.tsx](../../src/components/Sidebar.tsx) (only if it should appear in the sidebar).
4. If the page is role-restricted, gate the navigation entry by checking `effectiveProfile.role`. Server-side enforcement still happens at the proxy.

## Current route table (high level)

| Path | Page | Allowed roles |
|---|---|---|
| `/` | `Home.tsx` | All authenticated |
| `/auth/redeem?token=…` | `RedeemTokenPage.tsx` | Public — used by the admin-issued sign-in-link flow |
| `/wiki` | `Wiki.tsx` | All authenticated |
| `/wiki/article/:id` | `LoreArticle.tsx` | All authenticated (filtered by status) |
| `/wiki/new`, `/wiki/edit/:id` | `LoreEditor.tsx` | Staff |
| `/compendium` | Compendium landing | All authenticated |
| `/compendium/classes` | `ClassList.tsx` | All authenticated |
| `/compendium/classes/:id` | `ClassView.tsx` | All authenticated |
| `/compendium/classes/edit/:id` | `ClassEditor.tsx` | Admin |
| `/compendium/spells` | `SpellList.tsx` | All authenticated |
| `/compendium/spells/manage` | `SpellsEditor.tsx` | Admin |
| `/compendium/unique-options` | `UniqueOptionGroupBrowser.tsx` | All authenticated |
| `/compendium/tags` | `TagManager.tsx` | Admin |
| `/characters` | `CharacterList.tsx` | All authenticated |
| `/characters/:id` | `CharacterBuilder.tsx` | Owner or character-DM (admin/co-dm) |
| `/sources` | `Sources.tsx` | All authenticated |
| `/sources/:id` | `SourceDetail.tsx` | All authenticated |
| `/sources/edit/:id` | `SourceEditor.tsx` | Staff |
| `/admin/users` | `AdminUsers.tsx` | Admin |
| `/admin/campaigns`, `/admin/eras`, `/admin/worlds` | `AdminCampaigns.tsx` (one console, three tabs) | `campaigns`/`eras` Staff · `worlds` Admin |
| `/admin/eras/edit/:id`, `/admin/worlds/edit/:id` | `EraEditor.tsx` / `WorldEditor.tsx` | Admin |
| `/campaign/:id`, `/campaign/edit/:id` | `CampaignManager.tsx` / `CampaignEditor.tsx` | Member / Staff |
| `/admin/images` | `ImageManager.tsx` | Image-manager-eligible (admin/co-dm/lore-writer) |
| `/admin/skills`, `/admin/tools`, `/admin/weapons`, `/admin/armor`, … | category editors | Admin |
| `/profile/settings` | `Settings.tsx` | Self |
| `/profile/:uid` | `Profile.tsx` | Self or staff |
| `/images/view` | `ImageViewer.tsx` | Public |

This table is illustrative — for the canonical list, search `App.tsx` for `<Route path=`.

**Tab-as-route console.** `/admin/campaigns`, `/admin/eras`, and `/admin/worlds` all render the
same component (`AdminCampaigns`) with a different `tab` prop set by the route, so one console is
reachable (and bookmarkable) from each entity's path with that tab active. Clicking a tab
`navigate()`s to the sibling route. See [../features/campaigns-eras.md](../features/campaigns-eras.md#management-console).

## RBAC at the route boundary

The pattern in `App.tsx`:

```tsx
const effectiveProfile = useMemo(() => ({
  ...userProfile,
  role: previewMode ? 'user' : userProfile?.role,
}), [userProfile, previewMode]);
```

`effectiveProfile` is passed as a prop into every page that needs it. There is no `<RequireRole>` wrapper — pages that need stricter access either:

1. **Render an access-denied state** if `effectiveProfile.role` doesn't match (most editors do this).
2. **Hide their navigation entry** in `Sidebar.tsx` so unauthorised users never see the link.
3. **Rely on server-side checks** for the actual security boundary (see [permissions-rbac.md](permissions-rbac.md)).

## Initialization sequence

Roughly what happens between page load and ready-to-render:

1. **Auth bootstrap.** `onAuthChange` (`src/lib/auth.ts`) fires with the current identity (or null) — the native session if present, else the Firebase fallback. If null, render the sign-in route.
2. **Profile load.** Call `GET /api/me` with the session token (Bearer). The server endpoint handles steps 3 and 4 itself — the client just consumes the returned `profile`. While the request is in flight, render a splash.
3. **Auto-create + auto-promote (server-side).** `/api/me` synthesizes the `users` row on first sign-in, then forces `role = admin` for the hardcoded owner email and the `admin` / `gm` usernames.
4. **Default campaign (server-side).** Same endpoint pins the user's first `campaign_members` row as `active_campaign_id` if it's null.
5. **Foundation heartbeat.** Start the 30-second polling loop on `system_metadata.last_foundation_update` for cross-tab cache invalidation.
6. **`isAuthReady = true`.** `<main>` renders the matched route.

The bootstrap / promote / default-campaign logic used to run client-side with raw `fetchDocument` + `upsertDocument` calls; it moved server-side as part of the H6 closure so a coerced client can no longer spread `{ ..., role: 'admin' }` into the upsert. See [../platform/auth-firebase.md](../platform/auth-firebase.md#2-profile-load).

## Browser router quirks

- **Page reloads in nested routes** are handled by Pages's built-in SPA-fallback behaviour — any path that doesn't match a Pages Function or a static asset falls through to `index.html`. See [SPA fallback](#spa-fallback) below. In local dev, the Express server serves `index.html` for all non-API paths.
- **Anchor links** (`#section`) work but should be rare; prefer programmatic scroll in editors.
- **Trailing slashes** are stripped — don't link to `/wiki/`.

## SPA fallback + API catch-all dispatchers

Cloudflare Pages serves the filesystem in this order: Pages Functions under `functions/` (matched by URL pattern), then static assets from `dist/` (served by the Pages CDN), and finally a built-in SPA fallback to `index.html` for any unmatched path. Client-side routes like `/compendium/spells` don't exist on the filesystem so they fall through to `index.html`, the SPA bundle loads, and React Router resolves the route. No explicit `_routes.json` or `_redirects` rule is needed for this — Pages handles it natively.

The catch-all dispatcher pattern uses Pages Functions' native double-bracket syntax. Each multi-segment resource has one file at `functions/api/<resource>/[[path]].ts`; the `[[path]]` filename matches every URL under `/api/<resource>/` (including the bare resource path itself). The handler reads `context.params.path` (an array of segments) to route internally:

| URL family | Pages Function file |
|---|---|
| `/api/me/*` | [functions/api/me/[[path]].ts](../../functions/api/me/[[path]].ts) |
| `/api/lore/*` | [functions/api/lore/[[path]].ts](../../functions/api/lore/[[path]].ts) |
| `/api/campaigns/*` | [functions/api/campaigns/[[path]].ts](../../functions/api/campaigns/[[path]].ts) |
| `/api/admin/users/*` | [functions/api/admin/users/[[path]].ts](../../functions/api/admin/users/[[path]].ts) |
| `/api/admin/eras/*` | [functions/api/admin/eras/[[path]].ts](../../functions/api/admin/eras/[[path]].ts) |
| `/api/admin/worlds/*` | [functions/api/admin/worlds/[[path]].ts](../../functions/api/admin/worlds/[[path]].ts) |
| `/api/module/*` | [functions/api/module/[[path]].ts](../../functions/api/module/[[path]].ts) |

Single-segment endpoints use the single-bracket form (`[id].ts`, `[username].ts`, `[action].ts`) instead. Static endpoints have plain filenames (`spell-favorites.ts`, `admin/characters.ts`).

When you add a new client-side route, no routing config update is needed — Pages's SPA fallback picks it up automatically. When you add a new multi-segment **API** dispatcher, create the corresponding `functions/api/<resource>/[[path]].ts` file; Pages auto-wires it on the next build.

This is a change from the pre-2026 Vercel-based architecture, which required a `vercel.json` rewrite for every catch-all because Vercel's filesystem routing didn't support real catch-all syntax (the `[...slug]` filename was silently treated as a single-segment param). On Pages the catch-all `[[path]]` is native, no rewrite layer needed.

## Navigation patterns

### Programmatic navigation
```tsx
import { useNavigate } from 'react-router-dom';
const navigate = useNavigate();
navigate(`/compendium/classes/${classId}`);
```

### Link with active styling
```tsx
import { NavLink } from 'react-router-dom';
<NavLink to="/wiki" className={({ isActive }) => isActive ? 'text-gold' : 'text-ink/70'}>
  Wiki
</NavLink>
```

### Confirmation before nav
Editors with unsaved changes use `useUnsavedChangesWarning(hasChanges)` plus `useBlocker` (when explicit confirm is needed). See [src/pages/compendium/ClassEditor.tsx](../../src/pages/compendium/ClassEditor.tsx) for the canonical pattern.

## Related docs

- [permissions-rbac.md](permissions-rbac.md) — what roles each route allows
- [../platform/auth-firebase.md](../platform/auth-firebase.md) — sign-in flow
- [../ui/components.md](../ui/components.md) — Navbar and Sidebar shells
