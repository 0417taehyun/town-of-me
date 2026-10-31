-- Large venues at the town's edge (the ballpark first), validated by backend/src/town.ts when saved and when read, so
-- '{}' reads as the defaults and a new venue needs no migration.
ALTER TABLE towns
  ADD COLUMN venues jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(venues) = 'object');
