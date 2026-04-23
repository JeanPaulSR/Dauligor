# Styling & Theming Architecture

The UI is implemented using **Tailwind CSS** and **shadcn/ui**.

## 1. Theme Implementation

Themes are toggled via a class string on the `<html>` or `<body>` element.

- **`parchment`**: Sets `--background` to a yellowish-white and uses ink-style typography.
- **`light`**: Standard grayscale lighting.
- **`dark`**: Dark charcoal background with high-luminance text.

### Semantic CSS Variables
Variables defined in `src/index.css`:
- `--background`: Page base color.
- `--foreground`: Primary text color.
- `--card`: Background for `Card` components.
- `--primary`: Accent color for buttons and highlights.
- `--secondary`: Background for secondary buttons and badges.

## 2. Programmatic Color Injection

- **Logic**: `src/App.tsx` reads the `accentColor` field from the active `userProfile`.
- **Dynamic CSS**: The hex code is injected as a CSS variable `--primary` into a style tag or the document body.

## 3. Utility Classes (`src/index.css`)

Fixed class names for typography:
- `.h1-title`: `font-serif text-3xl font-bold tracking-tight`.
- `.description-text`: `font-serif text-sm italic opacity-80`.
- `.label-text`: `text-xs font-semibold uppercase tracking-wider`.
- `.muted-text`: `text-sm text-muted-foreground`.

## 4. Typography Plugin Configuration

- **Lib**: `@tailwindcss/typography` (`prose` class).
- **Overrides**: Global CSS forces `--foreground` on all child elements of `.prose` to ensure consistent legibility across theme state changes.
