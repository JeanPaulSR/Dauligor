# Archive Style Guide

This is the single source of truth for CSS classes and UI patterns in Dauligor.

**Before writing inline Tailwind strings, check whether a class here already covers the pattern.**

All named classes are defined in `src/index.css` under `@layer components`.

---

## Typography

| Class | Use |
|---|---|
| `.h1-title` | Page title — large serif, bold |
| `.h2-title` | Section heading — medium serif, bold |
| `.h3-title` | Card / sub-section heading — small serif, bold |
| `.body-text` | General body copy |
| `.description-text` | Flavor text, italicized excerpts |
| `.label-text` | Tiny gold metadata tag: Level, Source, Category |
| `.muted-text` | Timestamps, secondary info |

---

## Form Fields

| Class | Use |
|---|---|
| `.field-label` | Label above any form field |
| `.section-label` | Gold variant for config section headers |
| `.field-input` | Height + background for `<Input>` and `<SelectTrigger>` |
| `.field-hint` | Helper / hint text below a field |

### Pattern: labeled text input

```tsx
<div className="space-y-1.5">
  <label className="field-label">Hit Die</label>
  <Input className="field-input" type="number" />
  <p className="field-hint">The die rolled for hit points at each level.</p>
</div>
```

### Pattern: labeled Select

```tsx
<div className="space-y-1.5">
  <label className="field-label">Advancement Type</label>
  <Select value={value} onValueChange={(val) => { if (!val) return; onChange(val); }}>
    <SelectTrigger className="field-input">
      {/* Always pass an explicit display string — SelectValue can fail to read
          portal-rendered SelectItem content on first render */}
      <SelectValue>{LABELS[value] ?? 'Select...'}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="a">Option A</SelectItem>
      <SelectItem value="b">Option B</SelectItem>
    </SelectContent>
  </Select>
</div>
```

> **Gotcha**: `onValueChange` can receive `null` in the current shadcn version. Always guard with `if (!val) return;` before using the value.

---

## Page Layout

| Class | Use |
|---|---|
| `.page-header` | Top bar: page title left, Save button right |
| `.section-header` | Intra-section divider: label left, optional Add button right |
| `.section-divider` | Horizontal rule between major config blocks |
| `.config-fieldset` | Foundry-style bordered section — use with `<fieldset>` + `<legend>` |

### Pattern: page header

```tsx
<div className="page-header">
  <h1 className="h1-title">Class Editor</h1>
  <Button className="btn-gold-solid">Save Changes</Button>
</div>
```

### Pattern: section header

```tsx
<div className="section-header">
  <h3 className="label-text text-gold">Advancements</h3>
  <Button size="sm" className="h-7 gap-2 btn-gold">
    <Plus className="w-3.5 h-3.5" /> Add Row
  </Button>
</div>
```

### Pattern: config section divider

```tsx
<div className="section-divider">
  <h4 className="section-label">Configuration</h4>
  {/* fields */}
</div>
```

### Pattern: config fieldset (Foundry-style grouping)

Mirrors Foundry's `<fieldset>` + `<legend>` layout pattern for advancement editors.
Use `text-gold/60` for standard sections and `text-sky-500/60` for player-choice sections.

```tsx
<fieldset className="config-fieldset">
  <legend className="section-label text-gold/60 px-1">Details</legend>
  {/* fields inside */}
</fieldset>

<fieldset className="config-fieldset">
  <legend className="section-label text-sky-500/60 px-1">Choices</legend>
  {/* player-choice fields */}
</fieldset>
```

---

## Containers & Cards

| Class | Use |
|---|---|
| `.lore-card` | Browser / listing card — hover shadow |
| `.compendium-card` | Editor list-item card: advancement row, feature row |
| `.compendium-row` | Dense row inside a pool or grant list |
| `.empty-state` | Centered placeholder when a list is empty |

### Pattern: editor list-item row

```tsx
<div className="compendium-card flex items-center gap-3 p-3 group">
  {/* level + icon block */}
  <div className="w-10 h-10 bg-background rounded border border-gold/10 flex flex-col items-center justify-center shrink-0">
    <span className="text-[10px] font-mono text-gold/60">L1</span>
  </div>
  <div className="flex-1 min-w-0">
    <span className="text-xs font-black uppercase text-ink/80">Title</span>
    <p className="field-hint">Summary line</p>
  </div>
  {/* actions — visible on hover */}
  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold hover:bg-gold/10">
      <Edit2 className="w-3.5 h-3.5" />
    </Button>
    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 btn-danger">
      <Trash2 className="w-3.5 h-3.5" />
    </Button>
  </div>
</div>
```

### Pattern: empty state

```tsx
<div className="empty-state">
  <Zap className="w-8 h-8 text-gold/20 mb-3" />
  <p className="description-text">No advancements defined yet.</p>
  <p className="label-text text-gold/40 mt-1">Add the first entry above</p>
</div>
```

---

## Browser (Two-Panel Split View)

Use for any component that pairs a scrollable name list on the left with a detail pane on the right (class features, unique option groups, etc.).

| Class | Apply to | Use |
|---|---|---|
| `.browser-panel` | outer `<div>` | Border, rounded corners, flex row, clip overflow |
| `.browser-sidebar` | left panel `<div>` | Gold-tinted border-right, flex column |
| `.browser-row` | `<button>` inside sidebar | Row item with hover tint and bottom divider |
| `.browser-content` | right content `<div>` | Padded, scrollable detail area |

Width of `.browser-sidebar` is set via a `w-[Xpx]` utility or `style={{ width }}` prop — the class itself does not set a width. Pass `minHeight` via `style` on `.browser-panel` and `maxHeight` on `.browser-content`.

### Pattern: two-panel feature browser

```tsx
<div className={cn("browser-panel", className)} style={{ minHeight: maxHeight }}>
  {/* Left: names list */}
  <div className="w-[200px] browser-sidebar">
    <div className="flex-grow overflow-y-auto" style={{ maxHeight }}>
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "browser-row",
            selectedId === item.id
              ? 'bg-gold/20 border-r-4 border-r-gold text-gold font-bold shadow-inner'
              : 'text-ink/70'
          )}
        >
          {item.name}
        </button>
      ))}
    </div>
  </div>
  {/* Right: detail pane */}
  <div className="browser-content" style={{ maxHeight }}>
    {/* content */}
  </div>
</div>
```

---

## Navigation

| Class | Apply to | Use |
|---|---|---|
| `.nav-label` | `<span>`, `<div>`, `<button>` | Responsive category/section label — add `text-gold` or `text-ink/40` for color |
| `.nav-section-btn` | `<button>` | Collapsible section toggle in the sidebar |

`.nav-label` intentionally has no default text color so callers can pass `text-gold`, `text-ink/40`, or a conditional expression.

### Pattern: sidebar section header (static)

```tsx
<div className="flex items-center gap-2 nav-label text-gold mb-2 px-2">
  <BookOpen className="w-3 h-3" />
  <span>Recent</span>
</div>
```

### Pattern: collapsible section button

```tsx
<button onClick={toggle} className="nav-section-btn nav-label text-gold">
  <span>{sectionName}</span>
  {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
</button>
```

### Pattern: role badge (conditional color)

```tsx
<span className={`nav-label ${isStaff ? 'text-gold' : 'text-ink/40'}`}>
  {role}
</span>
```

---

## Data Tables

Use for any bordered list-table: trait pool, item grant list, scale value grid.

| Class | Apply to | Use |
|---|---|---|
| `.data-table` | outer `<div>` | Border, rounded corners, clip overflow |
| `.data-table-head` | header row `<div>` | Gold-tinted sticky header |
| `.data-table-th` | `<span>` inside header | Column header text |
| `.data-table-body` | body `<div>` | Dividers + scroll container |
| `.data-table-row` | row `<div>` | Hover tint — pair with `grid-cols-*` |

### Pattern: two-state checklist table (e.g. Guaranteed / Choice Pool)

```tsx
<div className="data-table">
  <div className="data-table-head grid grid-cols-[1fr_5rem_5rem]">
    <span className="data-table-th">Trait</span>
    <span className="data-table-th text-center text-gold/60">Guaranteed</span>
    <span className="data-table-th text-center text-sky-500/60">Choice Pool</span>
  </div>
  <div className="data-table-body max-h-96">
    {items.map(item => (
      <div key={item.id} className="data-table-row grid grid-cols-[1fr_5rem_5rem]">
        <span className="text-xs text-ink/80">{item.name}</span>
        {/* checkbox columns */}
      </div>
    ))}
  </div>
</div>
```

### Pattern: simple item list table (e.g. Item Grant pool)

```tsx
<div className="data-table">
  <div className="data-table-head grid grid-cols-[1fr_2rem]">
    <span className="data-table-th">Item</span>
    <span className="data-table-th">Remove</span>
  </div>
  <div className="data-table-body max-h-52">
    {pool.map(item => (
      <div key={item.id} className="data-table-row grid grid-cols-[1fr_2rem]">
        <span className="text-xs text-ink/80">{item.name}</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 btn-danger">
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    ))}
  </div>
</div>
```

---

## Editor Tables (TipTap)

These classes are designed for TipTap extension `HTMLAttributes` — they style real HTML `<table>`, `<tr>`, `<th>`, `<td>` elements produced by the rich text editor, not React div grids.

| Class | Apply to HTML element | Use |
|---|---|---|
| `.editor-table` | `<table>` | Full-width bordered table |
| `.editor-table-row` | `<tr>` | Row with bottom divider and hover tint |
| `.editor-table-th` | `<th>` | Gold-tinted header cell |
| `.editor-table-td` | `<td>` | Standard data cell |

### Pattern: TipTap table configuration

```ts
Table.configure({
  resizable: true,
  HTMLAttributes: { class: 'editor-table' },
}),
TableRow.configure({
  HTMLAttributes: { class: 'editor-table-row' },
}),
TableHeader.configure({
  HTMLAttributes: { class: 'editor-table-th' },
}),
TableCell.configure({
  HTMLAttributes: { class: 'editor-table-td' },
}),
```

---

## Dialog / Modal Windows

| Class | Apply to | Use |
|---|---|---|
| `.dialog-content` | `<DialogContent>` | Background, border, no default padding |
| `.dialog-header` | `<DialogHeader>` | Dark title bar |
| `.dialog-title` | `<DialogTitle>` | Gold serif title text |
| `.dialog-body` | inner `<div>` | Padded, scrollable content area |
| `.dialog-footer` | `<DialogFooter>` | Footer action bar |

Set `max-w-*` on `<DialogContent>` to control width. Default recommendation:
- `max-w-lg` — simple single-field dialogs (confirmation, rename)
- `max-w-2xl` — standard editor dialogs
- `max-w-5xl` — wide editor dialogs with two-column config (e.g. Trait advancement)

### Pattern: standard editor dialog

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="dialog-content max-w-2xl">

    <DialogHeader className="dialog-header">
      <DialogTitle className="dialog-title">Configure Advancement</DialogTitle>
    </DialogHeader>

    <div className="dialog-body max-h-[72vh]">
      {/* form rows */}
    </div>

    <DialogFooter className="dialog-footer">
      <Button variant="ghost" onClick={() => setOpen(false)} className="muted-text">
        Cancel
      </Button>
      <Button className="btn-gold-solid px-8 label-text">Save</Button>
    </DialogFooter>

  </DialogContent>
</Dialog>
```

---

## Buttons

These target the `className` prop on shadcn `<Button>`. They set color and weight only — use the `size` prop for height/padding.

| Class | Use |
|---|---|
| `.btn-gold` | Ghost gold — Add Row, minor actions |
| `.btn-gold-solid` | Solid gold — primary Save / Confirm |
| `.btn-danger` | Ghost danger — Delete / destructive |
| `.filter-tag` | Base for three-state toggle tags — pair with a `btn-*` class per state |

### Pattern: section add-row button

```tsx
<Button size="sm" className="h-7 gap-2 btn-gold">
  <Plus className="w-3.5 h-3.5" /> Add Row
</Button>
```

### Pattern: primary save button

```tsx
<Button className="btn-gold-solid px-8 label-text">Save Changes</Button>
```

### Pattern: icon delete button

```tsx
<Button variant="ghost" size="sm" className="h-7 w-7 p-0 btn-danger">
  <Trash2 className="w-3.5 h-3.5" />
</Button>
```

---

## Theme Variables

| Variable | Tailwind utility | Use |
|---|---|---|
| `--ink` | `text-ink`, `bg-ink` | Primary text — adapts per theme |
| `--gold` | `text-gold`, `bg-gold`, `border-gold` | Accent — gold in Dark/Parchment, blue in Light |
| `--background` | `bg-background` | Page base color |
| `--card` | `bg-card` | Card background |
| `--blood` | `text-blood`, `bg-blood` | Destructive / danger — always dark red |

Opacity modifiers work normally: `text-gold/60`, `border-gold/10`, `bg-gold/5`.

### Available themes (applied as a class on `<body>`)

| Class | Background | Accent |
|---|---|---|
| `.parchment` | Warm cream | Gold `#c5a059` |
| `.light` | White | Blue `#3b82f6` |
| `.dark` | Charcoal `#1a1a1e` | Gold `#c5a059` |

---

## Best Practices

1. **Never hardcode colors.** Use `text-ink`, `bg-card`, `text-gold` — not `text-gray-900` or `text-[#1a1a1a]`.
2. **Use `.field-label` for all form labels.** Do not write `text-[10px] uppercase font-black text-ink/60 tracking-widest` inline.
3. **Use `.field-input` on `<Input>` and `<SelectTrigger>`.** It sets height, background, and border consistently.
4. **Empty lists always use `.empty-state`**, not ad-hoc flex/center arrangements.
5. **Prose / rich text output always uses `.prose`** — it auto-adapts colors to the active theme.
6. **Icons**: `text-gold` for primary actions, `text-ink/60` for neutral, `text-blood` for destructive.
7. **`<SelectValue>` must have explicit children** — always pass the display string as children, not relying solely on `SelectItem` content which may not render on first mount through a React portal.
8. **Guard `onValueChange` for null** — the current shadcn version passes `string | null`; always check `if (!val) return;`.
