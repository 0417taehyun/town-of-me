# Architecture

This is the map of the codebase for contributors and coding agents. Read it before changing structure; read
[AGENTS.md](AGENTS.md) for the rules every change follows. It describes the code as it is, not a plan.

## System

```text
browser ── frontend (Vite, React, React Three Fiber) ── /v1 ──▶ backend (Node, Fetch handlers) ──▶ PostgreSQL
                                                                   │                                (or in memory)
                                                                   ├──▶ LinkedIn OIDC  (admin sign-in, optional)
                                                                   └──▶ OpenRouter     (dialogue drafts, optional)
```

- `frontend/` and `backend/` are npm workspaces that never import each other. The HTTP API under `/v1` is their only
  contract, and the frontend reaches it through a same-origin proxy (Vite in development, nginx in containers).
- A change may touch application code in only one of them; CI rejects a push or pull request that touches both, except
  a dependency-only change such as Dependabot's. Change the API in two steps: the backend first (accepting old and new
  shapes when needed), then the frontend.

## What lives where

Nothing personal is in the repository. A fork changes its owner, pet, residents, and references at `/admin`.

| Data                                                                                                                           | Stored in                                                  | Changed by                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------- |
| Town: objects, residents, owner (name, introduction, contact email, own resident, questions), pet (name, walk), movement style | database (`towns`, `town_objects`, `town_residents`)       | admins at `/admin`              |
| Venue settings: the ballpark's colors, pitch count, and difficulty, and next month's rules                                     | database (`towns.venues`)                                  | admins at `/admin`              |
| Admin emails                                                                                                                   | database (`admin_emails`), filled from `ADMIN_EMAILS` once | admins at `/admin`              |
| Guestbook notes                                                                                                                | database (`guestbook_entries`)                             | visitors write, admins approve  |
| A visitor's character, camera settings, guide progress, language                                                               | the browser tab (`sessionStorage`)                         | the visitor                     |
| Object kinds, variants, walks, skids, copy, procedural geometry                                                                | frontend code                                              | contributors                    |
| The sample town a fresh database starts from                                                                                   | `backend/seed/town.json` (fictional), or `TOWN_SEED_PATH`  | contributors, or a private file |

The backend validates the shape of everything it stores and the few structural rules it relies on (exactly one fountain
and guestbook board, residents' benches exist, road points, bench seats, house links, the ballpark rules). The frontend
owns the catalog of what can be drawn and drops what it does not know at its boundary, so new kinds, variants, walks,
skids, ballpark themes, and color roles need no backend change.

## Frontend (`frontend/src`)

| Path               | Owns                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `App.tsx`          | Routes `/baseball` lazily; `TownApp` (`/`, `/admin`) creates adapters and connects UI and scene.    |
| `data/`            | Models, the untrusted API boundary (`townApi.ts`), API clients, the tab's session and language.     |
| `scene/`           | Everything drawn with Three.js (see below). Loaded as a lazy chunk.                                 |
| `editor/`          | The admin editor: panels, gestures, history, admin list, guestbook review. Loaded only on `/admin`. |
| `ui/`              | DOM overlays: entry, HUD, dialogue, guestbook, map, character creator.                              |
| `baseball/`        | The home run derby at `/baseball`, a lazy chunk; only `baseballRoute.ts` is in the main chunk.      |
| `camera/`          | Camera defaults and pure camera math.                                                               |
| `audio/`           | Procedural music, voices, footsteps, skid squeal, and the bark sample.                              |
| `i18n/language.ts` | All copy, in Korean and English.                                                                    |
| `hooks/`           | Session, page language, reduced motion, and retryable loading hooks.                                |
| `motionMath.ts`    | Shared damping and interpolation helpers; reuse them instead of redefining them.                    |
| `testing/`         | The sample town as a test fixture. It never reaches the production bundle.                          |

Dependencies point down: `App` → `ui`/`scene`/`editor`/`hooks`/`baseball` → `data`/`camera`/`audio`/`i18n`. Lower
modules never import the app, and `camera`, `audio`, `data`, and `i18n` do not depend on React components. `baseball/`
never imports `editor/`, `TownScene.tsx`, or a `scene/` module that reaches the kinds registry, so the ballpark loads
none of the town.

- `townApi.ts` is the untrusted boundary: payloads are parsed into a `TownSnapshot`, and renderers never see transport
  shapes. `DemoRepository` is the data port for the visitor's session; `InMemoryDemoRepository` keeps it in
  `sessionStorage`.
- Use an interface only at a real boundary (repository adapters, reusable component props, data from another module),
  never for a single implementation with nothing to substitute.
- Extract a component when a UI pattern repeats or owns its own accessible contract. Pass ids and callbacks across UI
  boundaries; never hand Three.js objects to DOM components.

### `scene/`

| Path           | Owns                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| top level      | `TownScene.tsx` (canvas, lights, the lazy chunk), `Town.tsx` (draws every kind's layer), camera rig, controls, 2D collision (`townCollision.ts`), world curve, contact shadows, shared geometry (`roundedBox.ts`), instancing helpers, variant resolver. |
| `objects/`     | Placeable town objects, one folder per kind or per group of kinds sharing a renderer, plus the registry.                                                                                                                                                 |
| `motion/`      | Walks (`gait.ts`, `plantedFeetGait.ts`, `walkCycle.ts`), the skid turn (`skidTurn.ts`), dust and skid marks, player and resident motion.                                                                                                                 |
| `characters/`  | The procedural character (player and residents) and its merged head geometry.                                                                                                                                                                            |
| `animals/`     | The pet corgi: model, trot, and petting responses.                                                                                                                                                                                                       |
| `environment/` | Time of day, seasons and their transitions, sun, sky, night lights, weather particles, ground, distant land.                                                                                                                                             |

### Object kinds

Every placeable thing has a type in `TOWN_OBJECT_TYPES` (`data/models.ts`) and a definition, a plain
`TownObjectKind` (`scene/objects/townObjectKind.ts`), in `scene/objects/<kind>/kind.ts`:

- editor facts: its `category` (the editor tab that lists it), default color, whether the editor can add it, singleton,
  sky placement, default fields, marker size;
- `variants`: the named looks it can be saved with (`scene/objects/variants.ts`, data only);
- `Layer`: a component that draws **all** objects of the kinds sharing it, in instanced meshes, with one shared
  `TownLayerProps` object (season and day state, player position, actors, language, pet name);
- `colliders` and `contactShadows`: optional functions over all of the kind's objects.

`scene/objects/kinds.ts` registers every kind with `satisfies Record<TownObjectType, TownObjectKind>`, so a type without
a kind does not compile. `Town.tsx` draws each distinct layer once, `townCollision.ts` and the contact shadows collect
from the registry, and the editor reads its per-kind facts from it.

An object without a saved `variant` is drawn as its id picks (`resolveVariant` in `scene/objectVariant.ts`), from frozen
copies of the variant lists, so adding a variant never changes how existing objects look.

### Rendering and performance rules

- Frame-by-frame state lives in refs and Three.js objects, updated in `useFrame`; never set React state every frame.
- Many objects of one kind are drawn as instanced meshes from shared geometry. A kind's layer must not create one mesh
  per object when the town can hold dozens of them.
- The main chunk (`index-*.js`) must not import the kinds registry, layers, or editor code: `data/` reads only
  `scene/objects/variants.ts`, and the editor loads lazily. Compare `npm run build` chunk sizes before and after a change.
- `scene/worldCurve.ts` bends every material's vertices in a shared shader chunk once `TownScene.tsx` calls
  `installWorldCurve()`; importing the module alone does not, so the ballpark stays flat. Back-side materials (sky, sun,
  stars) skip it, and a large flat mesh needs enough subdivisions to bend smoothly.
- The pixel ratio adapts to the frame rate (`PerformanceMonitor` in `TownScene.tsx`).

### `baseball/game/`

The derby's core is plain TypeScript, without React, Three.js, or the DOM. A swing's landing is decided first,
without randomness, from its timing, power, and bat height; `flight.ts` only draws a path that ends there. The seeded generator (mulberry32) plans the pitches and nothing else. The scoring files use arithmetic,
comparisons, and `Math.sqrt` only, and import nothing at runtime from outside `baseball/game/` and
`baseball/statistics.ts`, so a server can mirror them and score a run the same way. `flight.ts` is display only and
not one of them. `derbyScore.ts` is that seam: `replayDerby` scores a run from its `RunPlan` (seed and the month's
rules) and its raw `DerbyInputLog`, recalibrating from the practice swings in it; each swing records whether a camera
or a key made it, and a key swing is judged at a fixed power. `derby.ts` plays a run on `gameClock.ts` time with the
same functions, so the numbers shown live are the replayed ones.

## Backend (`backend/src`)

```text
server.mjs (Node runtime: .env, store, seeding, HTTP)
   └── http.ts (route table, cookies, Origin checks, JSON errors)
         └── service.ts (domain rules; policy.ts asserts the admin role)
               └── Store (store.ts contract)
                     ├── MemoryStore (store.ts)    — no DATABASE_URL, tests
                     └── PostgresStore (postgres.ts) — migrations/ applied at startup
```

| File                           | Owns                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `town.ts`                      | Town layout validation: shapes, bounds, structural rules, monthly ballpark rules.  |
| `guestbook.ts`, `character.ts` | Guestbook entries and character appearances.                                       |
| `admins.ts`, `auth.ts`         | Admin emails, sessions, and setting the role from the admin list at every sign-in. |
| `linkedin.ts`                  | LinkedIn OIDC adapter (ID tokens verified with `jose`).                            |
| `openrouter.ts`                | Resident dialogue drafts; output validated like a town save.                       |
| `seed.ts`                      | Stores the seed town at startup when no town with its id exists.                   |
| `validation.ts`                | Shared input helpers; every request body passes through them.                      |

Tests run with `npm test` through `test/run.ts`. `test/storeContract.ts` runs the same behaviors against both stores
(PostgreSQL when `TEST_DATABASE_URL` is set); the flow tests drive the HTTP handler.

## Main flows

- **Visit:** `GET /v1/towns/:id` → `townApi.ts` parses it (unknown kinds and variants dropped) → the scene chunk draws
  it. A failed request shows `Try again`; there is no built-in town.
- **Edit:** LinkedIn sign-in → session cookie → `/admin` loads the saved town → edits stay local → `PUT
/v1/admin/towns/:id` with the revision it loaded (a stale revision gets `409`).
- **Guestbook:** anyone writes one note a day per browser cookie; notes stay pending until an admin approves them.
- **Resident dialogue:** an admin drafts it from a reference with OpenRouter and reviews it before saving; visits never
  call an LLM.

## How to extend

**A new kind of object** (frontend only):

1. Add its type to `TOWN_OBJECT_TYPES` in `frontend/src/data/models.ts`.
2. Add `frontend/src/scene/objects/<kind>/` with an instanced `Layer`, its layout helpers, and `kind.ts`.
3. Register it in `scene/objects/kinds.ts` and give it a Korean and English label in `i18n/language.ts`.
4. Optionally place a few in the sample town: `backend/seed/town.json` in a backend change, and the test copy in
   `frontend/src/testing/sampleTown.json`.

**A new variant:** append its name to the kind's list in `scene/objects/variants.ts`, label it in `i18n/language.ts`,
and draw it in the kind's layer through `resolveVariant`. Never rename or remove a released variant: saved towns name it.

**A new walk:** implement `Gait` (`scene/motion/gait.ts`: `step(input, pose)` and `footfalls()`), add its id to
`GAIT_STYLES`, register it in `scene/motion/createGait.ts`, and label it. A new skid is a timing entry in
`SKID_STYLES`/`skidTimings` (`scene/motion/skidTurn.ts`).

**Another animal:** there is one pet today, so there is no animal interface yet. When a second animal arrives, extract
the shared shape from `scene/animals/` the way `Gait` was extracted, rather than designing it up front.

**A backend route:** add it to the route table in `http.ts`, put the rule in a `service.ts` method (with `assertAdmin`
for admin routes), add store methods to both stores with a case in `test/storeContract.ts`, and document it in
`backend/README.md`. Schema changes are new numbered files in `backend/migrations/`; never edit an applied one.

## Checks

Each module has `npm run lint`, `npm run format:check`, `npm test`, and `npm run build`; `npm run check` at the root runs
both. Visual changes have no screenshot tests: check them in a browser at several times of day and seasons.
