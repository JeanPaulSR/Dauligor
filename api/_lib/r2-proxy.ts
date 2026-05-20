import type { IncomingMessage } from "node:http";
import { HttpError, getCredentialErrorMessage, requireImageManagerAccess } from "./firebase-admin.js";
import { executeD1QueryInternal } from "./d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, unknown>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader: (name: string, value: string) => void;
  send: (body?: unknown) => void;
  json: (body: unknown) => void;
};

function getWorkerConfig() {
  const workerUrl = process.env.R2_WORKER_URL;
  const apiSecret = process.env.R2_API_SECRET;

  if (!workerUrl || !apiSecret) {
    throw new HttpError(
      503,
      "R2 proxy is not configured. Set R2_WORKER_URL and R2_API_SECRET in the server environment."
    );
  }

  return { workerUrl, apiSecret };
}

function buildWorkerUrl(pathname: string, query?: URLSearchParams) {
  const { workerUrl } = getWorkerConfig();
  const url = new URL(pathname, workerUrl.endsWith("/") ? workerUrl : `${workerUrl}/`);
  if (query) url.search = query.toString();
  return url.toString();
}

function getRequestQuery(req: NodeLikeRequest) {
  if (req.query) {
    const params = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(req.query)) {
      if (rawValue == null) continue;
      if (Array.isArray(rawValue)) {
        for (const value of rawValue) {
          if (value != null) params.append(key, String(value));
        }
      } else {
        params.set(key, String(rawValue));
      }
    }
    return params;
  }

  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams;
}

async function readJsonBody(req: NodeLikeRequest) {
  // Pages adapter now hands raw bytes for non-JSON content types as a
  // Uint8Array. Exclude that case here so a misaddressed multipart POST
  // doesn't get mistaken for an already-parsed JSON object.
  if (req.body && typeof req.body === "object" && !(req.body instanceof Uint8Array)) return req.body;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function forwardWorkerResponse(
  res: NodeLikeResponse,
  workerResponse: Response,
) {
  const contentType = workerResponse.headers.get("content-type");
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }

  const text = await workerResponse.text();
  res.status(workerResponse.status).send(text);
}

async function callWorker(
  req: NodeLikeRequest,
  pathname: string,
  init: RequestInit = {},
) {
  await requireImageManagerAccess(req.headers.authorization);
  const { apiSecret } = getWorkerConfig();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiSecret}`);

  return fetch(buildWorkerUrl(pathname), {
    ...init,
    headers,
  });
}

export async function handleR2List(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const search = getRequestQuery(req);
    await requireImageManagerAccess(req.headers.authorization);
    const { apiSecret } = getWorkerConfig();
    const workerResponse = await fetch(buildWorkerUrl("/list", search), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
      },
    });
    await forwardWorkerResponse(res, workerResponse);
  } catch (error) {
    handleProxyError(res, error);
  }
}

export async function handleR2Delete(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const search = getRequestQuery(req);
    await requireImageManagerAccess(req.headers.authorization);
    const { apiSecret } = getWorkerConfig();
    const workerResponse = await fetch(buildWorkerUrl("/delete", search), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
      },
    });
    await forwardWorkerResponse(res, workerResponse);
  } catch (error) {
    handleProxyError(res, error);
  }
}

export async function handleR2Rename(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const body = await readJsonBody(req);
    const workerResponse = await callWorker(req, "/rename", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await forwardWorkerResponse(res, workerResponse);
  } catch (error) {
    handleProxyError(res, error);
  }
}

export async function handleR2MoveFolder(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const body = await readJsonBody(req);
    const workerResponse = await callWorker(req, "/move-folder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await forwardWorkerResponse(res, workerResponse);
  } catch (error) {
    handleProxyError(res, error);
  }
}

export async function handleR2Upload(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    await requireImageManagerAccess(req.headers.authorization);
    const { apiSecret } = getWorkerConfig();
    const contentType = req.headers["content-type"];
    // The Pages adapter pre-reads the body as Uint8Array for non-JSON
    // content types (multipart uploads land here). The body bytes carry
    // the multipart boundary delimiters that the storage worker's
    // `request.formData()` parse step requires; the previous
    // `body: req` form sent the entire shim object and made the worker
    // see no boundary string, hence the 500. Pass `req.body` directly.
    const body = (req as any).body;
    if (body == null) {
      return res.status(400).json({ error: "Missing upload body." });
    }
    const workerResponse = await fetch(buildWorkerUrl("/upload"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: body as BodyInit,
    });
    await forwardWorkerResponse(res, workerResponse);
  } catch (error) {
    handleProxyError(res, error);
  }
}

/* -------------------------------------------------------------------------- */
/* Image reference scan / rewrite                                              */
/* -------------------------------------------------------------------------- */
//
// These two handlers replace the client-side `scanForReferences` and
// `updateImageReferences` in `src/lib/imageMetadata.ts`. The client
// used to run the scan via `fetchCollection('users', …)` etc.
// directly through the generic `/api/d1/query` proxy. Two reasons to
// move it server-side:
//
//   1. PROTECTED_READ_TABLES now blocks direct SELECTs on `users`
//      and `characters` (both in the SCAN_TARGETS list), so the
//      client-side scan would silently skip those collections —
//      image admin would think a user's avatar has no references when
//      it actually does. Server-side via `executeD1QueryInternal`
//      bypasses the proxy gate intentionally (we're running with the
//      shared API_SECRET, not a user token).
//
//   2. L3 in the audit doc: the rewrite endpoint used to accept any
//      `(table, column)` pair as parameters via the generic proxy. The
//      server-side version pins the allow-list here, so even a
//      compromised image-manager UI can't ship UPDATE statements
//      against arbitrary columns.
//
// SCAN_TARGETS is duplicated from `src/lib/imageMetadata.ts` and uses
// the SAME shape but with snake_case table names directly (no
// camelCase → D1 mapping needed server-side). When you add a new
// image-bearing column, update BOTH locations or the scan will miss
// references in the new column.

type ScanTarget = { table: string; fields: string[]; nameField: string };

const SCAN_TARGETS: ScanTarget[] = [
  { table: "classes",       fields: ["image_url", "card_image_url", "preview_image_url"], nameField: "name" },
  { table: "subclasses",    fields: ["image_url"],                                        nameField: "name" },
  { table: "features",      fields: ["icon_url"],                                         nameField: "name" },
  { table: "characters",    fields: ["image_url"],                                        nameField: "name" },
  { table: "sources",       fields: ["image_url"],                                        nameField: "name" },
  { table: "users",         fields: ["avatar_url"],                                       nameField: "display_name" },
  { table: "lore_articles", fields: ["image_url", "card_image_url", "preview_image_url"], nameField: "title" },
];

// Sanity caps. D1 will reject anything too long anyway, but we want a
// fast and clear 400 instead of a noisy 500 from the worker.
const MAX_URL_LENGTH = 4096;

function assertUrlInput(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `Field \`${field}\` must be a string.`);
  }
  if (!value) {
    throw new HttpError(400, `Field \`${field}\` is required.`);
  }
  if (value.length > MAX_URL_LENGTH) {
    throw new HttpError(400, `Field \`${field}\` exceeds the ${MAX_URL_LENGTH}-character limit.`);
  }
  return value;
}

export async function handleImageReferencesScan(
  req: NodeLikeRequest,
  res: NodeLikeResponse,
) {
  try {
    await requireImageManagerAccess(req.headers.authorization);
    const body = (await readJsonBody(req)) as { url?: unknown };
    const url = assertUrlInput(body?.url, "url");

    // Mirror the client's Promise.all fan-out: one SELECT per
    // (table, field). The client used to swallow errors per-target
    // silently; here we let an unexpected error surface so the UI can
    // show a real failure instead of "no references found" when a
    // collection actually exists but the SELECT failed.
    const collected: Array<{ collection: string; id: string; name: string; field: string }> = [];

    for (const target of SCAN_TARGETS) {
      for (const field of target.fields) {
        const result = await executeD1QueryInternal({
          sql: `SELECT id, ${field}, ${target.nameField} FROM ${target.table} WHERE ${field} = ?`,
          params: [url],
        });
        const rows = Array.isArray(result?.results) ? result.results : [];
        for (const row of rows) {
          const r = row as any;
          collected.push({
            // Report back the snake_case table — the client's
            // legacy shape used camelCase aliases (e.g. `lore`), but
            // ImageManager.tsx only renders the `name` and uses the
            // `id` for deep-linking, so the collection label change
            // is cosmetic. If the UI ever depends on the camelCase
            // alias, map it back here.
            collection: target.table,
            id: r.id,
            name: (r[target.nameField] as string) || r.id,
            field,
          });
        }
      }
    }

    return res.status(200).json({ references: collected });
  } catch (error) {
    handleProxyError(res, error);
  }
}

export async function handleImageReferencesRewrite(
  req: NodeLikeRequest,
  res: NodeLikeResponse,
) {
  try {
    await requireImageManagerAccess(req.headers.authorization);
    const body = (await readJsonBody(req)) as { oldUrl?: unknown; newUrl?: unknown };
    const oldUrl = assertUrlInput(body?.oldUrl, "oldUrl");
    const newUrl = assertUrlInput(body?.newUrl, "newUrl");

    if (oldUrl === newUrl) {
      // No-op rewrite — return zero so the caller can short-circuit
      // its UI ("0 references updated") without a needless round-trip
      // through D1.
      return res.status(200).json({ count: 0 });
    }

    // One UPDATE per (table, field). Cheaper than a SELECT-then-UPDATE
    // round trip — D1 returns the affected row count and we don't need
    // the row ids server-side. The audit's L3 concern was about the
    // OLD client-side flow that ran UPDATE against an arbitrary
    // `(table, column)` pair from request params; here the pairs are
    // pinned to SCAN_TARGETS and the user has no input on them.
    let count = 0;

    for (const target of SCAN_TARGETS) {
      for (const field of target.fields) {
        const result = await executeD1QueryInternal({
          sql: `UPDATE ${target.table} SET ${field} = ? WHERE ${field} = ?`,
          params: [newUrl, oldUrl],
        });
        const meta = (result as any)?.meta;
        const changes = typeof meta?.changes === "number" ? meta.changes : 0;
        count += changes;
      }
    }

    return res.status(200).json({ count });
  } catch (error) {
    handleProxyError(res, error);
  }
}

function handleProxyError(res: NodeLikeResponse, error: unknown) {
  const credentialMessage = getCredentialErrorMessage(error);
  if (credentialMessage) {
    return res.status(503).json({ error: credentialMessage });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("R2 proxy request failed:", error);
  return res.status(500).json({ error: message || "R2 proxy request failed." });
}
