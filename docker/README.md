# Local containers

Build and start both applications:

```sh
docker compose up --build
```

The frontend is served at <http://localhost:8080> and the backend health endpoint at
<http://localhost:3000/healthz>. Override the published ports with `FRONTEND_PORT` and
`BACKEND_PORT` when needed.

The frontend's Nginx origin compresses text assets and sets cache headers for deployment behind a
CDN: fingerprinted JS, CSS, WebAssembly, and font files are immutable for a year (a missing one's 404 is
not), other assets such as the pose models are revalidated daily, and the HTML entry point and `/v1/`
responses are not cached. Configure the CDN to honor these origin headers, enable Brotli (and gzip
fallback) for text assets, and pass `/v1/` through without caching. No CDN provider is required for
local development.

The home run derby at `/baseball` (and `/baseball/`) is the only document allowed to use the camera,
and never the microphone or screen capture (`Permissions-Policy: camera=(self), microphone=(),
display-capture=()`), so it alone gets a strict Content Security Policy: scripts (with
WebAssembly) and connections from this origin only; images, media, and workers also from `blob:` URLs
(images from `data:` too); styles and fonts from this origin only; no plugins or `<base>`; forms post
only to this origin; and no page may frame it (`frame-ancestors 'none'`). It is also sent with
`Cross-Origin-Opener-Policy: same-origin`, so a page that opens it gets no handle to it, and
`Referrer-Policy: no-referrer`. Its monthly board at `/baseball/ranking` gets the same headers, and
both carry `X-Robots-Tag: noindex, noarchive`, since the board keeps names and links with no end date.
Every other document, `/` and `/admin` included, is sent with `camera=()`. Browsers apply these
headers only on a full page load, so the town and the ballpark link to each other with plain links. A CDN in front must pass them through unchanged.

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
cookies require and redirecting `www` and plain HTTP. Only Caddy publishes ports, 80 and 443 on IPv4. There is no CDN, so
the server sends every file itself. Compose refuses to start without the database password, public host, or seed file.

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
   updating only the backend, nginx kept the old address: `docker compose … restart frontend`.

6. Check that `docker compose … logs caddy` shows a certificate obtained for both names, and that `logs frontend` shows
   visitors' addresses. A private `172.x` address there means Docker is hiding them from Caddy, and every visitor is
   sharing one flood-guard counter.

Never run `docker compose down -v` on the server: `-v` deletes the database and the certificates. Containers come back on their own after a
crash or a reboot, and committed data survives them; only losing the disk means going back to the last snapshot, at most a
day old.

`/privacy` names AWS as the only company handling visitors' requests and states the backup period and log cap, so changing
any of them, or putting a CDN in front, means changing `privacy` in `frontend/src/i18n/language.ts`.
