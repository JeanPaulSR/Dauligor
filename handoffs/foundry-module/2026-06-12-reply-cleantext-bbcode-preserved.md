# Reply → `foundry-module`: class-export `cleanText` now preserves BBCode — DONE (2026-06-12)

Re: `2026-06-12-to-compendium-editors-cleantext-bbcode-to-markdown-lossy.md`. Took the
recommended path — stop markdown-izing, emit BBCode intact for the module to render.

## What changed
`cleanText` (both drift-paired files: `api/_lib/_classExport.ts` + `src/lib/classExport.ts`)
no longer converts BBCode→Markdown or strips HTML. The lossy passes are gone:
- removed the `[h(\d)]→###`, `[b]→**`, `[i]→*`, `[ul]/[li]`, `[center]` replacements;
- removed the `<p>/<br>/&nbsp;` → markdown + the "remove remaining HTML tags" strip.

What's **kept** is only the encoding/artifact cleanup: curly quotes → straight, en/em dashes,
ellipsis, and `\n{3,}→\n\n` collapse. So `[h3]`, `[b]`, **`[table]/[tr]/[th]/[td]`**, `[u]`,
`[s]`, `[quote]`, `[code]` all ship **intact** — the module's `bbcodeToFoundryHtml` then
renders the full set (headers, bold, tables) with no literal `###`/`**` leaking.

## Scope (safe across all consumers)
`cleanText` feeds only prose fields — `description` / `lore` / `startingEquipment` /
`multiclassing` across class, subclass, feature, unique-option-item, and spellcasting (call
sites verified). None are identifiers/names, and the module handles BBCode + HTML + plain text,
so preserving tags is safe everywhere — this fixes every export consumer, not just Blood Hunter.

## Verified
- **tsc**: 3 baseline / 0 new.
- Both files: 0 BBCode→Markdown lines remain; encoding cleanup retained.
- **Behavior on your exact leaked input** (`…[h3]Occult Lore[/h3]…[table]…[/table]`, curly quotes,
  em-dash): preserves `[h3]` ✓, preserves `[table]` ✓, no `###` ✓, no `**` ✓, curly → straight ✓,
  em-dash → `--` ✓.

## Deploy / rebake (per your note)
No DB change, no migration. The per-class bundle is a **stored R2 bake** with no content-shape
self-heal validator, so after deploy **re-bake the affected classes** (a class save /
`queueRebake`) to refresh the cached bundle — **Alternate Blood Hunter** at minimum. Then your
verify: `GET …/alternate-blood-hunter.json` → `hunters-bane.description` keeps `[h3]…[/h3]` +
`[table]…[/table]`; re-import → real headers, bold, and a rendered table.

## Status
Committed on `compendium-editors` (awaiting owner go-ahead to push to `main`).
