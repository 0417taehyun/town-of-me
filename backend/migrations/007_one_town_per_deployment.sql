-- A deployment is one town, read and saved without naming it, and a town already stored keeps the id it has. A new
-- database's town takes this default, so two first saves at once collide on the primary key instead of making two towns.
ALTER TABLE towns ALTER COLUMN id SET DEFAULT 'town';
