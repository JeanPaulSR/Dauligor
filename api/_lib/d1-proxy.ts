import { HttpError, getCredentialErrorMessage, requireStaffAccess } from "./firebase-admin.js";
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

async function readJsonBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  // Express usually parses JSON bodies if app.use(express.json()) is used
  return req.body || {};
}

export async function handleD1Query(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string') throw new HttpError(401, "Missing authorization header");
    
    // Most compendium data should be public, but let's at least ensure they are a valid user
    // or if it's a specific admin action, require staff access.
    // For now, let's just require staff access for ALL queries to be safe during development.
    await requireStaffAccess(authHeader);

    const body = await readJsonBody(req);
    const sql = body.sql || (Array.isArray(body) ? body[0]?.sql : '');
    const isMutation = /INSERT|UPDATE|DELETE|REPLACE/i.test(sql);
    
    if (isMutation) {
      console.log(`[D1 Proxy] Executing mutation: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
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

