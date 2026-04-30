import type { IncomingMessage } from "node:http";
import { getAdminServices, getCredentialErrorMessage, HttpError, requireAdminAccess } from "../../_lib/firebase-admin.js";

type NodeLikeRequest = IncomingMessage & {
  method?: string;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

async function deleteCollectionInChunks(collectionName: string) {
  const { db } = getAdminServices();
  let deletedCount = 0;

  while (true) {
    const snapshot = await db.collection(collectionName).limit(400).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();
    deletedCount += snapshot.docs.length;
  }

  return deletedCount;
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, "Method not allowed.");
    }

    await requireAdminAccess(req.headers.authorization);

    const purgedSpells = await deleteCollectionInChunks("spells");
    const purgedSummaries = await deleteCollectionInChunks("spellSummaries");

    return res.status(200).json({
      success: true,
      purgedSpells,
      purgedSummaries,
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
    console.error("Spell purge request failed:", error);
    return res.status(500).json({ error: message || "Spell purge request failed." });
  }
}
