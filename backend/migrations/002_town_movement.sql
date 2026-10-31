-- How every character walks and stops in the town, validated by backend/src/town.ts; existing towns keep the
-- original walk.
ALTER TABLE towns
  ADD COLUMN movement jsonb NOT NULL DEFAULT '{"gait": "plantedFeet", "skid": "long"}'
    CHECK (jsonb_typeof(movement) = 'object');
