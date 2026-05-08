// Server-side adapters that match the `fetchCollection` / `fetchDocument`
// signatures from `src/lib/d1.ts` but talk to the worker through
// `executeD1QueryInternal` instead of the client-only `/api/d1/query` proxy
// (which requires a Firebase JWT).
//
// Pass these to `exportClassSemantic(classId, fetchers)` from a Vercel
// function so the same shaping code runs server-side.
import { executeD1QueryInternal } from "./d1-internal.js";
import { getTableName } from "../../src/lib/d1Tables.js";

interface CollectionOptions {
  select?: string;
  where?: string;
  params?: any[];
  orderBy?: string;
}

export async function serverFetchCollection<T>(
  collectionName: string,
  options: CollectionOptions = {},
): Promise<T[]> {
  const tableName = getTableName(collectionName);
  let sql = `SELECT ${options.select || "*"} FROM ${tableName}`;
  if (options.where) sql += ` WHERE ${options.where}`;
  if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;

  const response = await executeD1QueryInternal({ sql, params: options.params });
  return (response.results || []) as T[];
}

export async function serverFetchDocument<T>(
  collectionName: string,
  id: string,
): Promise<T | null> {
  const tableName = getTableName(collectionName);
  const sql = `SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`;
  const response = await executeD1QueryInternal({ sql, params: [id] });
  const rows = (response.results || []) as T[];
  return rows[0] ?? null;
}

export const SERVER_EXPORT_FETCHERS = {
  fetchCollection: serverFetchCollection,
  fetchDocument: serverFetchDocument,
};
