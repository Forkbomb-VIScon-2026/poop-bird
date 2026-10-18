# Poopy Bird 💩🐦

A browser game you control by **straining your face**. The bird keeps falling;
the only way up is to poop. Make a constipated face at your webcam to charge,
relax to let go. Dodge the city, splat the cars, people and statues below.
Then dive into the harbour, where the bird becomes a pufferfish that you steer
by **making a pufferfish face**: cheeks puffed, lips pursed.

Everything runs in the browser: face tracking runs locally with MediaPipe, and
no video, snapshot or score leaves the device unless the player submits a run
to the [leaderboard](#leaderboard).

## Run it

Needs Node 24 and npm.

```sh
npm install          # also copies the MediaPipe WASM into public/mediapipe/wasm
npm run fetch-model  # downloads face_landmarker.task into public/mediapipe/ (once)
npm run dev          # http://localhost:5173 (no debug tooling, same as production)
npm run dev:debug    # same, with the debug panel (D), tuning sliders and window.poopyBird
```

Webcam access needs a secure context. `localhost` counts, so the dev server is
fine. To play from another device, serve over HTTPS.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build to `dist/` (no debug tooling; this is what CI, Docker and the deploy use) |
| `npm run build:debug` | Same, with the debug tooling included |
| `npm run preview` | Serve the build locally |
| `npm run app:dev` / `app:run` / `app:open` | The [Android app](#android-app) on a phone over USB: showing the dev server / the build; the project in Android Studio |
| `npm test` | Vitest unit tests (strain and puff math, charge and spike logic, buoyancy, the wedding lifecycle, dataset sessions, collector, leaderboard) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Typecheck only (browser code, and the Node code in `tsconfig.node.json`) |
| `npm run data:pull` / `data:purge` | Copy the face dataset from the team VM into `data/` / delete that copy (see [Face dataset](#face-dataset)) |
| `npm run eval` | Score face detection against every recording in `data/` |
| `npm run collector` | Run the dataset collector locally (needs `COLLECTION_CODE`, `DEV_TOKEN`, `DATA_DIR`; set `HOST=127.0.0.1`) |
| `npm run copy-wasm` | Re-copy the WASM from `node_modules` (also runs before `dev`/`build`) |
| `npm run fetch-model -- --force` | Re-download the model |

The WASM and the model are served from `public/` at runtime, so the game works
on bad Wi-Fi once the page has loaded. Both are gitignored: the WASM comes from
`node_modules`, and the model comes from `fetch-model`.

### Docker

```sh
docker compose up --build   # serves dist/ with Caddy on http://localhost:8080
```

The image builds the game and serves it with Caddy on port 8080. For camera
access on anything other than localhost, put it behind HTTPS. Compose also
starts the face dataset collector (local credentials `local` /
`local-dev-token`), which Caddy serves under `/api/`.

### Android app

The same game as an Android app: [Capacitor](https://capacitorjs.com) puts
the web build in a WebView (`capacitor.config.ts`, the Android project in
`android/`). There is one codebase: the web version, its dev server and its
deploy are unchanged, and the app is built from the same `dist/`. The WebView
is the same Chromium engine as Chrome, so it plays as fast as Chrome does (face
detection runs in a worker in both). What the app adds is an icon, full screen
and landscape without asking.

Differences, from `APP` in `src/env.ts` (true when Capacitor's
`window.Capacitor` is there, also under `app:dev`):

- **On-device only.** No online leaderboard: everything marked `.web-only` is
  hidden (`body.app`), and nothing goes to `/api`.
- **No face download** at game over (the WebView can't save files).
- **Full screen and landscape** come from the app (`MainActivity.java`, the
  manifest), not from `requestFullscreen`.
- The camera permission is Android's (`CAMERA` in
  `android/app/src/main/AndroidManifest.xml`), asked the first time the game
  opens the camera.

**One-time setup** (JDK 21 and the Android SDK; no Android Studio needed):

```sh
sudo pacman -S jdk21-openjdk         # Arch; any JDK 21 works
# Command-line tools from https://developer.android.com/studio#command-line-tools-only
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
unzip ~/Downloads/commandlinetools-linux-*_latest.zip && mv cmdline-tools latest
export ANDROID_HOME=~/Android/Sdk    # also in your shell's rc file
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

On the phone, turn on developer options and USB debugging, plug it in and
allow the laptop (`adb devices` lists it).

**Run it** (a debug build, installed over USB; nothing is published):

```sh
npm run app:dev      # the app shows the debug dev server, with live reload
npm run app:dev -- 5180   # on another port
npm run app:run      # the app with the production build inside, as it would ship
npm run app:open     # the Android project in Android Studio
```

`app:dev` starts `npm run dev:debug` on localhost, forwards its port to the
phone (`adb reverse`), and points the app at it, so edits show up in the app
like in a browser tab, and the debug panel's perf log saves to `perf-logs/`.
Ctrl+C stops both; the app keeps pointing at the dev server until the next
`app:run`. Inspect the app's WebView from `chrome://inspect` on the laptop.

## Controls

| Input | Action |
| --- | --- |
| Strain face (webcam) | City: charge; relax to poop |
| Open your mouth (webcam) | The bird opens its beak with you (just for fun; MediaPipe's `jawOpen`, tuned under "Beak" in the debug panel; classic graphics only) |
| Pufferfish face: puff cheeks, purse lips (webcam) | Ocean: inflate (more puff = rise, less = sink) |
| Hold **Space** / mouse / touch | City: same as straining. Ocean: inflate while held, deflate when released. Keyboard mode only |
| **P** / **Esc** / ⏸ button | Pause, and resume |
| **M** / 🔊 button | Mute (also silences vibration on phones) |
| **S** / ⚙ button | Settings (menu and in game; opening it mid-run pauses) |
| **Enter** | Press the yellow button on any screen (Play, Play again…). Every button takes exactly one key, the one on the keycap badge on its corner |
| **K** | Menu settings (the gear): play with the keyboard |
| **L** / 🏆 button | Menu: the [leaderboard](#leaderboard) |
| **Q** | Pause: back to the menu |
| **Esc** | Calibration and game over: back to the menu |
| **C** | Re-run calibration |
| **N** | Face mode: track another face (if the wrong person got picked) |
| **D** | Debug / tuning panel (only with `npm run dev:debug`) |
| **G** | With the debug panel open: the stage's waterfront comes next |
| **L** | With the debug panel open: spawn a power line now |
| **K** | With the debug panel open, while playing: a slingshot kid walks on |
| **W** | With the debug panel open: a wedding right now |
| **B** | With the debug panel open: a hot-air balloon floats in |
| **H** | With the debug panel open: a fisherman rows in (ocean only) |
| **J** | With the debug panel open: a shark swims in (ocean only) |
| **A** | With the debug panel open: a boat that drops its anchor comes in (ocean only) |
| **O** | With the debug panel open: start a run as the pufferfish (skips the city) |

### On phones and tablets

Touch devices (`(hover: none) and (pointer: coarse)`, `body.touch`) get touch
wording instead of key hints (`.kbd-only` / `.touch-only` in the HTML), and
"or play with touch" replaces the keyboard mode.

- **Landscape only.** Tapping Play goes fullscreen and locks the screen to
  landscape where the browser allows it (Android Chrome). Where it can't (iOS),
  a "Turn your phone sideways" screen covers the game while it's ready, running
  or paused in portrait, and a run in progress pauses. Portrait is too narrow:
  the playfield is always 600 units tall, so a portrait phone would only see
  about a second ahead.
- **Vibration** on releases, hits, accidents, crashes, zaps, bonks and pops
  (Android; iOS has no vibration API).
- Short landscape screens get compact cards: the webcam sits next to the
  calibration card, and the game-over card puts its buttons first.
- The game-over card shows the run in pictures, all in one row: your finest
  strain as a polaroid (face mode), then every front page, wedding photo and
  the fisherman's trophy photo in the order they were taken. When they don't
  fit, they overlap like a pile of prints (hover one to lift it), and past
  that the row scrolls sideways.
- If face tracking runs below `slowDetectionRate` detections per second, the
  perch suggests playing with touch or the keyboard instead.

## How it plays

**Calibration first, once per face.** In face mode, a face this tab hasn't
calibrated (see "Who's playing") starts on the **calibration screen**, before
any bird: a deliberately plain step, so that from then on the bird and the
fish do what the player expects, and nothing calibrates mid-game.

1. "Strain like you really need to go 💩", with an example photo of the face
   next to the player's webcam ("Like this" / "You"). Nothing
   happens until the player presses **I'm ready** (Enter). Then "Get ready to
   strain… 3, 2, 1", "STRAIN! Hold it!" for `calibrationSeconds` (3 s) with a
   countdown and a progress bar.
2. "Puff your cheeks like a pufferfish 🐡", the same way (held for
   `oceanCalibrationSeconds`, 3.5 s). No let-out step: the puff is fitted
   against the welcome's relaxed face.

The player is never asked for a relaxed face. The screen opens with a short
welcome ("Hi! 👋 Just look at the camera for a moment", just the webcam, no
example face yet, so nobody practises one): the relaxed face is read there
(2 s of a face in view, with a progress bar) and then kept as it is, retries
included. A phase whose fit fails its quality check says why ("That
looked a lot like your normal face. Strain harder!") and the button becomes
**Try again**; after two failed tries **Play anyway** shows too (strain: the
failed fit, or a guess from the relaxed face; puff: pursed lips only). If
recognition is still deciding after the read, the welcome waits up to 4 s
more ("Have we met? Checking… 🤔"); a face it knows goes straight on to the
perch ("👋 Welcome back!").

Every run then starts on the **perch**: the bird sits in its nest on top of a
street lamp, and the coach beside it says "Strain & let go to start" (Hold
Space). The first poop, however small, takes off with a full push and starts
the run; there's no countdown and no practice (the calibration screen already
taught the strain). The webcam stays small in its corner, as in the run.

**The coach.** Every tutorial step is one banner, the coach (`#coach`): a
sketch of the face to make, one short line, sometimes a hint under it. Each
step moves on once the player has done it (the line turns green for a moment),
not on a timer. On the perch it sits beside the bird; in the city and the
ocean, over the game near the top. The ocean tips use it too.

- **Flight lesson** (new players: this face hasn't seen it yet, see
  [Tutorials are per face](#tutorials-are-per-face)): right after takeoff, in a **calm
  city** (`Game.calmCity`: no obstacles, paparazzi or kids, and the street
  bounces the bird back up instead of ending the run): "Squeeze & relax to
  stay up" until three poops (or 20 s), then "Nice flying!". The lesson counts
  as seen (`city` in `TUTORIALS`), and the calm ends (and the coach goes) once
  the bird is clear of the street (or after 8 s); the first obstacle comes
  `firstObstacleDelay` later, unannounced.
  The lesson only teaches flying: the buildings, what to poop on, and what
  the ocean's jellyfish and sharks do are left for the player to discover.
  An accident (held too long) shows "Too long! Relax as soon as it's full".
- **Recalibrate** is a small button on the perch (or **C**, also on the game
  over card): it runs the calibration screen again, both phases. It turns
  yellow and pulses with a question when straining doesn't register: the face
  never crosses the strain threshold in 8 s ("Not taking off?"), or stays over
  it for 6 s ("Stuck even when you relax?").

The lamp and its nest scroll away with the street.

- Gravity pulls the bird down all the time. Fall speed is capped, and the bird
  falls slower while charging, because it tenses up.
- **Charge & release:** while you strain, the meter next to the bird fills over
  ~1.2 s and the bird turns red, puffs up and grits its beak. Relax and it
  poops: the push scales with the charge, and a tiny charge gives a "pfft".
- **Overstrain:** hold a full charge for more than ~1 s and you have an
  *accident*: a big splat, screen shake, and a stunned, tumbling bird with no
  push. In the last ~0.3 s before that the meter flashes gold ("NOW!"), and a
  release there gives a **perfect push** (×1.35).
- **Targets:** cars (×1), pedestrians (×1.5) and statues (×2) give
  `targetPoints × multiplier`. Consecutive hits build a combo, and a poop that
  hits the road resets it.
  The road has two lanes, one per direction (traffic keeps right: cars heading
  right drive in the near lane). Cars never overlap: one that catches up slows
  down and follows at a safe distance, or waits behind a stopped car.
  Some splatted pedestrians (`angryChance`) stop, turn on the bird and curse:
  red in the face, shaking a fist, a `#@$%!` bubble and a `curse` sound, for
  `angryDuration` seconds before walking on. Hitting one again restarts it.
- **Power lines:** from the second city on (after the first dive), some city
  obstacles are a run of poles with wires sagging between them
  (`powerLineChance`). Touching a wire zaps the bird and ends the run, and so
  does hitting a pole. Fly over, under, or (in later cities, when the wires
  stack up to three and the top one climbs higher) between them. Pigeons sit on the wires and are targets
  too (×2). Some of them (`droneChance`) are government surveillance drones:
  splat one and it drops off the wire and breaks open on the street, wires
  sparking.
- **Paparazzi:** now and then a paparazzo walks on with his camera raised.
  The ring over his head fills as he closes in; when it's full (just past the
  bird) he takes your picture. Splat him first to smash the camera (×3).
  Miss, and you get a flash, a polaroid, and your photo on a roadside
  billboard as the next obstacle, always before the harbour (and on the
  game-over screen). The run's first paparazzo walks slower.
- **Slingshot kids:** from the second city on, a kid in a propeller beanie trots along the sidewalk,
  plants his feet and winds up his slingshot at you. A "!" pops over his head
  and a dotted arc reaches out toward the bird, ending in a crosshair. When
  the band is fully back he lets go, aimed at where you are (with a little
  lead). A pebble that hits bonks the bird: it tumbles stunned, gets knocked
  down, and loses its charge and combo, which is deadly near the ground.
  Ways out: change height once he fires (a near miss pays a "CLOSE ONE!"
  bonus), put a building or pole between you (pebbles ping off them), shoot
  the pebble down with a falling poop ("INTERCEPTED!", ×4), or splat the kid
  while he's still armed ("DISARMED!", ×3) and he runs off crying. From the
  third city on kids fire twice, and they wind up and shoot faster city by
  city. Tunables are in the debug panel's "Slingshot kids" group.
- **The wedding:** now and then (`weddingChance`, about one city stage in
  four) a church takes the place of one building, with a wedding on the
  sidewalk in front: the couple under a flower arch with their names on it,
  guests, a getaway car and a photographer with an old plate camera. Bells ring and the organ plays
  "Here comes the bride". As the couple comes up to the bird the
  photographer counts down in a heart over them, *3… 2… 1…*, and then they
  **KISS!** for about a second (a ring around the heart runs out). That's the
  timing puzzle: start straining on the countdown, let go on "KISS!".
  - Splat the bride or groom mid-kiss and the wedding is **ruined**
    ("OBJECTION!", ×10): a record scratch, the bride shrieks, the groom
    faints, the guests gasp and the heart breaks. A moment later she throws
    her bouquet at the bird ("!" over her head first). It knocks the bird
    down but doesn't stun it.
  - Let the kiss go through and they're **married**: confetti, a flight of
    doves, a fanfare, and the bride tosses her bouquet high over the bird.
    Fly into it as it comes down to catch it ("YOU'RE NEXT!", ×4).
  - Splatting the couple before the kiss (×3), the guests, the photographer
    (his lens gets smudged, and so does the photo) or the car scores like a
    normal target.
  - Either way the photographer's flash goes off, and **the official
    wedding photo** pops up in the corner as a framed print: the couple, the
    guests and the bird photobombing from the corner, blissfully relieved if
    it just ruined everything. In face mode the bird has the player's face,
    grabbed at "KISS!" (when they should be straining hardest). The game-over
    screen shows every wedding of the run.
  Tunables are in the debug panel's "Wedding" group.
- **Hot-air balloons:** some city obstacles are a balloon drifting along with
  the wind (`balloonChance`). Fly through the envelope (or poop on it) and it
  pops (×4): fly through it yourself and the escaping hot air gives you a free
  lift. The basket drops to the street and the passengers bail out, tumbling
  until their parachutes open; while they drift down they're targets (×2),
  and once they land they walk off as pedestrians. The basket is solid:
  flying into it, hanging or falling, ends the run. Slip between the envelope
  and the basket without touching either for a "THREADED IT!" bonus (×6).
  Tunables are in the "Balloons" group.
- **Score** = distance + target bonuses. It carries straight across stages.

### The ocean stage

A run alternates city → ocean → city → … and difficulty keeps ramping with
total distance (scroll speed, gaps, spacing). On top of that, each new city
stage brings more: the first city has no power lines or slingshot kids and
few tall buildings; power lines and kids come in with the second, double
shots and stacked wires with the third, and tall buildings get more common
city by city (the debug panel's "Progression" group).

- **The harbour.** After `cityObstaclesBeforeGate` (6) city obstacles the street
  ends at a quay (bollard, ladder, stone wall) and the harbour opens up below.
  Poops that land in the water just plop.
- **Dive and transformation.** Once the bird is over the water the game takes
  the controls: a little hop, and it plunges through the surface while the
  camera follows it down past the quay wall into the sea. Under water it
  gulps, loses its feathers in a burst of bubbles and becomes a deflated
  pufferfish, which inflates by itself over `oceanTransformTime`. Then the
  controls are yours again. A returning player gets a short reminder ("Puff
  your cheeks to float 🐡", or "Hold SPACE to puff up").
- **New players** (the ocean tutorial hasn't been seen): the first dive swims
  on in **calm water** (`Game.calmWater`: no obstacles or jellyfish, no
  spiking, the sea floor doesn't kill) for the **swim lesson**
  (`runSwimLesson()`): "Puff your cheeks to rise" (or hold Space or the
  screen) until the fish is near the surface, then "Let the air out to sink"
  until it's near the floor (each step moves on after 15 s anyway), "Nice
  swimming!", and the spikes tip (spiking out, and popping when held too
  long; what's in the sea is left to discover); then the level starts. A fish lying on the sand when the level starts isn't
  killed by the sea floor until it swims off (at most `oceanCalmFloorGrace`,
  5 s). Nothing calibrates here: the puff was calibrated before the run. The
  lesson never stops the world. It shows once per face, like the flight
  lesson.
- **Buoyancy.** The fish is always somewhere between deflated (puff 0, sinks)
  and fully puffed (puff 1, rises). Around 40% puff it hovers. Speed eases
  toward the target with water drag, so it's floaty, never snappy. The sea
  floor kills; the surface is a soft ceiling you bump against.
- **Obstacles.** Coral and rocks rise from the sea floor. Now and then
  (`oceanWreckChance`, 20%) it's an old shipwreck instead: a long, low hull
  with one mast snapped off short, so you clear it by staying high enough
  rather than threading a gap. Some slots are a
  boat at anchor instead (`oceanAnchorChance`, 40%): its anchor hangs down on
  the chain, over coral or a rock (a gap between them) or, for
  `oceanAnchorOpenChance` (35%) of them, over open water, so you dive under
  it. The hull dips below the surface, so hugging the surface isn't safe
  either. The last obstacle before the far quay is never a boat (it would
  vanish from the harbour as the bird leaps out), and neither is one while a
  fisherman is out (he rows against the scroll, so it would run into him).
- **Dropping anchors.** Some of those boats (`oceanAnchorDropChance`, 35%;
  never over a wreck) drop their anchor as the fish comes near. First the
  warning (`oceanAnchorDropWarn`, 0.9 s): the anchor rattles and jerks on
  its chain with a clank, a red "!" swells beside it on each clank, and red
  chevrons below it march downward. Then the chain rips just below the hull
  with a snap, leaving a short stub with a torn link on the boat, and the
  anchor falls, gathering speed and trailing bubbles, with the torn-off chain
  above it. It lands on the coral or rock, or digs into the sand, with a thud
  and a puff of grit, and the chain piles up on it. All of that
  (`oceanAnchorDropFall`, 0.45 s) is over `oceanAnchorDropLead` (0.5 s)
  before the fish gets there. The chain is a hit wherever it is (the stub,
  the falling piece), just like on a boat that keeps its anchor. The timing
  is worked out from the fish's arrival at the current scroll speed; if the
  boat comes on screen late, the warning is shorter, and on screens too
  narrow for even half a second of it the boat keeps its anchor. Once the
  anchor is down, the way through is above it, between the stub and the
  anchor: the bottom of the old gap is closed, and a fish that was diving
  under has to rise.
- **Size is the tradeoff.** The fish, and its hitbox, grow with puff. Rising
  makes you bigger.
- **Spike-out.** At ~85% puff the spines come out. Spiked, you pop jellyfish
  for `targetPoints × 1.5 × combo` (the spines reach ~1.6× further than the
  sting hitbox, so popping is forgiving); unspiked, a jellyfish kills you. Stay
  spiked longer than ~1.5 s and you **pop**: a comic deflate, shake, and a
  stun during which you sink without control. The meter flashes "DEFLATE!" in
  the last ~0.3 s.
- **The fisherman:** some ocean stages (`anglerChance`) have a fisherman in
  a rowing boat, sitting low in the water with his pipe, beard, yellow
  oilskins and sou'wester. When he's close he casts (a "!" by the bobber), and
  the hook, with a wriggling worm on it, sinks to the depth the fish is at
  right then. After that it doesn't follow you: he only jigs it gently
  (`anglerJig`). Change depth to get past it ("CLOSE ONE!" if it was near).
  - **The hook always catches**, spiked or not. The world holds still while
    he reels the fish up, the reel ratcheting, and yanks it out of the water.
    That ends the run with **his trophy photo**: him in his boat, grinning,
    holding up the puffed-up fish. It pops up in-game and goes on the
    game-over card ("Catch of the day").
  - **The line above the hook can be cut**: cross it spiked (×4). It snags on
    the spines and he leans back hauling on it until it parts. The end on his
    rod whips back up, the cut-off end sinks away with the hook, and with the
    pull suddenly gone he goes over backwards into his boat, boots in the air,
    his hat flying off into the water. A moment later he sits up again, bald
    and shaking his fist. Unspiked, the fish just slips past the line.
  Tunables are in the debug panel's "Fisherman" group.
- **Sharks:** most ocean stages (`sharkChance`) have a shark. If the stage
  has a fisherman too, he comes first and the shark's music waits until he's
  done; the far quay waits for both, so such a stage runs a little longer. Its music starts a couple of obstacles in (`sharkSlot`), well
  before it shows up: `shark_theme.mp3` (the Jaws theme, from the second
  "do-doop"), timed so the shark shows up as the attack music kicks in
  (17.5 s into the track) and lunges on the swell `sharkThemeAttack` (16.6 s) in, and kept in
  sync across pauses (`Game.sharkTheme` is the clock). It cuts out the moment the shark bites into the spines; if it eats you, it plays on until the shark is gone. No new obstacles spawn
  in the last seconds before it arrives. Without that file, a synthesized
  two-note "dun-dun" plays instead, speeding up as it closes in. The shark
  glides in from ahead at the fish's depth for `sharkStalkTime`, stops, opens its jaws and a "!" pops over it.
  Then it lunges, homing on the fish:
  it can't be outswum, the only defence is to be spiked when it bites (the
  spines reach a bit further than its bite). Spiked, it yelps, turns tail
  with spines in its snout (×5, "NOT TODAY!"). Not spiked, it eats you
  and swims off with your tail sticking out of its mouth. Spiking up at the
  "!" leaves time before the spikes pop. Tunables are in the "Sharks" group.
- **No poop underwater.** Charge, poops and city targets are off in the ocean.
- **Leaping out.** After `oceanObstacles` (8) ocean obstacles the far quay's
  wall comes up ahead. Once the last obstacle is behind you and the wall is
  close, the game takes the controls: the fish shoots up, breaks the surface
  and becomes a bird again mid-leap, with the camera following it up to the
  street. The bird glides at a safe height until the street is below it, then
  the controls are yours again, so the wall can't get you. A strain held while
  surfacing doesn't fire: you have to relax first.
- With Space alone: hold to inflate (rise), let go to deflate (sink), and tap to
  hover. The puff meter next to the fish marks the hover level (blue) and the
  spike threshold (red).

### Music

Each stage has its own looping track: "Clumsy Pigeon March" in the city
(`music_city.opus`), "Bubble Oom-Pah" under water (`music_ocean.opus`), both in
`public/assets/audio/`, with `.m4a` (AAC) copies for Safari before 18.4,
which can't play Opus. They crossfade at the waterfront, when the bird turns
into the fish and back. The music starts when the bird takes off from the
perch and stops the moment it crashes; it's quieter while paused
(`musicPausedVolume`) and fades out while the shark's theme plays. **Settings → Sound →
Music** switches it off for good (saved in localStorage; the tracks then
aren't even downloaded); the mute button
silences it with everything else. `musicVolume` sets its level.

Both tracks were made with [Suno](https://suno.com); credits are in
`public/assets/audio/CREDITS.md`.

## Leaderboard

The game-over screen and the start screen's 🏆 (**L**) show the online
leaderboard: two boards of the runs players chose to submit.

- **🏆 Top scores**, by score.
- **😣 Most constipated faces**, by the constipaticity of the run's finest-strain face
  (0–100). Only runs submitted with their face are on it.

Only runs played with the face count. After a keyboard or touch run the
game-over screen says so instead of offering to submit, and the collector
turns away submissions that aren't face-mode runs. (At first keyboard runs
were accepted; the collector deletes any it finds when it starts.)

Nothing is sent until the player presses "Submit to the leaderboard" on the
game-over screen (with a name, 16 characters at most). The face goes along
only if they tick "with my face", which starts unticked every run, so the next
player at the same machine doesn't inherit the choice. A run submitted from
a browser has a ✕ there to take it off again (the delete key is kept in
`localStorage`).

**Constipaticity** (`strain.ts` `strainedness`) is the weighted mean of the raw
`browDown`, `eyeSquint` and ½ × `eyeBlink` blendshapes. These move on a strain
face for nearly everyone in the face dataset, and the mouth doesn't. It
ignores the calibration: the calibrated strain tops out at 1 for anyone who
strains past their own calibration (and a timid calibration would win), so it
can't rank players against each other. In the dataset, relaxed faces score
about 20–30 and hard strains 60–75. The score is smoothed like the strain
signal (`emaAlpha`), and the finest-strain snapshot is the frame where it
peaked while the game counted the player as straining in the city, so a laugh
or a blink doesn't count.

**Server.** The collector serves it (`collector/leaderboard.ts`, format and
ranking in `src/leaderboard.ts`) on the same `poopybird-data` volume as the
face dataset, so it survives deploys:

| Request | |
| --- | --- |
| `GET /api/leaderboard?limit=10` | both boards (at most 100 each) |
| `POST /api/leaderboard` | a run (`application/json` only); answers its places and a delete key |
| `GET /api/leaderboard/<id>.jpg` | a shared face |
| `DELETE /api/leaderboard/<id>` | with `X-Delete-Key`, or the dev token |
| `GET /api/leaderboard/runs` | every stored run, both pools (dev token) |

Each board keeps its top 500, far more than it lists. A run on neither isn't
stored, and one pushed off both is deleted, face and all. Submissions are
limited to 300 an hour per address (Caddy sets the address; a client can't
fake it).

### Moderation

Scores and strainedness come from the player's browser, so anyone who can open
the game could post any number, or any picture as their face. The team
removes bad runs with `npm run leaderboard`, which uses the dev token over SSH
(like `npm run data:pull`: it needs your SSH key on the VM). Nobody else can
remove a run, except its submitter from their own browser.

```sh
npm run leaderboard                                  # what the boards show, the newest runs, and their ids
npm run leaderboard -- remove <id> [<id>…]           # delete runs (faces included)
npm run leaderboard -- remove-name "Spam Bot"        # list every run under a name; add --yes to delete them
npm run leaderboard -- remove-since "2026-10-11 14:30"   # the same for everything since then (a flood)
npm run leaderboard -- list --all --debug            # every stored run, debug-build runs too
```

Because the boards keep 500 runs and show at most 100, a flood of fake runs
doesn't wipe the real ones: removing the fakes brings them back.

### Hardening

What players send ends up in other players' pages, so:

- **Names** are text only (`textContent`, never HTML), at most 16 characters.
  Control and invisible formatting characters (bidi overrides, zero-width) are
  dropped, and stacks of combining marks capped at two, so a name can't
  reorder or spill over the rows around it.
- **Faces** must be JPEGs (start and end markers, a frame header) of at most
  120 kB and 400 × 800 px; a small file declaring a huge image could stall
  every viewer's browser. They're served as `image/jpeg` with `nosniff` and a
  `Content-Security-Policy` of `default-src 'none'; sandbox`, so even a file
  crafted to look like HTML runs nothing when opened directly. The page only
  loads face URLs of the collector's own `/api/leaderboard/<id>.jpg` form.
- **Submissions** must be `application/json`, which a form on another site
  can't send, so other sites can't submit through a logged-in visitor's
  browser. Ids are 16 hex digits, checked before they touch a file path.
- **Not prevented:** made-up scores, strainedness and pictures (the server
  can't check what happened in the browser), and offensive names. That's what
  moderation is for.

Debug builds (`npm run dev:debug`) submit their runs as debug runs and show
only those, so testing never puts anything on the public boards. With `npm run
dev`, `/api` goes to the VM through `npm run tunnel` (or `COLLECTOR_URL`); a
local collector (`npm run collector`, see [Face dataset](#face-dataset)) gives
an empty board to play with.

## How the strain detection works

Code: `src/strain.ts` (pure, unit-tested), `src/face-detect.ts` (MediaPipe
and the face lock), `src/face.ts` (webcam and detection loop), and the wiring
in `src/main.ts`.

1. **Features.** MediaPipe Face Landmarker (`runningMode: "VIDEO"`,
   `outputFaceBlendshapes: true`, GPU delegate with CPU fallback) gives 52
   blendshape scores per frame. We use `browDown`, `eyeSquint`, `eyeBlink`,
   `noseSneer`, `cheekSquint` and `mouthPress` (each the mean of left and
   right), plus `mouthRollLower`, `mouthRollUpper`, `mouthShrugUpper` and
   `mouthShrugLower`.
2. **Calibration** (the calibration screen, per face, see "How it plays").
   Neutral is the welcome's read of the relaxed face (2 s, at least 20
   samples), as robust statistics (median and MAD), so a smile or a word
   doesn't move it. Strain is the "STRAIN!"
   hold, whose first `calibrationSettle` (0.7 s) is ignored so reaction time
   doesn't pollute the data (mean and standard deviation).

   **Play anyway.** After two failed strain tries the player can go on with
   the last failed fit, or without one a guess from the relaxed face: neutral
   plus a typical change per feature (`defaultCalibration`,
   `DEFAULT_STRAIN_DELTAS` in `src/strain.ts`, scaled by
   `defaultStrainScale`), only for the features that move for most people:
   brows, eyes, nose, cheeks and pressed lips. Either one is never saved for
   the browser.
3. **Weights.** A feature's weight is `max(0, |Δ| − minFeatureDelta) ×
   reliability`, where `Δ = strainMean − neutralMean` and reliability is
   `min(1, |Δ| / (σ_neutral + σ_strain) / 2)`. Features that didn't move get
   zero weight, and noisy ones get less.
4. **Score per frame.** Each feature is normalized to `(x − neutral) / (strain
   − neutral)` and clamped to `0..featureClampMax`. We take the weighted mean,
   clamp it to 0..1, then smooth it with a frame-rate-independent EMA.
5. **Hysteresis.** The signal turns on at `strainOn` and stays on until it
   drops below `strainOff`. "Straining" is then the face in face mode, or Space /
   pointer in keyboard mode (the two never mix), which feeds the charge state
   machine in `src/charge.ts`.
6. **Quality check.** After calibration, every calibration sample is scored. It
   fails if fewer than `minFaceCoverage` (60%) of a phase's frames had a face,
   if the summed weights are below
   `minCalibrationChange`, if fewer than 60% of strain frames would cross the
   on threshold, or if more than 25% of neutral frames would stay above the
   off threshold.
   The player sees why and can retry, after two tries play anyway, or switch
   to keyboard. Only a calibration that passes replaces the saved one.
7. **No face.** Short dropouts (up to `faceLossGrace`, 0.25 s) keep the last
   strain state, so a missed frame mid-grimace doesn't cause a release. After
   that, the strain drops to 0 (leaving the frame releases) and the preview
   shows "Can't see you".
8. **Face lock.** With several people in view, MediaPipe (`numFaces: 1`)
   would follow whichever face it happens to track, and can jump to a
   bystander when its tracking confidence drops (straining does that). So the
   first face found is locked, and from then on MediaPipe only sees a square
   crop around it (`faceCropScale`, 2.2× the face box), scaled into a 384 px
   canvas. Other faces aren't in its input at all. A face found in the crop
   only counts if its centre is within `faceLockMaxJump` (0.8) face sizes of
   the locked one and its size is within ±50%; anyone else (say, right behind
   the player) counts as no face. When the locked face is missing, the crop
   widens to cover that radius, and only after `faceRelockSeconds` (2 s) does
   it search the full frame again; that search finds every face (painting each one found over to find
   the next, up to 3) and locks the biggest, since MediaPipe's own pick is
   not necessarily the face in front. **N** masks the locked face out and
   locks onto another one. Whenever the lock moves to a different face, the
   smoothed strain and puff reset and any calibration step that is collecting
   samples starts over, so two people's samples never mix. In debug
   builds, "Face lock box" in the debug panel outlines the locked face and
   the crop (dashed) on the webcam preview.
   Detecting several faces instead would cost one landmark-model run per
   visible face (about 2.5× with three people); the crop costs nothing extra.
9. **Decoupled loops.** Detection runs on `requestVideoFrameCallback` (or rAF
   with a `currentTime` check), so only when there's a new video frame. Physics
   runs on a fixed 120 Hz timestep in the render loop.
10. **Detection in a worker.** A MediaPipe run takes 40–70 ms on a phone, and
    on the main thread that blocks the game for several screen refreshes each
    time (a Fairphone 4 played at ~20 fps). So MediaPipe and the face lock run
    in a module worker (`src/face-worker.ts`): the tracker sends each video
    frame as an `ImageBitmap`, one at a time (frames that arrive meanwhile
    are skipped), and gets it back with the result, so face ID and the
    finest-strain snapshot crop the exact frame the landmarks are from. The
    worker needs the GPU delegate (OffscreenCanvas WebGL); where it can't
    have it, or with the "Detect in a worker" tunable at 0, detection runs on
    the main thread as before (GPU, falling back to CPU). The debug panel
    shows "GPU worker" as the delegate, and the detection latency.

A full calibration is also saved in `localStorage`. Press **C** (or click
"Recalibrate") to calibrate again.

### Who's playing (face recognition)

Calibrations belong to a face, so whether a level starts with a calibration
step depends on who is in front of the camera. Whenever the tracker locks onto
a face (face mode starts, or the lock moves to a new face), `src/faceid.ts`
takes `faceIdSamples` (3) descriptors of it and `src/known-faces.ts` compares
them with the faces this tab has calibrated:

- **A known face** gets its calibrations back and skips the calibration
  screen (Play goes straight to the perch, or the screen lets them through
  once recognition is done), greeted with "👋 Welcome back!". A full
  calibration beats a "Play anyway" one; otherwise a calibration made since
  the lock is the newer and stays.
- **A new face** goes through the calibration screen first, and is
  remembered with its first calibration. A new face sitting down at the perch
  is sent to the calibration screen; one taking over mid-run plays on, and
  "Play again" calibrates them first.

A descriptor is 128 numbers from dlib's ResNet face model (public-domain
weights, run by [`@vladmandic/face-api`](https://github.com/vladmandic/face-api)'s
`faceRecognitionNet` on WebGL) of a 150 px crop aligned on the eyes from
MediaPipe's landmarks. Only big (`faceIdMinFacePx`), roughly frontal views are
described. A face is known if the median distance of the samples to its
nearest stored descriptor is under `faceIdSameDistance` (0.45). dlib suggests
0.6, but in testing two different people scored 0.54: a wrong match hands
someone else's calibration over, while a missed one just costs a read. A match
adds its samples to the face (up to 6 descriptors) only if they're well within
the distance (`GROW_WITHIN`), so a borderline match can't widen a face until it
matches someone else too. At most 20 faces are kept, the one seen longest ago
going first.

<a id="tutorials-are-per-face"></a>**Tutorials are per face.** A known face
also remembers which tutorials (`TUTORIALS` in `known-faces.ts`: the flight and
the swim lesson) it has seen, so each person gets them once, and someone new at
the booth gets them again. Without a face to remember them with (keyboard mode,
or no face recognition here), they show once per tab.

The faces live in memory and `sessionStorage` only (`poopybird.knownFaces.v1`),
so they go when the tab closes. **Settings → Faces → Forget all** deletes them
at once, and with them every tutorial seen: the next player starts fresh. The model (6 MB) is loaded only in face mode, from `public/faceid`
(copied from `node_modules` on install). Without WebGL (tfjs's CPU backend
blocks the page for a second per descriptor) or if loading fails, there's no
recognition: a saved calibration is used whoever plays (Play skips the
calibration screen when there is one), as before. In
debug builds, `poopyBird.faceId` shows the lock's status, the match distance
and the known faces, and the console logs each decision with the distances.

### Puff detection (ocean)

Code: `src/puff.ts` (pure, unit-tested), reusing the calibration machinery in
`src/strain.ts`.

The gesture is the **pufferfish face**: cheeks puffed while the lips are
pursed, like a kiss. In the face dataset a plain puff barely moved what
MediaPipe reports for some people (no feature, blendshape or landmark,
separated their puffs from their relaxed face), while pursed lips light up
`mouthPucker` for everyone: near 0 while relaxed, looking around or laughing,
0.2–1 with the pufferfish face. So the face puff is the higher of two signals:

- the **pucker range**: `max(mouthPucker, cheekPuff)` mapped from
  `oceanFallbackMin` (0.1, puff 0) to `oceanFallbackMax` (0.5, puff 1). It
  needs no puff calibration, so it works from the first frame and whenever
  the puff calibration is missing or failed. A few people rest with slightly
  pursed lips (0.2 in the calibration, 0.5 between puffs for one participant,
  whose fish floated all the time), so the range starts above the player's
  resting pucker (from the puff calibration's relaxed faces, or the main
  calibration's without one) when that's higher: resting +
  `oceanFallbackRestSds` (3) SDs + `oceanFallbackRestMargin` (0.05), same
  width.
- the **puff calibration** below, which learns the player's own scale: some
  people purse their lips much less than others and wouldn't get far up the
  pucker range alone.

1. **Features.** MediaPipe's `cheekPuff` blendshape stays near 0 however hard
   you puff ([google-ai-edge/mediapipe#4436](https://github.com/google-ai-edge/mediapipe/issues/4436)),
   so puff is read mostly from the face **landmarks** (`faceGeometry`): 3D
   distances divided by the outer-eye-corner distance, so face size, camera
   distance and head rotation don't matter:
   - `eyeMouth`: outer eye corner to the same-side mouth corner. In a recorded
     puff this dropped ~18% and **held** while puffed (the tracked mouth
     corners ride up as the cheeks fill), with almost no drift once relaxed
   - `cheekWidth`: face width at mouth level (puffed cheeks may widen it)
   - `mouthWidth`: mouth-corner distance (pursed lips narrow it)

   It also uses mouth blendshapes that come with puffing: `mouthPress` (lips
   stay pressed while the cheeks are held full), `mouthPucker`, `mouthFunnel`,
   `mouthRollLower`/`Upper` (and `cheekPuff`, in
   case a future model fixes it). The strain calibration only weights its own
   features, so the new ones get strain weight 0 and strain detection is
   unchanged.
2. **Calibration** (the calibration screen's second phase, `main.ts`
   `calibratePuff`, before the first run). The player holds the pufferfish
   face for `oceanCalibrationSeconds` (3.5 s), with an example photo next to
   their webcam; the first `calibrationSettle` is dropped. "Not puffing" is
   the welcome's read of the relaxed face. (There used to be a "let it out"
   step after the hold, dropped to keep the screen simple. It was there
   because a face just after a puff doesn't go back to the relaxed
   face from before it (the mouth stays narrower, the lips pressed or a bit
   pursed, the mouth corners up). When the calibration only knew the relaxed
   face from before, those leftovers read as puff and the fish often wouldn't
   sink: in the face dataset a fifth of the relaxed frames after a puff
   floated, for some people half.) The relaxed quantile edge in the fit
   below still keeps most relaxed frames at 0.
3. **Fit** (`buildInteractivePuffCalibration`). Per feature, "relaxed" is the `oceanPuffRelaxedQuantile` (80%) of
   those relaxed faces toward the puff side, so most of them score 0, and
   "full" is the puff **median** (as the cheeks fill, the lips purse hard for
   ~0.2 s and then relax; with the median only what you hold counts).
   Geometry moves by a few hundredths while blendshapes move by tenths, so the
   weights are scale-free: a feature counts once its change exceeds
   `oceanPuffMinSeparation` (1.5) times its noise (full weight at twice that),
   and only fully if the puff clears the relaxed edge by `oceanPuffMinGap`
   (half) of its change. Whatever moves for *you*, and stays put when you
   relax, gets picked. The score is the same weighted normalized mean and EMA
   as strain, but with **no hysteresis**: the fish needs the analog value.
4. **Quality check.** It fails on low face coverage, summed puff weights below
   `oceanMinPuffChange` (0.5, i.e. at least half a feature that clearly moved),
   fewer than 60% of puff samples scoring above the hover point, or fewer than
   `oceanPuffMinSinkRate` (80%) of the relaxed samples scoring below it, the
   pucker range included ("Let all the air out after the puff"). The screen
   says why and the player tries again; after two tries "Play anyway" leaves
   the fish to the pucker range alone. A failure never blocks the game.
5. The calibration is saved like the main one (`poopybird.puffCalibration.v3`;
   older single-hold ones are ignored) and with the face. **C** recalibrates
   both. After the face-loss grace, puff drops to 0 and the fish sinks.
6. **Input.** The fish gets `max(face puff, key puff)`; only one of them is live,
   depending on the mode. In keyboard mode, holding Space, mouse or touch inflates
   the key puff at `oceanKeyInflateRate`; releasing deflates it at
   `oceanKeyDeflateRate`.

If the puff doesn't register, open the debug panel (`npm run dev:debug`) in the ocean: the feature
rows show the geometry values as numbers with the relaxed-face marker, and the
stats line "puff source" names the features the calibration picked (or
"pucker range" without one). The console logs each calibration attempt
(`[calibration] puff`), including one that failed.

## Tuning

**Every tunable is in [`src/config.ts`](src/config.ts)**: physics, charge and
overstrain timing, thresholds, EMA, calibration, world scroll, gaps and
spacing, difficulty ramp, targets and scoring, and the "Ocean" and "Ocean puff"
groups (stage lengths, buoyancy and drag, hitbox scale, ocean gaps and spacing,
anchors, spike and pop timing, jellyfish, key puff rates, puff calibration and fallback
range).

Start the app with `npm run dev:debug` (or build with `npm run build:debug`),
then press **D** in game for the debug panel. Plain `dev`/`build` leave the
panel, the saved tuning overrides and `window.poopyBird` out, and the deployed
build is always the plain one:

- FPS, detections per second, the delegate, and whether a face is visible
- the current stage (and transition)
- a live plot of raw and smoothed strain, the on/off threshold lines, the
  charge, and the windows where "straining" was on
- in the ocean: a live plot of raw and smoothed face puff and the combined
  puff input, with hover and spike threshold lines and the spiked windows
- **G** brings the stage's waterfront next (the harbour in the city, the far
  quay in the ocean), so you can test both transitions without playing a whole
  stage first
- **L** spawns a power line right away (city only)
- **K** sends a slingshot kid on right away (city only)
- **W** starts a wedding right away (city only)
- **B** floats a hot-air balloon in right away (city only)
- **A** brings in a boat that drops its anchor (ocean only)
- **🐡 Start as pufferfish** (or **O**) starts a fresh run that dives straight
  into the ocean, skipping the ready screen and the city. From the menu it
  starts in keyboard mode
- **⏺ Record a dataset session** pauses the game and opens the face dataset
  recorder in a new tab (see [Face dataset](#face-dataset))
- **🗑 Forget calibration** deletes the saved strain and puff calibrations
  and the known faces, and reloads, so you can test the first-time flow (scores and settings are kept)
- each face feature (blendshapes and landmark geometry) as a bar, with neutral
  (blue) and strain (red) calibration markers and its share of the weight
  (features at 0% are greyed out). In the ocean the puff candidates show the
  puff calibration's markers and weights instead, and geometry values are also
  shown as numbers
- a slider and number field for every tunable. Changes apply live and persist
  in `localStorage`, changed values are highlighted, and there are "Reset to
  defaults" and "Copy config JSON" buttons. When you find good values, paste
  them back into `config.ts`.

`window.poopyBird` exposes `game`, `config`, `tracker`, `renderer`,
`calibration` and `puffCalibration` in the console.

## Face dataset

Calibration has to work for every face, so detection changes are checked
against a shared collection of labelled recordings from many people and
devices. It lives on the team VM only and is deleted with it.

**Recording.** The recorder is a separate page of the deployed site:
`https://24.hackathon.ethz.ch/collect.html?code=<COLLECTION_CODE>` works on
any device with a camera (the whole site is behind the ETH login, so
participants need an ETH or SWITCH edu-ID login). The game never links to
it; the debug panel's **⏺ Record a dataset session** opens it. It takes a
participant through about 3 minutes:

1. Consent. The text is stored verbatim with every session. A collect link
   can carry the collection code: `/collect.html?code=<code>`.
2. A random participant code (`pb-…`, no names), glasses, facial hair and
   light. The code is remembered on the device; on another device people can
   type it in so their sessions stay together.
3. A camera check (face found, distance, brightness, detection rate).
4. The parts, each one a segment of the session:
   - the game's calibration (relax, strain, same prompts and timing) plus a
     "relax again" phase, running straight into
   - a strain script (pulses of random length, a light strain, a long hold,
     looking around, laughing),
   - a break, then a puff script (full and half puff, pulses, puffing while
     looking around),
   - a break, then the same with the **pufferfish face** (segment `fish`):
     puffing the cheeks while pursing the lips, like a kiss.

   Each break explains the next part and waits for its start button; nothing
   is recorded meanwhile. Every step beeps: high for strain or puff, low for
   relax. The pufferfish face is the ocean's gesture (see
   [Puff detection](#puff-detection-ocean)): plain puffs barely move what
   MediaPipe reports (`cheekPuff` stays 0 and the geometry moves about as much
   as a relaxed face drifts), while pursed lips light up `mouthPucker`. The
   plain puff script stays as a baseline.
5. The upload, with a "Delete this session" button and a fallback to save the
   file when the upload fails. Then **Next person** starts over at consent
   with a fresh participant code (for one shared device at a collection
   table, logged in once), and **Same person again** goes straight back to
   the camera check.

The scripts and the file format are in `src/session.ts`. A session is one
gzipped JSON file of about 3–4 MB: per frame, the step label, all
blendshapes, the features and the 478 face-mesh points (Int16, stored as
differences from the previous frame, which compresses about 3× better).
Device, camera, detection delegate, tuning config and the game's saved
calibrations are stored with it. No video or images.

Scripts can't get past the ETH login, so the team reaches the VM over SSH
instead. To record from a local dev server into the team dataset (for
example to try a change to the recorder):

```sh
npm run tunnel        # keep running: SSH tunnel to the VM (port 8788 → the VM's Caddy)
npm run dev:debug     # then open /collect.html?code=<COLLECTION_CODE>
```

The dev server proxies `/api` to the tunnel, or to `COLLECTOR_URL` (for
example a local `HOST=127.0.0.1 COLLECTION_CODE=local DEV_TOKEN=local-dev-token
DATA_DIR=/tmp/pb npm run collector` with `COLLECTOR_URL=http://127.0.0.1:8787`;
its collection code is then `local`).

**Storage.** `collector/server.ts` is a small Node server without
dependencies, in its own container next to the game, with the recordings on
the `poopybird-data` Docker volume (it survives deploys). Caddy routes `/api/*`
to it. On the VM, `deploy.yml` generates its two secrets once into
`~/poopybird-collector.env` (`ssh viscon@24-direct.viscon-hackathon.ch cat
poopybird-collector.env`): `COLLECTION_CODE`, the upload password that goes
into collect links (uploads only), and `DEV_TOKEN` for the team (list,
download, review, delete). Every upload is validated, quality-checked (face
coverage, detection rate, whether the strain moved brows and eyes) and added
to the index. Participants can delete their session right after uploading; to
delete everything under a participant code:

```sh
ssh viscon@24-direct.viscon-hackathon.ch 'curl -s -X DELETE -H "Authorization: Bearer $(grep ^DEV_TOKEN= poopybird-collector.env | cut -d= -f2)" localhost:8080/api/recordings/<code>'
```

**Using it.** Needs your SSH key on the VM (`ssh-copy-id`); `data:pull` reads
the dev token and opens its own tunnel.

```sh
npm run data:pull   # new sessions into data/sessions/, sessions deleted on the server are deleted locally
npm run eval        # scoreboard: every variant in scripts/eval/variants.ts, per recording and per participant
npm run data:purge  # delete the local copy (everyone, when the VM goes away)
```

`npm run eval` fits each recording's calibration the way the game does and
replays the rest. For strain it reports hits on strain steps, false strain
while relaxed, looking around and laughing, releases in the middle of a
strain, and press and release latency. For puff it scores the plain puff
and the pufferfish face separately. Like the game's interactive calibration,
each script's first hold → relax cycle (plus the relaxed step before it) is
the swim lesson, and every variant is scored only on what comes after the
first two cycles (so the old two-cycle lesson compares fairly): the median
puff level
while relaxed, at half and at full puff, how often the fish sinks while
relaxed and rises while puffing, false spikes, and how often it would rise
while the player looks around (the look frames no calibration saw) or laughs
(the strain script's "look" and "laugh" steps). Like the game, a puff
calibration that fails its quality check isn't used; after an unclear lesson,
the calibration is fitted from the script's next two cycles plus the start of
the strain script's look-around. The script's relax steps are 3 s, so the
lesson's longer let-out step can't be replayed: play-test changes to it. The features are computed again from the
recorded blendshapes and landmarks with the current `extractFeatures` and
`faceGeometry`, so a new or changed feature scores on every recording. To try a
detection idea, add a variant to `scripts/eval/variants.ts`; the first entry
is what the game does today. About 1 in 5 participants are held out (picked
by a hash of their code); score them with `npm run eval -- --holdout` only
when a change is ready to merge. Older debug-recorder clips
(`poopybird-face-*.json`) still work: put them in `data/local/`.

## Privacy

- Video frames go to MediaPipe running in the page (WASM/WebGL) and nowhere
  else.
- The "finest strain" snapshot is taken in every face-mode run. It's a 200 px
  JPEG of your face at its most strained, kept in memory and shown on the
  game-over screen. It leaves the device only if you submit the run to the
  [leaderboard](#leaderboard) with "with my face" ticked; then everyone who
  can open the game sees it until you remove it (✕) or it drops off the
  boards. Without the face, a submitted run is a name, a score and a few
  stats.
- The paparazzi's photos show your face in face mode, and the bird with the
  keyboard. So does the bird in the wedding photos. They stay in memory for
  the current run and are never stored.
- Face recognition keeps a few face descriptors (128 numbers each, biometric
  data) of each face that calibrated, so returning players skip calibration.
  They stay in this tab's `sessionStorage`, are gone when the tab closes, are
  never uploaded, and **Settings → Faces → Forget all** deletes them at once.
  See [Who's playing](#whos-playing-face-recognition).
- All storage access is wrapped in try/catch, so the game works without
  storage.
- Playing sends nothing anywhere unless you submit a run to the
  leaderboard. Apart from that, only the separate dataset recorder
  (`collect.html`) uploads, after explicit consent, and it records expression
  scores and face-mesh points, never video or images. See
  [Face dataset](#face-dataset).

## Project layout

```
src/
  config.ts     all tunables, persisted overrides
  strain.ts     blendshapes → strain (pure)        strain.test.ts
  charge.ts     charge / release / overstrain (pure) charge.test.ts
  puff.ts       blendshapes / Space → puff (pure)  puff.test.ts
  swim.ts       buoyancy, drag, spike / pop (pure) swim.test.ts
  face.ts       webcam, detection loop (in the worker where it can)
  face-detect.ts  MediaPipe + face lock (no DOM; runs in the worker or on the main thread)
  face-worker.ts  the face worker
  faceid.ts     face recognition: descriptors of aligned face crops (face-api)
  known-faces.ts  the faces this tab calibrated: matching, storage format (pure)  known-faces.test.ts
  game/         simulation (fixed timestep), one module per feature, with its tests
    game.ts       the Game: a run's state, step(), scoring and effects helpers, debug spawns
    world.ts      playfield heights, the two stages' coordinates
    bird.ts fish.ts stage.ts   the creature in each stage, and the dive / leap between them
    obstacles.ts ocean-obstacles.ts power-lines.ts balloons.ts   what's in the way
    street.ts traffic.ts paparazzi.ts kids.ts wedding.ts poops.ts   the city's targets and what hits them
    jellies.ts shark.ts angler.ts   the ocean's
    effects.ts events.ts demo.ts     particles and floaters; GameEvents; the start screen's autopilot
  render/       canvas drawing, a module per feature named like its game/ module
    renderer.ts   the Renderer: camera, draw order, photo captures
    view.ts shapes.ts   what drawing functions share; canvas helpers
  rtx.ts        the RTX style's photos
  audio.ts      sound effects (WebAudio samples) and stage music
  feedback.ts   each GameEvent's sound and vibration
  debug.ts      debug / tuning panel
  snapshot.ts   face crops: peak-strain snapshot, paparazzi and wedding photos
  storage.ts    safe localStorage, best score, your leaderboard runs
  leaderboard.ts       leaderboard format, checks, ranking (shared with the collector)
  leaderboard-view.ts  the boards in the page: fetch, submit, remove, draw
  main.ts       screens, input, loops, calibration flow, lessons
  ui/           dom helpers, toast, coach (tutorial banner), game-over screen
  random.ts     pick, rnd (seeded)
  session.ts    dataset sessions: scripts, recorder, format, checks   session.test.ts
  collect.ts    the dataset recorder page (collect.html)
android/        the Android app's project (Capacitor; README "Android app")
capacitor.config.ts  the app's id and name, and its web build (dist/)
collector/
  server.ts     dataset upload/download server (Node, no deps)       server.test.ts
  leaderboard.ts  the online leaderboard's routes and storage        leaderboard.test.ts
  http.ts       helpers shared by both
  Dockerfile
scripts/
  copy-wasm.mjs    node_modules → public/mediapipe/wasm, public/faceid
  app-dev.mjs      app:dev: the dev server, and the Android app showing it
  fetch-model.mjs  downloads face_landmarker.task
  data.ts          data:pull / data:purge
  leaderboard.ts   leaderboard moderation: list and remove runs
  vm.ts            dev token + SSH tunnel to the collector (data.ts, leaderboard.ts)
  run-ts.mjs       runs a TS script through Vite (used by eval)
  eval/            detection scoreboard: load, strain, puff, variants
```
