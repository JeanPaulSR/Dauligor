import { batchQueryD1, deleteDocument, queryD1 } from "./d1";

/**
 * Robust upsert for Lore Articles, handling all metadata sub-tables and junctions.
 */
export async function upsertLoreArticle(id: string, payload: any, dmNotes: string) {
  const queries: { sql: string, params?: any[] }[] = [];

  // 1. Lore Article Base
  const articleColumns = [
    'id', 'title', 'slug', 'category', 'folder', 'content', 'excerpt', 
    'parent_id', 'status', 'author_id', 'dm_notes', 'image_url', 
    'image_display', 'card_image_url', 'card_display', 
    'preview_image_url', 'preview_display', 'updated_at'
  ];
  
  // Create slug if missing
  const slug = payload.slug || payload.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'lore-article';

  const articleValues = [
    id, payload.title, slug, payload.category, payload.folder || null, 
    payload.content, payload.excerpt || null, payload.parentId || null, 
    payload.status || 'draft', payload.authorId, dmNotes, 
    payload.imageUrl || null, 
    typeof payload.imageDisplay === 'object' ? JSON.stringify(payload.imageDisplay) : payload.imageDisplay,
    payload.cardImageUrl || null, 
    typeof payload.cardDisplay === 'object' ? JSON.stringify(payload.cardDisplay) : payload.cardDisplay,
    payload.previewImageUrl || null, 
    typeof payload.previewDisplay === 'object' ? JSON.stringify(payload.previewDisplay) : payload.previewDisplay,
    payload.updatedAt || new Date().toISOString()
  ];

  // If new, add created_at
  if (!payload.createdAt) {
    articleColumns.push('created_at');
    articleValues.push(payload.updatedAt || new Date().toISOString());
  } else {
    articleColumns.push('created_at');
    articleValues.push(payload.createdAt);
  }

  const placeholders = articleColumns.map(() => '?').join(', ');
  // ON CONFLICT DO UPDATE: avoids INSERT OR REPLACE's DELETE+INSERT, which
  // would fire ON DELETE CASCADE on lore_meta_*, lore_article_eras, etc.
  // before this batch's explicit DELETE+re-INSERT runs.
  const updateCols = articleColumns.filter(c => c !== 'id');
  const updateClause = updateCols.map(c => `${c} = excluded.${c}`).join(', ');
  queries.push({
    sql: `INSERT INTO lore_articles (${articleColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
    params: articleValues
  });

  // 2. Metadata (Clean up old then insert new to ensure synchronization)
  const meta = payload.metadata || {};
  
  // Always clear all possible metadata tables to avoid ghost data if category changes
  queries.push({ sql: `DELETE FROM lore_meta_characters WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_meta_locations WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_meta_organizations WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_meta_deities WHERE article_id = ?`, params: [id] });

  if (['character', 'deity'].includes(payload.category)) {
    queries.push({
      sql: `INSERT INTO lore_meta_characters (article_id, race, age, alignment, occupation, life_status, gender, pronouns, birth_date, death_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, meta.race, meta.age, meta.alignment, meta.occupation, meta.lifeStatus, meta.gender, meta.pronouns, meta.birthDate, meta.deathDate]
    });
    if (payload.category === 'deity') {
      queries.push({
        sql: `INSERT INTO lore_meta_deities (article_id, domains, holy_symbol) VALUES (?, ?, ?)`,
        params: [id, meta.domains, meta.holySymbol]
      });
    }
  } else if (['building', 'settlement', 'geography', 'country'].includes(payload.category)) {
    queries.push({
      sql: `INSERT INTO lore_meta_locations (article_id, location_type, population, climate, ruler, founding_date, parent_location, owning_organization) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, meta.locationType, meta.population, meta.climate, meta.ruler, meta.foundingDate, meta.parentLocation, meta.owningOrganization]
    });
  } else if (['organization', 'religion'].includes(payload.category)) {
    queries.push({
      sql: `INSERT INTO lore_meta_organizations (article_id, headquarters, leader, motto, founding_date) VALUES (?, ?, ?, ?, ?)`,
      params: [id, meta.headquarters, meta.leader, meta.motto, meta.foundingDate]
    });
    if (payload.category === 'religion') {
      queries.push({
        sql: `INSERT INTO lore_meta_deities (article_id, domains, holy_symbol) VALUES (?, ?, ?)`,
        params: [id, meta.domains, meta.holySymbol]
      });
    }
  }

  // 3. Junctions (Eras, Campaigns, Tags, Links)
  queries.push({ sql: `DELETE FROM lore_article_eras WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_article_campaigns WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_article_tags WHERE article_id = ?`, params: [id] });
  queries.push({ sql: `DELETE FROM lore_links WHERE article_id = ?`, params: [id] });

  (payload.visibilityEraIds || []).forEach((eraId: string) => {
    queries.push({ sql: `INSERT INTO lore_article_eras (article_id, era_id) VALUES (?, ?)`, params: [id, eraId] });
  });
  (payload.visibilityCampaignIds || []).forEach((campId: string) => {
    queries.push({ sql: `INSERT INTO lore_article_campaigns (article_id, campaign_id) VALUES (?, ?)`, params: [id, campId] });
  });
  (payload.tags || []).forEach((tagId: string) => {
    queries.push({ sql: `INSERT INTO lore_article_tags (article_id, tag_id) VALUES (?, ?)`, params: [id, tagId] });
  });
  (payload.linkedArticleIds || []).forEach((targetId: string) => {
    queries.push({ sql: `INSERT INTO lore_links (article_id, target_id) VALUES (?, ?)`, params: [id, targetId] });
  });

  return await batchQueryD1(queries);
}

/**
 * Handle secret upsert with visibility junctions.
 */
export async function upsertLoreSecret(articleId: string, secretId: string, data: any) {
  const queries: { sql: string, params?: any[] }[] = [];
  
  queries.push({
    sql: `INSERT INTO lore_secrets (id, article_id, content, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET article_id = excluded.article_id, content = excluded.content, updated_at = excluded.updated_at`,
    params: [secretId, articleId, data.content, data.updatedAt || new Date().toISOString()]
  });
  
  queries.push({ sql: `DELETE FROM lore_secret_eras WHERE secret_id = ?`, params: [secretId] });
  queries.push({ sql: `DELETE FROM lore_secret_campaigns WHERE secret_id = ?`, params: [secretId] });
  
  (data.eraIds || []).forEach((eraId: string) => {
    queries.push({ sql: `INSERT INTO lore_secret_eras (secret_id, era_id) VALUES (?, ?)`, params: [secretId, eraId] });
  });
  (data.revealedCampaignIds || []).forEach((campId: string) => {
    queries.push({ sql: `INSERT INTO lore_secret_campaigns (secret_id, campaign_id) VALUES (?, ?)`, params: [secretId, campId] });
  });
  
  return await batchQueryD1(queries);
}

/**
 * Fetch a complete Lore Article with all metadata, tags, and junctions.
 */
export async function fetchLoreArticle(id: string) {
  const { fetchDocument, queryD1 } = await import("./d1");
  const articleData = await fetchDocument<any>('lore', id);
  if (!articleData) return null;

  // Normalize
  const normalized = {
    ...articleData,
    parentId: articleData.parent_id,
    dmNotes: articleData.dm_notes,
    imageUrl: articleData.image_url,
    imageDisplay: typeof articleData.image_display === 'string' ? JSON.parse(articleData.image_display) : articleData.image_display,
    cardImageUrl: articleData.card_image_url,
    cardDisplay: typeof articleData.card_display === 'string' ? JSON.parse(articleData.card_display) : articleData.card_display,
    previewImageUrl: articleData.preview_image_url,
    previewDisplay: typeof articleData.preview_display === 'string' ? JSON.parse(articleData.preview_display) : articleData.preview_display,
    createdAt: articleData.created_at,
    updatedAt: articleData.updated_at,
    authorId: articleData.author_id,
  };

  // Metadata
  let metadata: any = {};
  if (['character', 'deity'].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_characters WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, lifeStatus: m.life_status, birthDate: m.birth_date, deathDate: m.death_date };
    }
    if (normalized.category === 'deity') {
      const dRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: dRows[0].holy_symbol };
    }
  } else if (['building', 'settlement', 'geography', 'country'].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_locations WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, locationType: m.location_type, parentLocation: m.parent_location, owningOrganization: m.owning_organization, foundingDate: m.founding_date };
    }
  } else if (['organization', 'religion'].includes(normalized.category)) {
    const rows = await queryD1<any>(`SELECT * FROM lore_meta_organizations WHERE article_id = ?`, [id]);
    if (rows.length > 0) {
      const m = rows[0];
      metadata = { ...metadata, ...m, foundingDate: m.founding_date };
    }
    if (normalized.category === 'religion') {
      const dRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
      if (dRows.length > 0) metadata = { ...metadata, ...dRows[0], holySymbol: dRows[0].holy_symbol };
    }
  }

  // Tags & Visibility
  const tagRows = await queryD1<any>(`SELECT tag_id FROM lore_article_tags WHERE article_id = ?`, [id]);
  const eraRows = await queryD1<any>(`SELECT era_id FROM lore_article_eras WHERE article_id = ?`, [id]);
  const campRows = await queryD1<any>(`SELECT campaign_id FROM lore_article_campaigns WHERE article_id = ?`, [id]);

  return {
    ...normalized,
    metadata,
    tags: tagRows.map(r => r.tag_id),
    visibilityEraIds: eraRows.map(r => r.era_id),
    visibilityCampaignIds: campRows.map(r => r.campaign_id),
  };
}

/**
 * Fetch all secrets for a lore article with their visibility links.
 */
export async function fetchLoreSecrets(articleId: string) {
  const { queryD1 } = await import("./d1");
  const rows = await queryD1<any>(`
    SELECT s.*, 
           (SELECT GROUP_CONCAT(era_id) FROM lore_secret_eras WHERE secret_id = s.id) as era_ids,
           (SELECT GROUP_CONCAT(campaign_id) FROM lore_secret_campaigns WHERE secret_id = s.id) as revealed_campaign_ids
    FROM lore_secrets s 
    WHERE s.article_id = ?
  `, [articleId]);
  
  return rows.map(s => ({
    ...s,
    eraIds: s.era_ids ? s.era_ids.split(',') : [],
    revealedCampaignIds: s.revealed_campaign_ids ? s.revealed_campaign_ids.split(',') : [],
    createdAt: s.created_at,
    updatedAt: s.updated_at
  }));
}

/**
 * Delete a lore secret.
 */
export async function deleteLoreSecret(secretId: string) {
    return await deleteDocument('loreSecrets', secretId);
}

/**
 * Delete a lore article and all its related metadata/junctions (via CASCADE).
 */
export async function deleteLoreArticle(articleId: string) {
  return await deleteDocument('lore', articleId);
}
