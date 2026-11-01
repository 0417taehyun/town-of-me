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
late as the calibration still counts one past the contact point, so a server needs none of it. It judges each pitch
against the visitor's usual timing in its swings so far, this one's included (`practiceCalibration`), and keeps that
calibration for the stage to draw the pitch with; `replayPractice` judges it again the same way. Its swing deadline
never moves with that usual timing, so which swings it takes, and with them the runs' calibration from their raw errors,
never hang on its own judging.

### `baseball/stage/` and `baseball/stadium/`

The stage draws a run on its own flat canvas: `BaseballStage.tsx` never installs the world curve. `DerbyDirector.tsx`
plays the run in one `useFrame`: `stageRun.ts` keeps the derby, its game clock, the ball, and the camera's choice in a
ref and reports only events to React. The ball is the pitcher's until the derby releases it; a pitch then waits at the
back of the batter's reach while a swing that touches it could still be reported (a camera swing comes up to the derby's
late margin after it), so the mitt never catches a ball the bat then hits. A ball in play leaves the bat where the bat
met it and flies to the landing the judge already decided, fast enough to come down before its result ends. The batter's
swing is the stage's too (`ShownSwing`): it begins when the camera cues the visitor's swing starting, eases into the
slot short of the plate until the derby judges it, and a judged swing gets its last stretch to the ball, timed from
where it is drawn (`lastStretchFor`: a frame or two from near the slot, the whole `CONTACT_DELAY_MS` from the windup).
The stage changes the clock's pace (a step back for a hit reported late, so the bat swings that stretch into the ball,
after the clock stands still a few frames, the ball resting at the back of the reach, while the batter aims the swing a
slice a frame; a hit-stop that holds them together; slow motion at a showcase home run's peak; a pause while the page
is hidden) but never an outcome, and no cue reaches the derby. `cameraShots.ts` frames the batting shot between the HUD's bands at any
aspect. The pitcher throws only strikes: every pitch passes through the zone whole (`game/pitchSchedule.test.ts`), and
`strikeZoneOutline.ts` draws the zone as a faint box from the windup until the pitch is judged. The batting shot looks
down, so a ball farther off is drawn higher and one flat frame would show strikes nearer the pitcher above it; the box
runs from where the bat meets the ball, over the plate, to where a pitch let go by waits, so a strike is drawn inside it
as the visitor swings, as it crosses the plate, and while it waits. Its opening is the zone grown by the drawn ball's
extra size. The stadium's lawn and hedge take the visitor's season like the town's (`scene/environment`), the sky and
light the time of day, and its dugouts and foul poles the ballpark palette; none of this reaches the score.

`stage/actors/` builds the players in plain Three.js. `ballplayerRig.ts` is the town character's body, look, and
proportions posed by joints (two-bone IK legs on planted feet, a chest turning about a tilted spine, elbow arms); the
batter (`batter.ts`) is the visitor's character with a bat and mitten hands, playing the pose lab's swing as monotone
keyframe tracks (`keyframes.ts`, `swingMotion.ts`). It reads the contact point from `game/field.ts` and aims at it, so a
PERFECT swing squares the bat there. A swing the camera saw begin leans toward the pitch and eases into the slot, the
bat still behind the batter, and goes back to the windup by itself unless it is judged by then; once judged it speeds up
onto its ball, as fast at the ball as a swing from the windup, or it is checked short of the plate and goes back, each
stretch starting where and as fast as the last left the bat; a left-handed batter is the mirror image. A swing turns its
bat and leans toward its ball, turning its chest and lunging with its body rather than stretching an arm for a ball
met far out in front, holds its finish, and comes back to the stance along keys of its own, low and in front of the
body. Its keys keep the bat out of the body, and the elbows and the head's tilt and turn are solved against the body's
simple solids (`bodyVolumes.ts`), smoothly from moment to moment, so the arms, the mittens, and the bat stay out of the
head, its hair and hat, and the body, and the arms and mittens off the bat and each other. That aim is the costliest
work a frame could do, so no frame does it at once: the aims a swing from the windup takes are solved ahead during the
windup, and a hit's is solved a slice a frame while the stage waits (`ballplayerCast.ts` `settleBatter`).
The other team's pitcher (`pitcher.ts`) and catcher (`catcher.ts`) wear its brick red and charcoal (`teamUniforms.ts`);
the pitcher's throw is keyed on the same tracks with its release key at `game/pitch.ts`'s `RELEASE_POINT`, and the
catcher's mitt reaches for where each pitch ends up. `ballplayerCast.ts` drives all three from the stage run: the
pitcher throws on the derby's windup and release, the batter loads with them and swings the swing the stage shows, a
judged one's bat meeting the ball where and when the stage sends it off, and every head follows the ball
(`headLook.ts`), the batter's only as far as its arms, mittens, and bat let a hat brim or hair turn, easing away
ahead of them while the swing moves them. Nothing in `game/` reads the rigs.

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
`heldObject.ts` locks by itself an object EfficientDet-Lite0 finds within a shoulder width of the visitor's still wrists
(it boxes a held bottle above the fist, 0.5–0.9 SW off in the drafts' log) once enough sightings agree, or one they tap
on the camera picture, and lets a detected one go after enough misses while they stand still. It locks only what an
allow list says a visitor might hold: never a person, nor a remote, which the log's detector took the empty hands for
through most of the minute, nor a phone or a mouse, the same kind of small thing nobody swings. When nothing has locked
about two seconds after the hands came into view, `swingTracker.ts` plays free mode on the detector's next run that
finds nothing by the still hands. That time runs while the detector still rests for the speed check, whose line asks for
the upper body and the hands in view, so a visitor with nothing to hold waits out the check, not the check and then a
search, and free mode never starts before the detector has looked. On every step a real object that locks later still
takes over, and one lost hands back to free mode at once, its caption saying so, so play goes on with the hands: the
design doc has a lost lock search again, which waits for the detector while it rests through every pitch, so a pitch or
two could not be swung at. While searching, the caption says it looks for what the visitor swings and that without one
both hands together will do, as on a bat, while the stance's line asks for the object or both hands held still. It never
says to swing: the search runs only on the setup step, where a swing meets no pitch and keeps free mode from starting.
Free mode's caption asks to bring the hands together, never to swing: it starts while the hands keep still, often
mid-stance on the setup step. Free mode follows where the wrists meet, but one that takes over from an object lost from
one hand goes on following that hand, for its swings and its stance alike, its caption saying to carry on as before (a
loss lands while the visitor keeps still, mostly mid-stance, so it never says to swing): in the drafts' real webcam log
the free hand hung 1.5 shoulder widths off, so the wrists' middle halved the next one-handed swing, which then fell
short. It turns two-hand, without a caption, once the hands have held a still load together for 300 ms (not hands that
only look together for a frame or in a swing's turned finish) with their middle loaded too, so that the switch never
un-counts a stance the one hand held, or follows another hand once an object locks in it. A lock or a loss that keeps
the hand followed keeps the load too, so the detector locking and losing the log's bottle three times in 15 s on the
setup step never makes the visitor load again. The detector waits until the computer is timed, then runs 4 times a
second while looking for an object (searching, or from a sighting by the hands until a lock window passes without
another), and otherwise only glances: once a second to keep a detected one fresh, back at 4 a second once a glance
misses it until it is seen again or let go, and in free mode, to spot a real one, once a second in play and twice on the
setup step, where the visitor picks up what they swing. It never runs while no hands show, as with nobody in view, since
what it finds is judged against them, nor for a tapped lock. The design doc has 9 a second while looking and 4 once
locked, but each run holds up the pose frames for some 40–65 ms: on a 30 fps fake camera, runs due every 110 ms left the
setup screen 15–16 pose frames a second, every 250 ms 22–25, every 500 ms 26–27, and once a second 27–29, against 29–30
with none. A lock still takes three sightings, so a held bottle locks about 0.5 s after the first run that sees it, or
1.1 s if the detector misses every other run, which the lock window (1.5 s rather than the drafts' 1 s) still fits; in
free mode the glance that first sees it comes up to half a second later on the setup step, a second in play. One picked
up on the setup step in free mode so locks 0.5–1 s later (0.8 s typically) if the detector finds it on every run, but
some 1.7 s, one time in ten nearly 4 s or more, if on half its runs: a wait of a few seconds is a patchy detector, not a
fault. Replaying the drafts' real webcam log, its bottle locks 1.3 s after it came within reach from a search and 1.5 s
from free mode, the visitor moving it in between (within 0.3 s at 9 runs a second). A detected object is let go after
six misses over 1.5 s with the hands still, so a few misses in a row never drop one still held, and one put down goes
1.6–2.6 s after it left the hands (the drafts' six misses at 4 a second took 1.5 s from the first). It rests from each
windup until the pitch's ball is down (the cadence is the tracker's, `objectDetectionInterval`, the pause the page's,
since both follow the tracker and the derby rather than the camera).
`swingTracker.ts` follows the grip against the shoulders of frontal frames only (a turned torso narrows them), arms on a
load, and fires at the interpolated midline crossing once the sweep is fast and long enough, the head
stayed (a visitor walking by moves both), and `motionEnergy.ts` saw the band it swept through change; a swing whose
wrists blur out just before the midline still counts, with its bat height unknown. It reports a swing on the first
frame that meets every rule, usually the crossing's own. Before that, once a sweep toward the batting side closes on
the midline fast, it cues the stage that a swing has begun and when it should cross, and if the sweep then ends without
a swing, that it was checked; only the batter's look follows a cue. It confirms a swing within 150 ms of the crossing,
and the derby waits long enough past the last touching moment for that, a 15 fps frame, and the frame's
trip to the stage (`LATE_SWING_MARGIN_MS`, tied to it in `stage/stageRun.test.ts`), so a slow camera or computer never
loses a swing. The bat's height comes from where the grip crossed against the shoulders. `SWING_RULES` and
`CONTACT_HEIGHT` come from the drafts' synthetic swings and one webcam log and still need tuning on a real webcam; the
tests build their 30 fps sequences in code and commit no recordings. `performanceTier.ts` times this computer on every
visit (the 95th percentile of the pose task's time and of the page's drawn-frame gaps after a warm-up, not the camera's
frame rate; nothing is stored). `deviceGate.ts` names why the camera game cannot start (camera refused, missing, busy,
or failed; tracking could not start), which the page shows with another try; a computer too slow
to track is blocked like a phone. `cameraTracking.ts` runs the camera for the page, loading the pose task and the object
detector while the browser asks for the camera, and draws each frame mirrored with the upper body on the camera panel's
canvas (`ui/cameraOverlay.ts`) with the object it marks: a found one's box, name, and lock progress (while searching,
or in free mode on the setup step; in play a glimpse by empty hands would only flash), or a locked one's box. It reads
swings and their cues on the same frames and hands each to the page the moment it is seen, so React hears only
status changes, whether the camera sees the visitor, and the tracker's short caption: where the tracker is, held at
least 0.7 s so it never flickers, or at once what just happened (a lock, a lost object, a swing, a sweep that was not
one). The design doc asks for two- or three-word captions; the search caption is longer on purpose, so it also tells a
visitor with nothing to hold that both hands together will do. The panel reads from 2 m: above the picture a 9vh chip
says in a word where the camera and the tracker are, coloured by it (dark looking, red to put right, blue ready, green
loaded, coral with a pop for a swing), and under it a 6vh line says the caption, or what a step waits for in its
place (`ui/derbyCues.ts cameraPanelWords`). Once the camera is off, the motion sampler's last picture
and the tracked body are wiped along with the panel's (a dev build's diagnostics keep their notes, below).

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
holding the batting stance about three seconds (`flow/stanceHold.ts`), read from the pose rather than the swing
tracker's states once it has locked what the visitor swings: the grip (both hands together, or the one that holds the
object) behind the body's midline on the batting side as far as the tracker loads, up by the chest or shoulders, and
still, its smoothed path measured in shoulder widths against the pose task's jitter as the drafts' real webcam log
shows it. Nothing counts in a step's first second; on the setup a stance the visitor already stands in counts, while
after practice or a run one kept from the last swing counts only once they have been seen moving or lowering their
hands for over 300 ms, so a glitch of the pose task is no fresh stance. A break or a tracking loss under 300 ms neither
fills nor drains the ring, and a longer one drains it as fast as holding fills it. The vision loop follows the hold and
fills `ui/StanceGauge.tsx` straight on its element; the line under the ring says what the hold waits for, the first
unmet first: the upper body in view, the hands inside the picture (a followed wrist within 5% of its edge, or past it
where the pose task only guesses it, as the drafts' log had the hands at the bottom, so that comes before any height or
place), the lock, both hands together as on a bat in two-hand free mode, raised by the back shoulder, a fresh stance,
held still, and in a step's first second, while the ring cannot fill, that the stance is being checked rather than to
keep holding. Right after swings, hands at the picture's edge are taken for lowered ones, so the line asks for a fresh
stance and then for the hands raised rather than to step back. React renders only when a step or the line changes, and
while a step waits the camera panel's line says the same in place of the swing tracker's directions to swing
(`ui/derbyCues.ts seenCameraState`). The ring and the line beside it are sized for 2 m, and a full ring dings and
flashes a big word for what it starts (practice, play ball, again). A lock that lands mid-hold leaves the ring filling: the grip moves to one hand only
when the wrists are too far apart to hold a stance in free mode, or the other is hidden and the grip was that hand
already. Practice pitches the game core's practice schedule at the practice pace as a derby of its own, and it takes
swings as late as the calibration still counts one past the contact point, so a slow camera's late swings still teach
it; each pitch waits at the back of the reach until then, as any of them may be on time. It judges each swing against
the visitor's own usual timing (`game/calibration.ts practiceTimingOffset`, `game/derbyScore.ts practiceCalibration`):
from the third valid swing on, the offset a run's calibration takes off, the median error of the valid swings so far
against the contact point, this one included. Before that there is no usual timing yet, so a valid swing is judged
against its own error and is on time: the first two say good, however far apart (against their midpoint, a second swing
far from the first would be early or late). The usual timing keeps to the range a run's offset keeps (−150 to +300 ms),
so a first swing further off than any run takes off is told early or late, as a run would tell it. The pitch on the
field and the word under it come from that one judgement, so they always agree: it tells each swing only a bit early,
good, or a bit late (`shownPracticeFeedback`), its judged error within the difficulty's GOOD window or not. Against the
contact point alone, as the drafts' design first had it (8.3 (c)), a webcam's steady delay would call nearly every swing
late. Its swings calibrate every run until the camera turns off, with their raw errors; a run takes the usual timing off
only from three valid swings (`findsUsualTiming`), so a practice that ends with fewer says so on its last card rather
than that the timing is set. Practice and a run stand still once the visitor has been out of the camera's view 1.5 s,
but only between pitches (before the first windup, or once a result's ball is down and another pitch is to come), so a
ball on its way plays out and no swing made meanwhile meets a pitch; the next pitch comes once they are back. A camera
that turns off, as after two minutes without movement, takes the page back to the rules card. In a dev build,
`devSeam.ts` lets an automated check stand in for a visitor the fake camera cannot show, and for their swings, which the
camera's frames hand over like tracked ones. In a dev build, D also shows `devDiagnostics.ts`'s panel
(`ui/DiagnosticsPanel.tsx`) for tuning on a real webcam: the camera's and the vision tasks' timing, the tracker and the
lock, each stance condition against its limit, and the last sweep from leaving the load to the stage's reaction against
the swing rules, with the judged swing's raw error against the contact point beside its judged one, since practice's and
a run's judging take the camera's lag out. The sweep shows its swing-start signal too: when its frame was taken and
handled, how fast the grip closed on the midline then, and the crossing it expected, against `startSpeed` and
`startHorizonMs` (or, if none was given, the frame it closed fastest on); a sweep that signalled the batter's start but
never left the load zone is noted too. L saves the last minute as a JSON file on this device: these numbers and, for
each camera frame, what the swing tracker and the stance hold read of it (the upper body's joint positions and the hips,
what the object detector handed the tracker, the motion in the swing's band, the picture's size, the batting side, and
the step that waited), with each pitch's release and result and each tap on the camera picture on the frames' clock;
never a picture. The file stays on this computer unless the visitor hands it over; until the tab closes, a dev build
also keeps that minute in memory after the camera turns off, so L can still save it. `devReplay.ts` feeds such a file
back through the swing tracker and the stance hold as their rules are now, taps included, so a real session tunes
`SWING_RULES`, `STANCE_HOLD_RULES`, and `HELD_OBJECT_RULES` (the motion stays as the page measured it, in the band it
used then). A dev build's detector reports detections down to 0.2 rather than `candidateScore`, which play still
filters by, so a replay can lower that bar to 0.2 but can add no label; the file's three decimals can tip a frame near
a rule's limit the other way, and a file that starts mid-session replays from a fresh tracker and stance hold, so its
first seconds differ from the notes. The drafts' design leaves out both the diagnostics export and its log replay; dev
builds keep them, since the rules need a real webcam's tuning. A production build leaves the panel and the saver out;
nothing in the app imports the replay. `ui/cameraPanelLayout.ts`
places the camera panel: the mirrored camera is the stage while it sets up, a column under the scoreboard on the side
opposite the batter from practice on (medium, 29% of the width, by default; V or the camera button cycles medium, large,
hidden, remembered in `localStorage`), a corner chip while the camera chases a home run, and beside the result screen
too, where the design doc hides it, as that screen waits for the visitor's stance (its card, like practice's last one,
centres in the band the panel leaves, and the screen can turn the camera off). A panel the visitor hid comes back at
medium while the camera looks for them or a step waits for their stance, so they see the stance they take, and it hides
below a readable width. The stage centres the play and the HUD its caption and banner in the band the panel leaves free
(`centreInBand` in `stage/cameraShots.ts`). No key swings and there is no swing button (keys only press the focused
button, leave with Escape, or resize the camera panel with V, and in a dev build show the diagnostics with D and save
them with L): the swings are the camera's, which the stage takes before advancing the derby in the same frame, so a
swing seen a little late is still judged at the moment its frame was taken.

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
