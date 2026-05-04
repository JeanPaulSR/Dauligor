import { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Parse path out of URL
  const urlObj = new URL(req.url || "", "http://localhost");
  let subpath = urlObj.pathname.replace(/^\/api\/module\/?/, "");

  let cleanSubpath = subpath;
  if (cleanSubpath === "sources") {
    cleanSubpath = "";
  } else if (cleanSubpath.startsWith("sources/")) {
    cleanSubpath = cleanSubpath.slice("sources/".length);
  }

  let filePath = path.join(process.cwd(), "module/dauligor-pairing/data/sources", cleanSubpath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "catalog.json");
  } else if (!filePath.endsWith(".json")) {
    if (fs.existsSync(filePath + ".json")) {
      filePath = filePath + ".json";
    } else if (fs.existsSync(path.join(filePath, "catalog.json"))) {
      filePath = path.join(filePath, "catalog.json");
    }
  }

  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "application/json");
    return res.end(fs.readFileSync(filePath, "utf-8"));
  }

  res.statusCode = 404;
  return res.end(JSON.stringify({ error: `Source not found at: ${subpath}` }));
}
