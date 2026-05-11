-- Up Migration
--
-- Bump room codes from 6 to 7 characters. New codes are generated at 7 chars
-- by `generateRoomCode()`; 6-char codes survive on legacy rows because
-- closed rooms are kept indefinitely as permanent identifiers for stale
-- share-links that pivot to the underlying jar.
--
-- 32^6 ≈ 1.07B codes → birthday-paradox collisions become noticeable
-- around 1M rows. 32^7 ≈ 34B pushes that horizon out two orders of
-- magnitude, which matters because we never reclaim closed-room codes for
-- jars that are still alive.
--
-- The destructive-migration scanner (scripts/check-migrations-safe.mjs)
-- will flag the DROP CONSTRAINT lines as a false positive — they're
-- semantically expand-only (the new regex `{6,7}` is a strict superset of
-- the old `{6}`, so no existing row can fail). Deploy with
-- ALLOW_DESTRUCTIVE_MIGRATION=1 for this one release.
--
-- Both the inline column-level CHECK from schema.sql (Postgres auto-names
-- it `rooms_code_check`) and the named constraint added by
-- 1776654813000_tighten_constraints.sql have to be replaced.

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_code_format_check;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_code_check;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_code_format_check
  CHECK (code ~ '^[A-HJ-NP-Z2-9]{6,7}$');

-- Down Migration

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_code_format_check;

-- Reverting the regex would reject any 7-char code already minted under the
-- new constraint, so the down-migration only restores the strict regex if
-- no 7-char rows exist. This matches the project's "down migrations are
-- best-effort, expect to roll forward" stance.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rooms WHERE char_length(code) = 7) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_code_format_check
      CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$');
  ELSE
    RAISE NOTICE 'Skipping strict 6-char CHECK — 7-char codes already exist';
  END IF;
END $$;
