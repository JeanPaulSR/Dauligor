# Branch: `<branch-name>`

Copy this template to `handoffs/<your-branch-slugified>/manifest.md` when starting a new branch.

---

Started: `<YYYY-MM-DD>`
Owner: `<your-name-or-agent-id>`
Goal: `<one-sentence describing what this branch will deliver>`
Status: `active` | `paused` | `ready-to-merge`

## Primary files (exclusive)

Files this branch owns. Other branches should request changes via the shared-files protocol rather than editing directly.

- `path/to/file.ts`
- `path/to/another.ts`

## Shared files (append-only)

Files this branch is also touching but which support multiple concurrent branches via append-only discipline. See [BRANCH_REGISTRY.md § "Shared files (append-only) examples"](../BRANCH_REGISTRY.md#shared-files-append-only-examples).

- `src/lib/compendium.ts`
- `src/lib/d1.ts`

## Open requests to other branches

When you need a change in another branch's primary file, log it here and notify the other branch's owner. Check items off when the change lands.

- [ ] `(2026-MM-DD)` Request `<other-branch>` to add `<thing>` to `<file>` — blocks `<my own work>`

## Handoff log

Newest at the top. Each entry: date + link to the handoff doc in this same folder.

- `2026-MM-DD` — [topic.md](2026-MM-DD-topic.md)
