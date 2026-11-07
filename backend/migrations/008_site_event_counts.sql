-- Anonymous daily totals of what people do inside the town (backend/src/siteStats.ts). A row is only a number: there is
-- deliberately no time, visitor, address, or hash in it, so nothing can link two counts to one person.
CREATE TABLE site_event_counts (
  -- The KST calendar day, as a ranking month's days are counted.
  day date NOT NULL,
  event text NOT NULL CHECK (event ~ '^[a-z][a-z-]{0,31}$'),
  -- A resident's id for the one event that names a resident, otherwise empty, since a key column cannot be null.
  subject text NOT NULL DEFAULT '' CHECK (subject = '' OR subject ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  count integer NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, event, subject)
);
