import {
  HttpError,
  getCredentialErrorMessage,
  requireAdminAccess,
  requireAuthenticatedUser,
  requireStaffAccess,
} from "./firebase-admin.js";
import { executeD1QueryInternal } from "./d1-internal.js";

// Re-exported for back-compat; the implementation now lives in d1-internal so
// firebase-admin can use it without a circular import through this module.
export { executeD1QueryInternal };

type NodeLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader: (name: string, value: string) => void;
  send: (body?: unknown) => void;
  json: (body: unknown) => void;
};

function getWorkerConfig() {
  const workerUrl = process.env.R2_WORKER_URL; // Reusing the same worker for now
  const apiSecret = process.env.R2_API_SECRET;

  if (!workerUrl || !apiSecret) {
    throw new HttpError(
      503,
      "D1 proxy is not configured. Set R2_WORKER_URL and R2_API_SECRET in the server environment."
    );
  }

  return { workerUrl, apiSecret };
}

function buildWorkerUrl(pathname: string) {
  const { workerUrl } = getWorkerConfig();
  const url = new URL(pathname, workerUrl.endsWith("/") ? workerUrl : `${workerUrl}/`);
  return url.toString();
}

/**
 * Normalize SQL so the gate's regex sees a predictable shape.
 *
 * Two transforms applied in order:
 *
 *   1. Strip SQL comments. `/* ... *\/` block comments and `-- ...`
 *      line comments both let a hostile caller break up keywords so
 *      `INSERT\/*x*\/INTO\/*x*\/users` evades the bare-identifier
 *      gate. We replace each comment with a single space so adjacent
 *      tokens stay separated.
 *
 *   2. Unquote SQLite identifier-style quotes around table names.
 *      `"users"`, `` `users` ``, and `[users]` are all valid SQLite
 *      identifier quoting and would otherwise slip past the
 *      bare-word `\b users \b` check. We only unwrap identifier
 *      shapes (`[a-z_][a-z0-9_]*`) — string literals (`'…'`) are
 *      left alone, both because they're values rather than tables
 *      and because mangling them could distort the gate's read.
 *
 * Result is only used for the auth gate decision; the original `sql`
 * is what gets forwarded to the Worker. False positives (e.g. a
 * SELECT that happens to mention `users` in a string literal after
 * the strip) fall to the more restrictive staff/admin gate — safe.
 */
function normalizeSqlForGate(sql: string): string {
  if (typeof sql !== "string" || !sql) return "";
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")              // /* block */
    .replace(/--[^\n]*/g, " ")                       // -- line
    .replace(/"([a-z_][a-z0-9_]*)"/gi, "$1")        // "ident"
    .replace(/`([a-z_][a-z0-9_]*)`/gi, "$1")        // `ident`
    .replace(/\[([a-z_][a-z0-9_]*)\]/gi, "$1")      // [ident]
    .replace(/\s+/g, " ");                           // collapse whitespace
}

async function readJsonBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export async function handleD1Query(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string') throw new HttpError(401, "Missing authorization header");

    // Split the gate by SQL kind. Most compendium reads are effectively
    // public (lore, classes, spells, etc.) and need to be available to
    // every signed-in role — including `trusted-player` and `user`. Writes
    // and DDL stay gated to staff (admin / co-dm / lore-writer).
    //
    // We have to parse the body before the auth check so we know which gate
    // to apply. The body is small JSON and we'd parse it anyway one line
    // later, so the cost is nil.
    //
    // The MUTATION_KEYWORDS regex is intentionally broad: it covers row
    // mutations (INSERT/UPDATE/DELETE/REPLACE) AND DDL/maintenance verbs
    // (CREATE/DROP/ALTER/TRUNCATE/ATTACH/DETACH/REINDEX/VACUUM/PRAGMA) so
    // a signed-in regular user can't, say, send `DROP TABLE users` through
    // the proxy. False positives (e.g. the word "UPDATE" appearing in a
    // SELECT's string literal) fall to the more restrictive staff path —
    // safe-by-default.
    //
    // PROTECTED_WRITE_TABLES are tables where direct mutations through
    // this generic proxy are limited to admins specifically (not just
    // staff). The `users` table is the canonical example: without this
    // gate a co-dm / lore-writer could send `upsertDocument('users',
    // <their-uid>, { role: 'admin' })` from devtools and self-promote.
    // Legitimate user writes now go through /api/admin/users which has
    // its own admin gate; this block forbids the bypass.
    //
    // Both regexes run against a NORMALIZED copy of the SQL, not the
    // raw string. Normalization strips comments and unquotes
    // identifier-style quoted table names (`"users"`, `` `users` ``,
    // `[users]` — all valid SQLite identifier-quoting forms). Without
    // this step, a hostile caller could send `UPDATE "users" SET role
    // = 'admin' WHERE id = ?` and slip past the protected-table check
    // because the bare-identifier regex doesn't match the quoted form.
    // The normalized SQL is used ONLY for the gate; the original
    // string is what we forward to the Worker.
    const body = await readJsonBody(req);
    const sql = body.sql || (Array.isArray(body) ? body[0]?.sql : '');
    const normalizedSql = normalizeSqlForGate(sql);
    const MUTATION_KEYWORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA)\b/i;
    // Protected mutation tables — direct writes via this generic proxy
    // require admin specifically (not just staff).
    //
    //   `users`  — H6 staff-side closure. Co-dm / lore-writer can no
    //              longer self-promote via direct upsertDocument.
    //              Legitimate writes go through /api/admin/users.
    //   `eras`   — L1 closure. Docs at permissions-rbac.md mark era
    //              CRUD as admin-only; this enforces that. AdminCampaigns
    //              also hides the era CRUD UI for non-admin viewers so
    //              co-dm doesn't see buttons that 403.
    //   `lore_*` — Lore-writes batch closure. Every lore_* table
    //              (lore_articles, lore_secrets, lore_meta_*, lore_article_*,
    //              lore_secret_*, lore_links) is now write-blocked at the
    //              proxy. Legitimate writes go through PUT/DELETE
    //              /api/lore/articles/[id][/secrets/[secretId]], which
    //              enforces isWikiStaff (admin/co-dm/lore-writer) and
    //              keeps lore-writer's legitimate authoring path open.
    //              Without this, a hostile signed-in staff member could
    //              backdoor a lore row write to set `dm_notes` content
    //              the per-route endpoint would otherwise gate.
    //   Phase-1 proposal entities — `tags`, `tag_groups`,
    //              `spell_rules`, `spell_rule_applications`,
    //              `class_spell_lists`. permissions-rbac.md has
    //              always declared these admin-only ("Admin
    //              (intended); currently staff at the proxy"). The
    //              content-proposals workflow finishes that
    //              closure: admins keep writing directly; non-
    //              admins (including `content-creator` holders)
    //              submit via POST /api/proposals, where an admin
    //              reviews + approves. Approvals re-apply via
    //              `executeD1QueryInternal` (the same escape hatch
    //              `/api/r2/scan-references` uses to bypass the
    //              read gate), so the proposal endpoint doesn't
    //              round-trip through this proxy.
    //   `pending_revisions` — the proposal queue table itself.
    //              Every legitimate read/write lives behind
    //              /api/proposals* (creator) or
    //              /api/admin/proposals* (admin). Block direct
    //              proxy access so a non-admin can't peek at or
    //              steamroll another creator's pending rows.
    const PROTECTED_WRITE_TABLES = /\b(?:INTO|FROM|UPDATE|TABLE)\s+(?:users|eras|lore_\w+|tags|tag_groups|spell_rules|spell_rule_applications|class_spell_lists|pending_revisions)\b/i;
    // Protected READ tables — tables whose rows carry per-row privacy
    // contracts that the generic proxy cannot enforce. Direct SELECTs
    // against any of these are refused; callers must go through the
    // per-route endpoint that does the column-scoping / ownership
    // check / visibility filter server-side.
    //
    //   `users`        — `recovery_email` is PII; per-route
    //                    `/api/me`, `/api/profiles/[username]`,
    //                    `/api/admin/users` column-scope by role.
    //                    Without this gate, a signed-in player could
    //                    `SELECT * FROM users` via devtools and
    //                    exfiltrate every recovery_email — bypassing
    //                    the entire column-scoping layer in those
    //                    per-route endpoints.
    //   `lore_secrets` — secret `content` MUST be filtered by the
    //                    viewer's active campaign (lore_secret_campaigns
    //                    join). Per-route
    //                    `GET /api/lore/articles/[id]/secrets` does
    //                    the filter; a raw SELECT here would return
    //                    every secret regardless of visibility.
    //   `characters` + `character_*` — `info_json` on the base row
    //                    is the character's private backstory/notes,
    //                    and the per-character relation tables
    //                    (character_progression, character_selections,
    //                    character_inventory, character_spells,
    //                    character_proficiencies,
    //                    character_spell_list_extensions,
    //                    character_spell_loadouts) make up the rest
    //                    of the H4 leak surface. Per-route
    //                    `GET /api/characters/[id]` returns the
    //                    fully reconstructed bundle for owner-or-DM
    //                    callers; `GET /api/me/characters` returns
    //                    the caller's own list. Without this gate, a
    //                    signed-in user could read anyone else's
    //                    sheet via raw `SELECT * FROM characters
    //                    WHERE id = ?` or piece it together from the
    //                    8 character_* tables.
    //
    // The matcher only fires on `FROM <table>` (not JOIN'd subqueries
    // against the same table, which are rare and we'd want to lock
    // down anyway). Normalized SQL is what we test, so quoted
    // identifiers (`"users"`, `` `users` ``, `[users]`) and SQL
    // comments can't slip past.
    const PROTECTED_READ_TABLES = /\bFROM\s+(?:users|lore_secrets|characters|character_\w+)\b/i;

    // `system_metadata` is a special case. The table holds two
    // distinct kinds of value:
    //   - `last_foundation_update`: a cache-bust timestamp that
    //     `src/lib/d1.ts` writes from every staff mutation (compendium
    //     edits, spell upserts, etc.). Blocking it would silently
    //     break cache invalidation for non-admin staff. The SQL shape
    //     is fixed and parameter-free.
    //   - `wiki_settings` and any future singleton config keys:
    //     legitimate writes only come from the admin UI. Per-route
    //     endpoints handle these (e.g. PUT /api/lore/system-metadata/
    //     wiki-settings); the generic proxy refuses them so a hostile
    //     client can't stomp `last_foundation_update` (force every
    //     other client to bust its cache) or invent new keys.
    //
    // The bump SQL is fingerprinted by the exact pattern d1.ts emits
    // — any drift in that helper would silently start failing here,
    // which is intentional (forces the call site to either match or
    // move to a per-route endpoint).
    const FOUNDATION_BUMP_PATTERN = /^\s*UPDATE\s+system_metadata\s+SET\s+value\s*=\s*CURRENT_TIMESTAMP\s+WHERE\s+key\s*=\s*'last_foundation_update'\s*$/i;
    const SYSTEM_METADATA_WRITE_PATTERN = /\b(?:INTO|FROM|UPDATE|TABLE)\s+system_metadata\b/i;

    // `campaigns` and `campaign_members` writes have moved to per-route
    // endpoints (api/campaigns.ts: POST / PATCH /[id] / DELETE /[id] /
    // PUT|DELETE /[id]/members/[uid]) so the (role, ownership)
    // checks actually run. The generic proxy used to admit any staff
    // — including lore-writer — to write any campaign, which is
    // wider than the permissions-rbac doc says (campaign management
    // is admin / co-dm only). Closes audit priority #8.
    const CAMPAIGN_WRITE_PATTERN = /\b(?:INTO|FROM|UPDATE|TABLE)\s+(?:campaigns|campaign_members)\b/i;

    const isMutation = MUTATION_KEYWORDS.test(normalizedSql);
    const targetsProtectedTable = isMutation && PROTECTED_WRITE_TABLES.test(normalizedSql);
    const targetsProtectedReadTable = !isMutation && PROTECTED_READ_TABLES.test(normalizedSql);
    const isSystemMetadataWrite = isMutation && SYSTEM_METADATA_WRITE_PATTERN.test(normalizedSql);
    const isFoundationBump = isSystemMetadataWrite && FOUNDATION_BUMP_PATTERN.test(typeof sql === "string" ? sql : "");
    const isCampaignWrite = isMutation && CAMPAIGN_WRITE_PATTERN.test(normalizedSql);

    if (isSystemMetadataWrite && !isFoundationBump) {
      // Block any non-bump write to system_metadata at the generic
      // proxy. Admin UI for wiki_settings goes through
      // `PUT /api/lore/system-metadata/wiki-settings` instead. This
      // closes M3 — without it, any signed-in staff could call
      // setSystemMetadata('arbitrary_key', value) and stomp the
      // singleton-config table.
      throw new HttpError(
        403,
        "Direct writes to system_metadata are not permitted through /api/d1/query. Use the per-route endpoint (currently PUT /api/lore/system-metadata/wiki-settings for wiki settings) instead."
      );
    }

    if (isCampaignWrite) {
      throw new HttpError(
        403,
        "Direct writes to campaigns / campaign_members are not permitted through /api/d1/query. Use the per-route endpoint (POST /api/campaigns, PATCH /api/campaigns/[id], DELETE /api/campaigns/[id], PUT|DELETE /api/campaigns/[id]/members/[uid]) instead."
      );
    }

    if (targetsProtectedTable) {
      await requireAdminAccess(authHeader);
      console.log(`[D1 Proxy] Admin-only mutation on protected table: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    } else if (isMutation) {
      await requireStaffAccess(authHeader);
      console.log(`[D1 Proxy] Executing mutation: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    } else if (targetsProtectedReadTable) {
      // 403 not 404 — we know the table exists; we just refuse to
      // serve it through the generic proxy. The error message points
      // the caller at the per-route alternative so a legitimate
      // (post-migration) caller knows where to go.
      throw new HttpError(
        403,
        "Direct reads of this table are not permitted through /api/d1/query. Use the per-route endpoint (/api/me, /api/profiles/[username], /api/admin/users, /api/characters/[id], /api/me/characters, or /api/lore/articles/[id]/secrets) instead."
      );
    } else {
      await requireAuthenticatedUser(authHeader);
    }

    const { apiSecret } = getWorkerConfig();

    const workerResponse = await fetch(buildWorkerUrl("/query"), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (isMutation && workerResponse.ok) {
      console.log(`[D1 Proxy] Mutation successful`);
    }

    const contentType = workerResponse.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    const text = await workerResponse.text();
    res.status(workerResponse.status).send(text);
  } catch (error) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return res.status(503).json({ error: credentialMessage });
    }

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("D1 proxy request failed:", error);
    return res.status(500).json({ error: message || "D1 proxy request failed." });
  }
}

