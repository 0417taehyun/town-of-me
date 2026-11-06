-- The frontend owns the catalog of object kinds, so the database checks only the identifier shape that
-- backend/src/town.ts accepts.
ALTER TABLE town_objects DROP CONSTRAINT town_objects_type_check;
ALTER TABLE town_objects ADD CONSTRAINT town_objects_type_check CHECK (type ~ '^[a-z][A-Za-z0-9]{0,31}$');

-- The owner and the pet are named per town instead of in the code; existing towns get neutral names to edit.
ALTER TABLE towns
  ADD COLUMN owner jsonb NOT NULL DEFAULT '{"name":{"ko":"마을 주인","en":"Town owner"}}'
    CHECK (jsonb_typeof(owner) = 'object'),
  ADD COLUMN pet jsonb NOT NULL DEFAULT '{"name":{"ko":"토토","en":"Toto"}}'
    CHECK (jsonb_typeof(pet) = 'object');

-- Verified LinkedIn emails that sign in as admin, edited at /admin. ADMIN_EMAILS fills it only while it is empty.
CREATE TABLE admin_emails (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  created_at timestamptz NOT NULL DEFAULT now()
);
