-- Backfill: convert legacy `lore_secrets` rows into `secret` layout blocks on
-- their article, so the article body is fully block-native (storyteller secrets
-- now live as `secret` blocks, not a side table). Idempotent: skips any article
-- that already has a secret block. Runs BEFORE the schema-drop migration and the
-- block-only code deploy.
--
-- Each secret becomes one `secret` block appended after the article's existing
-- blocks. config matches `serializeLayoutBlock(SecretBlock)`:
--   { body, eraIds: string[], revealedCampaignIds: string[] }
-- json(COALESCE(json_group_array(...), '[]')) yields a real nested JSON array
-- (empty [] when the secret has no era / campaign junctions).

INSERT INTO lore_article_blocks (id, article_id, block_type, "order", config, created_at, updated_at)
SELECT
  'secret-' || s.id,
  s.article_id,
  'secret',
  (SELECT COALESCE(MAX("order"), -1) + 1 FROM lore_article_blocks b WHERE b.article_id = s.article_id),
  json_object(
    'body', COALESCE(s.content, ''),
    'eraIds', json(COALESCE((SELECT json_group_array(era_id) FROM lore_secret_eras e WHERE e.secret_id = s.id), '[]')),
    'revealedCampaignIds', json(COALESCE((SELECT json_group_array(campaign_id) FROM lore_secret_campaigns c WHERE c.secret_id = s.id), '[]'))
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM lore_secrets s
WHERE NOT EXISTS (
  SELECT 1 FROM lore_article_blocks b
  WHERE b.article_id = s.article_id AND b.block_type = 'secret'
);
