# Theming

Three themes, semantic CSS variables, programmatic accent colour, and Tailwind utility integration. All theme variables and utility classes are defined in [src/index.css](../../src/index.css).

## The three themes

Themes are toggled by a class on `<body>` (or `<html>`):

| Class | Background | Accent | Use case |
|---|---|---|---|
| `parchment` | Warm cream `#f5f5f0` | Gold `#c5a059` | Default — sword & sorcery aesthetic |
| `light` | White | Blue `#3b82f6` | High-contrast technical look |
| `dark` | Charcoal `#1a1a1e` | Gold `#c5a059` | Dark mode |

The active theme is read from `userProfile.theme` and applied in `App.tsx` on load and on profile changes.

## Semantic CSS variables

The themes share variable names; their values change per theme. Use these instead of hardcoded colours.

| Variable | Tailwind utility | Purpose |
|---|---|---|
| `--ink` | `text-ink`, `bg-ink` | Primary text — adapts per theme |
| `--gold` | `text-gold`, `bg-gold`, `border-gold` | Accent — gold in `parchment`/`dark`, blue in `light` |
| `--background` | `bg-background` | Page base colour |
| `--card` | `bg-card` | Card background |
| `--blood` | `text-blood`, `bg-blood` | Destructive / danger — always dark red regardless of theme |
| `--foreground` | `text-foreground` | Generic foreground |
| `--muted-foreground` | `text-muted-foreground` | Secondary text |

Opacity modifiers work normally: `text-gold/60`, `border-gold/10`, `bg-gold/5`.

## Programmatic accent injection

Each user can set a custom `accentColor` (hex). On profile load, `App.tsx` writes it into `--primary` (a CSS variable) on the document root. Components that opt into this use `var(--primary)` directly — but the standard pattern is to use the theme's `--gold` instead, which is already accent-aware.

`accentColor` is mostly for the Profile/Settings page and a few personalised UI flourishes; do not use it as a load-bearing colour.

## Opacity ramp

Text and accent hierarchy (faded labels, subtle borders, hover tints) is built with **opacity on `ink`/`gold`**, not separate grey colours — `text-ink/65`, `border-gold/35`, `bg-gold/15`. This is deliberate: an opacity is a translucent shade of the *themed* colour, so it adapts automatically when a user customises their Text or Highlight.

**Use only the canonical 10-step ramp** on `ink`/`gold`:

```
/5   /15   /25   /35   /45   /55   /65   /75   /85   /95
```

Rough intent: `/5–/25` = dividers, faint fills, subtle borders · `/35–/45` = placeholders, muted metadata, chip borders · `/55–/75` = secondary/help text · `/85–/95` = near-primary text. (Live ladder with real use-sites: Settings → Appearance → **Tiers**, or `src/components/appearance/themeMocks.tsx`.)

Do **not** invent intermediate levels (`/40`, `/60`, `/70`, `/12`…). They drift the system back toward the 19 ad-hoc values we collapsed, and read inconsistently once a user changes colours. Snap to the nearest canonical step. `--blood` (danger) is theme-stable and outside this ramp.

## Typography

Two font families:

- **Serif** — `Cormorant Garamond` (variable). Used for page titles and flavour text.
- **Sans-serif** — `Inter` (variable). Used for body, UI controls, data.

Variable fonts ship via `@fontsource-variable/geist` and the Cormorant package — see `package.json`.

Named typography classes (defined in `src/index.css`):

| Class | Use |
|---|---|
| `.h1-title` | Page title — large serif, bold |
| `.h2-title` | Section heading |
| `.h3-title` | Card / sub-section heading |
| `.body-text` | General body copy |
| `.description-text` | Italicised flavour text / excerpts |
| `.label-text` | Tiny gold metadata tag (Level, Source, Category) |
| `.muted-text` | Timestamps, secondary info |
| `.field-label` | Label above any form field |
| `.field-hint` | Helper text below a field |

Full pattern reference is in [style-guide.md](style-guide.md).

## Tailwind 4 + shadcn/ui

The app uses Tailwind 4 (the `@tailwindcss/vite` plugin) with the `@layer components` block in `src/index.css` defining all named classes. shadcn/ui components are styled via the same Tailwind layer, with theme variables ensuring they respect the active theme.

`tailwind-merge` is used by the `cn()` helper in [src/lib/utils.ts](../../src/lib/utils.ts) for safe class composition.

## Animations

The app uses the `motion` library (Framer Motion's modern fork) for animation. Use it sparingly — most UI is intentionally static and technical.

`tw-animate-css` provides Tailwind-compatible utility animations.

## Best practices

1. **Never hardcode colours.** Use `text-ink`, `bg-card`, `text-gold` — not `text-gray-900` or `text-[#1a1a1a]`.
2. **Prefer named typography classes** over inline Tailwind for headings, labels, and body text.
3. **Theme-test new components** in all three themes before considering them done. The blood and gold variables are theme-stable; everything else shifts.
4. **Don't bypass `cn()`.** Pass conditional class strings through it so duplicate utility classes are merged correctly.
5. **Keep dark-mode contrast in mind.** Gold-on-charcoal is the highest-contrast combination available; secondary text should be `gold/65` or `ink/75` minimum to remain readable.
6. **Opacity only on the canonical ramp.** On `ink`/`gold`, use `/5 /15 /25 /35 /45 /55 /65 /75 /85 /95` — never intermediate levels. See [Opacity ramp](#opacity-ramp).

## Related docs

- [style-guide.md](style-guide.md) — every named CSS class with usage patterns
- [content-rendering.md](content-rendering.md) — `BBCodeRenderer` vs `Markdown` rules
- [components.md](components.md) — shared component patterns (Dialog, FilterBar, etc.)
- [bbcode.md](bbcode.md) — rich-text editor and renderer
