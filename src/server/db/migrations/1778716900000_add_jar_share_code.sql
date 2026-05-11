-- Up Migration
--
-- Adds jars.share_code, the permanent per-jar URL identifier. Each jar gets
-- exactly one share_code at creation; subsequent room sessions reuse it so a
-- single share-link works forever, regardless of room churn.
--
-- Backfill rules (run in order, inside the same transaction):
--   1. Add the column nullable.
--   2. For each existing jar that has at least one room, copy the *latest*
--      room's code as the jar's share_code. This preserves the most recent
--      bookmarked URL on a best-effort basis. Older historical room codes
--      stop resolving after the contract migration drops rooms.code.
--   3. Attach the UNIQUE constraint. Step (2) is 1:1 with rooms.code, which
--      is already UNIQUE, so this can't fail unless two jars race-share a
--      code — which the partial-unique index on rooms prevents.
--   4. For each jar still NULL (jars that have never had a room), generate
--      a fresh 7-char code from the same alphabet as room codes, retrying
--      on the rare unique-violation. Kept inside SQL so the migration is
--      atomic and doesn't need an out-of-band Node script.
--   5. Flip NOT NULL + attach the format CHECK.

ALTER TABLE jars ADD COLUMN share_code TEXT;

WITH latest_room AS (
  SELECT DISTINCT ON (jar_id) jar_id, code
  FROM rooms
  ORDER BY jar_id, created_at DESC
)
UPDATE jars j
SET share_code = lr.code
FROM latest_room lr
WHERE j.id = lr.jar_id;

ALTER TABLE jars ADD CONSTRAINT jars_share_code_unique UNIQUE (share_code);

DO $$
DECLARE
  jar_record RECORD;
  new_code TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i INT;
  attempts INT;
BEGIN
  FOR jar_record IN SELECT id FROM jars WHERE share_code IS NULL LOOP
    attempts := 0;
    LOOP
      new_code := '';
      FOR i IN 1..7 LOOP
        new_code := new_code || substring(chars FROM (1 + floor(random() * 32))::int FOR 1);
      END LOOP;
      BEGIN
        UPDATE jars SET share_code = new_code WHERE id = jar_record.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 20 THEN
          RAISE EXCEPTION 'Failed to generate unique share_code after 20 attempts for jar %', jar_record.id;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE jars ALTER COLUMN share_code SET NOT NULL;
ALTER TABLE jars
  ADD CONSTRAINT jars_share_code_format_check
  CHECK (share_code ~ '^[A-HJ-NP-Z2-9]{6,7}$');
CREATE INDEX idx_jars_share_code ON jars(share_code);

-- Down Migration

DROP INDEX IF EXISTS idx_jars_share_code;
ALTER TABLE jars DROP CONSTRAINT IF EXISTS jars_share_code_format_check;
ALTER TABLE jars DROP CONSTRAINT IF EXISTS jars_share_code_unique;
ALTER TABLE jars DROP COLUMN IF EXISTS share_code;
