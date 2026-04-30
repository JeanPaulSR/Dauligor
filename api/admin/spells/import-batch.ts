import type { IncomingMessage } from "node:http";
import { getCredentialErrorMessage, HttpError, requireAdminAccess } from "../../_lib/firebase-admin.js";
import { upsertSpellWithSummary } from "./_shared.js";

type NodeLikeRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

async function readJsonBody(req: NodeLikeRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed.");
    }

    await requireAdminAccess(req.headers.authorization);
    const body = await readJsonBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];

    if (!entries.length) {
      throw new HttpError(400, "No spell entries were provided.");
    }

    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      const id = typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : null;
      const payload = entry?.payload;
      if (!payload || typeof payload !== "object") {
        throw new HttpError(400, "Each spell entry must include a payload object.");
      }

      await upsertSpellWithSummary(id, payload as Record<string, any>);
      if (id) updated += 1;
      else created += 1;
    }

    return res.status(200).json({
      success: true,
      total: entries.length,
      created,
      updated,
    });
  } catch (error) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return res.status(503).json({ error: credentialMessage });
    }

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("Spell batch import request failed:", error);
    return res.status(500).json({ error: message || "Spell batch import request failed." });
  }
}
