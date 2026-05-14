# Spell Favourites

Per-user (and optionally per-character) starred spells on `/compendium/spells`. Local-first with cross-device cloud sync for authenticated users.

| Concern | Doc |
|---|---|
| Where it's used | [compendium-spells-browser.md](compendium-spells-browser.md) |

Source: [src/lib/spellFavorites.ts](../../src/lib/spellFavorites.ts), [api/spell-favorites.ts](../../api/spell-favorites.ts).

## Two scopes

| Scope | localStorage key | D1 table | Cross-device sync |
|---|---|---|---|
| **Universal Favorite** (default) | `dauligor.spellFavorites` | `user_spell_favorites` | ✅ Yes |
| **Per-character** | `dauligor.spellFavorites.character.<characterId>` | `character_spell_favorites` | ✅ Yes |

A player browsing on PC and phone sees the same stars under Universal. Switching to a saved character in the favourites-pane scope dropdown re-points to that character's per-character list (also synced). Anonymous users only get the local layer — no cloud writes happen until they sign in.

## Storage architecture

```
                  ┌─────────────────────────────────┐
                  │      useSpellFavorites          │
                  │   (userId, scope?)              │
                  │                                 │
                  │  state: Set<string> favorites   │
                  └──────────────┬──────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                     │
        localStorage                       /api/spell-favorites
   (writes & paint-on-mount)                  (GET / POST)
              │                                     │
              │                                     ▼
              │                          ┌──────────────────┐
              │                          │  Firebase Auth   │
              │                          │  ID token verify │
              │                          └────────┬─────────┘
              │                                   │
              ▼                                   ▼
   ┌────────────────────────────┐    ┌──────────────────────────────┐
   │ Universal:                 │    │ Universal:                   │
   │   `dauligor.spellFavorites`│    │   user_spell_favorites       │
   │                            │    │     (user_id, spell_id)      │
   │ Character:                 │    │                              │
   │   `dauligor.spellFavorites │    │ Character:                   │
   │      .character.<id>`      │    │   character_spell_favorites  │
   │                            │    │     (user_id, character_id,  │
   │                            │    │       spell_id)              │
   └────────────────────────────┘    └──────────────────────────────┘
```

`localStorage` writes are synchronous and run on every toggle, so the page paints the new state immediately. The cloud write is fire-and-forget — failures are logged but don't surface as an error toast, since the local state is already correct.

## Hook API

```ts
import { useSpellFavorites } from '@/lib/spellFavorites';

// Universal scope (default).
const { favorites, isFavorite, toggleFavorite, hydrating } =
  useSpellFavorites(userProfile?.id || null);

// Character scope — pass an object with characterId as the second arg.
const { favorites, isFavorite, toggleFavorite, hydrating } =
  useSpellFavorites(userProfile?.id || null, { characterId: 'aleria-uuid' });
```

| Property | Meaning |
|---|---|
| `favorites: Set<string>` | The active scope's spell ids. Reactive. |
| `isFavorite(id)` | Convenience predicate. |
| `toggleFavorite(id)` | Adds or removes; writes through to both layers (local + cloud). |
| `hydrating` | True until the initial cloud-sync resolves on mount or scope-change. |

Switching scopes (passing a new `{ characterId }` or `null`) reloads from the appropriate localStorage key and re-runs the cloud sync.

## Login / scope-switch merge semantics

On mount or when `userId` / scope changes:

1. Read localStorage for the active scope synchronously → paint stars immediately.
2. Fetch the cloud copy via `GET /api/spell-favorites` (or `…?characterId=<id>` for character scope).
3. **Union-merge**: cloud ∪ local. Any star on either side counts.
4. Promote local-only ids to cloud via `POST { action: 'bulkAdd', spellIds: [...] }` so the cloud copy catches up to ad-hoc anonymous-session stars.
5. Write the union back to localStorage. Update state.

The merge is intentionally asymmetric: it never **removes** a favourite from one side. Removing a favourite is rare enough that the "merge then promote" pattern wins simplicity over last-write timestamps. The user's anonymous-mode picks are never lost when they sign in.

## API endpoint

`api/spell-favorites.ts` — Vercel serverless function. Auth via `requireAuthenticatedUser` (any signed-in user, not just staff). User id is always derived from the verified Firebase ID token, never from the request body — the client cannot ask about another user's favourites.

### GET

```
GET /api/spell-favorites               → universal scope
GET /api/spell-favorites?characterId=X → per-character scope
```

Response:

```json
{ "spellIds": ["fireball", "shield", "..."] }
```

For character scope, the endpoint verifies the character belongs to the calling user before reading. Mismatch returns 404 (not 403) — we don't leak the existence of other users' characters.

### POST

```ts
POST /api/spell-favorites
{
  "action": "add" | "remove" | "bulkAdd",
  "spellId"?: string,        // for add / remove
  "spellIds"?: string[],     // for bulkAdd
  "characterId"?: string     // omit for universal scope
}
```

| Action | Effect (universal) | Effect (character) |
|---|---|---|
| `add` | `INSERT ... ON CONFLICT(user_id, spell_id) DO NOTHING` into `user_spell_favorites` | Same into `character_spell_favorites` (with character_id triple-key) |
| `remove` | `DELETE FROM user_spell_favorites WHERE user_id=? AND spell_id=?` | Same with character_id condition |
| `bulkAdd` | Multi-row `VALUES` insert, idempotent via `ON CONFLICT DO NOTHING` | Same triple-key variant |

Character-scoped writes verify ownership ONCE at the top of the handler — every action below trusts the verified `characterId` from that point on.

## D1 schema

### `user_spell_favorites`

```sql
CREATE TABLE user_spell_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spell_id   TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, spell_id)
);

CREATE INDEX idx_user_spell_favorites_user
  ON user_spell_favorites(user_id);
```

Migration: [worker/migrations/20260514-1522_user_spell_favorites.sql](../../worker/migrations/20260514-1522_user_spell_favorites.sql).

### `character_spell_favorites`

```sql
CREATE TABLE character_spell_favorites (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  spell_id     TEXT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, character_id, spell_id)
);

CREATE INDEX idx_character_spell_favorites_character
  ON character_spell_favorites(character_id);
```

Migration: [worker/migrations/20260514-2030_character_spell_favorites.sql](../../worker/migrations/20260514-2030_character_spell_favorites.sql).

`user_id` is denormalised onto the row (defence in depth — the endpoint always filters by `(user_id, character_id)` so even a buggy WHERE clause down the line can't bleed across users). The composite PK enforces uniqueness per (user, character, spell).

### Decoupled from `character_spells.is_favourite`

The favourites system is **separate** from `character_spells.is_favourite`. That column is per-spell metadata on a character's spellbook (used by the Spellbook Manager for layout / loadout pinning). The compendium-browser favourites are account-level "starred for later" state and have no relationship to whether a character has actually learned the spell.

## Scope dropdown (UI)

Lives in the favourites pane header on `/compendium/spells`. Two-section popover:

1. **Universal Favorite** — always present, highlighted when active (`favoriteScope === null`).
2. **Characters** section — only renders if the user has saved characters. Each character listed; clicking re-points the page's favorites scope.

When the user has no characters, the popover still opens and shows "You have no saved characters." under the Universal option, so the affordance stays discoverable.

Characters list is fetched on mount via `SELECT id, name FROM characters WHERE user_id = ? ORDER BY updated_at DESC`. Load failures fall back to an empty list (the dropdown still renders with just the Universal option).

## Related docs

- [compendium-spells-browser.md](compendium-spells-browser.md) — where the favourites pane lives
- [../platform/d1-architecture.md](../platform/d1-architecture.md) — D1 architecture overview
- [character-builder.md](character-builder.md) — where characters are created
