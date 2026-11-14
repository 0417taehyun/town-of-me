# Local containers

Build and start both applications:

```sh
docker compose up --build
```

The frontend is served at <http://localhost:8080> and the backend health endpoint at
<http://localhost:3000/healthz>. Override the published ports with `FRONTEND_PORT` and
`BACKEND_PORT` when needed.

The frontend's Nginx origin compresses text assets and sets cache headers: fingerprinted JS, CSS, WebAssembly, font, and
model files are immutable for a year (a missing one's 404 is not), other assets are revalidated daily, and the HTML entry
point and `/v1/` responses are not cached. The derby's WebAssembly and models are compressed once when the image is
built, and sent as Brotli to browsers that accept it and as gzip to the rest.

The home run derby at `/baseball` (and `/baseball/`) is the only document allowed to use the camera,
and never the microphone or screen capture (`Permissions-Policy: camera=(self), microphone=(),
display-capture=()`), so it alone gets a strict Content Security Policy: scripts (with
WebAssembly) and connections from this origin only; images, media, and workers also from `blob:` URLs
(images from `data:` too); styles and fonts from this origin only; no plugins or `<base>`; forms post
only to this origin; and no page may frame it (`frame-ancestors 'none'`). It is also sent with
`Cross-Origin-Opener-Policy: same-origin`, so a page that opens it gets no handle to it, and
`Referrer-Policy: no-referrer`. Its weekly board at `/baseball/ranking` gets the same headers, and
both carry `X-Robots-Tag: noindex, noarchive`, since the board keeps names and links with no end date.
Every other document, `/` and `/admin` included, is sent with `camera=()`. Browsers apply these
headers only on a full page load, so the town and the ballpark link to each other with plain links.

```sh
FRONTEND_PORT=8081 BACKEND_PORT=3001 docker compose up --build
docker compose down
```

Compose also starts PostgreSQL 17 with a named `postgres-data` volume, creating the database and role
from `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` (local defaults: `town_of_me`). The backend
receives the matching `DATABASE_URL` and applies pending migrations at startup, so data survives
container restarts; `docker compose down -v` deletes it. PostgreSQL is published only on
`127.0.0.1:${POSTGRES_PORT:-5432}` for a backend started with `npm run dev`. LinkedIn admin sign-in and OpenRouter
dialogue drafting are enabled when their variables from the root `.env` are present. A fresh database starts from the fictional
sample town in `backend/seed/town.json`; sign in at `/admin` to make it your own.

## Deploying

`compose.production.yaml` runs everything on one server, with Caddy in front holding the HTTPS certificates the `__Host-`
cookies require and redirecting `www` and plain HTTP. Only Caddy publishes ports, 80 and 443 on IPv4. There is no CDN
unless you add one ([Behind CloudFront](#behind-cloudfront)), so the server sends every file itself. Compose refuses to start without the database password, public host, or seed file.

1. Create a server with 2 GB of memory and a static IP, for example a Lightsail instance. In its firewall leave SSH, 80,
   and 443 open on IPv4 and nothing on IPv6. Building the frontend peaks near 1 GB beside the running site, so add 2 GB of
   swap. Install Docker with Compose 2.24 or newer. Turn on automatic snapshots: they are the database's only backup, keep
   the latest 7 days, the period `/privacy` states, and are deleted along with the instance.
2. Point `A` records for the domain and its `www` at the server, and add no `AAAA` record, since visitors' IPv6 addresses
   would not reach nginx. Do this before the first start: Let's Encrypt allows 5 failed validations per hostname per hour.
3. Clone the repository. Copy `.env.production.example` to `.env.production` and fill it in, and put the private town at
   `.seed/town.json`. It is read once, while the database has no town; after that `/admin` is the source of truth.
4. Register `https://<PUBLIC_HOST>/v1/auth/linkedin/callback` in the LinkedIn app.
5. Start it, and repeat this after `git pull` to update:

   ```sh
   docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build
   docker image prune -f
   ```

   The site keeps running through the build; only replacing the containers interrupts it. If it answers 502 after
   updating only the backend, nginx kept the old address: `docker compose … restart frontend`. After a change to
   `docker/Caddyfile`, run `docker compose … restart caddy`: `git pull` replaces the file, and `up -d` leaves the running
   Caddy with the old one.

6. Check that `docker compose … logs caddy` shows a certificate obtained for both names, and that `logs frontend` shows
   visitors' addresses. A private `172.x` address there means Docker is hiding them from Caddy, and every visitor is
   sharing one flood-guard counter. If no certificate came, the start itself still succeeded and HTTPS fails: confirm
   DNS with `dig` and the firewall, fix them, and restart Caddy once, since its retries back off for up to a day.

Never run `docker compose down -v` on the server: `-v` deletes the database and the certificates. Containers come back on their own after a
crash or a reboot, and committed data survives them; only losing the disk means going back to the last snapshot, at most a
day old.

### Behind CloudFront

Optional, for visitors far from the server: CloudFront answers at `PUBLIC_HOST` and reaches the server at a second name,
`ORIGIN_HOST`, adding a secret `X-Origin-Verify` header that `docker/Caddyfile.cloudfront` requires. That file also passes
on the `X-Forwarded-For` CloudFront sends, whose last address is the visitor's, so the flood guard still counts each
visitor apart; with the plain `docker/Caddyfile` behind CloudFront they would all share a few counters.

1. Point an `A` record for `ORIGIN_HOST` at the server. Set `CADDYFILE`, `ORIGIN_HOST`, and `ORIGIN_VERIFY_SECRET` in
   `.env.production` and run the `up -d` command above, which replaces Caddy. `logs caddy` shows the new certificate, the
   site still answers at `PUBLIC_HOST`, and `https://ORIGIN_HOST/` answers 403 without the header.
2. Create the distribution: the origin is `ORIGIN_HOST` over HTTPS only with the custom header; `/v1/*` and the default
   behavior use the managed `CachingDisabled` cache policy and `AllViewerExceptHostHeader` origin request policy, with
   every method allowed on `/v1/*`; `/assets/*` uses `CachingOptimized`. Attach no response headers policy and no custom
   error response: the per-path headers above must arrive as nginx sends them.
3. Before moving DNS, request the distribution's own `cloudfront.net` name with a forged `X-Forwarded-For` and check
   that `logs frontend` shows your real address, and that `/baseball` still carries its `Permissions-Policy`.
4. Point `PUBLIC_HOST` at the distribution with alias `A` and `AAAA` records; `www` stays on the server. Change `privacy`
   in `frontend/src/i18n/language.ts`, which says where visitors' requests go.
5. Once settled, delete the `{$PUBLIC_HOST}` block from `docker/Caddyfile.cloudfront`: its certificate can no longer be
   renewed. Until then, pointing DNS back at the server undoes the move.

With `CLOUDFLARE_WEB_ANALYTICS_TOKEN` set, the town's page loads Cloudflare Web Analytics, except for browsers that send
Global Privacy Control or Do Not Track. `/privacy` names AWS for visitors' requests and Cloudflare for those statistics,
and states the backup period and log cap, so changing any of them, or putting a CDN in front, means changing `privacy` in
`frontend/src/i18n/language.ts`.

A link to the town shows `frontend/public/og-image.jpg` (a picture of the sample town, 1200×630) with `SITE_TITLE` and
`SITE_DESCRIPTION`, or "Town of Me" and a general line while they are empty; the build points crawlers at
`https://PUBLIC_HOST/og-image.jpg`. LinkedIn, KakaoTalk, and Slack keep a preview for days, so after changing either,
refresh it with LinkedIn's Post Inspector or Kakao's sharing debugger.
