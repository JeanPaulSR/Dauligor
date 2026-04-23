# Troubleshooting & Common Fixes

This document outlines known solutions to common technical issues and maintenance tasks for the Dungeon Master's Archive.

## 1. Firestore Permission Errors

**Symptoms**: "Missing or insufficient permissions" or `INTERNAL ASSERTION FAILED` in the browser console.
**Cause**: Often due to a corrupted local IndexedDB cache after a project remix or a change in Firebase configuration.
**Fix**:
1. Navigate to the **Sources** page.
2. Click the **"Clear Cache & Hard Reset"** button.
3. This utility (`resetFirestore` in `src/lib/firebase.ts`) terminates the persistence connection, clears the cache, and reloads the page.

---

## 2. Admin Role Not Recognized

**Symptoms**: The owner logs in but lacks access to the Admin panel or sees a "User" badge.
**Cause**: Firestore profile misconfiguration or username mapping drift.
**Fix**:
The app uses **Email as the Source of Truth** for master accounts. Logging in with `admin@archive.internal`, `gm@archive.internal`, or the owner's recovery email triggers an auto-promotion logic in `App.tsx`. This logic forces the Firestore `role` to `admin` and ensures the `username` is correctly set.

---

## 3. Project Remixing & Fresh Backends

When remixing the project or moving to a new chat, you MUST run the **`set_up_firebase`** tool to provision a fresh backend.

### Post-Setup Checklist
1. **Deploy Rules**: Call **`deploy_firebase`** to apply the `firestore.rules`. Without rules, the app will be read/write-protected for most users.
2. **Initialize Sources**: If the database is empty, the **Sources** page will offer to initialize core SRD content (PHB, DMG, etc.).
3. **Data Dependency**: Classes and Spells require a `sourceId`. Ensure you have created at least one **Source** book before attempting to add mechanics.

---

## 4. UI/UX Glitches

- **Sidebar Stickiness**: If the sidebar fails to collapse/expand, check the `previewMode` state in `App.tsx` and ensure the `Sidebar` is receiving the correct `isCollapsed` prop.
- **BBCode Not Rendering**: Ensure the tag logic in `src/lib/bbcode.ts` is correctly mapped in the `BBCodeRenderer.tsx` component.
- **TipTap Height**: If the editor grows indefinitely, check the `.prose` height overrides in `src/index.css`.
