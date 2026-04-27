import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { applicationDefault, cert, getApp, getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
  handleR2Delete,
  handleR2List,
  handleR2MoveFolder,
  handleR2Rename,
  handleR2Upload,
} from "./api/_lib/r2-proxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARDCODED_STAFF_EMAILS = new Set([
  "luapnaej101@gmail.com",
  "admin@archive.internal",
  "gm@archive.internal",
]);

type FirebaseAppletConfig = {
  projectId: string;
  firestoreDatabaseId: string;
};

function loadFirebaseConfig(): FirebaseAppletConfig {
  const configPath = path.join(__dirname, "firebase-applet-config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as FirebaseAppletConfig;
}

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

  return {
    auth: getAdminAuth(app),
    db: getAdminFirestore(app, firebaseConfig.firestoreDatabaseId),
  };
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
      const { auth, db } = getAdminServices();
      const decoded = await auth.verifyIdToken(idToken);

      const actingUserSnapshot = await db.collection("users").doc(decoded.uid).get();
      const actingRole = actingUserSnapshot.exists ? actingUserSnapshot.data()?.role : null;
      const isAdmin = HARDCODED_STAFF_EMAILS.has(decoded.email ?? "") || actingRole === "admin";

      if (!isAdmin) {
        return res.status(403).json({ error: "Admin access required." });
      }

      const targetUserId = req.params.id;
      const targetUserSnapshot = await db.collection("users").doc(targetUserId).get();
      if (!targetUserSnapshot.exists) {
        return res.status(404).json({ error: "Target user profile not found." });
      }

      const temporaryPassword = createTemporaryPassword();
      await auth.updateUser(targetUserId, { password: temporaryPassword });
      await db.collection("users").doc(targetUserId).set(
        {
          mustChangePassword: true,
          temporaryPasswordGeneratedAt: new Date().toISOString(),
          temporaryPasswordGeneratedBy: decoded.uid,
        },
        { merge: true }
      );

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
