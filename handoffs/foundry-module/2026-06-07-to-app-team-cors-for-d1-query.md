# Request → dauligor-applications: CORS for `/api/d1/query`

**From:** `foundry-module` · **Date:** 2026-06-07 · **Priority:** blocks page-system Phase 4 (system pages)

## TL;DR

The earlier CORS pass (`6622db6`) added the cross-origin wrapper to `/api/auth`,
`/api/lore`, and `/api/campaigns` — but **not `/api/d1/query`**. The Foundry
module reads **system pages** (the `&kind[anchor]` rule-ref targets) through
`/api/d1/query` (Option A — `system_pages` / `system_page_blocks` are
player-readable, not in `PROTECTED_READ_TABLES`). Without CORS there, the
browser blocks the cross-origin request and system pages can't load in Foundry.

Please add the **same CORS wrapper** the other three routers already have to
`functions/api/d1/query.ts`.

## Evidence (prod, today)

```
OPTIONS /api/d1/query    → 401  (NO Access-Control-Allow-Origin)   ← blocked
OPTIONS /api/lore/articles → 204 + ACAO:* + Allow-Methods/Headers  ← works
```
Browser error from the module (origin `http://localhost:30000`):
> Access to fetch at 'https://www.dauligor.com/api/d1/query' … blocked by CORS
> policy: Response to preflight request doesn't pass access control check: No
> 'Access-Control-Allow-Origin' header is present…

The d1-proxy handler requires an auth header and 401s on the preflight, so the
OPTIONS must be short-circuited **before** the handler runs (same reason
lore/campaigns needed it).

## Requested change

`functions/api/d1/query.ts` currently just delegates:

```ts
export const onRequest = async (context: any): Promise<Response> => {
  return runVercelHandler(context.request, context.env, handleD1Query);
};
```

Wrap it exactly like the other three routers:

```ts
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequest = async (context: any): Promise<Response> => {
  // Short-circuit the preflight BEFORE the proxy (it 401s without auth).
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const response = await runVercelHandler(context.request, context.env, handleD1Query);
  for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  return response;
};
```

## Safety — same posture as the other Bearer endpoints

CORS `*` here is **non-credentialed**: the module sends the native session JWT as
`Authorization: Bearer …` (no cookies), so this is not a CSRF surface — a hostile
origin can't read responses without a token, and a token holder already has API
access regardless of CORS. The proxy's existing gates are **unchanged**: role
checks, `PROTECTED_READ_TABLES` (users / lore_secrets / characters / character_*),
`PROTECTED_WRITE_TABLES`, mutation→staff/admin. Opening CORS does not widen what
any caller can read or write; it only lets the already-authorized module read the
**player-readable** tables it needs (`system_pages`, `system_page_blocks`) from a
cross-origin context — identical to how `/api/lore` + `/api/campaigns` already work.

## Alternative (if you'd rather not open the generic proxy cross-origin)

A scoped, read-only, CORS-open endpoint for system pages — e.g.
`GET /api/module/system-pages` (mirrors the public `/api/module/*` catalog
surface) returning `system_pages` + `system_page_blocks`. More work than the
wrapper, but keeps the generic SQL proxy same-origin. If you choose this, tell us
the path/shape and the module will switch `content-service.getSystemPage` to it
(it currently issues two SELECTs: all of `system_pages`, then
`system_page_blocks WHERE page_id = ?`).

**Recommendation:** the CORS wrapper — it's the smallest change, consistent with
the three endpoints already done, and the safety analysis above shows no new
exposure.

## Module side (already shipped, waiting on this)

`content-service.getSystemPage(kind)` + the viewer's `system` mode + the
`&Reference[…]` enricher takeover are all on `foundry-module` and verified
headless. They degrade gracefully until this lands: a failed read shows the
viewer's "Couldn't reach Dauligor" error (not a crash). Once CORS is live,
`&condition[…]` / `&Reference[condition=…]` refs resolve to the in-Foundry
Library with no module change.
