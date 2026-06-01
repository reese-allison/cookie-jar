-- Up Migration
--
-- `listTemplates` runs `SELECT * FROM jars WHERE is_template = true ORDER BY
-- name` on every landing-page template fetch. Without an index that's a seq
-- scan + sort over the whole jars table. A partial index keyed on `name` and
-- restricted to template rows is tiny (only templates are indexed) and serves
-- both the filter and the ORDER BY as an index walk.
--
-- Additive and safe to ship alongside the app code — pure index creation, no
-- destructive change.

CREATE INDEX IF NOT EXISTS idx_jars_templates ON jars (name) WHERE is_template;

-- Down Migration

DROP INDEX IF EXISTS idx_jars_templates;
