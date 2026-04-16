CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (account holders who can own jars)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jars (persistent note collections)
CREATE TABLE jars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  appearance JSONB NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jars_owner_id ON jars(owner_id);

-- Notes (items inside jars)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) <= 500),
  url TEXT,
  style TEXT NOT NULL DEFAULT 'sticky',
  state TEXT NOT NULL DEFAULT 'in_jar' CHECK (state IN ('in_jar', 'pulled', 'discarded')),
  author_id UUID REFERENCES users(id),
  pulled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_jar_id ON notes(jar_id);
CREATE INDEX idx_notes_jar_state ON notes(jar_id, state);

-- Rooms (live sessions around a jar)
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'closed')),
  max_participants INT NOT NULL DEFAULT 10,
  max_viewers INT NOT NULL DEFAULT 20,
  idle_timeout_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_jar_id ON rooms(jar_id);

-- Pull history (journal of what was pulled, when, by whom)
CREATE TABLE pull_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  pulled_by TEXT NOT NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pull_history_jar_id ON pull_history(jar_id);
