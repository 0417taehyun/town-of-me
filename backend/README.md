# Town of Me Backend

Implementation-ready TypeScript foundation for the portfolio town. It uses Web-standard `Request`/`Response` instead of committing to an HTTP framework. PostgreSQL is the production source of truth; `MemoryStore` exists only for local tests and a zero-provider prototype.

## v1 decisions

- LinkedIn is **OIDC login only**, requesting `openid profile email`. It supplies a stable subject, display name, optional email, and optional picture. It does not supply work experience, About, or connection data, and this project never scrapes them.
- Only the admin signs in; visitors stay anonymous, and their characters live in the frontend's tab storage. Character appearances on residents and guestbook entries use the frontend `PlayerProfile` field names: the backend validates field names, option shape, and `#rrggbb` colors, and the frontend owns the exact option catalog and normalizes unknown options. LinkedIn links on houses and residents accept any https `linkedin.com/in/<id>` link and are stored as `https://www.linkedin.com/in/<id>`; other links are rejected. Admins are the verified emails in the `admin_emails` table, edited at `/admin`: every sign-in sets the role to `admin` for a listed verified email and `member` otherwise, and removing an email demotes its users and ends their sessions at once. `ADMIN_EMAILS` only fills that table while it is empty (the first start), so later changes to it are ignored. `FRONTEND_URL` (default `http://localhost:5173/admin`, because only the admin signs in) must be on one of `ALLOWED_ORIGINS`.
- The town is curated by admins, not by visitors, and everything personal lives in the database rather than the code; see [Town layout](#town-layout).
- Drafting prompts must not infer sensitive traits such as health, ethnicity, religion, politics, sexuality, or biometrics, and nothing an LLM writes reaches visitors before the admin reviews it.
- Soft deletion immediately invalidates sessions; a production erasure worker must then delete/cascade personal content according to the retention policy.

## Town layout

A town is one layout: an `owner` and a `pet` (each named `{ ko, en }`, one line of 1–24 characters per language), a
`movement` setting, `venues`, objects, and residents. All of it is public, and saves replace the whole layout in one
transaction.

- **Owner and pet:** besides `name`, each has optional fields, and an omitted one reads as `null` (`[]` for
  `owner.questions`):
  - `owner.introduction`: `{ ko, en }` text of 1–600 characters each, with a reference's rules (line breaks kept, no
    other control characters), shown before the character creator and as the owner's answer to "Who are you?"; `null`
    skips that step.
  - `owner.contactEmail`: stored trimmed and lowercase, with the admin list's shape (at most 254 characters,
    `name@example.com`); anything else returns `400`. `null` hides the contact button, which opens a `mailto:` link.
  - `owner.residentId`: the resident who is the owner, so visitors can talk to them. It must name a resident in the
    same layout, like a resident's bench, or the save returns `400`; `null` means no resident is the owner. That
    resident, like every resident, needs no `reference` or `dialogue`.
  - `owner.questions`: up to five `{ question, answer }` pairs the owner wrote for visitors, with a dialogue
    follow-up's rules (each `{ ko, en }`; a question is one line of 1–80 characters, an answer 1–400 characters with
    line breaks kept).
  - `pet.route`: a closed walking loop of 3–32 `[x, z]` points within the ground bounds resident routes use (±52);
    `null` walks the frontend's default loop around the fountain, so it follows the fountain when it moves.

- **Objects** have an id, a `type`, a position within ±120 horizontally and −1 to 40 high, a rotation, a scale, an
  optional `#rrggbb` color, and an optional `variant`. The frontend owns the catalog of kinds and variants and drops what
  it cannot draw, so the backend checks only their shape: a `type` matches `^[a-z][A-Za-z0-9]{0,31}$` and a `variant`
  matches `^[a-z][A-Za-z0-9-]{0,31}$`.
- **Structural rules** the backend relies on: exactly one `fountain` and one `guestbook`; bench `seats`; road `points`
  (relative to its position) and `width`; house `ownerName`, `description`, and a canonical `linkedInProfileUrl`. Other
  fields are dropped.
- **Residents** are not users. They have a name, the character appearance fields, a walking route, a bench that must
  exist, the route index where they stop at it, and optionally a `role` and `relationship` with the owner (one line each
  in Korean and English), a canonical `linkedInProfileUrl`, a `reference` about the owner in both languages, and a
  `dialogue`: `aboutOwner` plus up to three `followUps` of `{ question, answer }`, each `{ ko, en }`. The dialogue is
  drafted from the reference ahead of time and reviewed before saving, so a conversation never waits for an LLM.
- **Movement:** `movement.gait` and `movement.skid` match the same identifier pattern as types; an omitted setting or
  field defaults to `{ gait: 'plantedFeet', skid: 'long' }`.
- **Venues:** the large venues at the town's edge, keyed by id. Only `ballpark` exists; unknown ids are dropped. An
  omitted venue or field takes its default, so a town saved before venues existed reads
  `{ visible: false, theme: 'garden', colors: {}, rules: { pitchCount: 5, difficulty: 'normal' } }`.
  - `visible` is the admin's switch for showing a venue to visitors: a boolean (anything else returns `400`) that
    defaults to `false`, so a venue stays hidden until the admin shows it, also in a town saved before the switch
    existed. Like the look, it applies as soon as it is saved, never on the rules' monthly schedule. The public town
    still carries a hidden venue's other settings, since the editor loads the town from the same `GET` and saves them
    back; the frontend decides what a hidden venue shows. While the ballpark is hidden, ranked runs are neither issued
    nor recorded (see [Ranked runs](#ranked-runs)).
  - The look applies as soon as it is saved. The frontend owns the themes and color roles, so only the shape is checked:
    `theme` matches the type pattern, and `colors` maps up to 12 role names (the same pattern) to `#rrggbb` colors,
    stored in lowercase. A role left out keeps the theme's color.
  - `rules` are exact, because ranked runs will snapshot them: `pitchCount` is a whole number from 3 to 10 and
    `difficulty` is `easy`, `normal`, or `hard`. They change only between ranking months, the KST (UTC+9) calendar
    months written `YYYY-MM`. The server owns the rules in effect: a save checks the `rules` it sends but keeps the
    stored ones, and a town's first save starts with the defaults, so a stale editor tab never changes them mid-month.
  - `scheduledRules: { fromMonth, rules }` (omitted or `null` for none) takes over at the start of `fromMonth`. A new or
    changed schedule must start in the server's next KST month, the one after the month the save arrives in; any other
    `fromMonth` returns `400`, so an admin device whose clock is off near a month boundary is told instead of having
    its schedule land in another month. The stored schedule sent back unchanged is accepted. Once `fromMonth` has
    come, the next save moves the stored schedule into `rules`, whether or not it sends the schedule again. A save
    without `scheduledRules` cancels a schedule whose month has not come yet. Reads never check the clock, so a stored
    schedule whose month has come still reads; its `rules` apply from `fromMonth` on.
  - Stored towns are read with these same checks, so a published range or difficulty is never narrowed or removed
    without a data migration.
- **Revisions:** a save names the revision it started from; a stale revision returns `409 CONFLICT` and changes nothing.

`src/town.ts` enforces all of this, so a stored layout always renders.

## OIDC security boundary

`LinkedInOidcAdapter` is injected when both `LINKED_IN_CLIENT_ID` and `LINKED_IN_CLIENT_SECRET` are present. The included adapter uses the confidential authorization-code flow: the client secret stays server-side, the code is exchanged server-side, and the ID-token RS256 signature, issuer (`https://www.linkedin.com/oauth` or `https://www.linkedin.com`), audience, expiry, and an issue time within the last ten minutes are verified with LinkedIn's published keys. LinkedIn reserves PKCE for natively enabled apps (a web app sending `code_challenge` fails with `invalid_client`) and does not echo the requested nonce, so the app sends no PKCE and rejects only a nonce that is present and different. CSRF and replay protection come from 256-bit state, a ten-minute one-use server-side transaction bound to an `HttpOnly; Secure; SameSite=Lax` cookie, opaque hashed sessions carried only by cookies, and an allowed `Origin` on every mutation. Each sign-in start deletes expired transactions and sessions first. Failed callbacks log the failing step server-side.

For local development, copy the root [`.env.example`](../.env.example) to `.env`, keep the real values out of version control, and register the exact callback URL in the LinkedIn Developer Portal. The default is `http://localhost:3000/v1/auth/linkedin/callback`; set `LINKED_IN_REDIRECT_URI` when the registered HTTPS development or production URL differs. The server reads the root `.env` when it exists, while deployed environments should inject the same variables through their secret manager.

Use a maintained OIDC library when wiring the provider; do not hand-roll JWT validation. Provider credentials stay outside the database and are optional at boot. With no adapter, `/v1/auth/linkedin/*` returns `503 NOT_CONFIGURED`.

## API shell

Create a handler with `createApi({ service, authStore, linkedInOidc, allowedOrigins, frontendUrl })` and mount it in any runtime that supports Fetch requests. Every response is `Cache-Control: no-store`, a body that is not a JSON object returns `400`, and unexpected errors are logged and return a generic `500`. Included routes:

- `GET /v1/auth/linkedin/start` returns `{ authorizationUrl }`; `/callback` always redirects to `FRONTEND_URL` with `?login=success` or `?login=failed` and logs the failure reason server-side
- `POST /v1/auth/logout` and `GET /v1/me` (`{ user }` with `role`, or `{ user: null }` when not signed in)
- `GET /v1/guestbook` returns `{ entries, own }`: the newest 100 approved entries, and this browser's latest entry with its `status` and whether it is still `revisable`
- `POST /v1/guestbook` and `PUT /v1/guestbook/:id` take `{ message, locale, profile }` from anyone and return `{ entry }`; see the guestbook rules below
- `GET /v1/admin/guestbook` lists the newest 200 entries of every status with `updatedAt`; `POST /v1/admin/guestbook/:id/approval` with `{ updatedAt }` publishes the entry only if it was not revised since that version (`409` otherwise); `DELETE /v1/admin/guestbook/:id` removes it
- `POST /v1/games/:game/runs` and `POST /v1/games/:game/runs/:id/result` start and record a ranked run, `GET /v1/games/:game/leaderboard` and `GET /v1/games/:game/podium` read the monthly board and its statues, `PUT` and `DELETE /v1/games/:game/entries/own` change or delete the visitor's records, and `POST /v1/games/:game/entries/:id/report` reports one; see [Ranked runs](#ranked-runs)
- `GET /v1/admin/games/:game/review` and the `/v1/admin/games/:game/entries/:id/…` and `/v1/admin/games/:game/runs/…` actions review the boards for an admin session; see [Board review](#board-review)
- `GET /v1/towns/:id` returns `{ town }` with `revision`, or `404` when no such town exists
- `PUT /v1/admin/towns/:id` with `{ baseRevision, name, owner, pet, spawn, movement, venues, objects, residents }` replaces the town for an admin session (`401` signed out, `403` otherwise) and returns the saved `{ town }`; `baseRevision` is `0` for the first save
- `POST /v1/admin/resident-dialogues` with `{ name, role, relationship, reference, owner }` (`owner` is the owner's `{ ko, en }` name) returns a drafted `{ dialogue }` for an admin session without storing it; the admin saves it with the town
- `GET /v1/admin/admins` returns `{ admins: [{ email, createdAt }], currentEmail }` sorted by email, where `currentEmail` is the signed-in admin's own address; `POST /v1/admin/admins` with `{ email }` returns `201 { admin }` (`409` if listed, `400` if invalid), and the account becomes admin at its next sign-in; `DELETE /v1/admin/admins/:email` returns `204` and demotes and signs out that email's users at once, or `409` for the admin's own email or the last listed one and `404` when it is not listed. All three need an admin session. Emails are stored trimmed and lowercase, at most 254 characters, shaped like `name@example.com`

## Guestbook rules

Visitors no longer sign in, so the guestbook is anonymous and moderated:

- An entry keeps the visitor's character name and appearance from the request `profile` (never gender or a LinkedIn link) and starts `pending`. Only `approved` entries are public; a revision returns the entry to `pending`, so the admin always approves the text visitors will read.
- The first entry gives the browser a random `__Host-tom_visitor` cookie (`HttpOnly`, one year). Only its hash is stored. One browser may write one entry per 24 hours and revise that entry during those 24 hours; another entry in that window returns `409`, and revising someone else's entry returns `404`.
- Clearing the cookie starts a new visitor, and there is no per-address limit. Because nothing is public before approval, such entries only add to the admin's review list.

## Ranked runs

The home run derby (`home-run-derby`, the ballpark of the `mossbell` town the frontend plays) keeps a monthly board.
Its season is the KST (UTC+9) calendar month written `YYYY-MM`, and a run belongs to the season it was issued in,
whenever its result arrives. Any other game id returns `404`. The client never sends a score anyone keeps: the server
judges the run again with `src/derbyJudge/`, the frontend judge's copy (`test/derbyJudgeVectors.json` holds both to
the same results).

- `POST /v1/games/home-run-derby/runs` (no body) returns `201 { run: { id, season, expiresAt, rules, seed } }` and
  gives the browser the guestbook's `__Host-tom_visitor` cookie if it has none. `rules` are the stored town's
  `{ pitchCount, difficulty }` in effect for the season, and `seed` is a 32-bit unsigned integer that plans the pitches
  (the landings have no randomness, so it is no secret). A run is open for ten minutes, and a new one abandons the
  visitor's open run; there is no limit on how many a visitor starts. It returns `503` while the ballpark is hidden and
  when the town has no `owner.contactEmail`, since records are public and takedown requests need a contact.
- `POST /v1/games/home-run-derby/runs/:id/result` takes at most 8 KB (`413` otherwise):
  `{ side, practice, swings, clientElapsedMs, claimed, profile }`, where `side` is `right` or `left`; `practice` is up to
  five `{ errorMs, speed }` (±5000 ms, 0–200 shoulder widths per second), at least three of them within 400 ms; `swings`
  has exactly `rules.pitchCount` items, each `null` or `{ contactMs, startedMs, speed, heightError }` (0–5000 ms, −1000 ms
  to `contactMs`, 0–200, and −3 to 3 m or `null`); `clientElapsedMs` is 0–600000; `claimed` is the client's
  `{ homeRuns, totalDistanceDm }`; and `profile` is the character appearance with an optional `name` (NFKC, one line of
  1–24 characters). Every other field, such as pose keypoints, is dropped and never stored; the run keeps only the
  parsed `side`, `practice`, and `swings`, and the name is kept only on a listed record.
- It answers `200 { result, standing, entry }`: the server's own `result` (`homeRuns`, `totalDistanceDm` of the home
  runs, and per pitch only `pitchType`, `outcome`, and `distanceDm`), the visitor's `standing`, and their record on the
  run's board (`entry`, or `null`). `standing.kind` is `ranked` (`rank`, `personalBest`), `unlisted` (`wouldBeRank`,
  `personalBest`), `consentNeeded` (the same; the browser's listed record looked like someone else, so this one is off
  the board until they agree), `reviewing` (the run is held), or `excluded` (the record is disqualified).
- In order, the server checks the run (no visitor cookie, an unknown run, or someone else's is `404`; a run already
  recorded answers again from what was stored; an abandoned, rejected, or expired run is `409`), then the time: a
  result sooner than 85% of the shortest honest run (ready, windup, and a miss's result hold per pitch, 3.2 s) is `409`
  and uses the run up. Then the body: a malformed one is `400` and leaves the run open. The server then scores the run
  from its own rules and seed and the log, and holds it for review when a check in `src/homeRunDerby.ts`
  `DERBY_REVIEW_RULES` finds it unusual, starting with claimed totals that differ from its own. A held run is stored
  with its flags but leaves the visitor's record as it was; any other run becomes the record only if it has more home
  runs, or as many and a longer total distance, so the earlier of two equal records stays.
- A first record on a board is listed only if the visitor's latest record of the game was listed and looks like the
  same player (the same appearance, and the same name when it had one); a listed record whose next run looks like
  someone else's goes off the board and loses its name, so a shared browser never publishes one player's score under
  another's consent.
- `PUT /v1/games/home-run-derby/entries/own` with `{ listed?, profile?, linkedIn? }` (at least one) changes this
  month's record of the visitor cookie (`404` without one): `listed: true` needs `profile`, whose name is stored from
  then on, and `listed: false` drops the name and the link. A name the record does not have yet is checked (below) and
  then waits for approval, and a new appearance returns the record to review. It returns `{ entry }`, the visitor's own
  view (`listed`, `name`, `nameStatus`, `disqualified`, `profile`, `appearancePublic`, `takedown`, `linkedIn`,
  `homeRuns`, `totalDistanceDm`, `achievedAt`, and `rank`, the place it holds or would hold).
  - `?season=YYYY-MM` names a past season, whose record only takes `{ anonymize: true }` (no name or link from then
    on; the score keeps its place) or `{ linkedIn: null }`; anything else is `400`. A record whose best run arrived
    after midnight, or was accepted after the season ended, takes the changes above instead until a week after it
    ended, when held runs can no longer be accepted either.
  - A name is NFKC, one line of 1–24 characters (`400` otherwise). It is `rejected`, and the record shows as an
    anonymous batter while keeping its place, when it has a format or zero-width character or a Hangul filler, stacks
    combining marks, has no letter, digit, or symbol, looks like a web address, domain, handle, or phone number, or its
    comparison form (lowercase, no spacing, punctuation, or symbols, lookalike Cyrillic and Greek letters made Latin)
    contains the town's owner, resident, or house owner names or a reserved word (`admin`, `official`, `관리자`, …), or
    equals another visitor's approved name on the board. Anything else is `pending`.
  - `linkedIn: { profileUrl, ownProfile: true }` links a listed record that was not taken down (`409` otherwise) to a
    LinkedIn profile: an https `linkedin.com/in/<id>` link whose id, decoded once, is 3–100 letters, digits, or
    hyphens and reads like no contact, stored as `https://www.linkedin.com/in/<id>` percent-encoded. A link the town
    shows or a takedown blocked is `400`. A new address gets an ownership code, `TOM-` and four Crockford base32
    characters, for the visitor to put on the profile; the link shows only on statue rows (`podium` here and on past
    seasons' boards, and `/podium`) once the admin has seen the code there, and stays while the visitor keeps it on.
    `linkedIn: null` deletes the address, its status, and its code. The own view shows only a hint of the address
    (`linkedin.com/in/sp•••`), its `status` (`pending`, `approved`, or `reported`), and the `code`; a link is never
    carried to a new month, and a run that looks like someone else's deletes it with the listing.
- `DELETE /v1/games/home-run-derby/entries/own` deletes every run and record of the visitor cookie in every season at
  once and returns `204` (also without a cookie); a statue makes way for the next record. Nothing else is ever deleted
  on a schedule.
- `POST /v1/games/home-run-derby/entries/:id/report` with `{ target, reason? }` (`target` is `name`, `character`, or
  `link`; `reason` is `other`, or `mine` for a link whose profile is the reporter's) returns `204` whatever it does (a
  malformed body is `400`), so it reveals nothing. It counts only
  from a visitor cookie that has sent a result, about someone else's record, at most five an hour (counted in the
  process's memory only); a report keeps no reporter. A report on an approved name puts it back under review and one on
  the character shows the default batter, unless the admin kept that name or character after an earlier report and the
  owner has not changed it or put the record back on the board since; a `mine` report hides the link (`reported`) with
  a new code, which only the admin's check of that code restores.
- `GET /v1/games/home-run-derby/leaderboard?season=YYYY-MM` (this month by default; a malformed season is `400`, a
  season still to come `404`) returns `{ season: { id, startsAt, endsAt, final }, podium, ranks, own }`. The public
  order is listed, not disqualified records by home runs, then their distance, then the earlier record; `podium` is
  its first three, the statues, and `ranks` places 4 to 50. A public row has `id`, `rank`, `name`, `nameState`,
  `profile`, `homeRuns`, `totalDistanceDm`, and `achievedOn`: the name only once approved (`nameState` is `approved`,
  `reviewing`, or `anonymous`), the default silhouette `{ kind: 'default' }` for an anonymous batter, and only the KST
  day; never a visitor hash, a review state, or an exact time. `own` is the visitor's own view, or `null`.
- `GET /v1/games/home-run-derby/podium` returns this month's `{ season: { id }, podium }` for the town's statues. It
  reads and sets no cookie and is `Cache-Control: public, max-age=60` (nginx leaves its `no-store` off this path), so
  a disqualification shows within a minute. Reads stay open while the ballpark is hidden; the frontend decides what a
  hidden venue shows.

## Board review

Every route here needs an admin session (`401` signed out, `403` otherwise, and `403` for a write without an allowed
`Origin`), and an unknown game is `404`. An action on a record sends the `updatedAt` it read, an ISO time as the queue
shows it: a record changed since is `409` and stays as it is. Each answers `{ entry }`, the record as the queue shows it.

- `GET /v1/admin/games/home-run-derby/review?season=YYYY-MM` (this season and the last by default) returns `{ items }`,
  one per visitor and board, most urgent first: `statue` (a statue whose record or name waits), `statue-run` (a held
  run of this season that would stand), `report` (open reports), `linkedin` (a statue's link waiting for its code),
  `past-run` (a held run of a past season, until a week after it ended), `run` (other held runs of this season, a
  visitor with two runs or fewer on the board, `newVisitor`, after the others), and `name` (a waiting name below the
  statues). An item has the visitor's `entry` (real name, every status, `updatedAt`, the whole link decoded and whether
  it was percent-encoded), their held `runs` (flags, would-be place, the profile they were sent with, and per pitch the
  server's timing error, power, swing duration and speed, and height error, which visitors never see), run counts,
  open `reports` per target, `warnings` (a name containing another record's or the town's, an appearance equal to
  another record's or a resident's), and the names three places either side.
- `POST …/entries/:id/approval` with `{ updatedAt, name?: 'approve' | 'reject' }` approves the record (`409` while it is
  disqualified) and decides its name; it never changes the link.
- `POST …/entries/:id/disqualification` with `{ updatedAt }` takes the record off the board, and the next record takes
  its place, statues included; `DELETE` with the same body puts it back, waiting for review.
- `POST …/entries/:id/linkedin-review` with `{ updatedAt, decision: 'code-verified' | 'reject' }` approves a link whose
  code the admin saw on the profile, or deletes it.
- `POST …/entries/:id/report-resolution` with `{ updatedAt, target, resolution: 'kept' | 'removed' }` closes the record's
  open reports on `target`: a kept name is approved and a removed one rejected, a kept character shows again and a
  removed one keeps the default batter, and a removed link is deleted while a kept one stays as it is.
- `POST …/entries/:id/appearance` with `{ updatedAt, public }` shows or hides the appearance (the default batter).
- `POST …/entries/:id/takedown` with `{ updatedAt, blockLinkedIn? }` answers a takedown request by anonymising the
  record: no name, no link, the default batter, and on this board neither ever comes back; the score keeps its place.
  `blockLinkedIn: true` also blocks the profile it linked (by the hash of its id) from every record.
- `POST …/runs/:id/acceptance` with `{ updatedAt }`, the visitor's record as read (`null` when they had none), scores a
  held run as if it had scored at once and settles the record, approved; a past season's run only until a week after
  the season ended. `POST …/runs/:id/rejection` dismisses one; it stays stored. Both answer `{ run }` (acceptance also
  `entry`), and a run that is not waiting is `409`. `POST …/runs/rejection` with `{ season?, scope: 'no-history' }`
  dismisses the held runs of visitors with two runs or fewer on that board and returns `{ season, rejected }`.

## OpenRouter dialogue drafts

When `OPENROUTER_API_KEY` is present, the server injects an OpenRouter resident-dialogue drafter; otherwise drafting returns `503 NOT_CONFIGURED` and the admin can still write the dialogue by hand. `OPENROUTER_MODEL` defaults to `openrouter/auto`; optional `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` headers identify the application. The drafter sends only the resident's name, role, relationship, reference, and the owner's name as quoted data, asks for strict bilingual JSON grounded only in the reference, keeps at most three follow-up questions, and validates the result with the same rules as a town save. It asks reasoning models for low reasoning effort within a 6,000-token budget, because `openrouter/auto` can route to a model that otherwise spends the whole budget thinking and writes nothing; set `OPENROUTER_MODEL` to pin one model instead. A timeout, provider error, or unusable result returns `503` with the reason for the admin: OpenRouter's own message for a refused request (such as an unknown model ID), or the routed model and finish reason when the model wrote nothing.

## Town seed

At startup the server stores the town in `seed/town.json` (a fictional sample: a layout plus `id`, validated like a save) as revision 1 when no town with that `id` exists; it never overwrites an existing town. `TOWN_SEED_PATH` replaces the file and is resolved against the repository root, like the root `.env`. A missing or invalid file is logged and the server starts without it. With `MemoryStore`, this gives every restart the sample town.

## Data and deletion

Before the first deployment the schema lives in one squashed `001_initial.sql`; after a deployment, add new numbered files instead of editing applied ones. When `DATABASE_URL` is set, the server uses `PostgresStore` and applies pending files from [`migrations/`](migrations/) in name order at startup. Applied files are recorded in `schema_migrations`, all pending files run in one transaction, and an advisory lock serializes instances that start together. Without `DATABASE_URL`, the server warns and uses `MemoryStore`. Both stores implement the `Store` contract in `src/store.ts` with parameterized SQL and transactions on the PostgreSQL side. Localized JSON objects store both `ko` and `en`, enforced by database checks. Public guestbook reads must always require `status = 'approved'`.

On account deletion: set `deleted_at`, revoke every session immediately, hide public content, enqueue hard deletion, and keep only the minimum audit record required by the chosen legal retention policy. The product still needs an explicit decision for the retention duration.

## Verify

```sh
npm install
npm run lint
npm test
npm run build
```

No database, LinkedIn, translation, speech, or LLM credentials are needed for these checks. Set `TEST_DATABASE_URL` to also run the shared store contract against PostgreSQL; it creates and drops a temporary schema, so a development database is safe to reuse. CI runs it against a PostgreSQL service container. Provider tests use injected fake requests and never read real secrets. The front end lives separately in `../frontend`.
