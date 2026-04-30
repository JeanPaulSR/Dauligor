import type { IncomingMessage } from "node:http";
import { getAdminServices, getCredentialErrorMessage, HttpError, requireAdminAccess } from "../../_lib/firebase-admin.js";

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
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
    if (!id) {
      throw new HttpError(400, "Missing spell id.");
    }

    const { db } = getAdminServices();
    await Promise.all([
      db.collection("spells").doc(id).delete(),
      db.collection("spellSummaries").doc(id).delete(),
    ]);

    return res.status(200).json({ success: true, id });
  } catch (error) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return res.status(503).json({ error: credentialMessage });
    }

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("Spell delete request failed:", error);
    return res.status(500).json({ error: message || "Spell delete request failed." });
  }
}
