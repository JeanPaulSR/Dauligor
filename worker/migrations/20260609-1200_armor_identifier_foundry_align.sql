-- Align armor proficiency identifiers to Foundry's CONFIG.DND5E.armorIds slugs
-- (compact, no hyphens) so weapon/armor item import + export round-trips the
-- base armor correctly. Our WEAPON identifiers are already Foundry-canonical
-- (battleaxe, handcrossbow…); armor was seeded with hyphenated slugs, which
-- failed to match Foundry's `system.type.baseItem` on import AND emitted
-- unrecognized slugs on export. Verified against the real Foundry export
-- (E:/DnD/Professional/Foundry Export/Items) — these 6 were the only mismatches.
--
-- Idempotent: each UPDATE targets only the stale spelling, so re-running (or
-- running against an already-correct environment) is a harmless no-op. The
-- `base_armor_id` FK is by row id, so the rename never breaks existing links;
-- no catalog item currently references these slugs via base_item (checked).

UPDATE armor SET identifier = 'chainmail'  WHERE identifier = 'chain-mail';
UPDATE armor SET identifier = 'chainshirt' WHERE identifier = 'chain-shirt';
UPDATE armor SET identifier = 'halfplate'  WHERE identifier = 'half-plate';
UPDATE armor SET identifier = 'ringmail'   WHERE identifier = 'ring-mail';
UPDATE armor SET identifier = 'scalemail'  WHERE identifier = 'scale-mail';
UPDATE armor SET identifier = 'studded'    WHERE identifier = 'studded-leather';

-- Reconcile the shield armor *category* identifier to Foundry's 'shield'
-- (singular). Remote was reconciled 2026-06-08; this fixes any stale 'shields'
-- (the local DB drifted). No-op where it is already 'shield'.
UPDATE armor_categories SET identifier = 'shield' WHERE identifier = 'shields';
