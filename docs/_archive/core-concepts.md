# Core Architecture Concepts

The Archive is a Single Page Application (SPA) built with **React** (v18+) and **Firebase**.

## 1. Stack Overview

- **Frontend**: React with TypeScript, bundled with Vite.
- **Routing**: `react-router-dom` (Browser Mode).
- **Database**: Firebase Firestore (NoSQL).
- **Authentication**: Firebase Authentication (Email/Password).
- **Storage**: Firebase Storage (BLOB storage for images).
- **Styling**: Tailwind CSS (Utility-first) and shadcn/ui.
- **Animations**: `motion` library.

## 2. Layout Structure (`src/App.tsx`)

The application entry point is `src/App.tsx`. It manages the global routing table and top-level state.

### Key Components

- **`<Sidebar />`**: Navigation menu. Renders as a sticky column on desktop and a mobile drawer (`Dialog`). Supports a boolean `isCollapsed` state.
- **`<Navbar />`**: Fixed header. Contains the `CampaignSwitcher` and account dropdown.
- **`<main>`**: Content container where `Routes` are rendered. Wrapped in `ErrorBoundary`.
- **`<footer>`**: Static footer component.

## 3. Global State & Providers

- **`TooltipProvider`**: Wraps the app for `radix-ui` tooltip support.
- **`BrowserRouter`**: Context for path-based routing.
- **React State (`App.tsx`)**:
    - `userProfile`: Object from `users` collection matching `auth.currentUser.uid`.
    - `activeCampaignId`: String ID of the campaign selected in `<Navbar />`.
    - `previewMode`: Boolean toggling RBAC simulation.

## 4. Initialization Sequence

1. **Auth**: `onAuthStateChanged` triggers on load.
2. **Profile**: `onSnapshot` on `/users/{uid}` updates `userProfile` state.
3. **Admin Check**: Hardcoded check upgrading users with usernames `admin` or `gm` to administrative roles in Firestore.
4. **Campaign**: Selects the first available `campaignId` from `userProfile` if `activeCampaignId` is null.
5. **Ready**: `isAuthReady` boolean renders the `<main>` content once the profile is loaded.
