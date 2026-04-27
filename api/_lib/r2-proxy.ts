import type { IncomingMessage } from "node:http";
import { HttpError, getCredentialErrorMessage, requireImageManagerAccess } from "./firebase-admin.js";

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
  if (req.body && typeof req.body === "object") return req.body;

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
    const workerResponse = await fetch(buildWorkerUrl("/upload"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: req as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    await forwardWorkerResponse(res, workerResponse);
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
