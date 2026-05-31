# Bug → `system-applications`: rich-text wraps plain text in `[b]…[/b]` on save

> **From:** `proposal-system` · **To:** `system-applications` · **Date:** 2026-05-30
> **Why you:** this is the content-rendering / BBCode layer (`src/lib/bbcode.ts` + the TipTap
> rich-text editors), which is your domain — same family as the overview / page-management work.
> Surfaced while testing the proposal editors, but it is **not** proposal-specific.

## Repro
1. Open a class editor → the **Class Preview** rich-text field (the TipTap editor).
2. Type plain text — e.g. `test description` — **without** clicking Bold.
3. Save. The stored / displayed value comes back as `[b]test description[/b]` — bolded, though the
   user never applied bold.

## Where it is (lead, not a full root-cause)
`htmlToBbcode` is doing the right thing — it converts editor HTML to BBCode and `bbcode.ts:294–295`
maps `<strong>…</strong>` / `<b>…</b>` → `[b]…[/b]`. So the spurious bold is almost certainly
**upstream of the conversion**:

- **Most likely:** the preview rich-text editor is emitting `<strong>` (or `<b>`) around content the
  user didn't bold — e.g. a default mark applied on focus/typing, a wrapping `<strong>` in the initial
  doc, or a paste/placeholder artifact. `htmlToBbcode` then faithfully serializes it to `[b]`.
- **Worth ruling out:** double-conversion — the preview value being run through `htmlToBbcode` a second
  time, or stored already-BBCode then re-serialized.

Suggested places to look: the TipTap config for the Class Preview field (default marks / starter-kit
options / initial content), and whether `htmlToBbcode` (`bbcode.ts:288`) is invoked once vs. twice on
that field's value.

## Scope to check
- Does it affect **only** the Class Preview field, or every rich-text field (subclass preview, lore,
  descriptions)? That tells you whether it's the field's editor config or the shared serializer path.
- Confirm the intended storage format for these preview fields (HTML vs. BBCode) so the fix serializes
  once, correctly.

## Not blocking us
No proposal-system dependency — flagging it to the right owner. The proposal flow stores whatever the
editor produces, so once the editor stops emitting stray `<strong>`, the proposal payload is correct
too (no proposal-side change needed).
