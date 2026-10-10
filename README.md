# Poop Bird 💩🐦

A browser game you control by **straining your face**. The bird keeps falling;
the only way up is to poop. Make a constipated face at your webcam to charge,
relax to let go. Dodge the city, splat the cars, people and statues below.
Then dive into the harbour, where the bird becomes a pufferfish that you steer
by **puffing your cheeks**.

Everything runs in the browser: face tracking runs locally with MediaPipe, and
no video, snapshot or score leaves the device.

## Run it

Needs Node 24 and npm.

```sh
npm install          # also copies the MediaPipe WASM into public/mediapipe/wasm
npm run fetch-model  # downloads face_landmarker.task into public/mediapipe/ (once)
npm run dev          # http://localhost:5173 (no debug tooling, same as production)
npm run dev:debug    # same, with the debug panel (D), tuning sliders and window.poopBird
```

Webcam access needs a secure context. `localhost` counts, so the dev server is
fine. To play from another device, serve over HTTPS.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build to `dist/` (no debug tooling; this is what CI, Docker and the deploy use) |
| `npm run build:debug` | Same, with the debug tooling included |
| `npm run preview` | Serve the build locally |
| `npm test` | Vitest unit tests (strain and puff math, charge and spike logic, buoyancy, dataset sessions, collector) |
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

## Controls

| Input | Action |
| --- | --- |
| Strain face (webcam) | City: charge; relax to poop |
| Puff cheeks (webcam) | Ocean: inflate (more puff = rise, less = sink) |
| Hold **Space** / mouse / touch | City: same as straining. Ocean: inflate while held, deflate when released. Always works, also in face mode |
| **P** / Esc | Pause |
| **M** | Mute |
| **R** | Play again from game over |
| **C** | Re-run calibration |
| **D** | Debug / tuning panel (only with `npm run dev:debug`) |
| **G** | With the debug panel open: spawn the next gate now |
| **L** | With the debug panel open: spawn a power line now |
| **O** | With the debug panel open: start a run as the pufferfish (skips the city) |
| **Enter** | Play after calibration |

## How it plays

After calibration (each phase shows a sketch of the face to make), a strain
check shows a live meter between a relaxed and a strained face sketch. Then the
bird hovers until the player strains for the first time, which starts the run;
there's no countdown.

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
- **Power lines:** some city obstacles are a run of poles with wires sagging
  between them (`powerLineChance`). Touching a wire zaps the bird and ends the
  run, and so does hitting a pole. Fly over, under, or (later, when the wires
  stack up to three) between them. Pigeons sit on the wires and are targets
  too (×2).
- **Paparazzi:** now and then a paparazzo walks on with his camera raised.
  The ring over his head fills as he closes in; when it's full (just past the
  bird) he takes your picture. Splat him first to smash the camera (×3).
  Miss, and you get a flash, a polaroid, and your photo on a roadside
  billboard as the next obstacle, always before the harbour gate (and on the
  game-over screen). The run's first paparazzo walks slower and has a
  "SPLAT HIM!" arrow.
- **Score** = distance + target bonuses. It carries straight across stages.

### The ocean stage

A run alternates city → ocean → city → … and difficulty keeps ramping with
total distance.

- **Harbour gate.** After `cityObstaclesBeforeGate` (6) city obstacles comes a
  harbour building whose door is full of sea. Fly through it to dive in; its
  walls kill like any other obstacle.
- **Transformation.** A splash, and the bird becomes a pufferfish. On the first
  dive in face mode the world freezes for ~2.5 s with "PUFF YOUR CHEEKS!": that
  is the puff calibration (see below). Later dives, and keyboard mode, get a
  ~1 s transform instead. Keyboard mode shows "Hold SPACE to puff up".
- **Buoyancy.** The fish is always somewhere between deflated (puff 0, sinks)
  and fully puffed (puff 1, rises). Around 40% puff it hovers. Speed eases
  toward the target with water drag, so it's floaty, never snappy. The sea
  floor kills; the surface is a soft ceiling you bump against.
- **Size is the tradeoff.** The fish, and its hitbox, grow with puff. Rising
  makes you bigger.
- **Spike-out.** At ~85% puff the spines come out. Spiked, you pop jellyfish
  for `targetPoints × 1.5 × combo`; unspiked, a jellyfish kills you. Stay
  spiked longer than ~1.5 s and you **pop**: a comic deflate, shake, and a
  stun during which you sink without control. The meter flashes "DEFLATE!" in
  the last ~0.3 s.
- **No poop underwater.** Charge, poops and city targets are off in the ocean.
- **Exit gate.** After `oceanObstacles` (8) ocean obstacles, a reef arch with a
  bubble ring leads up to the surface. Swim through and you're a bird again.
  A strain held while surfacing doesn't fire: you have to relax first.
- With Space alone: hold to inflate (rise), let go to deflate (sink), and tap to
  hover. The puff meter next to the fish marks the hover level (blue) and the
  spike threshold (red).

## How the strain detection works

Code: `src/strain.ts` (pure, unit-tested), `src/face.ts` (MediaPipe and
webcam), and the wiring in `src/main.ts`.

1. **Features.** MediaPipe Face Landmarker (`runningMode: "VIDEO"`,
   `outputFaceBlendshapes: true`, GPU delegate with CPU fallback) gives 52
   blendshape scores per frame. We use `browDown`, `eyeSquint`, `eyeBlink`,
   `noseSneer`, `cheekSquint` and `mouthPress` (each the mean of left and
   right), plus `mouthRollLower`, `mouthRollUpper`, `mouthShrugUpper` and
   `mouthShrugLower`.
2. **Calibration** (per player, about 3 s per phase): "Relax your face", then
   "STRAIN!". The first 0.7 s of each phase is ignored so reaction time doesn't
   pollute the data. We store the mean and standard deviation of each feature
   for both phases.
3. **Weights.** A feature's weight is `max(0, |Δ| − minFeatureDelta) ×
   reliability`, where `Δ = strainMean − neutralMean` and reliability is
   `min(1, |Δ| / (σ_neutral + σ_strain) / 2)`. Features that didn't move get
   zero weight, and noisy ones get less.
4. **Score per frame.** Each feature is normalized to `(x − neutral) / (strain
   − neutral)` and clamped to `0..featureClampMax`. We take the weighted mean,
   clamp it to 0..1, then smooth it with a frame-rate-independent EMA.
5. **Hysteresis.** The signal turns on at `strainOn` and stays on until it
   drops below `strainOff`. "Straining" is then face OR Space OR pointer, which
   feeds the charge state machine in `src/charge.ts`.
6. **Quality check.** After calibration, every calibration sample is scored. It
   fails if fewer than `minFaceCoverage` (60%) of a phase's frames had a face,
   if the summed weights are below
   `minCalibrationChange`, if fewer than 60% of strain frames would cross the
   on threshold, or if more than 25% of neutral frames would stay above the
   off threshold. The player sees why and can retry, play anyway or switch to
   keyboard. Only a calibration that passes replaces the saved one. "Play
   anyway" uses a failed one for this session only.
7. **No face.** Short dropouts (up to `faceLossGrace`, 0.25 s) keep the last
   strain state, so a missed frame mid-grimace doesn't cause a release. After
   that, the strain drops to 0 (leaving the frame releases) and the preview
   shows "Can't see you".
8. **Decoupled loops.** Detection runs on `requestVideoFrameCallback` (or rAF
   with a `currentTime` check), so only when there's a new video frame. Physics
   runs on a fixed 120 Hz timestep in the render loop.

The last calibration is saved in `localStorage`. Press **C** (or click
"Recalibrate") when a new player sits down.

### Puff detection (ocean)

Code: `src/puff.ts` (pure, unit-tested), reusing the calibration machinery in
`src/strain.ts`.

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
2. **Neutral** comes from the main calibration's relaxed phase, which also
   stores each feature's standard deviation.
3. **Puff phase.** On the first dive in face mode, with the world frozen, we
   collect `oceanCalibrationSeconds` (3 s) of full puff and drop the first
   `calibrationSettle`. Pausing restarts the phase; going to the menu or
   recalibrating abandons it. The phase is summarized with **robust stats**
   (median and MAD): as the cheeks fill, the lips purse hard for ~0.2 s and
   then relax, and with mean stats that blip got weight, so the fish only
   puffed while the face was changing and sank while the puff was held. With
   the median only what you hold through most of the phase counts.
4. **Weights.** Geometry moves by a few hundredths while blendshapes move by
   tenths, so the puff weights are scale-free: a feature counts once its change
   exceeds `oceanPuffMinSeparation` (1.5) times its noise, with full weight at
   twice that. Whatever moves for *you* gets picked. The score is the same
   weighted normalized mean and EMA as strain, but with **no hysteresis**: the
   fish needs the analog value.
5. **Quality check.** It fails on low face coverage, summed puff weights below
   `oceanMinPuffChange` (0.5, i.e. at least half a feature that clearly moved),
   or fewer than 60% of puff samples scoring above the hover point. A failure
   never blocks the game: puff falls back to `max(mouthPress, cheekPuff)`
   mapped through `oceanFallbackMin`..`oceanFallbackMax`, with a toast. A
   calibration saved before these features existed has no neutral stats for
   them, so the fish uses the fallback until you recalibrate with **C**.
6. A passing puff calibration is saved like the main one, and the toast says
   which features it watches. **C** clears it, so the next dive samples again.
   After the face-loss grace, puff drops to 0 and the fish sinks.
7. **Input.** The fish gets `max(face puff, key puff)`. Holding Space, mouse or
   touch inflates the key puff at `oceanKeyInflateRate`; releasing deflates it
   at `oceanKeyDeflateRate`.

If the puff doesn't register, open the debug panel (`npm run dev:debug`) in the ocean: the feature
rows show the geometry values as numbers with the relaxed-face marker, and the
stats line "puff source" names the features the calibration picked.
`poopBird.lastPuffAttempt` in the console holds the last attempt, including
one that failed.

## Tuning

**Every tunable is in [`src/config.ts`](src/config.ts)**: physics, charge and
overstrain timing, thresholds, EMA, calibration, world scroll, gaps and
spacing, difficulty ramp, targets and scoring, and the "Ocean" and "Ocean puff"
groups (stage lengths, buoyancy and drag, hitbox scale, ocean gaps and spacing,
spike and pop timing, jellyfish, key puff rates, puff calibration and fallback
range).

Start the app with `npm run dev:debug` (or build with `npm run build:debug`),
then press **D** in game for the debug panel. Plain `dev`/`build` leave the
panel, the saved tuning overrides and `window.poopBird` out, and the deployed
build is always the plain one:

- FPS, detections per second, the delegate, and whether a face is visible
- the current stage (and transition)
- a live plot of raw and smoothed strain, the on/off threshold lines, the
  charge, and the windows where "straining" was on
- in the ocean: a live plot of raw and smoothed face puff and the combined
  puff input, with hover and spike threshold lines and the spiked windows
- **G** spawns the next gate right away, so you can test the ocean without
  flying through the city first
- **L** spawns a power line right away (city only)
- **🐡 Start as pufferfish** (or **O**) starts a fresh run that dives straight
  into the ocean, skipping the ready screen and the city. In face mode the dive runs
  the puff calibration if one is due, so **C** followed by this button is a
  quick way to retry it. From the menu it starts in keyboard mode
- **⏺ Record a dataset session** pauses the game and opens the face dataset
  recorder in a new tab (see [Face dataset](#face-dataset))
- **🗑 Forget calibration** deletes the saved strain and puff calibrations and
  reloads, so you can test the first-time flow (scores and settings are kept)
- each face feature (blendshapes and landmark geometry) as a bar, with neutral
  (blue) and strain (red) calibration markers and its share of the weight
  (features at 0% are greyed out). In the ocean the puff candidates show the
  puff calibration's markers and weights instead, and geometry values are also
  shown as numbers
- a slider and number field for every tunable. Changes apply live and persist
  in `localStorage`, changed values are highlighted, and there are "Reset to
  defaults" and "Copy config JSON" buttons. When you find good values, paste
  them back into `config.ts`.

`window.poopBird` exposes `game`, `config`, `tracker`, `calibration` and
`puffCalibration` in the console.

## Face dataset

Calibration has to work for every face, so detection changes are checked
against a shared collection of labelled recordings from many people and
devices. It lives on the team VM only and is deleted with it.

**Recording.** `collect.html` (debug panel: **⏺ Record a dataset session**, or
`/collect.html` on `npm run dev:debug`) takes a participant through about 3
minutes:

1. Consent. The text is stored verbatim with every session. A collect link
   can carry the collection code: `/collect.html?code=<code>`.
2. A random participant code (`pb-…`, no names), glasses, facial hair and
   light. The code is remembered on the device; on another device people can
   type it in so their sessions stay together.
3. A camera check (face found, distance, brightness, detection rate).
4. The game's calibration (relax, strain, same prompts and timing) plus a
   "relax again" phase, then a strain script (pulses of random length, a light
   strain, a long hold, looking around, laughing) and a puff script (full and
   half puff, pulses, puffing while looking around). Every step beeps: high
   for strain or puff, low for relax.
5. The upload, with a "Delete this session" button and a fallback to save the
   file when the upload fails.

The scripts and the file format are in `src/session.ts`. A session is one
gzipped JSON file of about 3–4 MB: per frame, the step label, all
blendshapes, the features and the 478 face-mesh points (Int16, stored as
differences from the previous frame, which compresses about 3× better).
Device, camera, detection delegate, tuning config and the game's saved
calibrations are stored with it. No video or images.

For now the recorder is only built in debug mode; the production build
ships just the game. In dev, `/api` is proxied to the team VM, or to
`COLLECTOR_URL` (for example a local `npm run collector`).

**Storage.** `collector/server.ts` is a small Node server without
dependencies, in its own container next to the game, with the recordings on
the `poopbird-data` Docker volume (it survives deploys). Caddy routes `/api/*`
to it. On the VM, `deploy.yml` generates its two secrets once into
`~/poopbird-collector.env`: `COLLECTION_CODE` (for collect links; uploads
only) and `DEV_TOKEN` (for the team: list, download, review, delete). Every
upload is validated, quality-checked (face coverage, detection rate, whether
the strain moved brows and eyes) and added to the index. Participants can
delete their session right after uploading; to delete everything under a
code: `curl -X DELETE -H "Authorization: Bearer $DEV_TOKEN" <site>/api/recordings/<code>`.

**Using it.**

```sh
export POOPBIRD_DEV_TOKEN=$(ssh viscon@24-direct.viscon-hackathon.ch "grep DEV_TOKEN poopbird-collector.env | cut -d= -f2")
npm run data:pull   # new sessions into data/sessions/, sessions deleted on the server are deleted locally
npm run eval        # scoreboard: every variant in scripts/eval/variants.ts, per recording and per participant
npm run data:purge  # delete the local copy (everyone, when the VM goes away)
```

`npm run eval` fits each recording's calibration the way the game does and
replays the rest. For strain it reports hits on strain steps, false strain
while relaxed, looking around and laughing, releases in the middle of a
strain, and press and release latency. For puff it reports the median puff
level while relaxed, at half and at full puff, and false spikes. To try a
detection idea, add a variant to `scripts/eval/variants.ts`; the first entry
is what the game does today. About 1 in 5 participants are held out (picked
by a hash of their code); score them with `npm run eval -- --holdout` only
when a change is ready to merge. Older debug-recorder clips
(`poopbird-face-*.json`) still work: put them in `data/local/`.

## Privacy

- Video frames go to MediaPipe running in the page (WASM/WebGL) and nowhere
  else.
- The "finest strain" snapshot is taken in every face-mode run. It's a 200 px
  JPEG of your face at peak strain, kept in memory, shown on the game-over
  screen, and saved only if you add the run to the local Hall of Fame
  (`localStorage`, top 5).
- The paparazzi's photos show your face in face mode, and the bird with the
  keyboard. They stay in memory for the current run and are never stored.
- All storage access is wrapped in try/catch, so the game works without
  storage.
- Playing never sends face data anywhere. Only the separate dataset recorder
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
  face.ts       MediaPipe + webcam, detection loop
  game.ts       simulation (fixed timestep)
  render.ts     canvas drawing
  audio.ts      WebAudio synth sounds
  debug.ts      debug / tuning panel
  snapshot.ts   face crops: peak-strain snapshot, paparazzi photos
  storage.ts    safe localStorage, best score, Hall of Fame
  main.ts       screens, input, loops, calibration flow
  session.ts    dataset sessions: scripts, recorder, format, checks   session.test.ts
  collect.ts    the dataset recorder page (collect.html)
collector/
  server.ts     dataset upload/download server (Node, no deps)       server.test.ts
  Dockerfile
scripts/
  copy-wasm.mjs    node_modules → public/mediapipe/wasm
  fetch-model.mjs  downloads face_landmarker.task
  data.ts          data:pull / data:purge
  run-ts.mjs       runs a TS script through Vite (used by eval)
  eval/            detection scoreboard: load, strain, puff, variants
```
