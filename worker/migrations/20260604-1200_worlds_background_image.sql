-- Add a background image to worlds — the bottom of the background cascade
-- (campaign → era → world). This replaces the old global wiki fallback that
-- lived in system_metadata key 'wiki_settings'.
--
-- NOTE: SQLite/D1 `ALTER TABLE ADD COLUMN` has no IF NOT EXISTS guard — run
-- this file exactly ONCE per database (local + remote). Re-running errors
-- with "duplicate column name".

ALTER TABLE worlds ADD COLUMN background_image_url TEXT;

-- Carry the existing global default forward onto the default world so the
-- current site background is preserved. Idempotent: only fills when empty,
-- and json_extract simply yields NULL if no wiki_settings row exists.
UPDATE worlds
   SET background_image_url = (
         SELECT json_extract(value, '$.defaultBackgroundImageUrl')
           FROM system_metadata
          WHERE key = 'wiki_settings'
       )
 WHERE is_default = 1
   AND (background_image_url IS NULL OR background_image_url = '');
