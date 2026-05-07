# Shared Components

Reusable components and the patterns they expect. For the full visual class catalog see [style-guide.md](style-guide.md).

## Layout shell

### `Navbar` (`src/components/Navbar.tsx`)
Fixed header. Contains:
- App brand
- Campaign switcher (writes to `users.active_campaign_id` in D1)
- Account dropdown
- Theme/preview-mode toggles for staff

### `Sidebar` (`src/components/Sidebar.tsx`)
Sticky left column on desktop, mobile drawer (`Dialog`) below `md`. Reads `effectiveProfile.role` to decide which sections to show. State:
- `isCollapsed` — boolean, controlled by App.tsx
- Section expand/collapse — local state per nav-section

When adding a new top-level page, register it in `NAV_ITEMS` here AND add the route in `App.tsx`.

### `<main>` content container
Wraps `Routes`. Errors are caught by `ErrorBoundary`. Each page is responsible for its own scrolling — the shell does not impose a max-height.

## Forms

### `Input` / `<SelectTrigger>` (shadcn/ui)
Apply `.field-input` for consistent height, background, and border.

### `Select` (shadcn/ui)
- **Always pass an explicit display string as `<SelectValue>` children.** SelectValue can fail to read portal-rendered SelectItem content on first render; the explicit children avoids that.
- **Guard `onValueChange` for null** — current shadcn version sometimes passes `string | null`. Always check `if (!val) return;` before using the value.

### Pattern: labelled input
```tsx
<div className="space-y-1.5">
  <label className="field-label">Hit Die</label>
  <Input className="field-input" type="number" />
  <p className="field-hint">The die rolled at each level.</p>
</div>
```

## Dialogs

### `Dialog` (shadcn/ui via Radix)
Use the `.dialog-*` classes — see [style-guide.md](style-guide.md#dialog--modal-windows).

Width sizing:
- `max-w-lg` — confirmation, rename
- `max-w-2xl` — standard editor dialogs
- `max-w-5xl` — wide editor dialogs (Trait advancement, etc.)

For full-page editors that won't fit any of the above, use `max-w-[95vw] lg:max-w-4xl`.

## Lists & tables

### `data-table-*` classes
Bordered list-tables for traits, item grants, scaling values. Pair with `grid-cols-*` for the row layout.

### `editor-table-*` classes
For TipTap-rendered tables (real `<table>` elements from rich text). These are configured via TipTap's `HTMLAttributes`:

```ts
Table.configure({ resizable: true, HTMLAttributes: { class: 'editor-table' } }),
TableRow.configure({ HTMLAttributes: { class: 'editor-table-row' } }),
TableHeader.configure({ HTMLAttributes: { class: 'editor-table-th' } }),
TableCell.configure({ HTMLAttributes: { class: 'editor-table-td' } }),
```

### `VirtualizedList` (`src/components/VirtualizedList.tsx`)
Used by the spell list and manual spell manager when row counts exceed a few hundred. Wraps a windowed renderer; pass an array of items and a row-render function.

### Pattern: empty state
```tsx
<div className="empty-state">
  <Zap className="w-8 h-8 text-gold/20 mb-3" />
  <p className="description-text">No advancements defined yet.</p>
  <p className="label-text text-gold/40 mt-1">Add the first entry above</p>
</div>
```

## Browsers (two-panel split views)

### `browser-*` classes
For any list-on-left, detail-on-right component (class features, unique option groups, spell list, image manager).

```tsx
<div className="browser-panel" style={{ minHeight }}>
  <div className="w-[200px] browser-sidebar">
    <div className="flex-grow overflow-y-auto" style={{ maxHeight }}>
      {/* browser-row buttons */}
    </div>
  </div>
  <div className="browser-content" style={{ maxHeight }}>
    {/* detail pane */}
  </div>
</div>
```

The sidebar width is set via `w-[Xpx]` or `style={{ width }}`. The class itself is layout-only.

### `FilterBar` (`src/components/compendium/FilterBar.tsx`)
Shared filter modal shell used by `ClassList`, `SpellList`, etc. Supports custom filter sections and labels so each list can supply its own filter UI through the same modal frame.

## Rich text

### `MarkdownEditor` (`src/components/MarkdownEditor.tsx`)
TipTap-based editor with Visual / Source toggle. Storage format is BBCode; conversion happens in [src/lib/bbcode.ts](../../src/lib/bbcode.ts). See [bbcode.md](bbcode.md).

Props of note:
- `value` / `onChange` — controlled input
- `autoSizeToContent` (default true) — set false for stable-baseline editors (e.g., spell description)
- `isWYSIWYG` (default true) — initial mode; toggles to source on click
- The editor uses a `ResizeObserver` to preserve manually-resized height across mode switches.

### `BBCodeRenderer` (`src/components/BBCodeRenderer.tsx`)
Display component. Sanitises BBCode, converts to HTML, wraps in `.prose` for theme-consistent typography. Use this for any field stored as BBCode.

### Reference launchers
For formula authoring (spellcasting, feature uses, activity damage), components opt into a small popover trigger that opens the formula reference helper. Sources:
- [src/components/reference/ReferenceSyntaxHelp.tsx](../../src/components/reference/ReferenceSyntaxHelp.tsx) — compact field-level help
- [src/components/reference/ReferenceSheetDialog.tsx](../../src/components/reference/ReferenceSheetDialog.tsx) — draggable utility window
- [src/components/reference/CharacterReferencePanel.tsx](../../src/components/reference/CharacterReferencePanel.tsx) — sheet-side launcher card

See [../architecture/reference-syntax.md](../architecture/reference-syntax.md) for the supported syntax.

## Image inputs

### `ImageUpload` (`src/components/ui/ImageUpload.tsx`)
Reusable upload widget. Three image types (`standard` / `icon` / `token`) determine the resize behaviour. WebP conversion is automatic.

Compact mode (`compact={true}`) renders an avatar-style square picker for feature icon slots.

### `IconPickerModal` (`src/components/ui/IconPickerModal.tsx`)
Browse-and-select modal for icon/token slots. Browses an R2 prefix (`icons/` or `tokens/`) with breadcrumb navigation, search across all subfolders, and an inline upload panel for staging new icons in a `_temp/` folder.

See [../features/image-manager.md](../features/image-manager.md) for the wider image system.

## Buttons

Apply on `<Button className="...">`:

| Class | Use |
|---|---|
| `.btn-gold` | Ghost gold — Add Row, minor actions |
| `.btn-gold-solid` | Solid gold — primary Save / Confirm |
| `.btn-danger` | Ghost danger — Delete |
| `.filter-tag` | Three-state toggle base — pair with one of the above for the active state |

Set height/padding via the shadcn `size` prop, not inline.

## Toasts

`sonner` is the project's toast lib. Import `{ toast }` from `sonner`. Standard signatures:

```ts
toast("Saved.");
toast.success("Class updated.");
toast.error("Failed to save: " + message);
toast.warning("Unsaved changes will be lost.");
```

D1 helpers in [src/lib/d1.ts](../../src/lib/d1.ts) call `toast.error(...)` automatically on fallback errors. Don't double-toast in the call site.

## Icons

`lucide-react` only. Standard sizes:
- `w-3 h-3` for inline label/nav icons
- `w-3.5 h-3.5` for button icons
- `w-4 h-4` for primary/inline actions
- `w-8 h-8` for empty-state placeholders
- `w-10 h-10` to `w-12 h-12` for prominent badges

Standard colours:
- `text-gold` — primary action
- `text-ink/60` — neutral
- `text-blood` — destructive

## Hooks

### `useUnsavedChangesWarning` (`src/hooks/useUnsavedChangesWarning.ts`)
Wraps the `beforeunload` event for editors. Pass a boolean indicating whether there are unsaved changes; the hook handles the prompt. Used in `ClassEditor`, `SubclassEditor`, `CharacterBuilder`.

Editors should also support `Ctrl/Cmd+S` for save — see existing editors for the pattern.

## Related docs

- [style-guide.md](style-guide.md) — full visual class catalog
- [theming.md](theming.md) — themes and CSS variables
- [bbcode.md](bbcode.md) — supported tags, parser
- [content-rendering.md](content-rendering.md) — `BBCodeRenderer` vs `Markdown`
