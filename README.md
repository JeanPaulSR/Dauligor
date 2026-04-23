<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/74a2fef7-b2a2-4f36-a1cf-85b98eba078b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Documentation

- **[Technical Structure (MAP)](DIRECTORY_MAP.md)**: File resolution and procedure guide.
- **[Documentation Index](docs/README.md)**: Technical specifications for Architecture, Database, Features, and Styling.
- **[Styling Standards](docs/styling/STYLE_GUIDE.md)**: CSS class definitions and component guidelines.
- **[BBCode Definition](docs/styling/BBCODE_REFERENCE.md)**: Tag specs for content rendering.
- **[External Schemas](docs/external/FOUNDRY_VTT.md)**: Data structures for 3rd party integrations.
- **[Entity Specs](schemas/)**: Interface and persistence rules for Firestore collections.

## Core Architecture

React-based Single Page Application (SPA) using Firebase (Firestore, Storage, Authentication).
- **Styling**: Tailwind CSS and shadcn/ui.
- **State Management**: Centralized React state in `src/App.tsx`.
- **Authorization**: Role-based access (RBAC) defined in `src/App.tsx` and `firestore.rules`.
