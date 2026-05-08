<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dauligor — the Archive

A specialized D&D 5e campaign-management workspace: hierarchical lore wiki, mechanical compendium, character builder, and FoundryVTT JSON export, all wrapped in a "technical dashboard meets sword-and-sorcery" aesthetic.

## Stack

- **Frontend**: React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · TipTap
- **Database**: Cloudflare D1 (SQL) via a project-owned Worker
- **Storage**: Cloudflare R2 (served from `https://images.dauligor.com`)
- **Auth**: Firebase Authentication (JWT layer only)
- **Hosting**: Vercel functions; local dev uses Express (`server.ts`) that mirrors the same routes

The Firestore→D1 migration is complete; the app is live at [dauligor.com](https://www.dauligor.com). See [AGENTS.md](AGENTS.md) for the rules and [docs/database/README.md](docs/database/README.md) for the database layout.

## Run locally

You need **two terminals**.

**Terminal 1 — Cloudflare Worker (D1 + R2):**
```
cd worker
npx wrangler dev
```

**Terminal 2 — Vite + Express:**
```
npm install
npm run dev
```

The Express server reads `R2_WORKER_URL=http://localhost:8787` from `.env` and proxies D1/R2 traffic to the local Worker. Full setup details — including `.dev.vars` and Firebase Admin credentials — live in [docs/operations/local-dev.md](docs/operations/local-dev.md).

## Documentation

- **[AGENTS.md](AGENTS.md)** — agent / contributor briefing. Read first.
- **[DIRECTORY_MAP.md](DIRECTORY_MAP.md)** — file-path resolution guide.
- **[docs/](docs/)** — full documentation index, organised by topic:
  - [platform/](docs/platform/) — runtime, D1, R2, auth, env vars
  - [database/](docs/database/) — D1 schema, migrations, phase status
  - [features/](docs/features/) — wiki, compendium, characters, image manager, foundry export
  - [ui/](docs/ui/) — style guide, theming, BBCode, content rendering
  - [architecture/](docs/architecture/) — routing, RBAC, foundry integration, reference syntax
  - [operations/](docs/operations/) — local dev, deployment, troubleshooting
- **[docs/database/structure/](docs/database/structure/)** — per-table SQL schema specs.
