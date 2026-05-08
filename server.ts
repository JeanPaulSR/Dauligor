import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { applicationDefault, cert, getApp, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  handleR2Delete,
  handleR2List,
  handleR2MoveFolder,
  handleR2Rename,
  handleR2Upload,
} from "./api/_lib/r2-proxy.js";
import { handleD1Query } from "./api/_lib/d1-proxy.js";
import { executeD1QueryInternal, loadUserRoleFromD1 } from "./api/_lib/d1-internal.js";
import moduleHandler from "./api/module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);

type FirebaseAppletConfig = {
  projectId: string;
};

function loadFirebaseConfig(): FirebaseAppletConfig {
  const configPath = path.join(__dirname, "firebase-applet-config.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as { projectId: string };
  return { projectId: raw.projectId };
}

// Firestore is decommissioned. Firebase Admin lives on only as a JWT verifier
// (and password updater for admin temp-password flows). All user/role data
// reads go through D1 via loadUserRoleFromD1.
function getAdminServices() {
  const firebaseConfig = loadFirebaseConfig();

  const app = getApps().length
    ? getApp()
    : initializeAdminApp(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON
          ? {
              credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
              projectId: firebaseConfig.projectId,
            }
          : {
              credential: applicationDefault(),
              projectId: firebaseConfig.projectId,
            }
      );

  return { auth: getAdminAuth(app) };
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
  app.use(express.json());

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
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing bearer token." });
      }

      const idToken = authHeader.slice("Bearer ".length);
      const { auth } = getAdminServices();
      const decoded = await auth.verifyIdToken(idToken);

      const actingRole = await loadUserRoleFromD1(decoded.uid);
      const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
      }

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
      console.error("Failed to generate temporary password:", error);
      const message = error instanceof Error ? error.message : String(error);
      const missingCredentials =
        message.includes("Could not load the default credentials") ||
        message.includes("Failed to parse private key") ||
        message.includes("Service account object must contain");

      return res.status(missingCredentials ? 503 : 500).json({
        error: missingCredentials
          ? "Firebase Admin credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON."
          : message,
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
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing bearer token." });
      }

      const idToken = authHeader.slice("Bearer ".length);
      const { auth } = getAdminServices();
      const decoded = await auth.verifyIdToken(idToken);

      const actingRole = await loadUserRoleFromD1(decoded.uid);
      const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
      }

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
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/admin/spells/import-batch", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing bearer token." });
      }

      const idToken = authHeader.slice("Bearer ".length);
      const { auth } = getAdminServices();
      const decoded = await auth.verifyIdToken(idToken);

      const actingRole = await loadUserRoleFromD1(decoded.uid);
      const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
      }

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
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/admin/spells/delete", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing bearer token." });
      }

      const idToken = authHeader.slice("Bearer ".length);
      const { auth } = getAdminServices();
      const decoded = await auth.verifyIdToken(idToken);

      const actingRole = await loadUserRoleFromD1(decoded.uid);
      const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
      }

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
      return res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  // Serve the data sources from the module directory dynamically via REST.
  // Local dev delegates to the Vercel handler at api/module.ts so the dispatch
  // logic, R2 read-through cache, and Cache-Control headers stay in one place.
  // The handler reads `req.url` directly; `req.params[0]` is unused. R2 writes
  // go through the local Worker if `R2_WORKER_URL` and `R2_API_SECRET` are
  // set in `.env` (writes silently no-op otherwise).
  app.get(["/api/module", "/api/module/*"], async (req, res) => {
    try {
      await moduleHandler(req as any, res as any);
    } catch (error) {
      console.error("Module endpoint failed (local):", error);
      if (!res.headersSent) res.status(500).json({ error: "Module endpoint failed." });
    }
  });

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
