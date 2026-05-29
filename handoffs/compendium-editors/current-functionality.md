# Current functionality — the compendium editors

_User-facing snapshot of what the areas this branch touches do **today on `main`**, before this
branch's changes land. Paired with [changes-being-made.md](changes-being-made.md)._

## What the compendium is

The compendium is the game's content library — classes, subclasses, features, spells, feats,
items, facilities, plus races and backgrounds, and the supporting vocabulary (tags, sources,
proficiencies, scaling tables). Admins author it; everyone signed in can browse it read-only;
trusted players can propose changes that admins review.

## How you author each kind of content today

- **Spells, Feats, Items** — a "manager" page: a searchable, scrollable list on the left, an
  editor in the middle (with Editor / Tags tabs), and a live read-only preview on the right that
  matches what end-users see in the public browser. There's also a Foundry-Import tab for bulk
  importing from the pairing module.
- **Classes and Subclasses** — a more complex, bespoke editor: an advancement timeline, a feature
  list, scaling tables, proficiencies, spellcasting config, and multiclass rules, all on one page.
- **Races and Backgrounds** — currently reuse the Feats editor (they're stored in the feats table
  for now), constrained to the race/background type.
- **Facilities** (Bastions) — a simpler form editor.
- **Skills, Tools, Proficiencies, Damage types, Languages, Conditions, etc.** — simple
  table-with-inline-edit editors for the small reference lists.

## The shared building blocks

Most editors are assembled from the same handful of widgets:

- **Advancement editor** — compose a level-by-level progression (hit points, ability score
  improvements, item grants, subclass markers, spell grants, etc.).
- **Activity editor** — define the automation behavior that the Foundry side runs (attacks, saves,
  healing, etc.).
- **Active Effect editor** — define the persistent modifications a piece of content applies.
- **Requirements editor** — build structured prerequisites (and/or/xor over level, class, ability,
  feature, spell, …).
- **Tag picker** — categorise content with hierarchical tags.
- **Filter bar** — search + multi-axis filtering, shared between the browsers and the editors.

## How it reaches Foundry

Authored content is served to the companion Foundry pairing module through a stable set of
endpoints. The module fetches sources and their resources in an optimized way. (What the module
does with the payload is outside this branch.)

## Known rough edges (being addressed)

- The editor-patterns documentation had drifted from the actual code (e.g. it described the
  Spell/Feat/Item editors as using an older generic shell; they've since moved to a shared
  master-detail shell).
- Some shared components carry small UI issues — being catalogued (and fixed where quick) in the
  component walkthrough. See [changes-being-made.md](changes-being-made.md).
