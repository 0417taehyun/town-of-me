-- The admin's review of the monthly boards (backend/src/leaderboardReview.ts) and what a record's visitor controls:
-- held runs, an optional LinkedIn link, the public portrait, takedowns, and reports. Nothing here expires.

-- A held run keeps the profile it was sent with, so accepting it settles the record as if it had scored at once.
-- `reviewed_at` takes a held run off the review queue, whether it was accepted or not.
ALTER TABLE minigame_runs
  ADD COLUMN profile jsonb CHECK (jsonb_typeof(profile) = 'object'),
  ADD COLUMN reviewed_at timestamptz;
CREATE INDEX minigame_runs_review_idx ON minigame_runs (game, season) WHERE status = 'flagged' AND reviewed_at IS NULL;
CREATE INDEX minigame_runs_visitor_idx ON minigame_runs (game, visitor_hash);

ALTER TABLE minigame_entries
  -- false shows the default batter instead of the appearance: the admin hid it, a report did, or a takedown.
  ADD COLUMN appearance_public boolean NOT NULL DEFAULT true,
  -- Present only while the visitor keeps it on a listed record, in any season; deleted when they turn it off. The id is
  -- decoded and checked in code, then stored percent-encoded (100 code points of up to 4 bytes, hence the length).
  ADD COLUMN linkedin_profile_url text CHECK (
    char_length(linkedin_profile_url) <= 1230
    AND linkedin_profile_url ~ '^https://www\.linkedin\.com/in/([A-Za-z0-9-]|%[0-9A-F]{2})+$'
  ),
  ADD COLUMN linkedin_status text CHECK (linkedin_status IN ('pending', 'approved', 'reported')),
  -- The ownership code the visitor puts on the profile for the admin to see.
  ADD COLUMN linkedin_code text CHECK (linkedin_code ~ '^TOM-[0-9A-HJKMNP-TV-Z]{4}$'),
  -- Anonymised on a takedown request: on this board the record never shows a name, a link, or its appearance again.
  ADD COLUMN takedown boolean NOT NULL DEFAULT false,
  ADD CHECK ((linkedin_profile_url IS NULL) = (linkedin_status IS NULL)),
  ADD CHECK ((linkedin_profile_url IS NULL) = (linkedin_code IS NULL)),
  ADD CHECK (listed OR linkedin_profile_url IS NULL),
  ADD CHECK (NOT takedown OR (author_name IS NULL AND linkedin_profile_url IS NULL AND NOT appearance_public));

-- Reports keep no reporter: neither the visitor hash nor the address.
CREATE TABLE minigame_reports (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES minigame_entries (id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('name', 'character', 'link')),
  reason text NOT NULL CHECK (reason IN ('mine', 'other')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution text CHECK (resolution IN ('kept', 'removed')),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
  CHECK (reason = 'other' OR target = 'link')
);
CREATE INDEX minigame_reports_entry_idx ON minigame_reports (entry_id, target);

-- LinkedIn profiles a takedown blocked, by the hash of their id: no record links them again.
CREATE TABLE minigame_link_blocks (
  profile_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL
);
