# From `system-applications` → `compendium-editors`: subclass image-led hover (handoff) + FYI on system pages

> **From:** `system-applications` · **To:** `compendium-editors` · **Date:** 2026-05-29
> **Status:** 1 ask (subclass image-led hover) + 1 FYI (system pages are live; `&` refs are now clickable end-to-end). No blockers.

---

## Ask — subclass image-led hover (deferred from class work)

When the class preview pane / hover card landed on `system-applications` today
(commit `a611b2d` on `main`, see [system-applications/2026-05-29-reference-enhancements.md](../system-applications/2026-05-29-reference-enhancements.md)),
the user noted the same treatment should apply to **subclasses** — but
explicitly deferred it to `compendium-editors` (your branch already claims
`SubclassEditor` for roadmap step 2 "bespoke cleanup," and subclass UI is your
domain). System-applications is paused on this; subclass hover is in your court.

### What "the same treatment" means

- The class-ref hover card uses an **image-led `ClassPreviewCard`** (image +
  serif gold title + source + short preview) rather than the generic hover
  layout, and clicking it opens the full **`ClassPreviewPane`** as an
  in-place overlay (not navigating to the class view). "View Page" inside
  the pane is the route to `/compendium/classes/view/:id`.
- For subclasses, the analogous shape: a `SubclassPreviewCard` (if subclass
  imagery exists; subclasses have `card_image_url`/`image_url` columns
  already) + a `SubclassPreviewPane` overlay on `&` / `@subclass[…]` ref
  click.

### Templates already on `main`

These are the patterns to mirror. All committed and on `origin/main`:

- **`src/components/compendium/ClassPreviewCard.tsx`** — image-led card. Uses
  `ClassImageStyle({ display })`, a gold-outlined serif title, source label,
  preview body, optional admin delete. Reusable shape — should clone cleanly
  for subclasses with the analogous image field + source resolution.
- **`src/components/compendium/ClassPreviewPane.tsx`** — full preview pane.
  Self-fetches by `classId` (PK), or accepts a pre-passed `classData` object;
  accepts an optional `foundation` (catalog of tags/skills/attributes/etc.)
  to avoid double-fetch when the host already loaded them. Optional
  callbacks `onViewPage` / `onEdit` only render their buttons when provided;
  `selectionMode` + `onSelect` + `onCancel` swap to a picker UI. Same
  template logic should map to subclasses (the data model is parallel —
  there's a parent class, features, advancements, etc.).
- **`src/components/reference/ReferenceHoverCard.tsx`** — the
  `c.variant === 'ref' && c.kind === 'class'` branch renders the image-led
  card with `onClick={() => openClassPane(cls)}`, which sets
  `paneClass = cls` (clearing the hover chain) and renders
  `<ClassPreviewPane classId={paneClass.docId ?? paneClass.id} open
  onClose={() => setPaneClass(null)} onViewPage={() => navigate(paneClass.route)} />`.
  Mirror that branch for `kind === 'subclass'` (and any other image-led kind
  in the future).
- **`src/lib/references.ts`** — `KIND_CONFIG['class']` includes `imageExpr`
  (`COALESCE(NULLIF(card_image_url, ''), image_url)`) and `sourceExpr` (an
  inline source lookup). `KIND_CONFIG['subclass']` currently has neither —
  add them analogously so `RefResolved.imageUrl` / `RefResolved.sourceLabel`
  are populated for subclass refs (subclasses have a `source_id` already).
- **`RefResolved.docId`** is the real DB primary key (the kind's `id` field
  is the semantic identifier/slug). `ClassPreviewPane` consumes `docId` to
  call `fetchDocument('classes', pk)`. Same shape will apply for
  `fetchDocument('subclasses', pk)`.

### Data ready

Subclasses got a `preview` column in an earlier commit today (`ffacedd`,
migration `20260529-1200_subclass_preview.sql`), and that migration is
applied to **remote** D1 (per the prior push-to-main round). The hover/pane
can use `preview` directly — it's already what the reference hover card
surfaces as the subclass summary
(`KIND_CONFIG['subclass'].summaryExpr = "COALESCE(NULLIF(preview, ''), description)"`).

### File ownership

`SubclassEditor.tsx` is on your branch's primary-files list (roadmap step 2
"bespoke cleanup"). New files `SubclassPreviewCard.tsx` / `SubclassPreviewPane.tsx`
would live under `src/components/compendium/` — which your manifest claims
EXCEPT for the system-applications-owned `SystemPageGlossary.tsx` (already
shipped). New subclass-preview files are clearly in your scope; go ahead.

The `RefKind` type and `KIND_CONFIG` in `src/lib/references.ts` are on
`system-applications`. Adding `imageExpr` / `sourceExpr` to
`KIND_CONFIG['subclass']` is structural enough that it should be coordinated
— if you want, file it as an open-request back to `system-applications` and
we'll add it; or this branch can do it if the manifest's "Shared files
(append-only)" rule covers it (it does NOT — it's a structural change to
the config object, not an append).

**Suggested split:** `compendium-editors` builds the two new component files +
the ReferenceHoverCard subclass branch (or coordinates the hover-card edit);
`system-applications` adds `imageExpr` / `sourceExpr` to
`KIND_CONFIG['subclass']` (small, single edit, file is ours). I (or whoever
picks up `system-applications` next) can do that on request.

---

## FYI — system pages are live; `&` refs are now clickable end-to-end

Today's other shipped feature on `main` (commits `8989bd1` + `1ecbf0a`,
documented in [../system-applications/2026-05-29-system-pages.md](../system-applications/2026-05-29-system-pages.md)):
a **system page article type** for site-consistent reference glossaries
(Conditions, Skills, Magic, homebrew rules), with the `&` rule reference
system extended to navigate into them.

Practical implications for your editors:

- `&condition[paralyzed]` and Foundry's `&Reference[condition=paralyzed]`
  (and page-level `&condition[]`) now resolve to clickable refs that
  **hover-preview** + **navigate** to `/system/conditions#paralyzed`. If
  feat/spell/item descriptions in your editors want to cite rules, the `&`
  autocomplete is wired and the grammar accepts both forms.
- The `&` autocomplete (inside `MarkdownEditor`) now surfaces system pages
  AND their entries as results. No code change needed on your side — it
  works wherever `MarkdownEditor` is used.
- Pages can be addressed by EITHER their canonical identifier OR a slugified
  match against their name (so Foundry's `condition` kind resolves to a page
  whose admin identifier is `conditions` if the name is "Condition"). The
  `bbcode.ts` ↔ `_bbcode.ts` drift on refs is **intentional** (server keeps
  refs as text for Foundry-side enrichers) — don't try to mirror.

**No action required** — this is informational. Nothing changed in files
your branch owns.

---

## Coordination

- `system-applications` is paused after the system-page push, pending the
  user's next direction (likely Foundry inline-roll formulas, condition →
  system-entry linking, or the live-content bridge).
- Subclass image-led hover is now in your court. Ping back via the same
  pattern (file a new dated handoff in `handoffs/system-applications/` from
  `compendium-editors`) if you want the `KIND_CONFIG['subclass']` edit done
  on our side, or any other coordination.
