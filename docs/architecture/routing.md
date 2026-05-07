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
| `/characters/:id` | `CharacterBuilder.tsx` | Owner or staff |
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
2. **Profile load.** Read `users.id = uid` from D1 via `fetchDocument('users', uid, null)`. While loading, render a splash.
3. **Auto-promote.** If the username matches `admin`, `gm`, or the email matches a hardcoded staff email, upsert `role: admin` to D1.
4. **Default campaign.** If `users.active_campaign_id` is null and the user has memberships, pick the first one (via `campaign_members`).
5. **Foundation heartbeat.** Start the 30-second polling loop on `system_metadata.last_foundation_update` for cross-tab cache invalidation.
6. **`isAuthReady = true`.** `<main>` renders the matched route.

## Browser router quirks

- **Page reloads in nested routes** require Vercel rewrites (already configured in [vercel.json](../../vercel.json)). In local dev, the Express server serves `index.html` for all non-API paths.
- **Anchor links** (`#section`) work but should be rare; prefer programmatic scroll in editors.
- **Trailing slashes** are stripped — don't link to `/wiki/`.

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
