# Content Rendering & Formatting Rules

This document defines the strict rules for rendering and formatting content within the Archive. Follow these rules to ensure technical consistency and prevent formatting errors.

## 1. Renderer Selection

| Data Field | Format | Component to Use |
|------------|--------|------------------|
| Class Description | BBCode | `<BBCodeRenderer />` |
| Class Lore | BBCode | `<BBCodeRenderer />` |
| Feature Description | BBCode | `<BBCodeRenderer />` |
| Choice Description | BBCode | `<BBCodeRenderer />` |
| Multiclassing Req. | BBCode | `<BBCodeRenderer />` |
| Source Info | Markdown | `<Markdown />` (if applicable) |

**Rule 1:** NEVER use `<Markdown />` for fields containing BBCode tags (e.g., `[b]`, `[i]`, `[color]`).
**Rule 2:** Components MUST support recursive object arrays for lore/description fields to handle sections, insets, and quotes correctly.

## 2. Recursive Content Structure

Many data fields (Lore, Descriptions) use a recursive object structure rather than a flat string. Renderers must handle these types:

- **`type: "section"`**: Renders a labeled section with its own `entries`.
- **`type: "entries"`**: A standard container for a list of strings or nested objects.
- **`type: "quote"`**: Renders a blockquote with optional attribution (`by`).
- **`type: "inset"`**: Renders a sidebar or callout box.
- **`type: "table"`**: Renders a data table with `colLabels` and `rows`.

## 3. Typography & Styling

### Semantic Classes
Use these classes with specific components:

- **`.body-text`**: Use for all primary descriptions and lore. 
  - *Technical Definition:* `font-sans`, default weight, non-italic.
  - *Reasoning:* Content should be plain by default so users can use BBCode for manual styling.
- **`.description-text`**: Use ONLY for literal excerpts, quotes, or distinct "flavor text" sidebars.
  - *Technical Definition:* `font-serif`, `italic`, 70% opacity.
- **`.label-text`**: Use for categories, level markers, and status indicators.
  - *Technical Definition:* `text-[10px]`, `uppercase`, `font-bold`, `text-gold`.

### Header Standards
- **Feature Headers:** Use `sans-serif` (`font-sans` / default). 
- **Page Titles:** Use `serif` (`font-serif`) specifically for `.h1-title`.

## 3. UI Component Constraints

### FeaturesView Preview
- **Constraint:** When using `FeaturesView` in a preview dialog (e.g., in `ClassList`), always set `hideChoices={true}`.
- **Goal:** Prevent visual clutter from modular choices in a high-level preview.

## 4. BBCode Implementation
- All tags must use square brackets: `[tag]content[/tag]`.
- Supported tags: `b`, `i`, `u`, `color`, `size`, `url`, `quote`, `spoiler`.
- Always wrap BBCode output in a `.prose` container via `BBCodeRenderer`.
