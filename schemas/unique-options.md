# Compendium: Unique Options Schema

This document outlines the data structure for modular character choices like Eldritch Invocations, Combat Maneuvers, or Infusions.

## 1. Unique Option Group (`uniqueOptionGroups`)
A category that groups related options together.
- `name`: (string) e.g., "Eldritch Invocations".
- `description`: (string) BBCode overview of what these options represent.
- `sourceId`: (string) Reference to `sources`.
- `maxSelections`: (number) How many options a character can choose from this group (default: 1).
- `scalingColumnId`: (string, optional) Reference to a `scalingColumns` document.
- `featureId`: (string, optional) Reference to a `features` document.

## 2. Unique Option Item (`uniqueOptionItems`)
An individual choice within a group.
- `name`: (string) e.g., "Agonizing Blast".
- `groupId`: (string) Reference to the parent `uniqueOptionGroups`.
- `sourceId`: (string) Reference to `sources`.
- `page`: (string) Page number in the source book.
- `levelPrerequisite`: (number) Minimum level required (legacy).
- `stringPrerequisite`: (string) Textual prerequisites (legacy).
- `prerequisites`: (array of objects) Structured requirements (Spells known, specific Level, Pact tags).
- `description`: (string) BBCode text of the option's effect.
- `featureType`: (string) Identifier used for grouping and progression filtering.
- `consumes`: (object, optional) Resource consumed by this option (e.g., Superiority Die).
- `isRepeatable`: (boolean) Whether the option can be selected multiple times.
- `classIds`: (array of strings) Optional list of Class IDs that have access to this specific option. If empty, all classes with access to the group can see it.
- `featureId`: (string, optional) Reference to a `features` document that this option grants.
- `automation`: (object, optional) Foundry VTT compatible data for `activities` and `effects`.
