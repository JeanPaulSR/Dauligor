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
| `/compendium/options` | `UniqueOptionGroupList.tsx` | All authenticated |
| `/compendium/tags` | `TagManager.tsx` | Admin |
| `/characters` | `CharacterList.tsx` | All authenticated |
| `/characters/:id` | `CharacterBuilder.tsx` | Owner or character-DM (admin/co-dm) |
| `/sources` | `Sources.tsx` | All authenticated |
| `/sources/:id` | `SourceDetail.tsx` | All authenticated |
| `/sources/edit/:id` | `SourceEditor.tsx` | Staff |
| `/admin/users` | `AdminUsers.tsx` | Admin |
| `/admin/campaigns` | `AdminCampaigns.tsx` | Staff |
| `/admin/images` | `ImageManager.tsx` | Image-manager-eligible (admin/co-dm/lore-writer) |
| `/admin/skills`, `/admin/tools`, `/admin/weapons`, `/admin/armor`, … | category editors | Admin |
| `/profile/settings` | `Settings.tsx` | Self |
| `/profile/:uid` | `Profile.tsx` | Self or staff |
| `/images/view` | `ImageViewer.tsx` | Public |

This table is illustrative — for the canonical list, search `App.tsx` for `<Route path=`.

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

1. **Auth bootstrap.** `onAuthStateChanged` fires with the current `User` (or null). If null, render the sign-in route.
2. **Profile load.** Call `GET /api/me` with the Firebase ID token. The server endpoint handles steps 3 and 4 itself — the client just consumes the returned `profile`. While the request is in flight, render a splash.
3. **Auto-create + auto-promote (server-side).** `/api/me` synthesizes the `users` row on first sign-in, then forces `role = admin` for the hardcoded owner email and the `admin` / `gm` usernames.
4. **Default campaign (server-side).** Same endpoint pins the user's first `campaign_members` row as `active_campaign_id` if it's null.
5. **Foundation heartbeat.** Start the 30-second polling loop on `system_metadata.last_foundation_update` for cross-tab cache invalidation.
6. **`isAuthReady = true`.** `<main>` renders the matched route.

The bootstrap / promote / default-campaign logic used to run client-side with raw `fetchDocument` + `upsertDocument` calls; it moved server-side as part of the H6 closure so a coerced client can no longer spread `{ ..., role: 'admin' }` into the upsert. See [../platform/auth-firebase.md](../platform/auth-firebase.md#2-profile-load).

## Browser router quirks

- **Page reloads in nested routes** require Vercel rewrites (already configured in [vercel.json](../../vercel.json)) — see [SPA fallback](#spa-fallback). In local dev, the Express server serves `index.html` for all non-API paths.
- **Anchor links** (`#section`) work but should be rare; prefer programmatic scroll in editors.
- **Trailing slashes** are stripped — don't link to `/wiki/`.

## SPA fallback + API resource-root dispatchers

Vercel serves static files first and serverless functions at `/api/*`. Client-side routes like `/compendium/spells` don't exist on the filesystem, so a hard refresh or shared deep link would 404 without a rewrite. The catch-all in [vercel.json](../../vercel.json) sends every non-API path to `/index.html` so the SPA bundle loads and React Router resolves the route.

There's also a set of API-side rewrites for the per-route endpoint family. Vercel's pure-functions filesystem routing doesn't support real catch-all syntax (the `[...slug]` filename is silently treated as a single-segment dynamic param), so each multi-segment resource is implemented as one top-level file (`api/me.ts`, `api/lore.ts`, `api/campaigns.ts`) and a rewrite forwards `/api/<resource>/(.*)` to it. The handler parses the original path out of `req.url`. Same pattern `api/module.ts` has used since the Foundry export work.

```json
{
  "rewrites": [
    { "source": "/api/module/(.*)",      "destination": "/api/module" },
    { "source": "/api/module",           "destination": "/api/module" },
    { "source": "/api/me/(.*)",          "destination": "/api/me" },
    { "source": "/api/lore/(.*)",        "destination": "/api/lore" },
    { "source": "/api/campaigns/(.*)",   "destination": "/api/campaigns" },
    { "source": "/((?!api/|assets/).*)", "destination": "/index.html" }
  ]
}
```

The catch-all's negative lookahead `(?!api/|assets/)` skips paths under `/api/` (so the serverless functions still resolve) and `/assets/` (so missing JS chunks return real 404s instead of being rewritten to `index.html`, which used to mask stale-bundle errors as MIME-type failures). Static files in `/public` and built assets in `/assets` are served from the filesystem before rewrites are evaluated, so they're unaffected.

When you add a new client-side route, you don't have to update `vercel.json` — the SPA catch-all handles it automatically. When you add a new multi-segment **API** dispatcher, add a `/api/<resource>/(.*)` rewrite alongside the existing three.

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
