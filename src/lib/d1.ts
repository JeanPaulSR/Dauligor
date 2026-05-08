import { auth } from "./firebase";
import { toast } from "sonner";
import { D1_TABLE_MAP, getTableName } from "./d1Tables";

// Re-export so existing imports from './d1' keep working.
export { D1_TABLE_MAP, getTableName };

const QUERY_CACHE: Record<string, { data: any, timestamp: number }> = {};
const INFLIGHT_REQUESTS: Record<string, Promise<any>> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SESSION_CACHE_PREFIX = 'dauligor_cache_';

// Tables that are safe to persist in sessionStorage (mostly static)
const PERSISTENT_TABLES = [
  'eras', 'sources', 'skills', 'tools', 'weapons', 'armor', 
  'languages', 'damage_types', 'status_conditions', 'attributes',
  'tag_groups', 'tags', 'scaling_columns', 'weapon_properties',
  'armor_categories', 'weapon_categories', 'tool_categories', 
  'language_categories', 'condition_categories',
  'lore_articles', 'lore_meta_characters', 'lore_meta_locations', 
  'lore_meta_organizations', 'lore_meta_deities', 'lore_secrets',
  'lore_article_eras', 'lore_article_campaigns', 'lore_article_tags', 'lore_links',
  'lore_secret_eras', 'lore_secret_campaigns', 'campaigns', 'items', 'feats'
];

export function clearCache(tableName?: string) {
  if (tableName) {
    // Clear in-memory
    Object.keys(QUERY_CACHE).forEach(key => {
      if (key.includes(`FROM ${tableName}`) || key.includes(`INTO ${tableName}`) || key.includes(`UPDATE ${tableName}`) || key.includes(`DELETE FROM ${tableName}`)) {
        delete QUERY_CACHE[key];
      }
    });
    // Clear session storage (iterate because keys are SQL-based)
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith(SESSION_CACHE_PREFIX) && key.includes(`FROM ${tableName}`)) {
        sessionStorage.removeItem(key);
      }
    });
  } else {
    Object.keys(QUERY_CACHE).forEach(key => delete QUERY_CACHE[key]);
    // Clear all session storage dauligor keys
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith(SESSION_CACHE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    });
  }
}

/**
 * Updates the global foundation version timestamp in D1.
 * Called whenever a persistent table is mutated.
 */
export async function bumpFoundationUpdate() {
  const sql = `UPDATE system_metadata SET value = CURRENT_TIMESTAMP WHERE key = 'last_foundation_update'`;
  await queryD1(sql);
}

/**
 * Checks the latest foundation update timestamp.
 * Used for polling from the client to detect stale cache.
 */
export async function checkFoundationUpdate(): Promise<string | null> {
  const sql = `SELECT value FROM system_metadata WHERE key = 'last_foundation_update' LIMIT 1`;
  const results = await queryD1<{ value: string }>(sql, [], { noCache: true });
  return results.length > 0 ? results[0].value : null;
}

/**
 * Generic key/value reader for `system_metadata`. JSON-decodes the stored
 * string. Use this for small singleton config blobs (wiki_settings, feature
 * flags, etc.) — anything bigger belongs in its own table.
 */
export async function getSystemMetadata<T = any>(key: string): Promise<T | null> {
  const sql = `SELECT value FROM system_metadata WHERE key = ? LIMIT 1`;
  const results = await queryD1<{ value: string }>(sql, [key]);
  if (!results.length) return null;
  const raw = results[0].value;
  try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
}

/**
 * Generic key/value writer for `system_metadata`. JSON-encodes the value.
 */
export async function setSystemMetadata<T = any>(key: string, value: T): Promise<void> {
  const sql = `INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`;
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  await queryD1(sql, [key, encoded]);
}

async function getAuthHeaders() {
  if (!auth.currentUser) {
    throw new Error("You must be signed in to access the compendium.");
  }

  const idToken = await auth.currentUser.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

export interface D1Response<T> {
  results: T[];
  success: boolean;
  meta?: any;
  error?: string;
}

/**
 * Execute a SQL query against the D1 database via the proxy.
 */
export async function queryD1<T>(sql: string, params: any[] = [], options: { noCache?: boolean } = {}): Promise<T[]> {
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  const cacheKey = `${sql}:${JSON.stringify(params)}`;
  const tableMatch = sql.match(/FROM\s+([^\s\(]+)/i);
  const tableName = tableMatch ? tableMatch[1].replace(/[`"]/g, '') : null;
  const isPersistent = isSelect && tableName && PERSISTENT_TABLES.includes(tableName);

  // 1. Check in-memory cache
  if (isSelect && !options.noCache && QUERY_CACHE[cacheKey]) {
    const cached = QUERY_CACHE[cacheKey];
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data as T[];
    }
  }

  // 2. Check session storage for persistent tables
  if (isPersistent && !options.noCache) {
    const sessionKey = `${SESSION_CACHE_PREFIX}${cacheKey}`;
    const sessionData = sessionStorage.getItem(sessionKey);
    if (sessionData) {
      try {
        const { data, timestamp } = JSON.parse(sessionData);
        if (Date.now() - timestamp < CACHE_TTL * 12) { // Persistent cache lasts longer (1 hour)
          // Also backfill in-memory
          QUERY_CACHE[cacheKey] = { data, timestamp };
          return data as T[];
        }
      } catch (e) {
        sessionStorage.removeItem(sessionKey);
      }
    }
  }

  // 3. Check de-duplication for selects
  if (isSelect && INFLIGHT_REQUESTS[cacheKey]) {
    return INFLIGHT_REQUESTS[cacheKey];
  }

  const executeQuery = async (): Promise<T[]> => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/d1/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql, params }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Query failed: ${res.status}`);
      }

      const data: D1Response<T> = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Query execution failed");
      }

      // Auto-parse JSON fields
      const jsonFields = [
        'proficiencies', 'spellcasting', 'activities', 'effects', 'tags', 'class_ids', 'class_levels', 'progression', 
        'selections', 'inventory', 'spells', 'meta_data', 'classifications',
        'values', 'levels', 'option_ids', 'fixed_ids', 'category_ids', 
        'optionIds', 'fixedIds', 'categoryIds', 'prerequisites_items', 
        'tag_ids', 'tagIds', 'properties', 'advancements', 'uses_recovery'
      ];
      const parsedResults = (data.results || []).map((row: any) => {
        const parsed: any = { ...row };
        for (const field of jsonFields) {
          if (typeof parsed[field] === 'string') {
            try {
              parsed[field] = JSON.parse(parsed[field]);
            } catch (e) {
              // Not valid JSON or already an object, skip
            }
          }
        }
        return parsed;
      });

      if (isSelect) {
        QUERY_CACHE[cacheKey] = { data: parsedResults, timestamp: Date.now() };
        if (isPersistent) {
          const sessionKey = `${SESSION_CACHE_PREFIX}${cacheKey}`;
          sessionStorage.setItem(sessionKey, JSON.stringify({ data: parsedResults, timestamp: Date.now() }));
        }
      } else {
        const match = sql.match(/(?:INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+([^\s\(]+)/i);
        if (match) {
          const mutatedTable = match[1].replace(/[`"]/g, '');
          clearCache(mutatedTable);
          
          if (PERSISTENT_TABLES.includes(mutatedTable) && mutatedTable !== 'system_metadata') {
            bumpFoundationUpdate().catch(err => console.error("Failed to bump foundation update:", err));
          }
        } else {
          clearCache();
        }
      }

      return parsedResults;
    } catch (err: any) {
      console.error("D1 Query Error:", err);
      throw err;
    } finally {
      if (isSelect) delete INFLIGHT_REQUESTS[cacheKey];
    }
  };

  if (isSelect) {
    const promise = executeQuery();
    INFLIGHT_REQUESTS[cacheKey] = promise;
    return promise;
  }

  return executeQuery();
}

/**
 * Execute multiple SQL queries in a single batch.
 */
export async function batchQueryD1(queries: { sql: string, params?: any[] }[]): Promise<any[]> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/d1/query', {
      method: 'POST',
      headers,
      body: JSON.stringify(queries),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch query failed: ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Batch execution failed");
    }

    const hasMutation = queries.some(q => /INSERT|UPDATE|DELETE|REPLACE/i.test(q.sql));
    if (hasMutation) {
      let persistentAffected = false;
      // Invalidate cache for each table affected
      queries.forEach(q => {
        const match = q.sql.match(/(?:INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+([^\s\(]+)/i);
        if (match) {
          const tableName = match[1].replace(/[`"]/g, '');
          clearCache(tableName);
          if (PERSISTENT_TABLES.includes(tableName) && tableName !== 'system_metadata') {
            persistentAffected = true;
          }
        } else if (/INSERT|UPDATE|DELETE|REPLACE/i.test(q.sql)) {
          clearCache(); // nuclear option for complex mutations
        }
      });

      if (persistentAffected) {
        bumpFoundationUpdate().catch(err => console.error("Failed to bump foundation update in batch:", err));
      }

      const timestamp = new Date().toLocaleTimeString();
      console.info(`%c[D1][${timestamp}] Batch mutation successful (${queries.length} queries)`, 'color: #10b981; font-weight: bold;');
    }

    return data.results;
  } catch (err: any) {
    console.error("D1 Batch Query Error:", err);
    throw err;
  }
}

/**
 * Higher-level helper for standard collection fetching.
 * D1-only — Firestore fallback support was removed at the end of the migration.
 */
export async function fetchCollection<T>(
  collectionName: string,
  options: {
    select?: string,
    where?: string,
    params?: any[],
    orderBy?: string
  } = {}
): Promise<T[]> {
  try {
    const tableName = getTableName(collectionName);
    let sql = `SELECT ${options.select || '*'} FROM ${tableName}`;
    if (options.where) sql += ` WHERE ${options.where}`;
    if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;

    const results = await queryD1<T>(sql, options.params);
    console.info(`[D1] Fetched ${results.length} rows from ${tableName}`);
    return results;
  } catch (err) {
    console.error(`Failed to fetch from D1 (${collectionName}):`, err);
    throw err;
  }
}

/**
 * Fetch a single document by ID.
 * D1-only — Firestore fallback support was removed at the end of the migration.
 */
export async function fetchDocument<T>(
  collectionName: string,
  id: string,
): Promise<T | null> {
  try {
    const tableName = getTableName(collectionName);
    const sql = `SELECT * FROM ${tableName} WHERE id = ? LIMIT 1`;
    const results = await queryD1<T>(sql, [id]);
    if (results.length > 0) {
      console.info(`[D1] Fetched document ${id} from ${tableName}`);
      return results[0];
    }
    return null;
  } catch (err) {
    console.error(`Failed to fetch document ${id} from D1 (${collectionName}):`, err);
    throw err;
  }
}

/**
 * Upsert a document into D1.
 */
export async function upsertDocument(
  collectionName: string,
  id: string,
  data: Record<string, any>
): Promise<void> {
  const tableName = getTableName(collectionName);
  const entries = Object.entries(data);
  const columns = ['id', ...entries.map(([key]) => key)];
  const values = [id, ...entries.map(([, val]) => typeof val === 'object' && val !== null ? JSON.stringify(val) : val)];
  const placeholders = columns.map(() => '?').join(', ');
  const updateCols = entries.map(([key]) => key);
  const updateClause = updateCols.length > 0
    ? `DO UPDATE SET ${updateCols.map(c => `${c} = excluded.${c}`).join(', ')}`
    : 'DO NOTHING';

  // Use ON CONFLICT DO UPDATE (not INSERT OR REPLACE): REPLACE deletes the
  // existing row before inserting, which fires ON DELETE CASCADE on FK
  // children (e.g. saving a class would wipe its subclasses).
  const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) ${updateClause}`;

  await queryD1(sql, values);
  const timestamp = new Date().toLocaleTimeString();
  console.info(`%c[D1][${timestamp}] Successfully updated/added document ${id} in ${tableName}`, 'color: #10b981; font-weight: bold;');
}

/**
 * Executes multiple upsert operations in a single batch.
 */
export async function upsertDocumentBatch(collectionName: string, entries: { id: string | null, data: Record<string, any> }[]) {
  if (entries.length === 0) return [];

  const tableName = getTableName(collectionName);
  const sqls: string[] = [];
  const paramsList: any[][] = [];

  for (const { id, data } of entries) {
    const resolvedId = id || crypto.randomUUID();
    const entryData = Object.entries(data);
    const columns = ['id', ...entryData.map(([key]) => key)];
    const values = [resolvedId, ...entryData.map(([, val]) => typeof val === 'object' && val !== null ? JSON.stringify(val) : val)];
    const placeholders = columns.map(() => '?').join(', ');
    const updateCols = entryData.map(([key]) => key);
    const updateClause = updateCols.length > 0
      ? `DO UPDATE SET ${updateCols.map(c => `${c} = excluded.${c}`).join(', ')}`
      : 'DO NOTHING';

    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) ${updateClause}`;
    sqls.push(sql);
    paramsList.push(values);
  }

  return queryD1<any>(sqls, paramsList);
}

/**
 * Delete a document from D1.
 */
export async function deleteDocument(
  collectionName: string,
  id: string
): Promise<void> {
  const tableName = getTableName(collectionName);
  const sql = `DELETE FROM ${tableName} WHERE id = ?`;
  
  await queryD1(sql, [id]);
  const timestamp = new Date().toLocaleTimeString();
  console.info(`%c[D1][${timestamp}] Successfully deleted document ${id} from ${tableName}`, 'color: #ef4444; font-weight: bold;');
}

/**
 * Delete documents from D1 using a custom WHERE clause.
 */
export async function deleteDocuments(
  collectionName: string,
  where: string,
  params: any[] = []
): Promise<void> {
  const tableName = getTableName(collectionName);
  const sql = `DELETE FROM ${tableName} WHERE ${where}`;
  
  await queryD1(sql, params);
  const timestamp = new Date().toLocaleTimeString();
  console.info(`%c[D1][${timestamp}] Successfully deleted from ${tableName} (where: ${where})`, 'color: #ef4444; font-weight: bold;');
}
