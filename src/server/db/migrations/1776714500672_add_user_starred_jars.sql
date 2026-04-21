-- Up Migration
-- Non-owners can pin a jar so it shows up in their My Jars list. Owner's own
-- jars are derived from jars.owner_id — this table only tracks the pin for
-- users who don't own the jar. Survives an allowlist removal (the row just
-- becomes inaccessible to the user; visible only as a tombstone we can clean
-- up lazily).

CREATE TABLE IF NOT EXISTS user_starred_jars (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  starred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, jar_id)
);

CREATE INDEX IF NOT EXISTS idx_user_starred_jars_user_id ON user_starred_jars(user_id);

-- Down Migration

DROP INDEX IF EXISTS idx_user_starred_jars_user_id;
DROP TABLE IF EXISTS user_starred_jars;
