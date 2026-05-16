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
    const PROTECTED_WRITE_TABLES = /\b(?:INTO|FROM|UPDATE|TABLE)\s+users\b/i;
    const isMutation = MUTATION_KEYWORDS.test(normalizedSql);
    const targetsProtectedTable = isMutation && PROTECTED_WRITE_TABLES.test(normalizedSql);

    if (targetsProtectedTable) {
      await requireAdminAccess(authHeader);
      console.log(`[D1 Proxy] Admin-only mutation on protected table: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    } else if (isMutation) {
      await requireStaffAccess(authHeader);
      console.log(`[D1 Proxy] Executing mutation: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
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

