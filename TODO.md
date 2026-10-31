# TODO

Open work, roughly in priority order within each section. Remove an item when it lands; the commit message records
what changed.

## Town and editor

- Editor phase 2: a scatter tool that fills an area with trees, flowers, grass, birds, or clouds at a chosen density
  (as OpenRCT2's scenery scatter tool does), and an area tool that clears one category.
- Let route handles (residents' and the pet's) move with the keyboard, not only by dragging.
- Add redo, multi-select, grid snapping, and a two-finger twist to rotate the top view if they prove necessary.
- Page the guestbook beyond the newest 100 notes if it fills up.
- Lay out the `/baseball` HUD for 4:3 and 16:10 screens: its centred English caption covers the home-run count once
  the summed distance reaches four digits (by about 60 px at 1024×768 and 10 px at 1440×900), and by 9-36 px on 4:3
  even with three.
- Near a KST month boundary, an admin device whose clock runs fast treats the stored ballpark schedule as already in
  effect, so a rules edit can still save without the schedule, which the backend takes as a cancel. A schedule moved to
  any month but the server's next one is already refused.

## Backend and security

- Rate-limit `/v1/auth/linkedin/start`, `PUT /v1/admin/towns/:id`, `POST /v1/admin/resident-dialogues`, and
  `POST /v1/guestbook` at the deployment proxy (for example nginx `limit_req`); the backend cannot trust client
  addresses on its own.
- Revisit an address-based guestbook limit if visitors clear cookies to flood it; today that only lengthens the review
  list.
- Recheck that LinkedIn still rejects PKCE for web apps and omits the nonce, and restore both if that changes.
- Choose the dialogue-drafting provider (OpenRouter today; `OPENROUTER_MODEL` can select OpenAI models) and check draft
  quality against real references.
- Decide what happens after an account is deleted (`deleted_at`): erasure or anonymization, retention periods, and
  database backup and restore.

## Deployment

- Choose hosting, database, and secret management; add deployment workflows once a target exists. After the first
  deployment, add migrations instead of editing applied ones.
- Before going public, settle the API domain, HTTPS and cookies, CORS or a same-origin proxy, CDN bypass for `/v1/`,
  and Brotli, and publish privacy, retention, and asset-credit notices.
- Test admin sign-in end to end with the registered LinkedIn redirect URLs. Locally, use `localhost` rather than
  `127.0.0.1` so the cookie host matches.
- On real desktop and mobile devices, check that admin saves reach visitors, the guestbook write, review, and publish
  cycle, and resident conversations. Also measure frame pacing while walking, running, moving the camera, and talking,
  and try keyboard-only use, reduced motion, muted audio, the WebGL fallback, and the editor's touch controls on a real
  tablet and phone.

## Publishing the repository

- Confirm the copyright line in `LICENSE.md`.
- Enable private vulnerability reporting in the GitHub repository settings, which `SECURITY.md` relies on.
- Enable Dependabot alerts and security updates in the repository settings; `.github/dependabot.yml` only covers
  version updates.
- Before the first commit, check with `git status` that `.env` and `.seed/` stay untracked.
