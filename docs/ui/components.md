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

### Fullscreen master-detail page (rail + body / rail + tree + detail)

Pattern used by `/admin/proficiencies` (2 panes) and `/compendium/tags` (3 panes). When you need a page where every visible pane reaches the bottom of the viewport and only the *inside* of a pane scrolls — not the document — **copy this recipe rather than rebuilding a grid**.

Three rules that are easy to get wrong:
1. **Lock the page height at every width.** `h-[calc(100vh-4rem)]` on the outer wrapper (4rem = `--navbar-height`). Half-applying it only at `lg+` is the classic "columns reach the bottom on desktop but stop short on phones" bug.
2. **Use a flex row at lg+, not a grid.** Flex row's default `align-items: stretch` makes every visible pane the same height for free. CSS Grid sizes its row to `max(content)` unless you also pass `grid-template-rows: 1fr`, which is one more thing to forget.
3. **Every pane's outer Card needs `flex-1`.** The wrapper `<div>` stretches to the row height, but the Card inside sizes to its content unless you tell it to fill. Missing `flex-1` on any one pane's Card → that column is visibly shorter than its neighbours.

```tsx
// Page wrapper — height-locked, flex column.
<div className="h-[calc(100vh-4rem)] flex flex-col gap-2 lg:gap-4 max-w-[1600px] mx-auto w-full px-3 sm:px-4 py-2 lg:py-4">
  {/* Optional page header. Hide it on narrow widths if you need
      every pixel for the explorer; the rail card already shows
      enough context. */}
  <div className={cn('page-header shrink-0 lg:flex', activeView === 'rail' ? '' : 'hidden')}>
    {/* `lg:flex` — NOT `lg:block`. .page-header is @apply flex,
        and `lg:block` would kill its `items-center` alignment. */}
    …
  </div>

  {/* Pane container — flex column at < lg, flex row at lg+. */}
  <div className="flex flex-col lg:flex-row gap-4 min-h-0 flex-1">
    {/* Rail — full-width at < lg (flex-1 in the column stack),
        fixed 240px at lg+ (flex-none + w-[240px] in the row). */}
    <div className={cn(
      'flex-col flex-1 min-h-0 lg:flex-none lg:w-[240px]',
      activeView === 'rail' ? 'flex' : 'hidden',
      'lg:flex',
    )}>
      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
        …
      </Card>
    </div>

    {/* Body — flex-1 always (fills remaining row space at lg+,
        fills remaining column space at < lg). */}
    <div className={cn(
      'flex-col flex-1 min-h-0',
      activeView === 'body' ? 'flex' : 'hidden',
      'lg:flex',
    )}>
      {/* Narrow-width back-nav row. Sticky just below the
          fixed navbar so it survives scroll. */}
      <div className="lg:hidden sticky top-[var(--navbar-height)] z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-gold/15 shadow-sm flex items-center gap-2 h-12 mb-2">
        <Button onClick={() => setActiveView('rail')} variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5 px-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
      </div>
      <Card className="flex flex-col flex-1 min-h-0 overflow-hidden">
        …
      </Card>
    </div>
  </div>
</div>
```

**`activeView` state machine** — drives narrow-width drilldown. Two-pane pages use `'rail' | 'body'`; three-pane pages use `'rail' | 'tree' | 'detail'`. At `lg+` it's effectively ignored because every pane gets `lg:flex` to override the `hidden` swap. Initialize from URL (`useState(() => params.id ? 'body' : 'rail')`) so deep links don't strand the user on a blank rail.

**Three-pane staggered collapse** (TagsExplorer's variant): the detail collapses first as the viewport narrows. Below `xl`, detail and tree share the body slot via `flex-1` + `activeView`-based visibility; at `xl+` detail switches to `xl:flex-none xl:w-[360px]`.

**Body class** — pages using this shell mount `admin-page-fullscreen` on `documentElement` + `body` in a `useEffect` so the global `<main>` padding is stripped (otherwise the page's `h-[calc(100vh-4rem)]` plus default padding overflows the navbar). See `AdminProficiencies.tsx` for the exact `useEffect` shape.

**SearchInput** — use [`src/components/ui/SearchInput.tsx`](../../src/components/ui/SearchInput.tsx) for any `Search` icon + filter input combo in the rail or pane toolbars. Don't hand-roll `<div className="relative"><Search /><Input pl-7 /></div>` — that's what the shared component is for.

Reference implementations:
- `src/pages/admin/AdminProficiencies.tsx` — 2-pane rail + body. Canonical example.
- `src/pages/compendium/TagsExplorer.tsx` — 3-pane rail + tree + detail with staggered collapse.

**Proposal-route adaptation.** When the editor is mounted inside `ProposalEditorWrapper` (under `/proposals/edit/*`), pass the wrapper's `fullscreen` prop so it switches its outer from `space-y-4` to **`flex flex-col h-[calc(100vh-4rem)] gap-4`**. The explicit calc (instead of `h-full`) is deliberate: App.tsx wraps every route in an `animate-in fade-in` div with no height behaviour, so `h-full` would resolve against a content-sized parent and collapse the whole stack. The child editor then uses **`flex-1 min-h-0 flex flex-col`** on its outer (instead of the direct route's `h-[calc(100vh-4rem)]`) so it grows as a flex item inside the wrapper's flex column, absorbing whatever's left after the sticky proposal strip. The child still has to mount `admin-page-fullscreen` itself (so main's padding is stripped and footer is hidden); the CSS rule at `body.admin-page-fullscreen .proposal-editor-strip { margin: 0 }` mirrors the spell-list-fullscreen bleed-zero so the strip's `-mx-4` doesn't spill into the sidebar. Editors that prefer natural document scroll inside the proposal wrapper just omit the `fullscreen` prop. See `TagsExplorer` + the `/proposals/edit/tags` route in `App.tsx`.

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
Shared filter modal shell used by every list / browse surface in the compendium. Wraps the modal frame, search bar, and bulk affordances (chip-label search, Show All / Hide All); pages provide their own filter sections via the `renderFilters` prop. Companion components in the same file: `<AxisFilterSection>` (single-value axes with 3-state include/exclude + AND/OR/XOR combinators) and `<TagGroupFilter>` (per-group tag filter with subtag section-expand pattern). Full design + roadmap in [filters.md](filters.md).

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

Compact mode (`compact={true}`) renders an avatar-style square picker for feature icon slots. Pass `browseRoot` to add a **Browse** button that opens `IconPickerModal` (select-only) rooted at that R2 prefix.

### `FocalImageField` (`src/components/ui/FocalImageEditor.tsx`)
The single "system image with focal positioning" control — preview + swap (a dropzone, or a button that opens the image manager via `uploadVariant`) + reset, with **optional** drag-to-pan / scroll-zoom (provide `display` + `onDisplayChange`) and an optional `backdrop` flag for faint full-bleed art. `ImageSetEditor` composes several of these (one per window); the campaign editor uses one for the Campaign Image (positionable) and one for the Wiki Background (static `backdrop`); world/era editors use one for their backgrounds. Exports `ImageDisplay` / `DEFAULT_DISPLAY` / `imageFocalStyle` (callers import `imageFocalStyle` aliased as `ClassImageStyle`). See [../features/image-manager.md](../features/image-manager.md).

### `ImageSetEditor` (`src/components/ui/ImageSetEditor.tsx`)
The shared image-authoring control for an entity that shows one artwork in several places (class: Detail / Card / Preview; article: Header / Wiki Card / Hover Preview). A default image plus N caller-defined framable **windows** (per-aspect crops, each overridable). "Edit Display" opens a dialog of `FocalImageField`s. `systemImages` scopes the picker to the System Images library; `controlsOnTop` aligns a row of windows. Used by the class, subclass, and article editors.

### `IconPickerModal` (`src/components/ui/IconPickerModal.tsx`)
Foundry-FilePicker-style browse-and-select modal. Originally icon/token-only; `rootFolder` now accepts **any** R2 prefix (e.g. `images`) so it doubles as a general system-image picker. Optional `title` overrides the heading; `allowUpload={false}` makes it a pure picker (no in-modal upload). Toolbar covers:
- **Source tabs** — would switch between `icons/` and `tokens/`. Only shown when `AVAILABLE_SOURCES` lists more than one source; currently set to `['icons']` so the strip is hidden. Tokens remain wired up for the future creature/NPC system
- **Path navigation** — up-arrow + editable path input (Enter to navigate); the `<source>/` prefix is shown as a non-editable hint
- **Favorites** — star button pins the current path; saved per Firebase uid in `localStorage` (`dauligor.iconPicker.favorites.v1.<uid>`). Each user sees only their own pins. A chip strip below the toolbar lists pins for the active source, each with hover-X to remove
- **Create folder** *(admin only)* — folder-plus opens an inline name row; implemented by writing a `.keep` placeholder under the new prefix (`.keep` and any dotfile is filtered out of listings)
- **Hide private** *(admin only)* — eye-slash toggle hides folders starting with `_` (e.g. `_temp`); default **on**. Non-admins always have these hidden
- **Display mode** — Tile (5-col grid) or List (thumb + name + size + date)
- **Filter** — searches recursively across the **current folder and its subtree**, lazy-loaded; cache invalidates on folder change
- **Upload** *(admin only)* — saves to current folder, or to `<source>/_temp/` for later sorting via the Image Manager
- **Drag-and-drop** *(admin only)* — drop files from the OS onto the modal; uploads sequentially into the current folder

The caller passes `rootFolder` as the prefix to browse (default `icons`). Admin-only buttons read the role from [`src/lib/currentUser.ts`](../../src/lib/currentUser.ts) (set by App.tsx); the server proxy is the authoritative gate. Uploads auto-crop to 126² for the icons root / 400² for tokens, and **not at all** for general roots; WebP conversion automatic.

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
