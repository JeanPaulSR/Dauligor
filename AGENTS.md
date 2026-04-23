# Technical Guardrails & Constraints

## 1. Authentication Protocol
- **Constraint**: No anonymous or public registration.
- **Implementation**: Mapping handle string to internal domain via `usernameToEmail` (`src/lib/firebase.ts`).
- **Auth Seed**: Username `admin` or `gm` triggers administrative role assignment in `App.tsx`.

## 2. Authorization (RBAC)
- **Role Map**: `admin`, `co-dm`, `lore-writer`, `user`.
- **Validation**: Use the `effectiveProfile` object passed via React props to determine UI visibility.

## 3. Data Integrity & Errors
- **Try/Catch**: Mandatory for all `getDoc`, `getDocs`, `addDoc`, `updateDoc`, `setDoc`, and `deleteDoc` calls.
- **Diagnostics**: Errors must be passed to `handleFirestoreError` (`src/lib/firebase.ts`) to generate the required JSON metadata.

## 4. Documentation Lookup Protocol
1. **File Resolution**: Use `DIRECTORY_MAP.md` for path lookup.
2. **Implementation Logic**: Refer to `/docs/` subdirectories (`architecture/`, `database/`, `features/`, `styling/`).
3. **Data Specs**: Refer to the `/schemas/` directory for interface and validation rules.

## 5. Styling Standards
- **Palette**: Uses dynamic CSS variables (`--primary`, `--background`, `--foreground`).
- **Icons**: Restricted to the `lucide-react` library.
