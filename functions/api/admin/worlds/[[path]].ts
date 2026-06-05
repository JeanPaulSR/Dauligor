// /api/admin/worlds/* — admin CRUD for worlds (compendium containers).
//
// Worlds are the top-level scope dimension for compendium content.
// Phase 1 stands the table up and exposes CRUD; per-entity world_id
// columns + scope enforcement against tags/spells/etc. ship later.
//
// The default world ("Dauligor") is seeded by the
// worlds_and_user_permissions migration and protected here:
//   - is_default flag cannot be cleared via PATCH.
//   - The default world cannot be deleted.
//   - At most one world may have is_default = 1 (enforced by the
//     partial unique index in the schema; we also refuse client
//     attempts to set the flag to 1 on a non-default row).
//
// Routes:
//   GET    /api/admin/worlds              — list all worlds
//   POST   /api/admin/worlds              — create world (non-default)
//   PATCH  /api/admin/worlds/<id>         — update world
//   DELETE /api/admin/worlds/<id>         — delete world (refuses default)
//
// All routes admin-only.

import {
  HttpError,
  getCredentialErrorMessage,
  requireAdminAccess,
} from "../../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../../api/_lib/d1-internal.js";

const ALLOWED_WORLD_FIELDS = new Set([
  "name",
  "slug",
  "description",
  "owner_user_id",
  "sort_order",
  "background_image_url",
]);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function handleList(): Promise<Response> {
  const result = await executeD1QueryInternal({
    sql: `SELECT id, name, slug, description, owner_user_id, is_default,
                 sort_order, background_image_url, created_at, updated_at
            FROM worlds
        ORDER BY is_default DESC, sort_order ASC, name ASC`,
    params: [],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  return Response.json({ worlds: rows });
}

async function handleCreate(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "`name` is required.");

  const id: string =
    typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const slug =
    (typeof body.slug === "string" && body.slug.trim()) || slugify(name);
  if (!slug) throw new HttpError(400, "`slug` could not be derived.");

  // Refuse client-driven is_default flips on create — the default is
  // the seeded Dauligor row, and we don't expose a "move default" UX
  // in Phase 1.
  const columns: string[] = ["id", "name", "slug"];
  const values: any[] = [id, name, slug];

  for (const key of ALLOWED_WORLD_FIELDS) {
    if (key === "name" || key === "slug") continue;
    if (!(key in body)) continue;
    columns.push(key);
    values.push((body as any)[key] ?? null);
  }

  try {
    await executeD1QueryInternal({
      sql: `INSERT INTO worlds (${columns.map((c) => `"${c}"`).join(", ")})
            VALUES (${columns.map(() => "?").join(", ")})`,
      params: values,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("UNIQUE")) {
      throw new HttpError(409, "A world with that slug already exists.");
    }
    throw error;
  }

  return Response.json({ world: { id, name, slug } });
}

async function handleUpdate(
  request: Request,
  worldId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as any;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const existing = await executeD1QueryInternal({
    sql: "SELECT id, is_default FROM worlds WHERE id = ? LIMIT 1",
    params: [worldId],
  });
  const rows = Array.isArray(existing?.results) ? existing.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "World not found.");
  }
  const isDefault = Number((rows[0] as any).is_default) === 1;

  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (!ALLOWED_WORLD_FIELDS.has(key)) continue;
    // Re-slugify if a name change came through without a slug.
    if (key === "slug" && typeof val === "string") {
      const s = slugify(val) || slugify(String(body.name ?? ""));
      if (!s) throw new HttpError(400, "`slug` cannot be empty.");
      setClauses.push(`"slug" = ?`);
      params.push(s);
      continue;
    }
    setClauses.push(`"${key}" = ?`);
    params.push(val ?? null);
  }

  if (setClauses.length === 0) {
    return Response.json({ ok: true, id: worldId, noop: true });
  }

  setClauses.push(`"updated_at" = CURRENT_TIMESTAMP`);
  params.push(worldId);

  try {
    await executeD1QueryInternal({
      sql: `UPDATE worlds SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("UNIQUE")) {
      throw new HttpError(409, "A world with that slug already exists.");
    }
    throw error;
  }

  return Response.json({ ok: true, id: worldId, was_default: isDefault });
}

async function handleDelete(worldId: string): Promise<Response> {
  const existing = await executeD1QueryInternal({
    sql: "SELECT id, is_default FROM worlds WHERE id = ? LIMIT 1",
    params: [worldId],
  });
  const rows = Array.isArray(existing?.results) ? existing.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "World not found.");
  }
  if (Number((rows[0] as any).is_default) === 1) {
    throw new HttpError(409, "The default world cannot be deleted.");
  }

  await executeD1QueryInternal({
    sql: "DELETE FROM worlds WHERE id = ?",
    params: [worldId],
  });
  return Response.json({ ok: true, id: worldId });
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

    if (request.method === "GET" && path.length === 0) {
      return await handleList();
    }
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
      {
        error: `Method ${request.method} not allowed for /api/admin/worlds/${path.join("/")}`,
      },
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
    console.error(
      `/api/admin/worlds (${request.method} ${request.url}) failed:`,
      error,
    );
    return Response.json(
      { error: message || "Worlds request failed." },
      { status: 500 },
    );
  }
};
