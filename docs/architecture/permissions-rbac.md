# Permissions & RBAC

The application implements Role-Based Access Control (RBAC) enforced by client-side logic and Firestore Security Rules.

## 1. Defined Roles

| Role ID | UI Label | Capabilities |
| :--- | :--- | :--- |
| `admin` | GM | CRUD on all collections; User/Campaign management. |
| `co-dm` | Co-DM | CRUD on `lore`; management of assigned campaigns in `campaignIds`. |
| `lore-writer` | Librarian | CRUD on `lore` (published/draft). |
| `user` | Adventurer | Read-only access to published `lore` and revealed `secrets`. |

## 2. RBAC Simulation (Preview Mode)

`App.tsx` provides a simulation layer for administrative users.

### Implementation Logic
1. **State**: `previewMode` (Boolean).
2. **Staff check**: Returns true if `userProfile.role` is `admin` or `co-dm`.
3. **Effective Profile**: A computed object where `role` is set to `'user'` if `previewMode` is true.
4. **Prop Drilling**: The `effectiveProfile` object is passed to page components for conditional rendering.

### UI Effects
- Hides "Edit" buttons on articles and classes.
- Restricts `secrets` subcollection visibility to the player-facing logic.
- Hides `dmData` (storyteller notes).

## 3. Data Protection (`firestore.rules`)

- **Root Access**: `admin` has `allow write: if true` on core collections.
- **Lore Rules**: 
    - `lore-writer` has `allow write` on the `lore` collection.
    - `secrets` subcollection: `allow read` only if `revealedCampaignIds` array contains the user's `activeCampaignId`.
    - `dmData` subcollection: `allow read` only if user role is `admin` or `co-dm`.
- **User Ownership**: Users have `allow update: if request.auth.uid == userId`.

---
*For more details on specific collection rules, refer to [Firestore Schema](../database/firestore-schema.md).*
