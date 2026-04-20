-- Up Migration
-- pullHistory.getHistory filters by jar_id and orders by pulled_at DESC. The
-- per-column index on jar_id alone forces a re-sort — the composite lets
-- Postgres walk the index in already-sorted order for LIMIT'd queries.

CREATE INDEX IF NOT EXISTS idx_pull_history_jar_pulled_at
  ON pull_history (jar_id, pulled_at DESC);

-- Down Migration

DROP INDEX IF EXISTS idx_pull_history_jar_pulled_at;
