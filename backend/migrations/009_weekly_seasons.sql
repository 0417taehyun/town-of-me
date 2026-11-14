-- A season is now a KST week, named by its Monday as YYYY-MM-DD (backend/src/town.ts rankingWeek), no longer a month
-- written YYYY-MM. Both sort as text, so nothing that compares seasons changes.

ALTER TABLE minigame_runs DROP CONSTRAINT minigame_runs_season_check;
ALTER TABLE minigame_entries DROP CONSTRAINT minigame_entries_season_check;

-- A month's rows move to the week holding the month's first day. No two months share that week, since first days are
-- at least 28 days apart, so distinct seasons stay distinct and neither the one-record-per-board key
-- (game, season, visitor_hash) nor any other can collide. The one-open-run index does not include the season.
UPDATE minigame_runs
  SET season = to_char(
    (season || '-01')::date - (extract(isodow FROM (season || '-01')::date)::integer - 1), 'YYYY-MM-DD')
  WHERE season ~ '^[0-9]{4}-[0-9]{2}$';
UPDATE minigame_entries
  SET season = to_char(
    (season || '-01')::date - (extract(isodow FROM (season || '-01')::date)::integer - 1), 'YYYY-MM-DD')
  WHERE season ~ '^[0-9]{4}-[0-9]{2}$';

-- A real calendar day, since anything else fails the cast, and a Monday.
ALTER TABLE minigame_runs ADD CONSTRAINT minigame_runs_season_check
  CHECK (season ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND extract(isodow FROM season::date) = 1);
ALTER TABLE minigame_entries ADD CONSTRAINT minigame_entries_season_check
  CHECK (season ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND extract(isodow FROM season::date) = 1);

-- A rule change scheduled by month (venues.ballpark.scheduledRules.fromMonth) has no week it clearly meant, and the
-- town is validated on every read, so a stored one would make the town unreadable. It is dropped: the rules in effect
-- stay, and the admin schedules the change again for a week.
UPDATE towns SET venues = venues #- '{ballpark,scheduledRules}'
  WHERE venues #> '{ballpark,scheduledRules}' ? 'fromMonth';
