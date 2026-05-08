# Phase 3 Migration Details: Wiki & Lore

## Table Definitions

### 1. Base Articles
- **Table**: `lore_articles`
- **Columns**: `id` (PK), `title`, `slug`, `category`, `folder`, `content`, `excerpt`, `parent_id` (FK), `status` (Enum: draft, etc.), `author_id` (FK), `dm_notes`, `image_url`, `image_display` (JSON), `card_image_url`, `card_display` (JSON), `preview_image_url`, `preview_display` (JSON), `created_at`, `updated_at`.
- **Indices**: `idx_lore_category`, `idx_lore_status`, `idx_lore_slug`.

### 2. Category Metadata
- **Table**: `lore_meta_characters`
  - **Columns**: `article_id` (PK/FK), `race`, `age`, `alignment`, `occupation`, `life_status`, `gender`, `pronouns`, `birth_date`, `death_date`.
- **Table**: `lore_meta_locations`
  - **Columns**: `article_id` (PK/FK), `location_type`, `population`, `climate`, `ruler`, `founding_date`, `parent_location`, `owning_organization`.
- **Table**: `lore_meta_organizations`
  - **Columns**: `article_id` (PK/FK), `headquarters`, `leader`, `motto`, `founding_date`.
- **Table**: `lore_meta_deities`
  - **Columns**: `article_id` (PK/FK), `domains`, `holy_symbol`.

### 3. Storyteller Secrets
- **Table**: `lore_secrets`
  - **Columns**: `id` (PK), `article_id` (FK), `content`, `created_at`, `updated_at`.

### 4. Visibility & Relation Junctions
- **Table**: `lore_article_eras`: Junction between articles and eras.
- **Table**: `lore_article_campaigns`: Junction between articles and campaigns.
- **Table**: `lore_secret_eras`: Junction between secrets and eras.
- **Table**: `lore_secret_campaigns`: Junction between secrets and campaigns.
- **Table**: `lore_article_tags`: Junction between articles and tags.
- **Table**: `lore_links`: Junction for article-to-article linking (`article_id`, `target_id`).
