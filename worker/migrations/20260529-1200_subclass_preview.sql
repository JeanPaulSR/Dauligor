-- Add a short "preview" blurb to subclasses, mirroring classes.preview.
-- Subclasses are a complex editor like classes, so the reference hover card
-- shows this brief preview (falling back to description) rather than the full
-- subclass description. Authored in SubclassEditor alongside description/lore.
ALTER TABLE subclasses ADD COLUMN preview TEXT;
