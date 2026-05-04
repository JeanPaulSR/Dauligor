import { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { getAdminServices } from "./_lib/firebase-admin.js";

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
  if (cleanSubpath === "sources" || cleanSubpath === "sources/") {
    cleanSubpath = "";
  } else if (cleanSubpath.startsWith("sources/")) {
    cleanSubpath = cleanSubpath.slice("sources/".length);
  }

  // Handle Dynamic Catalog Requests
  try {
    const { db } = getAdminServices();

    // 1. Source Catalog
    if (!cleanSubpath || cleanSubpath === "catalog.json") {
      const sourcesSnap = await db.collection("sources").where("status", "==", "ready").get();
      const sources = sourcesSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: data.slug || doc.id,
          name: data.name,
          shortName: data.abbreviation || data.name,
          description: data.description,
          coverImage: data.imageUrl || "",
          classCount: 0, // Simplified for catalog
          catalogUrl: `${data.slug || doc.id}/classes/catalog.json`
        };
      });

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        kind: "dauligor.source-catalog.v1",
        schemaVersion: 1,
        sources
      }));
    }

    // 2. Class Catalog for a Source
    const pathParts = cleanSubpath.split("/");
    if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2] === "catalog.json") {
      const sourceSlug = pathParts[0];
      const sourceSnap = await db.collection("sources").where("slug", "==", sourceSlug).limit(1).get();
      if (!sourceSnap.empty) {
        const sourceDoc = sourceSnap.docs[0];
        const sourceId = sourceDoc.id;
        const classesSnap = await db.collection("classes").where("sourceId", "==", sourceId).get();
        const classes = classesSnap.docs.map(doc => {
          const data = doc.data();
          return {
            id: data.identifier || doc.id,
            name: data.name,
            entity: "class",
            sourceId: sourceSlug,
            url: `${data.identifier || doc.id}.json`
          };
        });

        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({
          kind: "dauligor.class-catalog.v1",
          schemaVersion: 1,
          source: { id: sourceSlug },
          classes
        }));
      }
    }

    // 3. Specific Class Data
    if (pathParts.length === 3 && pathParts[1] === "classes" && pathParts[2].endsWith(".json")) {
      const sourceSlug = pathParts[0];
      const classIdentifier = pathParts[2].replace(".json", "");
      const classSnap = await db.collection("classes").where("identifier", "==", classIdentifier).limit(1).get();
      if (!classSnap.empty) {
        const classData = classSnap.docs[0].data();
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(classData));
      }
    }
  } catch (error) {
    console.error("Dynamic Module API Error:", error);
    // Fall back to static file logic if Firestore fails
  }

  // Fallback: Static File Logic
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
