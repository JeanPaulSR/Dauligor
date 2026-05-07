// Server-side helper for talking to the Cloudflare Worker's `/query` endpoint
// from inside the API layer (no client JWT required). Lives in its own module
// so both d1-proxy.ts and firebase-admin.ts can use it without a circular
// dependency through firebase-admin.

class WorkerConfigError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.status = 503;
  }
}

function getWorkerConfig() {
  const workerUrl = process.env.R2_WORKER_URL;
  const apiSecret = process.env.R2_API_SECRET;
  if (!workerUrl || !apiSecret) {
    throw new WorkerConfigError(
      "D1 proxy is not configured. Set R2_WORKER_URL and R2_API_SECRET in the server environment.",
    );
  }
  return { workerUrl, apiSecret };
}

/**
 * Execute one or more D1 queries from the API layer (no auth header needed —
 * uses the shared worker secret). Pass either a `{ sql, params }` object or
 * an array of them for batched calls.
 */
export async function executeD1QueryInternal(body: any): Promise<any> {
  const { workerUrl, apiSecret } = getWorkerConfig();
  const url = new URL("/query", workerUrl.endsWith("/") ? workerUrl : `${workerUrl}/`);

  const sql = body.sql || (Array.isArray(body) ? body[0]?.sql : "");
  const isMutation = /INSERT|UPDATE|DELETE|REPLACE/i.test(sql);
  if (isMutation) {
    console.log(`[D1 Internal] Executing mutation: ${sql.substring(0, 100)}${sql.length > 100 ? "..." : ""}`);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (isMutation && response.ok) {
    console.log(`[D1 Internal] Mutation successful`);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as any).error || `D1 Worker request failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Look up a user's role from the D1 `users` table by Firebase Auth UID.
 * Returns the role string (e.g. "admin", "co-dm") or `null` if the user has
 * no D1 row yet. The `users.id` column matches `auth.currentUser.uid`.
 */
export async function loadUserRoleFromD1(uid: string): Promise<string | null> {
  if (!uid) return null;
  try {
    const result = await executeD1QueryInternal({
      sql: "SELECT role FROM users WHERE id = ? LIMIT 1",
      params: [uid],
    });
    const row = result.results?.[0] as { role?: string } | undefined;
    return row?.role ?? null;
  } catch (err) {
    console.error(`[D1 Internal] role lookup failed for uid=${uid}:`, err);
    return null;
  }
}
