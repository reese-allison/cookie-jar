CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (account holders who can own jars)
-- Compatible with better-auth's user model via field mapping
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- better-auth session table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);

-- better-auth account table (OAuth providers)
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  id_token TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);

-- better-auth verification table
CREATE TABLE verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
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
  is_template BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jars_owner_id ON jars(owner_id);

-- Notes (items inside jars)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) <= 500),
  url TEXT CHECK (url IS NULL OR char_length(url) <= 2000),
  style TEXT NOT NULL DEFAULT 'sticky' CHECK (style IN ('sticky', 'index_card', 'napkin', 'parchment', 'fortune_cookie')),
  state TEXT NOT NULL DEFAULT 'in_jar' CHECK (state IN ('in_jar', 'pulled', 'discarded')),
  author_id UUID REFERENCES users(id),
  pulled_by TEXT,
  pulled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_jar_id ON notes(jar_id);
CREATE INDEX idx_notes_jar_state ON notes(jar_id, state);
CREATE INDEX idx_notes_jar_state_created ON notes(jar_id, state, created_at);
CREATE INDEX idx_notes_author_id ON notes(author_id);
CREATE INDEX idx_notes_pulled_by_user_id ON notes(pulled_by_user_id);

-- Rooms (live sessions around a jar)
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'closed')),
  max_participants INT NOT NULL DEFAULT 20,
  max_viewers INT NOT NULL DEFAULT 50,
  idle_timeout_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_jar_id ON rooms(jar_id);
-- One active (non-closed) room per jar. Without this the app-layer check in
-- POST /api/rooms races against simultaneous creates from the owner and an
-- allowlisted member.
CREATE UNIQUE INDEX idx_rooms_active_per_jar ON rooms(jar_id) WHERE state != 'closed';

-- Pull history (journal of what was pulled, when, by whom)
CREATE TABLE pull_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  pulled_by TEXT NOT NULL,
  pulled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pull_history_jar_id ON pull_history(jar_id);
CREATE INDEX idx_pull_history_jar_pulled_at ON pull_history(jar_id, pulled_at DESC);
CREATE INDEX idx_pull_history_note_id ON pull_history(note_id);
CREATE INDEX idx_pull_history_room_id ON pull_history(room_id);
CREATE INDEX idx_pull_history_pulled_by_user_id ON pull_history(pulled_by_user_id);

-- Non-owners pin a jar to their My Jars list so they can come back to it.
-- Owner's own jars are derived from jars.owner_id, so they aren't in here.
-- The star survives even if the user is later removed from the jar's
-- allowlist — the row just becomes inaccessible when they try to act on it.
CREATE TABLE user_starred_jars (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jar_id UUID NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
  starred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, jar_id)
);

CREATE INDEX idx_user_starred_jars_user_id ON user_starred_jars(user_id);
