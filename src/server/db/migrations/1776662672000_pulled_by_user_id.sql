-- Up Migration
-- Pulls currently identify "who pulled this" by display name string. That
-- collides when two users share a name or one rejoins under a different id
-- with the same name — private-mode history filtering and pull counts both
-- attribute the wrong notes. Add the user id alongside so authed pulls
-- disambiguate. The display-name column stays — anonymous sessions don't
-- have a user id, and we keep the name for display purposes either way.

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS pulled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE pull_history
  ADD COLUMN IF NOT EXISTS pulled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_pulled_by_user_id ON notes(pulled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pull_history_pulled_by_user_id ON pull_history(pulled_by_user_id);

-- Down Migration

DROP INDEX IF EXISTS idx_pull_history_pulled_by_user_id;
DROP INDEX IF EXISTS idx_notes_pulled_by_user_id;
ALTER TABLE pull_history DROP COLUMN IF EXISTS pulled_by_user_id;
ALTER TABLE notes DROP COLUMN IF EXISTS pulled_by_user_id;
