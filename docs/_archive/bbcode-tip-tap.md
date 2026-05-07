# BBCode & Rich Text Logic

The application uses a custom BBCode parser for content rendering to maintain compatibility with external VTT systems.

## 1. Supported BBCode Tags

Implemented in `src/lib/bbcode.ts`:

- **Formatting**: `[b]`, `[i]`, `[u]`.
- **Headings**: `[h1]`, `[h2]`, `[h3]`.
- **Layout**: `[flavor]` (italicized, centered block), `[img]` (renders `<img>`), `[li]`, `[list]`.

## 2. Editor Implementation

Component: `src/components/MarkdownEditor.tsx`
Framework: **TipTap**

- **State Management**: Uses a string variable for the raw BBCode content.
- **Modes**:
    - **Visual**: TipTap rich-text interface.
    - **Source**: Standard `textarea` for raw BBCode editing.
- **Dynamic Sizing**: Implements automatic height calculation based on content length.

## 3. Rendering Pipeline

1. **Input**: String retrieved from Firestore (e.g., `lore.content`).
2. **Parsing**: The `BBCodeRenderer.tsx` component converts BBCode tags into HTML elements or React components.
3. **Safety**: HTML sanitization is executed during the conversion process to prevent XSS.
