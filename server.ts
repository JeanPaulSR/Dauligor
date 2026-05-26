import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  handleR2Delete,
  handleR2List,
  handleR2MoveFolder,
  handleR2Rename,
  handleR2Upload,
} from "./api/_lib/r2-proxy.js";
import { handleD1Query } from "./api/_lib/d1-proxy.js";
import { executeD1QueryInternal, loadUserRoleFromD1 } from "./api/_lib/d1-internal.js";
import { HttpError, getAdminServices, getCredentialErrorMessage } from "./api/_lib/firebase-admin.js";
import { wrapPagesFunction } from "./api/_lib/pages-to-express.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);

/**
 * Inline admin gate used by the dev-server's hand-rolled admin endpoints
 * (temp-password + the legacy spell admin routes). Mirrors the
 * `requireAdminAccess` helper in `api/_lib/firebase-admin.ts`: wraps the
 * JWT verify in a try/catch so jose verify failures surface as 401
 * instead of bubbling up as a generic 500 from the handler's outer catch.
 */
async function verifyAdminToken(authHeader: string | string[] | undefined): Promise<void> {
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token.");
  }
  const idToken = headerValue.slice("Bearer ".length);
  let decoded: any;
  try {
    const { auth } = getAdminServices();
    decoded = await auth.verifyIdToken(idToken);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new HttpError(401, `Invalid auth token: ${reason}`);
  }
  const actingRole = await loadUserRoleFromD1(decoded.uid);
  const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";
  if (!isAdmin) {
    throw new HttpError(403, "Admin access required.");
  }
}

function createTemporaryPassword(length = 14) {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%*?";
  const allChars = `${uppercase}${lowercase}${numbers}${symbols}`;

  const required = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  while (required.length < length) {
    required.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  for (let i = required.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [required[i], required[swapIndex]] = [required[swapIndex], required[i]];
  }

  return required.join("");
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  // Body limit bumped from the 100kb default to 50mb so bulk
  // Foundry imports (spells, feats, items) can flow through the
  // local /api/d1/query proxy. Each Foundry-shaped entity carries
  // its full preserved `foundry_data` JSON payload (~20-100kb per
  // row); a folder of 500+ feats easily crosses single-MB territory.
  // Production (Cloudflare Pages Functions + Worker) is bounded
  // by Cloudflare's 100MB request body limit, so 50mb here is well
  // below the platform ceiling. If a single batch ever exceeds
  // 50mb, the client-side `batchUpsertFeats` / `batchUpsertSpells`
  // helpers should chunk further.
  app.use(express.json({ limit: '50mb' }));

  // JSON Endpoint for Character Pairings
  // In a real app we'd fetch from Firestore here. 
  // For the applet, we can't easily fetch user-specific private data from the server 
  // without service account keys.
  // However, we can provide the static sample for now as a proof of concept endpoint.
  app.get("/api/characters/:id/json", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // This is a placeholder that correctly sets content-type for the foundry module
    res.json({
      error: "Authentication required via Archive interface. Use 'View JSON' in Character Builder.",
      hint: "To fetch live data, the server requires Firestore Admin SDK configuration."
    });
  });

  app.post("/api/admin/users/:id/temporary-password", async (req, res) => {
    try {
      await verifyAdminToken(req.headers.authorization);

      // Verify the target user exists in our D1 directory before resetting their
      // Firebase Auth password. This guards against typos / stale UIDs.
      const targetUserId = req.params.id;
      const targetCheck = await executeD1QueryInternal({
        sql: "SELECT id FROM users WHERE id = ? LIMIT 1",
        params: [targetUserId],
      });
      if (!targetCheck.results?.length) {
        return res.status(404).json({ error: "Target user profile not found." });
      }

      const temporaryPassword = createTemporaryPassword();
      const { auth } = getAdminServices();
      await auth.updateUser(targetUserId, { password: temporaryPassword });
      // Note: the legacy Firestore write of `mustChangePassword` /
      // `temporaryPasswordGeneratedAt` / `temporaryPasswordGeneratedBy` is gone.
      // The temp-password lifecycle is now handled entirely by Firebase Auth
      // and the returned password value below; D1 has no columns for it.

      return res.json({
        temporaryPassword,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Failed to generate temporary password:", error);
      const message = error instanceof Error ? error.message : String(error);
      const credentialMessage = getCredentialErrorMessage(error);
      return res.status(credentialMessage ? 503 : 500).json({
        error: credentialMessage ?? message,
      });
    }
  });

  app.get("/api/r2/list", (req, res) => {
    void handleR2List(req, res);
  });

  app.delete("/api/r2/delete", (req, res) => {
    void handleR2Delete(req, res);
  });

  app.post("/api/r2/rename", (req, res) => {
    void handleR2Rename(req, res);
  });

  app.post("/api/r2/move-folder", (req, res) => {
    void handleR2MoveFolder(req, res);
  });

  app.post("/api/r2/upload", (req, res) => {
    void handleR2Upload(req, res);
  });

  // D1 Proxy
  app.post("/api/d1/query", handleD1Query);

  // Helper to map spell payload to D1 columns
  function mapSpellToD1(id: string, payload: any) {
    return {
      id,
      name: payload.name,
      identifier: payload.identifier || (payload.name || "").toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      level: Number(payload.level) || 0,
      school: payload.school || null,
      preparation_mode: payload.preparationMode || 'spell',
      ritual: payload.ritual ? 1 : 0,
      concentration: payload.concentration ? 1 : 0,
      components_vocal: payload.components?.vocal ? 1 : 0,
      components_somatic: payload.components?.somatic ? 1 : 0,
      components_material: payload.components?.material ? 1 : 0,
      components_material_text: payload.components?.materialText || null,
      components_consumed: payload.components?.consumed ? 1 : 0,
      components_cost: payload.components?.cost || null,
      description: payload.description || "",
      image_url: payload.imageUrl || null,
      activities: JSON.stringify(payload.activities || []),
      effects: JSON.stringify(payload.effects || []),
      foundry_data: JSON.stringify(payload.foundryData || {}),
      source_id: payload.sourceId || null,
      page: payload.page || null,
      tags: JSON.stringify(payload.tags || []),
      updated_at: new Date().toISOString()
    };
  }

  // Spell Admin Endpoints
  app.post("/api/admin/spells/upsert", async (req, res) => {
    try {
      await verifyAdminToken(req.headers.authorization);

      const { id, payload } = req.body;
      const targetId = id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const d1Data = mapSpellToD1(targetId, payload);
      const columns = Object.keys(d1Data);
      const placeholders = columns.map(() => "?").join(", ");
      const updates = columns.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(", ");

      const sql = `
        INSERT INTO spells (${columns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET ${updates}
      `;

      await executeD1QueryInternal({
        sql,
        params: Object.values(d1Data)
      });

      return res.json({ 
        success: true, 
        id: targetId, 
        action: id ? 'updated' : 'created' 
      });
    } catch (error) {
      console.error("Error upserting spell:", error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/admin/spells/import-batch", async (req, res) => {
    try {
      await verifyAdminToken(req.headers.authorization);

      const { entries } = req.body;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "Entries must be an array." });
      }

      const queries = entries.map(entry => {
        const targetId = entry.id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const d1Data = mapSpellToD1(targetId, entry.payload);
        const columns = Object.keys(d1Data);
        const placeholders = columns.map(() => "?").join(", ");
        const updates = columns.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(", ");

        return {
          sql: `
            INSERT INTO spells (${columns.join(", ")})
            VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET ${updates}
          `,
          params: Object.values(d1Data)
        };
      });

      await executeD1QueryInternal(queries); // executeD1QueryInternal handles array of queries as a batch

      return res.json({ 
        success: true, 
        total: entries.length
      });
    } catch (error) {
      console.error("Error importing spells:", error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/admin/spells/delete", async (req, res) => {
    try {
      await verifyAdminToken(req.headers.authorization);

      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: "ID is required." });
      }

      await executeD1QueryInternal({
        sql: "DELETE FROM spells WHERE id = ?",
        params: [id]
      });

      return res.json({ success: true, id });
    } catch (error) {
      console.error("Error deleting spell:", error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  // Character Pairing Export
  app.get("/api/characters/:id/json", async (req, res) => {
    try {
      const { id } = req.params;
      const { buildCharacterExport } = await import("./src/lib/characterShared.js");
      const { executeD1QueryInternal } = await import("./api/_lib/d1-proxy.js");
      
      const payload = await buildCharacterExport(id, executeD1QueryInternal);
      if (!payload) {
        return res.status(404).json({ error: "Character not found." });
      }

      return res.json(payload);
    } catch (error) {
      console.error("Error generating character export:", error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/characters/:id/export", async (req, res) => {
    try {
      const { id } = req.params;
      const { buildCharacterExport } = await import("./src/lib/characterShared.js");
      const { executeD1QueryInternal } = await import("./api/_lib/d1-proxy.js");
      const { slugify } = await import("./src/lib/characterLogic.js");

      const payload = await buildCharacterExport(id, executeD1QueryInternal);
      if (!payload) {
        return res.status(404).json({ error: "Character not found." });
      }

      const safeName = slugify(payload.actor?.name || "character");
      const key = `exports/characters/${id}/dauligor-character-${safeName}.json`;
      
      const { workerUrl, apiSecret } = JSON.parse(JSON.stringify({
        workerUrl: process.env.R2_WORKER_URL,
        apiSecret: process.env.R2_API_SECRET
      }));

      const uploadRes = await fetch(`${workerUrl}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiSecret}`,
        },
        body: (() => {
          const formData = new FormData();
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          formData.append('file', blob, 'character.json');
          formData.append('key', key);
          return formData;
        })()
      });

      if (!uploadRes.ok) {
        throw new Error(`R2 Upload failed: ${uploadRes.statusText}`);
      }

      const uploadData: any = await uploadRes.json();
      return res.json({ url: uploadData.url, key });
    } catch (error) {
      console.error("Error exporting character to R2:", error);
      if (error instanceof HttpError) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  // Mount Pages Functions onto Express in dev.
  //
  // After the May 2026 Vercel→Cloudflare-Pages migration, the
  // following routes live ONLY as Pages Functions under `functions/`.
  // In production Cloudflare's runtime serves them; in local dev we
  // run Express + Vite, so without these mounts every /api/me, every
  // admin endpoint, and the lore/campaigns/eras APIs would fall
  // through to the SPA and return `index.html` (the
  // "Unexpected token '<'" SyntaxError users used to see). The
  // adapter at api/_lib/pages-to-express.ts translates the Express
  // req/res pair into the Web Request/Response shape `onRequest`
  // expects.
  //
  // `/api/module/*` is now mounted via the same wrapper — the handler
  // optionally uses `context.waitUntil` (guarded with `typeof`) and
  // reads D1 via the worker-fetch path (not `context.env`), so the
  // request/params-only adapter in `pages-to-express.ts` is enough.
  // Previously this required `wrangler pages dev`; that's only needed
  // now if you're exercising the Cloudflare R2 cache binding, which
  // the pipeline gracefully degrades without (cold path goes straight
  // to D1 every time, slower but functional).
  const pagesFunctions: Array<{ mount: string; modulePath: string }> = [
    { mount: "/api/me", modulePath: "./functions/api/me/[[path]].ts" },
    { mount: "/api/admin/users", modulePath: "./functions/api/admin/users/[[path]].ts" },
    { mount: "/api/admin/worlds", modulePath: "./functions/api/admin/worlds/[[path]].ts" },
    { mount: "/api/admin/eras", modulePath: "./functions/api/admin/eras/[[path]].ts" },
    { mount: "/api/admin/proposals", modulePath: "./functions/api/admin/proposals/[[path]].ts" },
    // Single-file Pages Function (not a [[path]] catch-all). The
    // worker's scheduled() handler POSTs here daily; mirroring it in
    // the local Express dev server lets us exercise the prewarm
    // end-to-end without spinning up `wrangler pages dev`.
    { mount: "/api/admin/prewarm-spell-cache", modulePath: "./functions/api/admin/prewarm-spell-cache.ts" },
    // Single-file Pages Functions for per-user favorites. Local dev
    // wires them through the same `wrapPagesFunction` adapter so
    // signed-in users get cloud-sync against `npx wrangler d1 …
    // --local`. Without these mounts the requests fall through to
    // the SPA and clients see `Unexpected token '<'` from the HTML
    // body. (Production Cloudflare serves them automatically.)
    { mount: "/api/spell-favorites", modulePath: "./functions/api/spell-favorites.ts" },
    { mount: "/api/feat-favorites", modulePath: "./functions/api/feat-favorites.ts" },
    { mount: "/api/item-favorites", modulePath: "./functions/api/item-favorites.ts" },
    { mount: "/api/proposals", modulePath: "./functions/api/proposals/[[path]].ts" },
    { mount: "/api/lore", modulePath: "./functions/api/lore/[[path]].ts" },
    { mount: "/api/campaigns", modulePath: "./functions/api/campaigns/[[path]].ts" },
    // Module export pipeline (read-through cache for the Foundry
    // pairing module's in-Foundry importer wizard). The handler is
    // env-free — it accesses D1 via the worker-fetch path and only
    // uses `context.waitUntil` optionally (guarded). Locally the R2
    // cache binding is absent, so every request goes cold-path to
    // D1 + worker — fine for dev (slower than prod, still correct).
    { mount: "/api/module", modulePath: "./functions/api/module/[[path]].ts" },
  ];

  for (const { mount, modulePath } of pagesFunctions) {
    try {
      const mod = await import(modulePath);
      const handler = mod.onRequest;
      if (typeof handler !== "function") {
        console.warn(`[dev] ${modulePath} has no onRequest export`);
        continue;
      }
      app.use(mount, wrapPagesFunction(handler));
    } catch (err) {
      console.warn(`[dev] Failed to mount Pages Function at ${mount}:`, err);
    }
  }

  // Serve static files from the module directory if needed for documentation
  app.use("/module", express.static(path.join(__dirname, "module")));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
