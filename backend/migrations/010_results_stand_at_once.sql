-- The derby board without its review process (backend/src/leaderboard.ts, leaderboardReview.ts). A result, a listed
-- name, and a link its visitor signed in for all show at once; the admin removes afterwards. Stored rows move to that
-- model as follows.

-- Runs. A run that was held and then accepted is already `scored`, and keeps its flags, which are now only marks. A
-- run that was held and never accepted stays `flagged`: it never counted, and SQL cannot judge whether it would have
-- become its visitor's record, so it is kept as it is, a historical row the admin's list shows with its flags. No new
-- run gets that status, and the code reads it only to show it and to count it as a judged run for reports.
--
-- The profile a held run was sent with (a name and an appearance) was kept only to settle the record on acceptance,
-- and `reviewed_at` only said the run had left the review queue. Neither has a reader now, and the profile is a
-- visitor's name kept for nothing, so both go; the queue's index goes with its column.
DROP INDEX minigame_runs_review_idx;
ALTER TABLE minigame_runs DROP COLUMN profile, DROP COLUMN reviewed_at;
-- The admin's list reads a board's runs newest first, a page at a time.
CREATE INDEX minigame_runs_board_idx ON minigame_runs (game, season, issued_at DESC, id DESC);

-- Records. `review_status` was `pending`, `approved`, or `disqualified`, and only the last still means anything: a
-- record waiting for approval among the first three is public from now on, like an approved one. So the column
-- becomes a yes or no, and the public order's index is rebuilt on it.
ALTER TABLE minigame_entries ADD COLUMN disqualified boolean NOT NULL DEFAULT false;
UPDATE minigame_entries SET disqualified = true WHERE review_status = 'disqualified';
DROP INDEX minigame_entries_board_idx;
ALTER TABLE minigame_entries DROP COLUMN review_status;
CREATE INDEX minigame_entries_board_idx ON minigame_entries (game, season, score DESC, tiebreak DESC, achieved_at, id)
  WHERE listed AND NOT disqualified;

-- Names. One that waited for approval shows now, like an approved one (`shown`); a `rejected` one stays off.
ALTER TABLE minigame_entries DROP CONSTRAINT minigame_entries_name_status_check;
UPDATE minigame_entries SET name_status = 'shown' WHERE name_status IN ('pending', 'approved');
ALTER TABLE minigame_entries ADD CONSTRAINT minigame_entries_name_status_check
  CHECK (name_status IN ('shown', 'rejected'));

-- Links. The ownership code and the admin's confirmation of it give way to the visitor's own LinkedIn sign-in. A link
-- the admin had confirmed stays public (`verified`, with no display name, since nobody signed in for it); one that
-- still waited for its code is `unverified` and stays hidden until its visitor signs in; a `reported` one stays hidden
-- until the admin decides. Dropping the code's column drops the checks that name it.
ALTER TABLE minigame_entries DROP COLUMN linkedin_code;
ALTER TABLE minigame_entries DROP CONSTRAINT minigame_entries_linkedin_status_check;
UPDATE minigame_entries SET linkedin_status = 'verified' WHERE linkedin_status = 'approved';
UPDATE minigame_entries SET linkedin_status = 'unverified' WHERE linkedin_status = 'pending';
ALTER TABLE minigame_entries ADD CONSTRAINT minigame_entries_linkedin_status_check
  CHECK (linkedin_status IN ('unverified', 'verified', 'reported'));
-- The display name of the LinkedIn account that signed in for the link, for the admin to compare with the address.
-- Nothing else of that account is stored: no subject id, email, or picture.
ALTER TABLE minigame_entries
  ADD COLUMN linkedin_verified_name text CHECK (char_length(linkedin_verified_name) BETWEEN 1 AND 100);
ALTER TABLE minigame_entries
  ADD CHECK (linkedin_verified_name IS NULL OR linkedin_profile_url IS NOT NULL);

-- A visitor's started LinkedIn sign-in (backend/src/linkVerification.ts): one use, ten minutes, for one record and the
-- address it had. Apart from oidc_transactions on purpose, so it can never become a user or a session. `id_hash` is
-- the hash of the id the browser's cookie holds.
CREATE TABLE minigame_link_verifications (
  id_hash text PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  visitor_hash text NOT NULL,
  entry_id uuid NOT NULL REFERENCES minigame_entries (id) ON DELETE CASCADE,
  profile_url text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- The admin's list names the records with an open report.
CREATE INDEX minigame_reports_open_idx ON minigame_reports (entry_id) WHERE resolved_at IS NULL;
