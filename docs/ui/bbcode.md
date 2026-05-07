# RPG Archive BBCode System

This document explains how text is edited, stored, and displayed in the RPG Archive.

## 1. Core Philosophy
The application uses **BBCode** as its primary data format for rich text. This choice provides a balance between human-readability (for the Source mode) and structured parsing (for the Visual mode and final rendering).

## 2. Components

### `MarkdownEditor.tsx`
The primary editing interface. It supports two modes:
- **Visual (WYSIWYG)**: Powered by **TipTap**. It provides a modern, interactive editing experience.
- **Source**: A raw textarea for direct BBCode manipulation.

**Key Features:**
- **Real-time Sync**: Changes in Visual mode are converted to BBCode and saved. Toggling to Source mode shows the raw BBCode.
- **Sticky Toolbar**: The formatting toolbar stays at the top of the editor even when scrolling through long articles.
- **Dynamic Resizing**: The editor scales its height based on content (up to 70vh) and supports manual vertical resizing.

### `BBCodeRenderer.tsx`
The component used to display content throughout the app. It replaces `ReactMarkdown`.
- **Safety**: It sanitizes input and converts BBCode to safe HTML.
- **Consistency**: Ensures that a `[b]` tag looks the same whether it's in a Lore Article, a Class Description, or a Source Book detail.
- **Styling**: Uses the `.prose` class which is aggressively overridden in `index.css` to ensure consistent text colors and opacities across all themes, specifically fixing dark mode legibility.

### `bbcode.ts` (Library)
Contains the core logic for:
- `bbcodeToHtml(text)`: Converts BBCode to HTML for TipTap and the Renderer.
- `htmlToBbcode(html)`: Converts TipTap's HTML output back into BBCode for storage.

## 3. Supported Tags

| Tag | Description | HTML Equivalent |
|-----|-------------|-----------------|
| `[b]` | Bold | `<strong>` |
| `[i]` | Italic | `<em>` |
| `[u]` | Underline | `<u>` |
| `[s]` | Strikethrough | `<del>` |
| `[h1]`-`[h4]` | Headings | `<h1>`-`<h4>` |
| `[left]`, `[center]`, `[right]`, `[justify]` | Alignment | `<p style="text-align:...">` |
| `[ul]`, `[ol]`, `[li]` | Lists | `<ul>`, `<ol>`, `<li>` |
| `[url=...]` | Links | `<a>` |
| `[quote]` | Blockquote | `<blockquote>` |
| `[code]` | Inline Code | `<code>` |
| `[hr]` | Horizontal Rule | `<hr>` |
| `[br]` | Line Break | `<br>` |
| `[small]` | Small Text | `<small>` |
| `[spoiler]` | Spoiler | `<span class="spoiler">` |

## 4. Technical Implementation Details

### TipTap Extensions
The editor uses several TipTap extensions to map BBCode features to a visual interface:
- `StarterKit`: Core features (Bold, Italic, Lists, etc.)
- `Underline`: Support for `<u>`
- `TextAlign`: Support for alignment styles
- `Link`: Support for hyperlinks
- `Subscript`/`Superscript`: Support for `<sub>`/`<sup>`

### Height Persistence
The editor uses a `ResizeObserver` to track its height. This ensures that if you resize the editor in Source mode, it stays that same size when you switch to Visual mode.

### Paragraph Handling
To ensure compatibility with TipTap's block-based model, the `bbcodeToHtml` converter automatically wraps loose text in `<p>` tags while preserving existing block elements like headings and lists.
