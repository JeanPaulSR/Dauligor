# Authentication & Identity

The Archive uses a "Pseudo-Username" mapping layer on top of Firebase Authentication.

## 1. Mapped Identity

Firebase Authentication uses email addresses as primary identifiers. The application maps usernames entered in the UI to an internal domain.

### Mapping Utility (`src/lib/firebase.ts`)
```typescript
export const usernameToEmail = (username: string) => {
  return `${username.toLowerCase().trim()}@archive.internal`;
};
```
- **Login Process**:
    1. User enters `Username`.
    2. App calls `usernameToEmail(Username)`.
    3. App calls `signInWithEmailAndPassword` with the generated email.

## 2. Account Lifecycle

- **Registration**: Public sign-up is disabled.
- **Creation**: Accounts are created via `AdminUsers.tsx` (`/admin/users`) by users with the `admin` role.
- **Persistence**: 
    1. Firebase Auth Record: Created via Admin SDK logic or manual input.
    2. Firestore Profile: A document in the `users` collection with ID matching the Auth UID.

## 3. Administrative Bootstrapping

- **Auto-Promotion**: `App.tsx` identifies users with usernames `admin` or `gm`.
- **Force Update**: The system automatically writes `role: 'admin'` to the Firestore document upon login if the username matches the hardcoded strings.

## 4. Account Settings

- **Password**: Managed via Firebase Auth.
- **Recovery**: `AdminUsers` can trigger the `sendPasswordResetEmail` function if `users.recoveryEmail` is populated.
- **Handled Changes**: Username changes in `Settings.tsx` update both the Firestore `username` field and the Firebase Auth email address.
- **Privacy Flags**: 
    - `hideUsername`: Boolean to suppress handle display in UI.
    - `isPrivate`: Boolean to restrict profile access to admins and owner.
