# Archive Style Guide

This document defines the semantic CSS classes used throughout the Dauligor: Compendium and Lore Manager. These classes ensure visual consistency across themes (Parchment, Light, Dark) and provide a clear structure for future AI assistants.

## Typography Classes

| Class Name | Usage | Description |
|------------|-------|-------------|
| `.h1-title` | Page Headers | Large, serif, bold. Use for primary entity titles (e.g., Class Name). |
| `.h2-title` | Section Headers | Medium, serif, bold. Use for major page sections. |
| `.h3-title` | Card Headers | Small, serif, bold. Use for titles inside cards or sub-sections. |
| `.body-text` | Primary Content | Standard sans-serif font. Use for all general descriptions and lore entries. |
| `.description-text` | Excerpts/Quotes | Italicized serif text. Use ONLY for literal excerpts or flavor-text callouts. |
| `.label-text` | Metadata Labels | Tiny, uppercase, bold gold. Use for Level, Source, or Category tags. |
| `.muted-text` | Secondary Info | Low-contrast text. Use for background help text or timestamps. |

## Theme Variables

The application uses CSS variables to handle theme switching dynamically.

- `--ink`: The primary text color (dark in light mode, light in dark mode).
- `--gold`: The primary accent color (dynamic based on user preference).
- `--background`: The main page background color.
- `--card`: The background color for card elements.

## Best Practices

1. **Avoid Hardcoded Colors**: Always use the semantic classes or Tailwind's `text-ink`, `bg-card`, etc., to ensure dark mode compatibility.
2. **Prose Content**: Use the `.prose` class for any rich text content (BBCode/Markdown). It is configured to automatically invert colors in dark mode.
3. **Icons**: Use `lucide-react` icons with `text-gold` or `text-ink/60` for consistency.
