# TODO

Open work, roughly in priority order within each section. Remove an item when it lands; the commit message records
what changed.

## Town and editor

- Decide whether the derby review's queue should show a visitor's other runs: the spec lists them for each item (§3.9,
  leaderboard-spec.md line 601), and today it shows only their held runs and their record's best run.
- Editor phase 2: a scatter tool that fills an area with trees, flowers, grass, birds, or clouds at a chosen density
  (as OpenRCT2's scenery scatter tool does), and an area tool that clears one category.
- Let route handles (residents' and the pet's) move with the keyboard, not only by dragging.
- Add redo, multi-select, grid snapping, and a two-finger twist to rotate the top view if they prove necessary.
- Page the guestbook beyond the newest 100 notes if it fills up.
- Tune the `/baseball` camera swing (`SWING_RULES` and `CONTACT_HEIGHT` in `baseball/vision/swingTracker.ts`, the
  held-object rules in `heldObject.ts`, and the stance hold's `STANCE_HOLD_RULES` in `flow/stanceHold.ts`) in a
  hands-on session with a real webcam; they come from synthetic swings and one draft log only. Measure there how late
  a swing reaches the stage: `LATE_SWING_MARGIN_MS` (`game/derby.ts`) allows the tracker's 150 ms finish window, a
  15 fps frame, and 100 ms more, and a pitch nobody swings at waits that long behind the batter before the catch.
- Near a KST month boundary, an admin device whose clock runs fast treats the stored ballpark schedule as already in
  effect, so a rules edit can still save without the schedule, which the backend takes as a cancel. A schedule moved to
  any month but the server's next one is already refused.

## Backend and security

- Revisit an address-based guestbook limit if visitors clear cookies to flood it; today that only lengthens the review
  list.
- Recheck that LinkedIn still rejects PKCE for web apps and omits the nonce, and restore both if that changes.
- Choose the dialogue-drafting provider (OpenRouter today; `OPENROUTER_MODEL` can select OpenAI models) and check draft
  quality against real references.
- Decide what happens after an account is deleted (`deleted_at`): erasure or anonymization, retention periods, and
  database backup and restore.

## Deployment

- Deploy with `compose.production.yaml` ([docker/README.md](docker/README.md#deploying)); add a deployment workflow if
  updating by hand becomes a chore. After the first deployment, add migrations instead of editing applied ones.
- `toWebRequest` in `backend/server.mjs` resolves `request.url` as a relative reference, so a leading `//` becomes a host
  name. nginx refuses such addresses today; build the URL from the path so the backend is safe on its own.
- `/privacy` publishes the privacy, retention, and asset-credit notices; what is left is a legal check of its wording,
  including how it names AWS, which handles visitors' data.
- Test admin sign-in end to end with the registered LinkedIn redirect URLs. Locally, use `localhost` rather than
  `127.0.0.1` so the cookie host matches.
- On real desktop and mobile devices, check that admin saves reach visitors, the guestbook write, review, and publish
  cycle, and resident conversations. Also measure frame pacing while walking, running, moving the camera, and talking,
  and try keyboard-only use, reduced motion, muted audio, the WebGL fallback, and the editor's touch controls on a real
  tablet and phone.

## Publishing the repository

- Enable private vulnerability reporting, which `SECURITY.md` relies on, and Dependabot security updates, since
  `.github/dependabot.yml` only covers version updates.
- Add a `main` ruleset that blocks force pushes and deletion and requires `Module scope`; the other checks run only when
  their paths change, so requiring them would leave unrelated pull requests waiting.
- Require approval before Actions run on pull requests from outside contributors.
