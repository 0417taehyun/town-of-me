-- Ranked runs the server started, validated by backend/src/homeRunDerby.ts and leaderboard.ts. The server picks the
-- seed and takes the rules in effect for the KST month the run was issued in (its season), and accepts one result.
-- `visitor_hash` is the hash of the anonymous visitor cookie; client addresses are never stored.
CREATE TABLE minigame_runs (
  id uuid PRIMARY KEY,
  game text NOT NULL CHECK (game ~ '^[a-z][a-z0-9-]{0,31}$'),
  season text NOT NULL CHECK (season ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  visitor_hash text NOT NULL,
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  status text NOT NULL CHECK (status IN ('issued', 'abandoned', 'scored', 'flagged', 'rejected')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  -- The practice numbers and four numbers per pitch; never pose keypoints, traces, or video.
  input_log jsonb CHECK (jsonb_typeof(input_log) = 'object'),
  result jsonb CHECK (jsonb_typeof(result) = 'object'),
  score integer CHECK (score >= 0),
  tiebreak integer CHECK (tiebreak >= 0),
  flags text[] NOT NULL DEFAULT '{}',
  CHECK ((status IN ('issued', 'abandoned')) = (submitted_at IS NULL))
);
-- At most one open run per visitor and game; issuing a new run abandons the open one in the same transaction.
CREATE UNIQUE INDEX minigame_runs_one_open_idx ON minigame_runs (game, visitor_hash) WHERE status = 'issued';

-- One row per visitor and board (a game and a season): the visitor's best scored run and how it is shown. A held run
-- never changes it. Records are kept with no end date.
CREATE TABLE minigame_entries (
  id uuid PRIMARY KEY,
  game text NOT NULL CHECK (game ~ '^[a-z][a-z0-9-]{0,31}$'),
  season text NOT NULL CHECK (season ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  visitor_hash text NOT NULL,
  best_run_id uuid REFERENCES minigame_runs (id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score >= 0),
  tiebreak integer NOT NULL CHECK (tiebreak >= 0),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  achieved_at timestamptz NOT NULL,
  -- An unlisted record keeps no name.
  author_name text CHECK (char_length(author_name) BETWEEN 1 AND 24),
  name_status text CHECK (name_status IN ('pending', 'approved', 'rejected')),
  author_appearance jsonb NOT NULL CHECK (jsonb_typeof(author_appearance) = 'object'),
  listed boolean NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('pending', 'approved', 'disqualified')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (game, season, visitor_hash),
  CHECK ((author_name IS NULL) = (name_status IS NULL)),
  CHECK (listed OR author_name IS NULL)
);
-- The public order; its first three are the statues, so there is no statue table.
CREATE INDEX minigame_entries_board_idx ON minigame_entries (game, season, score DESC, tiebreak DESC, achieved_at, id)
  WHERE listed AND review_status <> 'disqualified';
CREATE INDEX minigame_entries_visitor_idx ON minigame_entries (game, visitor_hash, season DESC);
