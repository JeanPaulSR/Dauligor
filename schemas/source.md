# Compendium: Source Schema

This document outlines the data structure for source books and documents.

## 1. Source (`sources`)
A book, document, or website that provides content for the compendium.
- `name`: (string) e.g., "Player's Handbook".
- `abbreviation`: (string) e.g., "PHB" or "SRD".
- `description`: (string) Markdown overview of the source.
- `url`: (string, optional) External link to the source.
- `imageUrl`: (string, optional) URL for the cover image.
- `tags`: (array of strings) e.g., ["Classes", "Spells"].
- `createdAt`: (string) ISO timestamp.
- `updatedAt`: (string) ISO timestamp.

## Relations
- **Classes**: Linked via `sourceId` (string, Firestore Document ID).
- **Subclasses**: Linked via `sourceId` (string, Firestore Document ID).
- **Spells**: Linked via `sourceId` (string, Firestore Document ID).
- **Items**: Linked via `sourceId` (string, Firestore Document ID).
