// /api/admin/eras/* — admin CRUD for eras (campaign world-state).
//
// Closes audit #9. Era writes used to flow through the generic
// /api/d1/query proxy with admin gated via PROTECTED_WRITE_TABLES
// (the L1 close). That kept the access boundary correct but left
// the client crafting the SQL.
//
// Reads stay on /api/d1/query (eras are public-among-signed-in
// taxonomy — `fetchCollection('eras', …)` from AdminCampaigns,
// CampaignEditor, LoreArticle work fine through the proxy). The
// `eras` table is NOT in PROTECTED_READ_TABLES; it IS still in
// PROTECTED_WRITE_TABLES as a defense-in-depth backstop (any direct
// write that escapes this path still gets admin-gated at the proxy).
//
// Routes:
//   POST   /api/admin/eras              — create era (admin)
//   PATCH  /api/admin/eras/<id>         — update era (admin)
//   DELETE /api/admin/eras/<id>         — delete era (admin)

import {
  HttpError,
  getCredentialErrorMessage,
  requireAdminAccess,
} from "../../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../../api/_lib/d1-internal.js";

const ALLOWED_ERA_FIELDS = new Set([
  "name",
  "description",
  "order",
  "background_image_url",
]);

async function handleCreate(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "`name` is required.");

  const id: string = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const columns: string[] = ["id", "name", "created_at", "updated_at"];
  const values: any[] = [id, name, nowIso, nowIso];

  for (const [key, val] of Object.entries(body)) {
    if (key === "id" || key === "name") continue;
    if (!ALLOWED_ERA_FIELDS.has(key)) continue;
    columns.push(key);
    values.push(val ?? null);
  }

  // `order` is a SQL reserved word — quote every column on write so we
  // don't have to special-case which fields need quoting.
  const colSql = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  await executeD1QueryInternal({
    sql: `INSERT INTO eras (${colSql}) VALUES (${placeholders})`,
    params: values,
  });

  return Response.json({ era: { id, name } });
}

async function handleUpdate(request: Request, eraId: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (!ALLOWED_ERA_FIELDS.has(key)) continue;
    setClauses.push(`"${key}" = ?`);
    params.push(val ?? null);
  }

  if (setClauses.length === 0) {
    return Response.json({ ok: true, id: eraId, noop: true });
  }

  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM eras WHERE id = ? LIMIT 1",
    params: [eraId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Era not found.");
  }

  setClauses.push(`"updated_at" = CURRENT_TIMESTAMP`);
  params.push(eraId);
  await executeD1QueryInternal({
    sql: `UPDATE eras SET ${setClauses.join(", ")} WHERE id = ?`,
    params,
  });

  return Response.json({ ok: true, id: eraId });
}

async function handleDelete(eraId: string): Promise<Response> {
  const check = await executeD1QueryInternal({
    sql: "SELECT id FROM eras WHERE id = ? LIMIT 1",
    params: [eraId],
  });
  if (!Array.isArray(check?.results) || check.results.length === 0) {
    throw new HttpError(404, "Era not found.");
  }

  // No FK cascade — `campaigns.era_id` references this table but the
  // column is nullable. We deliberately don't null campaigns' era_id
  // here either; the AdminCampaigns "Are you sure?" warning explicitly
  // says "this will remove the Era but not the campaigns assigned to
  // it" — they get left with a dangling era_id that the UI shows as
  // unassigned.
  await executeD1QueryInternal({
    sql: "DELETE FROM eras WHERE id = ?",
    params: [eraId],
  });
  return Response.json({ ok: true, id: eraId });
}

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    await requireAdminAccess(authHeader);

    const path: string[] = Array.isArray(params?.path)
      ? params.path.map(String)
      : params?.path
        ? [String(params.path)]
        : [];

    if (request.method === "POST" && path.length === 0) {
      return await handleCreate(request);
    }
    if (request.method === "PATCH" && path.length === 1) {
      return await handleUpdate(request, path[0]);
    }
    if (request.method === "DELETE" && path.length === 1) {
      return await handleDelete(path[0]);
    }

    return Response.json(
      { error: `Method ${request.method} not allowed for /api/admin/eras/${path.join("/")}` },
      { status: 405 },
    );
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`/api/admin/eras (${request.method} ${request.url}) failed:`, error);
    return Response.json(
      { error: message || "Eras request failed." },
      { status: 500 },
    );
  }
};
