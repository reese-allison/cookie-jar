-- Up Migration
-- Belt for the app-layer isValidUrl check. Without this, any direct DB
-- write (seeds, ops scripts, a future API bug) could persist a
-- `javascript:` / `data:` URL, and PulledNote renders note.url as an <a
-- href=…> that React will not sanitize. The CHECK keeps the attack
-- surface bounded by the API.

ALTER TABLE notes
  ADD CONSTRAINT notes_url_protocol_check
  CHECK (url IS NULL OR url ~* '^https?://');

-- Down Migration

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_url_protocol_check;
