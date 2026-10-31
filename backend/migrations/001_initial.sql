CREATE TYPE content_locale AS ENUM ('ko', 'en');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  display_name text NOT NULL,
  email text,
  picture_url text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oidc_transactions (
  id_hash text PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- The admin edits the whole town at once; `revision` lets a save detect that another save happened since loading.
CREATE TABLE towns (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  spawn jsonb NOT NULL CHECK (jsonb_typeof(spawn) = 'object'),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every placeable object, validated by backend/src/town.ts; `properties` holds the type-specific fields.
CREATE TABLE town_objects (
  town_id text NOT NULL REFERENCES towns(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  sort_order integer NOT NULL,
  type text NOT NULL CHECK (
    type IN (
      'house', 'dogHouse', 'tree', 'bench', 'lamp', 'rock', 'flower', 'weed', 'bush', 'mushroom', 'pumpkin',
      'fountain', 'guestbook', 'road', 'bird', 'cloud'
    )
  ),
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  position_z double precision NOT NULL,
  rotation double precision NOT NULL DEFAULT 0,
  scale double precision NOT NULL DEFAULT 1 CHECK (scale > 0),
  color text CHECK (color ~ '^#[0-9a-f]{6}$'),
  properties jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties) = 'object'),
  PRIMARY KEY (town_id, id)
);

-- Residents are registered by the admin; they are not users and never sign in.
CREATE TABLE town_residents (
  town_id text NOT NULL REFERENCES towns(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  sort_order integer NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
  appearance jsonb NOT NULL CHECK (jsonb_typeof(appearance) = 'object'),
  route jsonb NOT NULL CHECK (jsonb_typeof(route) = 'array'),
  bench_object_id text NOT NULL,
  seat_index integer NOT NULL CHECK (seat_index >= 0),
  start_seated boolean NOT NULL DEFAULT false,
  -- How visitors meet the resident: role and relationship in both languages, a canonical LinkedIn profile, and
  -- the dialogue drafted from their reference about the town owner and reviewed by the admin.
  role jsonb CHECK (jsonb_typeof(role) = 'object'),
  relationship jsonb CHECK (jsonb_typeof(relationship) = 'object'),
  linkedin_profile_url text CHECK (linkedin_profile_url ~ '^https://www\.linkedin\.com/in/[A-Za-z0-9_%-]{1,100}$'),
  reference jsonb CHECK (jsonb_typeof(reference) = 'object'),
  dialogue jsonb CHECK (jsonb_typeof(dialogue) = 'object'),
  PRIMARY KEY (town_id, id),
  FOREIGN KEY (town_id, bench_object_id) REFERENCES town_objects (town_id, id)
);

-- Anonymous entries keep the visitor's character as it looked when signing and stay hidden until approved.
-- `visitor_hash` is the hash of a random browser cookie; client addresses are never stored.
CREATE TABLE guestbook_entries (
  id uuid PRIMARY KEY,
  visitor_hash text NOT NULL,
  author_appearance jsonb NOT NULL CHECK (
    jsonb_typeof(author_appearance) = 'object'
    AND char_length(author_appearance ->> 'name') BETWEEN 1 AND 24
  ),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 240),
  locale content_locale NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX guestbook_entries_status_created_idx ON guestbook_entries (status, created_at DESC, id DESC);
CREATE INDEX guestbook_entries_visitor_created_idx ON guestbook_entries (visitor_hash, created_at DESC);
