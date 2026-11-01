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
| `audio/`           | Procedural music, voices, footsteps, skid squeal, derby sounds, and the bark sample.                |
| `i18n/language.ts` | All copy, in Korean and English.                                                                    |
| `hooks/`           | Session, page language, local time and season, reduced motion, and retryable loading hooks.         |
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
| `venues/`      | The large venues' colors: theme palettes as data with the admin's building colors over them (`ballpark/ballparkThemes.ts`), one shared material per color role, recolored in place (`venueMaterials.ts`).                                                |

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
- The pixel ratio adapts to the frame rate in every `GraphicsCanvas` given no fixed `dpr` (the town and the derby).
  A canvas whose WebGL 2 is missing, lost, or fails while drawing shows the fallback and calls `onUnavailable`.

### `baseball/game/`

The derby's core is plain TypeScript, without React, Three.js, or the DOM. A swing's landing is decided first,
without randomness, from its timing, power, and bat height; `flight.ts` only draws a path that ends there. The seeded generator (mulberry32) plans the pitches and nothing else. The scoring files use arithmetic,
comparisons, and `Math.sqrt` only, and import nothing at runtime from outside `baseball/game/` and
`baseball/statistics.ts`, so a server can mirror them and score a run the same way. `flight.ts` is display only and
not one of them. `derbyScore.ts` is that seam: `replayDerby` scores a run from its `RunPlan` (seed and the month's
rules) and its raw `DerbyInputLog` (the batting side, the practice swings, and each pitch's camera swing or none),
recalibrating from the practice swings in it; a swing whose tracking lost the bat counts a common height error (0.2 m),
never a level bat. Every swing is the camera's: no key or button swings. `derby.ts` plays a run on `gameClock.ts` time
with the same functions, so the numbers shown live are the replayed ones; it logs a swing's bat height against the
ball's height at the contact point (`contactHeight` in `pitch.ts`), since only it knows which pitch the swing met.
Practice plays as a derby too (`createPracticePlan` in `runPlan.ts`, `createDerby`'s `practice`): the fixed practice
pitches at the practice pace, which the scoring functions take as an argument that a run never passes, taking swings as
late as the calibration still counts one, so a server needs none of it.

### `baseball/stage/` and `baseball/stadium/`

The stage draws a run on its own flat canvas: `BaseballStage.tsx` never installs the world curve. `DerbyDirector.tsx`
plays the run in one `useFrame`: `stageRun.ts` keeps the derby, its game clock, the ball, and the camera's choice in a
ref and reports only events to React. The ball is the pitcher's until the derby releases it; a pitch then waits at the
back of the batter's reach while a swing that touches it could still be reported (a camera swing comes up to the
derby's late margin after it), so the mitt never catches a ball the bat then hits. A
ball in play leaves the bat where the bat met it and flies to the landing the judge already decided, fast enough to
come down before its result ends; the stage changes the clock's pace (a hit-stop that holds the moment the bat met the
ball, even for a swing reported late; slow motion at a showcase home run's peak; a pause while the page is hidden) but
never an outcome. `cameraShots.ts` frames the batting shot between the HUD's bands at any aspect. The pitcher throws
only strikes: every pitch passes through the zone whole (`game/pitchSchedule.test.ts`), and `strikeZoneOutline.ts` draws
the zone as a faint box from the windup until the pitch is judged. The batting shot looks down, so a ball farther off
is drawn higher and one flat frame would show strikes nearer the pitcher above it; the box runs from where the bat meets
the ball, over the plate, to where a pitch let go by waits, so a strike is drawn inside it as the visitor swings, as it
crosses the plate, and while it waits. Its opening is the zone grown by the drawn ball's extra size. The stadium's lawn
and hedge take the visitor's season like the town's (`scene/environment`), the sky and light the time of day, and its
dugouts and foul poles the ballpark palette; none of this reaches the score.

`stage/actors/` builds the players in plain Three.js. `ballplayerRig.ts` is the town character's body, look, and
proportions posed by joints (two-bone IK legs on planted feet, a chest turning about a tilted spine, elbow arms); the
batter (`batter.ts`) is the visitor's character with a bat and mitten hands, playing the pose lab's swing as monotone
keyframe tracks (`keyframes.ts`, `swingMotion.ts`). It reads the contact point from `game/field.ts` and aims at it, so a
PERFECT swing squares the bat there, and each swing meets its ball `CONTACT_DELAY_MS` after it starts; a left-handed
batter is the mirror image. A swing turns its bat and leans toward its ball, holds its finish, and comes back to the
stance along keys of its own, low and in front of the body. Its keys keep the bat out of the body, and the elbows are
solved against the body's simple solids (`bodyVolumes.ts`), so the forearms and the mittens stay out of the body and the
forearms off the bat and each other.
The other team's pitcher (`pitcher.ts`) and catcher (`catcher.ts`) wear its brick red and
charcoal (`teamUniforms.ts`); the pitcher's throw is keyed on the same tracks with its release key at `game/pitch.ts`'s
`RELEASE_POINT`, and the catcher's mitt reaches for where each pitch ends up. `ballplayerCast.ts` drives all three from
the stage run: the pitcher throws on the derby's windup and release, the batter loads with them and swings each judged
swing so its bat meets the ball where and when the stage sends it off, and every head follows the ball (`headLook.ts`),
the batter's only as far as its bat lets a hat brim or hair turn. Nothing in `game/` reads the rigs.

### `baseball/vision/`

The webcam is read in the browser only, and nothing it sees leaves the device; `/baseball`'s CSP (`connect-src 'self'`,
`docker/nginx.conf`) enforces that. `tasksVision.ts` imports MediaPipe Tasks Vision only when asked, pinned to exactly
0.10.35 because 1.0.0 and later send usage logs, and loads everything from this origin: Vite fingerprints the wasm from
`frontend/`'s own copy of the package (not the one `@react-three/drei` depends on), and the models are committed in
`public/assets/models/`. It builds a task on the GPU or, when that fails, the CPU, builds it again after a lost WebGL
context, and keeps frame timestamps strictly increasing. `cameraInput.ts` asks for video only and stops every track on
`pagehide`, after two minutes without movement, when the camera ends by itself, and when its caller's signal aborts.
`poseLandmarks.ts` reduces a pose to the wrists, the shoulders (their width, midpoint, and height), and the head (the
nose) a swing reads, in the raw, unmirrored image, with the point, box, and grip geometry the held object and the
tracker share. `poseLoop.ts` runs the pose task on each camera frame from the video's frame callback, times each frame
by the browser's capture time (so a swing is timed when it happened, not after the frame was carried and tracked), keeps
the camera on while the visitor moves, and holds whether it sees them through brief flickers. A swing counts only once
the held object is locked, loaded behind the body on the batting side, and swept across the body's midline:
`heldObject.ts` locks an object EfficientDet-Lite0 finds next to the visitor's still hands (an allow list of things a
visitor might hold, never a person), one they tap on the camera picture or lock with the "lock this object" button, or
none in free mode, and lets a detected one go after enough misses while they stand still. The detector waits until the
computer is timed, then runs about 9 times a second while searching and 4 once locked, and rests during each windup and
pitch (the cadence is `heldObject.ts`'s, the pause the page's, since both follow the tracker and the derby rather than
the camera). `swingTracker.ts` follows the grip against the shoulders of frontal frames only (a turned torso narrows
them), arms on a load, and fires at the interpolated midline crossing once the sweep is fast and long enough, the head
stayed (a visitor walking by moves both), and `motionEnergy.ts` saw the band it swept through change; a swing whose
wrists blur out just before the midline still counts, with its bat height unknown. It confirms a swing within 150 ms of
the crossing, and the derby waits long enough past the last touching moment for that, a 15 fps frame, and the frame's
trip to the stage (`LATE_SWING_MARGIN_MS`, tied to it in `stage/stageRun.test.ts`), so a slow camera or computer never
loses a swing. The bat's height comes from where the grip crossed against the shoulders. `SWING_RULES` and
`CONTACT_HEIGHT` come from the drafts' synthetic swings and one webcam log and still need tuning on a real webcam; the
tests build their 30 fps sequences in code and commit no recordings. `performanceTier.ts` times this computer on every
visit (the 95th percentile of the pose task's time and of the page's drawn-frame gaps after a warm-up, not the camera's
frame rate; nothing is stored). `deviceGate.ts` names why the camera game cannot start (camera refused, missing, busy,
or failed; tracking could not start), which the page shows with another try; a computer too slow
to track is blocked like a phone. `cameraTracking.ts` runs the camera for the page, loading the pose task and the object
detector while the browser asks for the camera, and draws each frame mirrored with the upper body on the camera panel's
canvas (`ui/cameraOverlay.ts`) with the locked object's box. It reads swings on the same frames and hands each to the
page the moment it is seen, so React hears only status changes, whether the camera sees the visitor, and the tracker's
two- or three-word caption: where the tracker is, held at least 0.7 s so it never flickers, or at once what just
happened (a lock, a swing, a sweep that was not one). Once the camera is off, the motion sampler's last picture and the
tracked body are wiped along with the panel's.

### The `/baseball` page

`BaseballApp.tsx` checks the device first (`deviceGate.ts`: a phone or tablet, then WebGL 2) and shows why one cannot
play in the visitor's language (also when the stadium's graphics fail later, or when the camera finds this computer too
slow to track), then the character, then the derby. Each
run reads the KST month it starts in and gets a `crypto` seed (`flow/derbyFlow.ts`), so a page left open into a new
month plays the rules scheduled for it, as loaded with the page, from its next run. The editor's link to `?rules=next`
(`isNextRulesPreview` in `baseballRoute.ts`) plays the rules scheduled for next month instead, or this month's when
none are (`plannedBallparkRules`), badged `Preview · not ranked`; once ranked runs exist, such a preview must never get
a run ticket. The editor opens the preview in the same tab, so the preview's back links and Escape return to `/admin`
(`baseballExit`). The HUD (`ui/`) keeps only what the stage's events tell it (`derbyCues.ts`): a release carries
nothing it shows, so the pitch type reaches the screen only in a result, and the result banner waits until the ball is
down so it never covers the play; the scoreboard's home runs and their summed distance count a home run as its banner
shows. The banner and the HUD show the outcome, the distance, and the pitch type, never a timing verdict or a swing's
power. The result screen draws the `DerbyResult` that `replayDerby` returns with the `finished` event. The rules card
promises that the camera picture stays on the device and turns off on leaving or after two minutes without movement,
then turns the camera on with the only click the derby needs, which also unlocks its sounds and asks for the full
screen; the screen stays awake while the camera is on, asked again each time the page shows
(`flow/screenRequests.ts`). `flow/derbyFlow.ts` holds the steps after it: the setup, where the visitor picks the
batting side (which the batter, the camera panel, and the swing tracker follow), then practice, the step after it, the
run, and its result. Each step that waits goes on by its focused button (Enter and Space press it, as on any page) or by
holding the batting stance about three seconds (`flow/stanceHold.ts`): the swing tracker loaded on the batting side
with the grip up by the shoulders and still, measured in shoulder widths. A stance kept from before the step asked, or
in its first two seconds, counts for nothing, moving drains the ring at twice its pace, and a brief dropout holds it.
The vision loop follows the hold and fills `ui/StanceGauge.tsx` straight on its element, so React renders only when a
step changes. Practice pitches the game core's practice schedule at the practice pace as a derby of its own, with no
calibration, so its swings' errors are against the contact point, and it takes swings as late as the calibration still
counts one, so a slow camera's late swings still teach it. It tells each swing only a bit early, good, or a bit late
(its own error against the contact point, within the difficulty's GOOD window or not), and its swings calibrate every
run until the camera turns off. Practice and a run stand still once the visitor has been out of the camera's view
1.5 s, but only between pitches (before the first windup, or once a result's ball is down and another pitch is to
come), so a ball on its way plays out and no swing made meanwhile meets a pitch; the next pitch comes once they are
back. A camera that turns off, as after two minutes without movement, takes the page back to the rules card. In a dev
build, `devSeam.ts` lets an automated check stand in for a visitor the fake camera cannot show, and for their swings,
which the camera's frames hand over like tracked ones. In a dev build, D also shows `devDiagnostics.ts`'s panel
(`ui/DiagnosticsPanel.tsx`) for tuning on a real webcam: the camera's and the vision tasks' timing, the tracker and the
lock, each stance condition against its limit, and the last sweep from leaving the load to the stage's reaction against
the swing rules; L saves the last minute of these numbers as a JSON file on this device, no picture. A production
build leaves both out. `ui/cameraPanelLayout.ts`
places the camera panel: the mirrored camera is the stage while it sets up, a column under the scoreboard on the side
opposite the batter from practice on (medium, 29% of the width, by default; V or the camera button cycles medium, large,
hidden, remembered in `localStorage`), a corner chip while the camera chases a home run, and hidden on the result screen
(which can turn the camera off) or below a readable width, but never while the camera looks for the visitor. The stage
centres the play and the HUD its caption and banner in the band the panel leaves free (`centreInBand` in
`stage/cameraShots.ts`). No key swings and there is no swing button (keys only press the focused button, leave with
Escape, or resize the camera panel with V, and in a dev build show the diagnostics with D and save them with L): the
swings are the camera's, which the stage takes before advancing the derby in the same frame, so a swing seen a little
late is still judged at the moment its frame was taken.

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
