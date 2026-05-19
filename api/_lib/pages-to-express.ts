// Bridges Cloudflare Pages Function handlers onto the Express dev
// server.
//
// Pages Functions export `onRequest(context)` where `context.request`
// is a Web `Request` and the function returns a Web `Response`. In
// production Cloudflare's runtime calls these directly; in local dev
// we run Express + Vite (see `server.ts`), so any path that lives
// only as a Pages Function (post-2026-05 migration: `/api/me`,
// `/api/admin/*`, `/api/lore/*`, `/api/campaigns/*`, etc.) would
// otherwise fall through to the SPA and return `index.html` instead
// of JSON.
//
// The wrapper turns each Express `(req, res)` pair into a Web
// `Request`, invokes `onRequest`, and pipes the Web `Response` back
// onto `res`. Mount with `app.use("/api/me", wrap(meHandler))`:
// Express strips the mount prefix from `req.url`, so the wrapper
// derives `params.path` from the remaining segments — the same value
// a `[[path]]` catch-all sees in production.

import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

type PagesContext = {
  request: Request;
  params: Record<string, string | string[]>;
  // The real Pages runtime exposes more, but Phase 1 / Phase 2 of the
  // proposal stack only uses `request` and `params`. Extend when an
  // endpoint genuinely needs `env`, `waitUntil`, or `data`.
};

type PagesOnRequest = (context: PagesContext) => Promise<Response>;

function splitSubPath(reqUrl: string): string[] {
  // Express sets `req.url` to the URL *after* the mount prefix.
  // Strip the query string and any leading slash, then split on `/`.
  const pathOnly = reqUrl.split("?", 1)[0] ?? "";
  return pathOnly.split("/").filter(Boolean);
}

export function wrapPagesFunction(handler: PagesOnRequest) {
  return async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const proto = req.protocol || "http";
      const host = req.headers.host || `localhost:${process.env.PORT || 3000}`;
      // `originalUrl` includes the mount prefix + query — what the
      // Pages runtime would see as the request URL.
      const url = `${proto}://${host}${req.originalUrl}`;

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(name, v);
        } else {
          headers.set(name, String(value));
        }
      }

      let body: BodyInit | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (req.body !== undefined && req.body !== null) {
          if (typeof req.body === "string") {
            body = req.body;
          } else if (Buffer.isBuffer(req.body)) {
            body = req.body as unknown as ArrayBuffer;
          } else {
            // Express's `express.json()` middleware leaves a parsed
            // object on `req.body`; rebuild the JSON so the Pages
            // handler can `await request.json()` like in prod.
            body = JSON.stringify(req.body);
            if (!headers.has("content-type")) {
              headers.set("content-type", "application/json");
            }
          }
        }
      }

      const webRequest = new Request(url, {
        method: req.method,
        headers,
        body,
      });

      const params: Record<string, string | string[]> = {
        path: splitSubPath(req.url),
      };

      const response = await handler({ request: webRequest, params });

      res.status(response.status);
      response.headers.forEach((value, key) => {
        // Skip content-length — Express recomputes on res.send().
        if (key.toLowerCase() === "content-length") return;
        res.setHeader(key, value);
      });

      const responseBody = await response.text();
      res.send(responseBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[pages-to-express] handler threw:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  };
}
