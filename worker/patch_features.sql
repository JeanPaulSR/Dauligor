UPDATE features SET source_id = (SELECT source_id FROM classes WHERE classes.id = features.parent_id) WHERE source_id IS NULL AND parent_type = 'class';
UPDATE features SET source_id = (SELECT source_id FROM subclasses WHERE subclasses.id = features.parent_id) WHERE source_id IS NULL AND parent_type = 'subclass';
