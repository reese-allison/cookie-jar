-- Up Migration
-- Belt-and-suspenders: app-layer validation catches these, but a direct DB
-- write (seeds, ops scripts) should fail closed too.

ALTER TABLE notes
  ADD CONSTRAINT notes_url_length_check
  CHECK (url IS NULL OR char_length(url) <= 2000);

ALTER TABLE notes
  ADD CONSTRAINT notes_style_check
  CHECK (style IN ('sticky', 'index_card', 'napkin', 'parchment', 'fortune_cookie'));

-- Clean up any pre-existing rooms whose codes predate this constraint before
-- adding it — demo/seed rows with letters O/I/0/1 would otherwise fail the
-- ALTER. Safe in practice: every legit code is generated from ROOM_CODE_CHARS
-- which already matches the regex.
DELETE FROM rooms WHERE code !~ '^[A-HJ-NP-Z2-9]{6}$';

ALTER TABLE rooms
  ADD CONSTRAINT rooms_code_format_check
  CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$');

-- Covers listNotesByJar(jarId, state) ORDER BY created_at without forcing a
-- re-sort. The existing idx_notes_jar_state stays for plain count queries.
CREATE INDEX IF NOT EXISTS idx_notes_jar_state_created
  ON notes (jar_id, state, created_at);

-- Down Migration

DROP INDEX IF EXISTS idx_notes_jar_state_created;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_code_format_check;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_style_check;
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_url_length_check;
