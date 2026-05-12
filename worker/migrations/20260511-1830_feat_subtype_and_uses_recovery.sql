-- Migration: Feats — feat_subtype + uses_recovery columns
-- Date: 2026-05-11
--
-- Brings feats closer to dnd5e 5.x's canonical `system.type.{value, subtype}`
-- pair and its `system.uses.recovery[]` array (per
-- E:/DnD/Professional/Foundry-JSON/features/item-feature.json, system v5.3.1).
--
-- Before this migration:
--   feats.feat_type was a single enum slot conflating two concerns —
--   the document `value` (feat / class / subclass / race / background /
--   monster) and the granular `subtype` (general / origin /
--   fightingStyle / epicBoon, or per-class identifier).
--
-- After:
--   feats.feat_type    → `system.type.value`    (broad category)
--   feats.feat_subtype → `system.type.subtype`  (granular tag)
--   feats.uses_recovery → `system.uses.recovery[]` (recovery rules JSON
--                          array; same shape activity uses.recovery has)
--
-- The editor cascades the subtype dropdown on the feat_type value:
--   feat → general / origin / fightingStyle / epicBoon
--   class / subclass / race / background → free-text identifier
--
-- Legacy data normalization: existing rows used the old single-enum
-- shape. The four feat-subtype slugs get promoted into feat_subtype
-- and feat_type rewrites to 'feat'. The 'classFeature' slug rewrites
-- to 'class' (its canonical Foundry document value).

-- New columns
ALTER TABLE feats ADD COLUMN feat_subtype TEXT;
ALTER TABLE feats ADD COLUMN uses_recovery TEXT DEFAULT '[]';

-- Normalize legacy feat_type → canonical value/subtype pair.
-- The two UPDATEs against the same set are intentionally separate so
-- the subtype copy runs before feat_type is overwritten.
UPDATE feats
   SET feat_subtype = feat_type
 WHERE feat_type IN ('general', 'origin', 'fightingStyle', 'epicBoon');

UPDATE feats
   SET feat_type = 'feat'
 WHERE feat_type IN ('general', 'origin', 'fightingStyle', 'epicBoon');

UPDATE feats
   SET feat_type = 'class'
 WHERE feat_type = 'classFeature';
