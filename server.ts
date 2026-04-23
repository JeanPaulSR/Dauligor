import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

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
