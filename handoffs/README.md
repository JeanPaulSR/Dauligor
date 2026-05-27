# Handoffs

Per-branch handoff journals + live coordination for concurrent agents.

## Two purposes, two surfaces

### 1. Per-branch handoff accumulation (`<branch>/`)

Every in-progress branch has a folder named after it (slashes → hyphens, so `claude/phase1-foundation` becomes `claude-phase1-foundation/`). Inside, handoff docs accumulate as the branch evolves — a session journal that survives context resets.

Convention for files inside a branch folder:
- `manifest.md` — declares the files this branch is touching + open requests to other branches
- `YYYY-MM-DD-<topic>.md` — individual handoffs, named by date + topic

When a branch lands on main, its handoff history doesn't have to be deleted — it stays as institutional memory. But the `manifest.md` should be removed (or the row removed from `BRANCH_REGISTRY.md`) so other branches know the files are free.

### 2. Live coordination ([BRANCH_REGISTRY.md](BRANCH_REGISTRY.md))

The root-level registry tracks which active branches own which files. **Read it before touching anything you didn't write yourself.** Update your own row as you go.

## The shared-files protocol

When a branch needs to touch a file owned by another active branch:

1. **Don't edit directly.** Find the owning branch in `BRANCH_REGISTRY.md`.
2. **File an "Open request"** in your own branch's `manifest.md` (under "Open requests to other branches"). Describe what you need.
3. **Notify the owning agent/human** — leave a note in the owning branch's most recent handoff doc, or in chat.
4. **The owning branch makes the change** on its own branch and commits.
5. **Owning branch records the result** in its own handoff log (date + summary).
6. **Requesting branch rebases** to pick up the change once it lands on the owning branch (or once both merge to main).

The point is to avoid two branches editing the same file in non-mergeable ways, and to keep one source of truth for any file. The owning branch's edit is canonical; the requesting branch consumes the result.

## Subfolder for `main/`

`main/` holds handoffs for **work that's already landed on main** but is part of a multi-stage plan where future stages need pickup context. The live-content bridge is the current example — Phase 1 is in main, Phase 2+ planning lives in `main/` until a Phase 2 branch is created (at which point Phase 2 handoffs move into that branch's folder).

## Why this exists

The Dauligor repo has multiple agents working concurrently on different feature branches. Without a coordination layer, the same shared utility file (`src/lib/d1.ts`, `src/lib/compendium.ts`, `src/App.tsx`, etc.) gets touched by three branches at once, producing mechanical rebase conflicts that take an hour to untangle — or worse, silent semantic conflicts when both edits look reasonable in isolation.

The previous coordination surface was a section in [AGENTS.md](../AGENTS.md) called "Multi-agent coordination." That worked while the repo had one or two parallel branches; it scaled poorly to the current 5+ branches. The handoff folder is the replacement.

## Lifecycle of a branch's handoff folder

| Branch state | Folder contents |
|---|---|
| Branch created, work starts | `manifest.md` declaring intent + files in scope. Row added to `BRANCH_REGISTRY.md`. |
| Branch in progress | New `YYYY-MM-DD-<topic>.md` handoffs accumulate. `manifest.md` updated as scope evolves. |
| Branch paused | `manifest.md` status set to `paused`. Other branches know it's safe to claim shared files. |
| Branch merged to main | `manifest.md` removed (or row removed from `BRANCH_REGISTRY.md`). Handoff folder optionally moved to `main/<branch-name>-archive/` or kept in place as institutional memory. |
