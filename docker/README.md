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

`compose.production.yaml` runs the frontend and backend images behind a Cloudflare Tunnel, with the database outside the
containers. It publishes no port, so the server needs no open inbound port, and Cloudflare serves the static files from
its edge and holds the HTTPS certificate the `__Host-` cookies require. Compose refuses to start without the public
address, database URL, tunnel token, seed file, or database certificate authority.

1. Add the domain to Cloudflare and create a tunnel in Zero Trust. Point its public hostname at `http://frontend:80`.
   Redirect any other hostname, such as `www`, to it, since `PUBLIC_ORIGIN` is the only origin the backend allows.
2. Create the database, for example Amazon RDS for PostgreSQL 17. Keep it off the public internet, allow port 5432 only
   from the server's security group, and keep automated backups at 7 days, the period `/privacy` states. The console
   defaults to 7 days, but the API and CLI to 1.
3. On a server with 2 GB of memory (building the frontend peaks near 1 GB) and Docker with Compose 2.24 or newer, clone
   the repository. Copy `.env.production.example` to `.env.production` and fill it in, keeping `sslmode=verify-full`.
   Put the private town at `.seed/town.json`; it is read once, while the database has no town, and after that `/admin`
   is the source of truth. Put the database's certificate authority at `.seed/database-ca.pem`; for RDS:

   ```sh
   curl -o .seed/database-ca.pem https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem
   ```

4. Register `<PUBLIC_ORIGIN>/v1/auth/linkedin/callback` in the LinkedIn app.
5. Start it, and repeat this after `git pull` to update:

   ```sh
   docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build
   ```

6. Check that `docker compose … logs frontend` shows visitors' addresses. A private `172.x` address there means
   `CF-Connecting-IP` is not arriving, and every visitor is sharing one flood-guard counter.

In Cloudflare, keep `/v1/` uncached with a cache rule, and leave Rocket Loader off, since it rewrites script tags under
the pages' Content Security Policy. Cloudflare compresses with Brotli on its own. `/privacy` names Cloudflare and AWS and
states the backup period and log cap, so changing any of them means changing `privacy` in
`frontend/src/i18n/language.ts`.
