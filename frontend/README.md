# Town of Me — frontend

The browser town: a React and React Three Fiber app that draws the town the backend stores, lets visitors walk around
it, and gives admins an editor at `/admin`. How the code is organized, and how to add object kinds, variants, or walks,
is in the root [ARCHITECTURE.md](../ARCHITECTURE.md).

The cozy miniature-town mood is high-level inspiration only; the project does not copy characters, UI, names, music, or
maps from Animal Crossing or any other game.

## Run it

Requirements: Node.js 26 or newer. Run `npm run dev` at the repository root to start the frontend with the backend, or
from this directory to start only the frontend (it proxies `/v1` to `BACKEND_PROXY_TARGET`, by default
`http://localhost:3000`).

```bash
npm run dev
npm run lint
npm run format:check
npm test
npm run build
```

## Visiting the town

- **Entry:** visitors start with `Continue as Guest`, read the owner's introduction when the town has one, and build a
  character in a live 3D preview: hat, hair, eyes, nose, mouth, mustache, ears, top, bottom, shoes, and colors. Gender
  is optional and never limits a choice. The character and session stay in the browser tab (`sessionStorage`) and end
  when the tab closes.
- **Contact:** when the owner has set a contact email, a button at the top of the town opens the visitor's mail app.
- **Language:** Korean or English, following the browser and switchable at any time. The tab remembers the choice, so
  the ballpark at `/baseball` and the town open in the same language.
- **The town:** loaded from `GET /v1/towns/:id`. If the request fails, visitors see `Try again`; there is no built-in
  town. A short guide walks first-time visitors through moving, looking around, sitting, the pet, residents, and the
  guestbook.
- **Residents:** walk their routes, sit on benches, and chat with each other. Talking to one offers "Who are you?",
  answered from their role, relationship with the owner, and LinkedIn link, and "What kind of person is <owner>?",
  answered with lines the admin prepared from their reference. Up to three follow-up questions follow, never repeating
  one already asked. A resident without prepared lines says a neutral line rather than inventing one.
- **The owner:** one resident can be the owner, marked "town owner" on their name tag. Asked "Who are you?", they
  answer with the owner's introduction and the contact link, then offer up to five questions the owner wrote.
- **The pet:** a corgi that walks a loop around the fountain, or the walk the admin drew. `E` pets it and `G` greets it
  with two soft woofs.
- **Houses:** approaching one shows its owner's name, linked to their LinkedIn profile when the town has one.
- **Guestbook:** anyone may write one note a day per browser and edit it that day. Notes appear after an admin approves
  them, and only the character's name and look are sent with a note.
- **Time and seasons:** lighting, sky, lamps, music, birds, and clouds follow local time; the season follows the
  Northern Hemisphere month. The sun button previews any time and season. Changes play out in order: leaves fall
  before snow settles, and snow melts before leaves return.
- **Home-run derby:** `/baseball` is a home-run derby in a garden ballpark, batting as your town character. Each run
  plays the pitch count (3–10) and difficulty the admin set for the current month in Korean time; a change takes effect
  from the next month, and a run started after midnight on the first plays the rules scheduled for it. A ball in play
  is a home run, a hit, or a foul; a pitch you let go is a strike and one you swing through a miss, and there are no
  outs. The result banner names the pitch type only after the pitch. The result shows the home runs, their total
  distance, and the longest. Its sky, light, lawn, and snow follow local time
  and season like the town's, without changing the score. Phones, tablets, and browsers without WebGL 2 see why they
  cannot play, with an address to copy.

## Controls

| Action                      | Input                                            |
| --------------------------- | ------------------------------------------------ |
| Move                        | `WASD` or arrow keys                             |
| Sprint                      | Keep moving, or hold `Shift` / on-screen `RUN`   |
| Look around                 | Drag on the town                                 |
| Interact (talk, pet, sit)   | `E` or the on-screen button                      |
| Greet the pet               | `G` or the on-screen button nearby               |
| Take a photo                | `C`                                              |
| Edit character              | Your initial in the top-right corner             |
| Preview time and season     | Sun button in the top-right HUD                  |
| Town map                    | Map button in the top-right HUD                  |
| Mobile movement             | One-finger virtual stick                         |
| Mobile camera               | Two-finger pan; spread fingers to widen the view |
| Field of view               | Mouse wheel                                      |
| Debug view                  | `H`                                              |
| Respawn and recenter camera | `R`                                              |
| Swing (home-run derby)      | `Space` / `Enter` or the on-screen `Swing`       |
| Leave the derby             | `Esc` or `Back to town`                          |

The camera button tunes the follow camera live, and `?` reopens help. Turning off `Ambient motion` in help freezes
clouds, birds, and water; the system's reduced-motion setting slows them instead.

## The admin editor

Open `/admin`. Only a LinkedIn account whose verified email is on the admin list gets the editor, and the backend checks
the role again on every save.

- **View:** the top view pans with a drag, turns with a right-drag, and zooms with the wheel. `Visitor view` shows the
  same spot from a visitor's eye level.
- **Browse:** the left panel has six tabs: Buildings, Paths, Nature, Props, Sky, and People. A tab shows its kinds with
  live counts (`Flower 79`); a kind shows its `Add` button and a list of its objects with a color swatch and variant.
  Choosing a row selects it and moves the camera to it. On a phone, `Show list` opens the list.
- **Select:** only the open tab's markers can be picked; the others are faded. Click a marker to select it,
  `Shift`+click to add or remove one, and `Shift`+drag on the map to add every marker in a box. In a list, the checkbox
  or `⌘/Ctrl`+click adds or removes a row, `Shift`+click adds a range, and `Select all N` takes the whole kind. On a
  touch screen, `Select` makes a tap add or remove a marker and a drag draw the box.
- **Move:** drag a marker; dragging one of several selected markers moves them all by the same offset, each kept inside
  its kind's limits. Birds and clouds keep their height.
- **Change one object:** position, rotation, size, and color; bench seats, road width, and a house's owner name,
  description, and LinkedIn link. Flowers, birds, and trees also choose their kind; `Automatic` lets the object's id
  pick it.
- **Change several:** one color or the default color, one kind when all are flowers, birds, or trees, one size and
  rotation or random ones within a range, `Duplicate`, and `Delete`. Values that differ show as `Mixed`. Copying and
  deleting skip the fountain and the guestbook board, and deleting skips benches residents use; the inspector says how
  many and why. Each of these is one undo step.
- **Roads and routes:** drag the handles of a selected road or resident route, add points at the end, or remove one.
- **Residents:** `Add resident` places one on the nearest bench. Edit their name, bench, look, role, relationship,
  LinkedIn link, and reference in Korean and English. `Draft dialogue` asks the backend to draft their lines with an
  LLM, and every line can be edited before saving. Without OpenRouter configured, `Write by hand` starts empty lines.
- **Yourself:** turn on `This is me (the town owner)` for your own resident. Its reference and drafting give way to
  the questions visitors can ask you; your self-introduction is the owner's introduction in the town settings.
- **Town settings** (toolbar): the owner's and the pet's names in both languages, the owner's introduction and contact
  email (both optional), the pet's walk, and how everyone walks and skids, with a looping preview.
- **The pet's walk:** `Edit the walk` starts from the default loop around the fountain and edits it with the same
  handles as a resident route; `Use the default walk` goes back to the loop that follows the fountain.
- **Ballpark** (town settings): the walls, roof, trim, and accent colors, or `Use theme color`, apply once saved. The
  pitch count (3–10) and difficulty change only from midnight KST on the first of next month, so the admin schedules
  next month's rules or cancels the change, and this month's games never change. Once saved, `Try next month's rules`
  plays them in the same tab at `/baseball?rules=next`, a preview that is never ranked.
- **Guestbook review:** approve or delete notes, waiting ones first.
- **Admins:** add an email (it gets the editor at its next sign-in) or remove one (its sessions end at once). Your own
  email and the last one cannot be removed.
- **Keys:** `Delete`/`Backspace` removes the selection (several objects ask first), `⌘/Ctrl+Z` undoes, and `Escape`
  clears the selection. A drag is one undo step.

Edits stay local until `Save town`. A save sends the whole town with the revision the editor loaded; if someone saved in
the meantime, it is refused and `Reload saved town` loads the newer version.

## Movement

- **Walks:** planted feet (the default) keeps each foot fixed on the ground while it bears weight and bends the legs to
  it; key poses steps through contact, down, passing, and up poses. The admin chooses one for the whole town.
- **Skid:** turning back at a run turns the character to face the new way while it slides on, with dust, a synthesized
  squeal, and skid marks on paths and snow. Letting go at a run brakes to a stop. The admin chooses a long, short, or
  no skid.
- **Collision:** a small 2D resolver keeps characters out of houses, benches, lamps, rocks, the fountain, and tree
  trunks, and apart from each other. Flowers, grass, and bushes can be walked through and sway as characters pass.

## Sound

Music, resident voices, footsteps, and the skid squeal are synthesized in the browser with the Web Audio API from
original patterns; there are no music files or sampled game sounds. The pet's bark is a CC0 recording. The page tries to
start music on entry, within the browser's autoplay rules, and the music button reflects whether it is playing.

## Graphics

WebGL 2 support is checked without collecting device details. If graphics fail, the interface and character editor keep
working, and a fallback explains how to turn on hardware acceleration in Chrome. The pixel ratio adapts between 1 and
1.35 with the frame rate.

The camera follows with separately damped position and look targets, looks ahead in the direction of travel, and
returns from a glance after a short pause. Defaults: field of view 44°, eye-level height, up to 90° of horizontal and
62° of vertical glance.

## Known limitations

- Tall scenery does not push the camera forward when it blocks the view.
- Cloud shadows are soft ground decals, and birds do not avoid tree crowns.
- Residents and the pet walk straight between route points, so they can pass through objects the admin places on those
  paths.
- Browsers without WebGL keep the interface but cannot show the town or the 3D preview.
- Autoplay depends on the browser, and audio cannot override a muted tab or device.
- Three.js alone is a chunk above Vite's 500 kB warning (about 180 kB compressed).

## Assets

Every bundled third-party file is listed with its title, author, source, license, and changes in
[`public/assets/CREDITS.md`](public/assets/CREDITS.md): four models from the
[Kenney Nature Kit](https://kenney.nl/assets/nature-kit) (rocks, mushrooms, bushes, and pumpkins) and the bark recording,
all CC0 1.0. Characters, flowers, trees, buildings, and everything else are original procedural geometry.
