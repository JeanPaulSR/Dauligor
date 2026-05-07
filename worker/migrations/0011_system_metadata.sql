-- Migration: Create system_metadata table
CREATE TABLE IF NOT EXISTS system_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initialize foundation update tracker
INSERT OR IGNORE INTO system_metadata (key, value) VALUES ('last_foundation_update', CURRENT_TIMESTAMP);
