-- Up Migration
-- Indexes that were missing from the initial schema. Added to keep delete
-- cascades fast on notes and pull_history.

CREATE INDEX IF NOT EXISTS idx_notes_author_id ON notes(author_id);
CREATE INDEX IF NOT EXISTS idx_pull_history_note_id ON pull_history(note_id);
CREATE INDEX IF NOT EXISTS idx_pull_history_room_id ON pull_history(room_id);

-- Down Migration

DROP INDEX IF EXISTS idx_notes_author_id;
DROP INDEX IF EXISTS idx_pull_history_note_id;
DROP INDEX IF EXISTS idx_pull_history_room_id;
