-- Phase 4f: Scaling Columns
-- Description: Table for class and subclass scaling columns (e.g. Sneak Attack, Ki Points).

CREATE TABLE IF NOT EXISTS scaling_columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT NOT NULL, -- ID of the class or subclass
    parent_type TEXT NOT NULL, -- 'class' or 'subclass'
    "values" TEXT NOT NULL DEFAULT '{}', -- JSON object mapping level (string) to value
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scaling_columns_parent ON scaling_columns(parent_id, parent_type);
