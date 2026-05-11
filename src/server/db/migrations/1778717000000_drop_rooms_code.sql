-- Up Migration
--
-- Contract step for the share-code rollout: `rooms.code` is no longer used
-- for URLs. The jar's permanent `share_code` is the URL identifier now, and
-- room rows are internally identified by their UUID `id`. The column, its
-- UNIQUE constraint, its format CHECK, and its index can all go.
--
-- This is genuinely destructive — codes are gone after this runs and the
-- rollback (Down section below) restores only the column shape, not the
-- data. Deploy with ALLOW_DESTRUCTIVE_MIGRATION=1 for the release that
-- ships this.
--
-- (Don't use the phrase "down migration" anywhere in this file except as
--  the section marker on its own line — node-pg-migrate's parser uses a
--  loose regex that'll happily match it mid-comment and chop the Up
--  section short. That's how this file silently no-op'd in dev + prod
--  before it was caught.)
--
-- Pre-flight: the application code in this same release no longer reads or
-- writes rooms.code. Old `/<roomCode>` bookmarks stop resolving at this
-- point; they were a best-effort transition aid during expand and are not
-- supported once contract lands.

ALTER TABLE rooms DROP COLUMN IF EXISTS code;

-- Down Migration
--
-- Restores the column shape so the schema isn't permanently divergent, but
-- the data is unrecoverable — there's no source of truth for what a given
-- room's code was once we drop the column. If a rollback is needed, expect
-- to have to backfill codes manually (or regenerate them and break every
-- outstanding share link).

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS code TEXT;
