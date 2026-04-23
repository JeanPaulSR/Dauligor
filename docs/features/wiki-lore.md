# Wiki & Lore System

## 1. Component Routes

| Page Type | Route | File Path |
| :--- | :--- | :--- |
| Directory | `/wiki` | `src/pages/wiki/Wiki.tsx` |
| View | `/wiki/article/:id` | `src/pages/wiki/LoreArticle.tsx` |
| Form | `/wiki/new`, `/wiki/edit/:id` | `src/pages/wiki/LoreEditor.tsx` |

## 2. Navigation Logic

- **Client-side Filtering**: `Wiki.tsx` implements filtering using the `category` field from the `lore` collection.
- **Display Modes**:
    - **Grid**: Uses `Card` components with `lore.imageUrl`.
    - **List**: Renders a flat array from Firestore into a nested tree using `category`, `folder`, and `parentArticleId`.

## 3. Data Visibility (Secrets & Notes)

### Secrets Subcollection
- **Path**: `/lore/{id}/secrets`
- **Filtering**: Query uses `where("revealedCampaignIds", "array-contains", activeCampaignId)`.
- **Management**: Administrative users update the `revealedCampaignIds` array via boolean checkbox toggles.

### DM Notes Subcollection
- **Path**: `/lore/{id}/dmData/notes`
- **RBAC**: Read/Write access restricted to `admin` and `co-dm` roles in `firestore.rules`.

## 4. Input Implementation (`LoreEditor.tsx`)

- **Metadata Mapping**: Form fields are conditionally rendered based on the value of the `category` string.
- **Hierarchical Linking**: Uses a `Select` component to map `parentArticleId` to existing articles in the database.
- **Media**: Implements `ImageUpload.tsx` for `lore.imageUrl` field persistence in Firebase Storage.
