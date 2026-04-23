# Media Storage Architecture

The application uses **Firebase Storage** for BLOB data persistence (images).

## 1. Directory Structure

Files are partitioned by domain into specific bucket paths:

| Resource Type | Bucket Path |
| :--- | :--- |
| Lore Articles | `/images/lore/{articleId}/` |
| Class Artwork | `/images/classes/{classId}/` |
| User Avatars | `/images/users/{userId}/` |

## 2. Life Cycle

1. **Upload**: Client sends binary data to a specific path via Firebase Storage SDK.
2. **URL Generation**: SDK returns a public HTTPS download URL.
3. **Reference**: The HTTPS URL string is stored in the corresponding Firestore document field (e.g. `imageUrl`).
4. **Access**: UI components render the URL using standard `<img>` tags.

## 3. Data Integrity

- **Filenames**: Stripped of non-alphanumeric characters and replaced with slugs during the upload process.
- **Deletions**: Firestore deletions do not automatically trigger Storage deletions (Requires manual audit or specific Cloud Function).
- **Constraints**: Optimal image formats are `.webp` or `.jpg`.
