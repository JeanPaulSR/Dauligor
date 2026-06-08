-- Migration: items.chat_description column
-- Date: 2026-06-07
--
-- Adds storage for Foundry's `system.description.chat` — the "Chat
-- Description" rich-text block shown on every item's Description tab
-- (Description / Unidentified Description / Chat Description). This is
-- DISTINCT from `system.chatFlavor`, which we already store as
-- `chat_flavor` (a tool-only one-liner, migration 20260526-1700).
--
-- Before this column the editor's third description block had nowhere to
-- persist and the export hardcoded `description.chat: ""`, so chat
-- descriptions never round-tripped.
--
-- TEXT, nullable. Authored as BBCode in-app; HTML-ized on Foundry export
-- (see api/_lib/_itemExport.ts). Empty/NULL = no chat description.

ALTER TABLE items ADD COLUMN chat_description TEXT;
