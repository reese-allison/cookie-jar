-- Up Migration
-- Enforce "one active (non-closed) room per jar" at the DB level. A race
-- between two simultaneous POST /api/rooms calls could otherwise split-brain
-- the jar into two parallel sessions — the route's "list active → none →
-- insert" check isn't transactional. The partial unique index fails the
-- second insert and the route retries with the winning row.

-- Close any pre-existing duplicates so the index can attach. Keep the newest
-- row per jar (created_at then id as a deterministic tie-breaker) and close
-- the rest. Safe: rooms now auto-close on last-leave, so live duplicates
-- should be rare; this mops up pre-fix zombies.
UPDATE rooms r1 SET state = 'closed', closed_at = now()
WHERE state != 'closed'
  AND EXISTS (
    SELECT 1 FROM rooms r2
    WHERE r2.jar_id = r1.jar_id
      AND r2.state != 'closed'
      AND (r2.created_at, r2.id) > (r1.created_at, r1.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_active_per_jar
  ON rooms(jar_id) WHERE state != 'closed';

-- Down Migration

DROP INDEX IF EXISTS idx_rooms_active_per_jar;
