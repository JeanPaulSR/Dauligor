-- Phase 3: Wiki & Lore

-- Base table for all wiki entries
CREATE TABLE IF NOT EXISTS lore_articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    category TEXT NOT NULL,
    folder TEXT,
    content TEXT,
    excerpt TEXT,
    parent_id TEXT,
    status TEXT DEFAULT 'draft',
    author_id TEXT,
    dm_notes TEXT,
    image_url TEXT,
    image_display JSON,
    card_image_url TEXT,
    card_display JSON,
    preview_image_url TEXT,
    preview_display JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES lore_articles(id) ON DELETE SET NULL,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lore_category ON lore_articles(category);
CREATE INDEX IF NOT EXISTS idx_lore_status ON lore_articles(status);
CREATE INDEX IF NOT EXISTS idx_lore_slug ON lore_articles(slug);

-- Metadata for characters and deities
CREATE TABLE IF NOT EXISTS lore_meta_characters (
    article_id TEXT PRIMARY KEY,
    race TEXT,
    age TEXT,
    alignment TEXT,
    occupation TEXT,
    life_status TEXT,
    gender TEXT,
    pronouns TEXT,
    birth_date TEXT,
    death_date TEXT,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);

-- Metadata for cities, geography, and landmarks
CREATE TABLE IF NOT EXISTS lore_meta_locations (
    article_id TEXT PRIMARY KEY,
    location_type TEXT,
    population TEXT,
    climate TEXT,
    ruler TEXT,
    founding_date TEXT,
    parent_location TEXT,
    owning_organization TEXT,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);

-- Metadata for guilds, factions, and nations
CREATE TABLE IF NOT EXISTS lore_meta_organizations (
    article_id TEXT PRIMARY KEY,
    headquarters TEXT,
    leader TEXT,
    motto TEXT,
    founding_date TEXT,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);

-- Metadata for deities (if separated from characters)
CREATE TABLE IF NOT EXISTS lore_meta_deities (
    article_id TEXT PRIMARY KEY,
    domains TEXT,
    holy_symbol TEXT,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);

-- Storyteller secrets linked to articles
CREATE TABLE IF NOT EXISTS lore_secrets (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);

-- Junction for article visibility (Eras)
CREATE TABLE IF NOT EXISTS lore_article_eras (
    article_id TEXT NOT NULL,
    era_id TEXT NOT NULL,
    PRIMARY KEY (article_id, era_id),
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (era_id) REFERENCES eras(id) ON DELETE CASCADE
);

-- Junction for article visibility (Campaigns)
CREATE TABLE IF NOT EXISTS lore_article_campaigns (
    article_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    PRIMARY KEY (article_id, campaign_id),
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Junction for secret visibility (Eras)
CREATE TABLE IF NOT EXISTS lore_secret_eras (
    secret_id TEXT NOT NULL,
    era_id TEXT NOT NULL,
    PRIMARY KEY (secret_id, era_id),
    FOREIGN KEY (secret_id) REFERENCES lore_secrets(id) ON DELETE CASCADE,
    FOREIGN KEY (era_id) REFERENCES eras(id) ON DELETE CASCADE
);

-- Junction for secret visibility (Campaigns - revealed to)
CREATE TABLE IF NOT EXISTS lore_secret_campaigns (
    secret_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    PRIMARY KEY (secret_id, campaign_id),
    FOREIGN KEY (secret_id) REFERENCES lore_secrets(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Junction for taxonomy (Tags)
CREATE TABLE IF NOT EXISTS lore_article_tags (
    article_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Junction for article-to-article linking
CREATE TABLE IF NOT EXISTS lore_links (
    article_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (article_id, target_id),
    FOREIGN KEY (article_id) REFERENCES lore_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES lore_articles(id) ON DELETE CASCADE
);
