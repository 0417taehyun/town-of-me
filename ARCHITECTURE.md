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
| Venue settings: whether visitors see the ballpark, its colors, pitch count, and difficulty, and next month's rules             | database (`towns.venues`)                                  | admins at `/admin`              |
| Admin emails                                                                                                                   | database (`admin_emails`), filled from `ADMIN_EMAILS` once | admins at `/admin`              |
| Guestbook notes                                                                                                                | database (`guestbook_entries`)                             | visitors write, admins approve  |
| Ranked derby runs, each visitor's best record per KST month, its optional LinkedIn link, reports, and blocked links            | database (`minigame_*`)                                    | visitors play, admins review    |
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
| `editor/`          | The admin editor: panels, gestures, history, admins, guestbook and board review. Only on `/admin`.  |
| `ui/`              | DOM overlays: entry, HUD, dialogue, guestbook, map, character creator. The `/privacy` page.         |
| `baseball/`        | The derby at `/baseball`, a lazy chunk; only its gate and `baseballRoute.ts` are in the main chunk. |
| `camera/`          | Camera defaults and pure camera math.                                                               |
| `audio/`           | Procedural music, voices, footsteps, skid squeal, derby sounds, and the bark sample.                |
| `i18n/language.ts` | All copy, in Korean and English.                                                                    |
| `hooks/`           | Session, page language, local time and season, reduced motion, retryable loading, monthly statues.  |
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
| `venues/`      | The venues past the hedge: edge slots and their approaches (`venueSlots.ts`), placements and gates (`venuePlacements.ts`), exteriors (`VenueExteriors.tsx`), theme palettes, a material per color role, the ballpark's parts and podium garden.          |
| `statues/`     | The painted statue of a board's top three (`paintedStatue.ts`): the character as plain Three.js (`statueFigure.ts`), the place finishes, and canvas-painted textures. The board and the town's podium garden both draw it.                               |

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

### `baseball/`

The derby draws on its own flat canvas (`BaseballStage.tsx` never installs the world curve) and reads the webcam in the
browser. Why each rule and number is what it is lives in the commit messages.

- **Top level:** the visibility gate (`BaseballGate.tsx`, `useBallparkGate.ts`), the path, previews, and exits
  (`baseballRoute.ts`, in the main chunk), the page (`BaseballApp.tsx`), the camera and vision tasks run for the page
  (`cameraTracking.ts`), the device check (`deviceGate.ts`), the character check (`baseballSession.ts`), ranked runs on
  the monthly board (`useRankedRuns.ts` over `data/leaderboardApi.ts`), and the median and percentile helpers
  (`statistics.ts`).
- **`game/`:** scoring a server can mirror: run plans and seeds, the pitch schedule, judging, landing, calibration, the
  live derby on `gameClock.ts` time (`derby.ts`), and its replay (`derbyScore.ts`). `flight.ts` only draws a path to
  the decided landing.
- **`stage/`:** run playback (`DerbyDirector.tsx`, and `stageRun.ts`, which keeps the derby, clock, ball, and shot in a
  ref and reports only events to React), the players' driver (`ballplayerCast.ts`), camera shots, the ball, flashes,
  and the strike-zone box.
- **`stage/actors/`:** the players in plain Three.js: the town character's body posed by joints (`ballplayerRig.ts`),
  the batter and its aim solve (`batter.ts`, `bodyVolumes.ts`), keyframed swings, the pitcher, catcher, and fielders.
- **`stadium/`:** the garden ballpark (field, bowl, landmarks, crowd, field crew, breeze, floodlight, scoreboard), laid
  out in the `*Layout.ts` files; buildings take the palette's roles, nature the visitor's season, and the sky the time
  of day.
- **`vision/`:** MediaPipe (`tasksVision.ts`), the camera stream (`cameraInput.ts`), the pose loop, the held object
  (`heldObject.ts`), the swing tracker (`swingTracker.ts`), motion energy, and the performance tier.
- **`flow/`:** the steps after the rules card (`derbyFlow.ts`), the stance hold (`stanceHold.ts`), a run and the board
  (`rankedRun.ts`), full screen, and the wake lock.
- **`ui/`:** DOM overlays: the HUD and what it may show (`DerbyHud.tsx`, `derbyCues.ts`), the camera panel and its
  layout (`cameraPanelLayout.ts`), the setup, practice, result, listing, and blocked screens, and the diagnostics
  panel.
- **`board/`:** the monthly board at `/baseball/ranking`, its own lazy chunk (`BoardPage.tsx`): the painted statues in
  one canvas (`BoardPodium.tsx`, `podiumScene.ts`), the list's portraits from one offscreen renderer
  (`portraitImages.ts`), seasons (`boardSeason.ts`), and what rows show (`boardView.ts`). `?view=hall-of-fame` opens
  every finished season's statues (`HallOfFamePage.tsx`) behind the same gate; the own card lists the visitor's past
  statues (`OwnPastSeasons.tsx`).
- **`devDiagnostics.ts`, `devSeam.ts`:** dev only. D shows the camera's, tracker's, and stance's numbers; L saves the
  last minute per camera frame (upper-body joints, detections, stance), never a picture, on this computer only. The
  seam lets an automated check stand in for a visitor and their swings.

Keep these when changing the derby:

1. `game/` is plain TypeScript importing at runtime only itself, `statistics.ts`, and constants from `data/models.ts`,
   so a server can score a run the same way (`replayDerby` over the `RunPlan` and the raw `DerbyInputLog`). The
   backend's copy is `backend/src/derbyJudge/`, and `backend/test/derbyJudgeVectors.json` (copied byte for byte to
   `game/derbyJudgeVectors.json`, checked by both) holds both to the same results, so a change to a judging value or
   operation changes all four.
2. A landing is decided without randomness from timing, power, and bat height; the seeded generator (mulberry32) plans
   only the pitches and the crowd's padded looks.
3. The pitcher throws only strikes: every pitch passes through the zone whole (`game/pitchSchedule.test.ts`).
4. The stage changes the pace (holds, hit-stop, slow motion, pauses), never an outcome; no cue reaches the derby.
5. The batter's arms, mittens, and bat never enter its head or body, nor the arms and mittens the bat or each other
   (`bodyVolumes.ts`, `batterOverlap.*.test.ts`); the aim is solved over several frames (`settleBatter`).
6. The camera picture never leaves the device: `/baseball`'s CSP has `connect-src 'self'` (`docker/nginx.conf`),
   `@mediapipe/tasks-vision` stays pinned to 0.10.35 (1.0.0 and later send usage logs), and the models are committed in
   `public/assets/models/`.
7. Every swing is the camera's: keys only press the focused button, leave with Escape, and cycle the camera panel with
   V (D and L in a dev build).
8. `baseball/` never imports `editor/`, `TownScene.tsx`, or the kinds registry.
9. `devDiagnostics.ts` and `devSeam.ts` are reached only behind `import.meta.env.DEV`; a production build has neither.
10. `SWING_RULES`, `CONTACT_HEIGHT`, `HELD_OBJECT_RULES`, and `STANCE_HOLD_RULES` are untuned on a real webcam
    (TODO.md); tests build their camera sequences in code and commit no recordings.

### The `/baseball` page

`BaseballGate.tsx` reads the town first. While the admin hides the ballpark (`town.venues.ballpark.visible`, false until
shown), only an admin's preview plays it (`ballparkOpens` asks `/v1/me` for the role only then); anyone else gets a
coming-soon card, and neither the derby's chunk nor the camera loads. The town reads the same flag: while it is shown,
the hedge opens at the end of the north road onto the ballpark's exterior and gate, whose prompt saves the visit and
leaves by a full page load (`window.location.assign`), so `/baseball` gets its own CSP and camera permission and the
visitor comes back to the gate, and a branch of that road, painted into the ground with it, leads to the podium garden
beside it, whose approach the editor keeps clear. There this KST month's top three stand as painted statues, still but
for a twinkle, read from the public `/podium` (`hooks/usePodium.ts`, again every few minutes and as the month turns;
a failed read leaves the pedestals waiting), and walking up to one opens its card (`ui/StatueCard.tsx`) through the
player's nearby interaction, after a resident. While it is hidden, nothing in the town hints at it, nor reads
`/podium`. The board at `/baseball/ranking` opens behind the same gate with no preview, so nothing ranked shows while
the ballpark is hidden.

`BaseballApp.tsx` then checks the device (a phone or tablet, then WebGL 2, later a computer too slow to track), the
character, and plays the derby. Each run asks the monthly board for a ranked run as it starts and plays the rules and
seed the server issued (`useRankedRuns.ts`); without an answer within 3 s, while the ballpark is hidden, or after a
practice that timed fewer than three swings, it plays unranked on the rules of the KST month it starts in and a
`crypto` seed (`flow/derbyFlow.ts`), and its result says so in a line. A ranked result sends only the
`DerbyInputLog`, the claimed totals, and the character's look with the board name (`rankedRunBody`), never gender, a
LinkedIn link, or anything the tracker saw; the server scores it again. The editor's previews, `?rules=next` (next
month's rules, or this month's when none are scheduled) and `?rules=current`, are badged `Preview · not ranked`, never
ask the board, and return to `/admin` (`baseballExit`). The rules card's one click turns the camera on, unlocks the
sounds, and asks for full screen and a wake lock. Then the setup (batting side), practice, the run, and its result each
go on by the focused button or by holding the batting stance about three seconds. Practice tells each swing early,
good, or late against the visitor's own usual timing (`practiceCalibration`) and calibrates the runs. Practice and a run
stand still between pitches while the visitor is out of view, and a camera that turns off goes back to the rules card.
The HUD and the result show the outcome, the distance, and the pitch type, never a timing verdict or power. The result
also says where the run left the visitor on the board; its listing card (`ui/ListingView.tsx`) posts the record only
after the visitor ticks the box, with the name (or none, an anonymous batter) and, opted in, the character's LinkedIn
link, whose ownership code it then shows.

`board/BoardPage.tsx` shows a season's board (`?season=YYYY-MM` for one of the last twelve final boards), which works
on phones too: the top three as painted statues over DOM name plates (read 1, 2, 3, shown 2, 1, 3; the canvas is
`aria-hidden`), which rise third to first the first time a browser sees a month; places 4 to 50 as an `<ol>`; and the
visitor's own record between them, which the same listing card posts, hides, or changes (a past season's record can
still turn its LinkedIn link off). It shows names only once approved, a LinkedIn chip only on a statue whose link the
admin approved, and the server's order, whose ties go to the earlier record. Every row's menu reports its name,
character, or link, copies its number, or mails the owner a takedown request, and the footer deletes all of the
visitor's records whatever their state. The result screen and the rules card link to it.

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
| `derbyJudge/`                  | Copy of the frontend's `baseball/game/` judge: scores a run again from its log.    |
| `homeRunDerby.ts`              | The ranked derby: its result's shape, the server's score, and the review checks.   |
| `leaderboard.ts`               | Runs, monthly records, the public order, and how a scored run changes a record.    |
| `leaderboardIdentity.ts`       | What a record shows of its player: the board's name check and LinkedIn link check. |
| `leaderboardReview.ts`         | The admin's review queue and actions on records and held runs, and reports.        |

Tests run with `npm test` through `test/run.ts`. `test/storeContract.ts` runs the same behaviors against both stores
(PostgreSQL when `TEST_DATABASE_URL` is set); the flow tests drive the HTTP handler.

## Main flows

- **Visit:** `GET /v1/towns/:id` → `townApi.ts` parses it (unknown kinds and variants dropped) → the scene chunk draws
  it. A failed request shows `Try again`; there is no built-in town.
- **Edit:** LinkedIn sign-in → session cookie → `/admin` loads the saved town → edits stay local → `PUT
/v1/admin/towns/:id` with the revision it loaded (a stale revision gets `409`).
- **Guestbook:** anyone writes one note a day per browser cookie; notes stay pending until an admin approves them.
- **Ranked run:** the derby asks for a run (rules for the KST month, a seed) → plays it → sends the raw swing numbers
  → the server scores them again and keeps the visitor's best record for the month the run was issued in. A listed
  record joins the public board, whose first three are the statues (`/podium`); they stand unchecked, and an admin
  reviews them, held runs, links, and reports afterwards.
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

**A new venue** (a backend change first, then a frontend one; the backend drops venue ids it does not know):

1. Backend: add its key to `TownVenues` and `parseTownVenues` in `backend/src/town.ts`, its look parsed by
   `parseVenueLook` (which carries `visible`), and a case in the tests.
2. Frontend: its key, default, and parser in `data/models.ts` and `data/townApi.ts` (`parseVenues`); an edge slot
   measured in the town in `VENUE_SLOTS` (clear of the hills and the follow camera's side) and its entry in
   `VENUE_PLACEMENTS`, with the path its gate leads to; an exterior drawn in the slot's frame in `VENUE_EXTERIORS`;
   `venues.<id>` copy, which the type checker asks for; a path check and a lazy page in `App.tsx`; and, if the page
   needs its own headers, an nginx location in `docker/nginx.conf`.
3. The gate opens, the forest clears, and the prompt appears only while the venue's `visible` is true.

**Another animal:** there is one pet today, so there is no animal interface yet. When a second animal arrives, extract
the shared shape from `scene/animals/` the way `Gait` was extracted, rather than designing it up front.

**A backend route:** add it to the route table in `http.ts`, put the rule in a `service.ts` method (with `assertAdmin`
for admin routes), add store methods to both stores with a case in `test/storeContract.ts`, and document it in
`backend/README.md`. Schema changes are new numbered files in `backend/migrations/`; never edit an applied one.

## Checks

Each module has `npm run lint`, `npm run format:check`, `npm test`, and `npm run build`; `npm run check` at the root runs
both. Visual changes have no screenshot tests: check them in a browser at several times of day and seasons.
