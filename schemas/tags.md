# Compendium: Tags Schema

This document outlines the data structure for the tagging system used to categorize and filter compendium entries.

## 1. Tag Group (`tagGroups`)
A category that groups related tags together.
- `name`: (string) e.g., "Class Group", "Spellcasting Type".
- `category`: (string) The type of entity this group applies to (e.g., "class", "spell", "item").
- `description`: (string) Optional overview of the group.
- `updatedAt`: (string) ISO timestamp.

## 2. Tag (`tags`)
An individual tag within a group.
- `name`: (string) e.g., "Tank", "Full-Caster".
- `groupId`: (string) Reference to the parent `tagGroups`.
- `updatedAt`: (string) ISO timestamp.
