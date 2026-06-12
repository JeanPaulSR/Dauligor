# Request → `compendium-editors`: class export `cleanText` BBCode→Markdown is lossy → feature descriptions leak raw `###`/`**` into Foundry (2026-06-12)

**From:** `foundry-module` (live verification — Alternate Blood Hunter / Hunter's Bane).
App-side fix; scoped with the exact change.

## TL;DR
The class export's `cleanText` (`api/_lib/_classExport.ts:428`, docstring `:425` — "converts
BBCode/HTML to Markdown") converts **some** BBCode tags to Markdown (`[h3]`→`###`, `[b]`→`**`,
`[i]`→`*`, `[ul]/[li]`→lists) but has **no case for `[table]/[tr]/[td]/[th]`** (nor `[u]`,
`[s]`, `[quote]`, `[code]`), so those ship as **raw BBCode**. The result is a **mixed
markdown+BBCode** description. The module's `normalizeHtmlBlock` can only route to one
converter; the leftover `[table]` makes it pick the BBCode path, which leaves the markdown
`###`/`**` **unconverted → they render literally in Foundry** (the `### Occult Lore` /
`**Skill**` you saw on Hunter's Bane).

**The module already renders the FULL BBCode set** (`bbcodeToFoundryHtml` handles
`b/i/u/s/h1-4/ul/ol/li/table/tr/th/td/quote/code/…`). So the cleanest fix is to **stop
markdown-izing and emit the stored BBCode intact** — the module then renders headers, bold,
**and tables** correctly.

## Evidence (prod)
- **DB** (`features.description`, `hunters-bane`): clean BBCode — `…following:\n\n[h3]Occult
  Lore[/h3]\n\n…` plus a `[table]…[/table]` skill table.
- **Bundle** (`/api/module/ll/classes/alternate-blood-hunter.json`): `…following:\n\n###
  Occult Lore\n\n…` + the **still-BBCode** `[table]…[/table]` (count: 2× `###`, 4× `**`, the
  full `[table][tr][/th][/tr][/td][/table]` set).
- **Module** (`normalizeHtmlBlock`, verified headless on the real bundle text): output is
  `<p>### Occult Lore</p>` — `looksLikeBbcode` matches the `[table]` → `bbcodeToFoundryHtml`
  → the markdown `###`/`**` are escaped + `<p>`-wrapped, not converted. Hence the leak.

## Root cause (exact lines)
`cleanText` (`api/_lib/_classExport.ts:432-439`) — the "Convert BBCode to Markdown" block:
```ts
cleaned = cleaned.replace(/\[h(\d)\]/gi, …'#'.repeat(level)+' ');  // [h3] → ###
cleaned = cleaned.replace(/\[\/h\d\]/gi, '\n');
cleaned = cleaned.replace(/\[b\]/gi, '**').replace(/\[\/b\]/gi, '**');
cleaned = cleaned.replace(/\[i\]/gi, '*').replace(/\[\/i\]/gi, '*');
cleaned = cleaned.replace(/\[ul\]/gi, '\n').replace(/\[\/ul\]/gi, '\n');
cleaned = cleaned.replace(/\[li\]/gi, '* ').replace(/\[\/li\]/gi, '\n');
cleaned = cleaned.replace(/\[center\]/gi, '').replace(/\[\/center\]/gi, '');
// …no [table]/[tr]/[td]/[th]/[u]/[s]/[quote]/[code] cases → they pass through as BBCode
```
Plus `:441-447` strips HTML entirely. Net: a partial, lossy BBCode→Markdown pass that yields
mixed content.

## The ask (recommended: preserve BBCode for the module bundle)
For the **module-bound** description text, **drop the BBCode→Markdown tag replacements
(`:432-439`) and the HTML-stripping (`:441-447`); keep only the encoding/artifact cleanup
(`:449-457`)** — curly-quote/mojibake normalization + newline collapse. Emit the BBCode tags
(`[h3]`, `[b]`, `[table]…`) **intact**. The module's `normalizeHtmlBlock` →
`bbcodeToFoundryHtml` then converts them to Foundry HTML completely (headers, bold, tables).

- Apply to **both** drift-paired files: `api/_lib/_classExport.ts` (the one
  `module-export-pipeline.ts` calls) **and** `src/lib/classExport.ts`.
- This fixes **all** feature/class/subclass/option descriptions (every export consumer), not
  just Blood Hunter. The module also handles raw HTML + plain text, so preserving tags is safe.

(Alternative, more work both sides: complete the Markdown conversion — add `[table]→`
GFM-table etc. — AND teach the module's `markdownToFoundryHtml` to render Markdown tables.
Not recommended; the BBCode the module already renders is right there.)

## Verify
`GET /api/module/ll/classes/alternate-blood-hunter.json` → `hunters-bane.description` keeps
`[h3]Occult Lore[/h3]` + `[table]…[/table]` (no `###`/`**`). Re-import in Foundry → the
feature shows real headers, bold, and a rendered table (no literal `###`/`**`).

## Deploy / rebake note
No DB change, no migration. Same as the feature-automation fix: the per-class bundle is a
**stored R2 bake** (`router getOrBuild(classBundleKey…)→serveCached`), so after the deploy,
**re-bake** the affected classes (a class save / `queueRebake`) to refresh the cached bundle.
