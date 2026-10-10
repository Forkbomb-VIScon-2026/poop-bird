# Agent notes

## Pull requests, not pushes to main

Never push to `main` directly (a ruleset rejects it anyway). Work on a branch
and open a pull request against `main` with auto-merge enabled:

```sh
gh pr create --fill
gh pr merge --auto --squash
```

GitHub merges the PR once the required checks (`check` and `docker` from
`ci.yml`) pass. If a check fails, the PR stays open: fix it on the branch.

Every merge to `main` deploys: once CI passes on `main`, `deploy.yml` ships the
build to the live VM. Green checks are all that stands between a PR and
production, so run `npm run lint`, `npm test` and `npm run build` locally first,
and actually try changes that the checks can't see (gameplay, camera, audio).

## Set up a new checkout

A fresh worktree has none of the gitignored runtime files, and the game fails
without them. Before running or previewing anything:

```sh
npm install          # dependencies; also copies the WASM into public/mediapipe/wasm
npm run fetch-model  # public/mediapipe/face_landmarker.task
```

Instead of downloading, you can copy the model from another checkout that
already has it (e.g. `cp ../../../repos/poop-bird/public/mediapipe/face_landmarker.task
public/mediapipe/`). Without the model, Vite serves `index.html` in its place
and face tracking fails with `Unable to open zip archive ... StartGraph failed`.

## Preview the change

When you finish implementing a change, leave a dev server running from your
checkout and end your response with its URL, so the changed version can be
opened right away.

- Always use `npm run dev:debug`, never plain `npm run dev`: the person
  you're working with tries the change there and needs the debug panel (`D`)
  and its shortcuts.
- Start it in the background so it outlives your turn.
- Several agents run at once: pick a free port instead of 5173, and don't stop
  dev servers you didn't start.
- Bind to localhost only. `vite.config.ts` sets `host: true`, which listens on
  all interfaces, so pass `--host 127.0.0.1` explicitly:
  `npm run dev:debug -- --host 127.0.0.1 --port <port>`.
- Check that the URL actually responds before you post it.
- Stop the dev server when you remove the checkout.

## Project

Poop Bird: a hackathon browser game (Vite + TypeScript, no framework) where the player controls a Flappy-Bird-style bird by **straining their face** at the webcam. Face tracking runs locally via MediaPipe Face Landmarker blendshapes; nothing leaves the device unless the player submits a run to the online leaderboard. The project is still in the ideation phase, so gameplay concepts may change, but the core idea (facial-expression control tied to the game's story) is fixed. README.md is detailed and up to date on gameplay, controls and the detection algorithm; read it before changing detection or tuning.

## Commands

Node 24 (`.nvmrc`).

```sh
npm install            # postinstall copies MediaPipe WASM into public/mediapipe/wasm
npm run fetch-model    # one-time: downloads face_landmarker.task into public/mediapipe/
npm run dev            # http://localhost:5173 (host: true; webcam needs localhost or HTTPS)
npm run dev:debug      # same, with the debug panel, tuning overrides and window.poopBird
npm run build          # typecheck && vite build → dist/ (production: no debug tooling; game + collect.html)
npm run build:debug    # build with debug tooling
npm test               # vitest run (src/**/*.test.ts, collector/**/*.test.ts)
npx vitest run src/strain.test.ts      # single file
npx vitest run -t "overstrain"         # tests matching a name
npm run lint           # eslint
npm run typecheck      # tsconfig.json (browser) + tsconfig.node.json (collector, scripts, session.ts)
npm run data:pull      # face dataset from the VM into data/ (over SSH; see README "Face dataset")
npm run tunnel         # SSH tunnel to the VM, so the local recorder can upload (the public site needs the ETH login)
npm run eval           # detection scoreboard over data/ (variants in scripts/eval/variants.ts)
docker compose up --build              # Caddy serving dist/ on :8080, plus the dataset collector
```

`public/mediapipe/` is gitignored and generated: the game fails to load face tracking if the model hasn't been fetched.

## Architecture

`src/main.ts` is the orchestrator: it owns the app state machine (`menu → loading → calibrating → calibrated → ready → playing ↔ paused → gameover`), input mode (`face` | `keyboard`), the calibration flow, DOM screens/HUD, and the render loop. In `ready` the bird hovers and the first strain (or Space) starts the run. Everything else is a module it wires together.

Input pipeline (face → bird):
1. `face.ts` `FaceTracker` runs detection on `requestVideoFrameCallback` (decoupled from rendering) and emits `FaceFrame`s with blendshape features.
2. `strain.ts` (pure) turns features + a per-player `Calibration` into a smoothed strain score with on/off hysteresis. Calibration fitting and quality assessment also live here.
3. `main.ts` `straining()` = face-strain in face mode, Space OR pointer in keyboard mode (`manualHeld()`). The two modes never mix.
4. `game.ts` `Game.step()` runs at a fixed 120 Hz timestep (accumulator in `main.ts` `frame()`), feeding `straining` into `charge.ts` (pure charge/release/overstrain state machine).

Stages: a run alternates city → ocean → city → …. `Game.stage` is `"city" | "ocean"`. Each stage ends at the waterfront (`Game.shore`, a `Shore`) after `cityObstaclesBeforeGate` / `oceanObstacles` obstacles: in the city the street ends at a quay, and once the bird is over the harbour the game takes over and dives it in; in the ocean the far quay comes up, and the game takes over and leaps the fish out, gliding the bird until it's over the street. Either is a `StageTransition` without player control: the bird plunges in and becomes a deflated fish under water (or the fish breaks the surface and becomes the bird mid-leap), with the stage switching at that swap. The city and the ocean have separate y coordinates, stacked: ocean y + `OCEAN_DEPTH` = city y, and `Game.cameraY` (top of the view in city y) pans between them; `render.ts` draws the city's sky, the quay and the sea in one camera space. On the `submerged` event (`onSubmerged()`, tied to the `flow` token), a face-mode dive without a puff calibration (or by a new player) starts the swim lesson (`runSwimLesson()`): the world swims on with `game.calmWater` set (nothing spawns, no spiking, the sea floor doesn't kill) while banners (with face pictograms) teach puffing and the fish follows the measured puff; the face is sampled to fit the puff calibration, and with a clear reading the level starts. If it's unclear, a slower calibration runs, where the fish follows a script (`scriptTarget`) instead. New players then get the ocean tips as banners. A new keyboard player gets the same tips, with a "hold Space" banner first, over calm water (`runKeyboardOceanTips()`). Nothing ever holds the world still for a tutorial. Tutorials seen are a set in localStorage (`storage.ts` `loadSeenTutorials`); the menu's "I'm new here" toggle is "some tutorial in `TUTORIALS` is unseen", and flipping it clears or fills that set. In the ocean the creature is a pufferfish: `main.ts` feeds `game.puffInput` = max(face puff from `puff.ts`, key puff from Space/pointer, keyboard mode only) each step instead of using `straining`. Charge, poops and targets are off. `swim.ts` (pure) maps puff to buoyancy and drag and runs the spike → pop state machine (`stepSpike`, the same pattern as `charge.ts`). Re-entering the city resets charge with `needsRelease`, so a held strain can't fire.

Output: `Game` pushes `GameEvent`s into `game.events`; `main.ts` `handleGameEvents()` drains them each frame into `audio.ts` (sample-based WebAudio playback using `src/audio-assets.ts` and `public/assets/audio/`; release samples follow `poopSoundMiddle` / `poopSoundLarge` thresholds) and UI. `render.ts` `Renderer` reads `Game` state and draws everything procedurally on canvas (no sprites). The logical playfield is 600 px tall (`VIEW_H`).

Audio assets: `src/audio-assets.ts` lists the sound IDs, and `src/audio.ts` caches decoded recordings. It loads `public/assets/audio/<name>.mp3` or `<name>.wav`, then logs the missing sound and tries `tmp_<name>.mp3`. Add new effects to `SOUND_NAMES` and provide the named asset; don't edit legacy `sounds/`. `release(size, charge, sweet)` plays `poop_weak`, `poop_middle`, or `poop_large` as selected by `main.ts` using `config.poopSoundMiddle` and `config.poopSoundLarge`. See `public/assets/audio/README.md`.

Conventions that span files:
- Debug tooling is opt-in: `src/env.ts` `DEBUG` is true only in `--mode debug`. Without it `debug` is null (use `debug?.`), saved tuning overrides are ignored, `window.poopBird` isn't set, and `[data-debug-only]` elements are removed.
- **All tunables live in `src/config.ts` `CONFIG_SPEC`.** The debug panel (`D` key, `debug.ts`) auto-generates a slider per entry and mutates the live `config` object in place; overrides persist to localStorage as a diff from defaults. Add new tunables there rather than hardcoding constants, and read `config.x` at use time (not cached), so live tuning works.
- `strain.ts`, `charge.ts`, `puff.ts`, `swim.ts` and `session.ts` are deliberately pure (no DOM, no global `config`; params are passed in) so they are unit-testable. Keep them that way. `game.ts` has no DOM either: `wedding.test.ts` steps a whole `Game` with an immortal bird, and `game.test.ts` drives one through the stage transitions with the default config. `collector/server.ts` has HTTP-level tests (`collector/server.test.ts`).
- Strain and puff share one `FeatureVector`: blendshapes (`FEATURE_SOURCES`) plus landmark geometry (`GEOMETRY_FEATURE_NAMES`, computed by `puff.ts` `faceGeometry()` in `face.ts`). MediaPipe's `cheekPuff` blendshape is dead (always ~0), and so are `noseSneer` and `cheekSquint`. The ocean gesture is the pufferfish face (cheeks puffed, lips pursed): face puff = max(`mouthPucker` through the `oceanFallbackMin`..`oceanFallbackMax` range (`puckerRange`, moved above the player's resting pucker), the per-player puff calibration over geometry and mouth blendshapes). The puff calibration comes from the swim lesson (`main.ts` `runSwimLesson`: a relaxed moment and two puff → relax cycles; if unclear, `CALIBRATION_STEPS` with a look-around and a timeline of the steps) and is fitted by `buildInteractivePuffCalibration`, so a feature only counts if the puff beats the face right after a puff. The puff phase uses `robustFeatureStats` (median/MAD) so the brief lip pucker while the cheeks fill gets no weight; the face dataset (`npm run data:pull`, then `npm run eval`) is the way to check detection changes against real faces. `buildCalibration` only weights the feature subset it's given (`STRAIN_FEATURES` by default, `PUFF_FEATURES` for puff), so puff-only features never affect strain; puff uses scale-free `separationWeight` because its features have different units. Saved calibrations go through `restoreCalibration`, which fills in features added later; a missing `neutralStd` means no puff calibration is possible, so the pucker range alone is used.
- All localStorage access goes through `storage.ts` wrappers (try/catch), so the game must keep working without storage.
- In debug mode, `window.poopBird` exposes `game`, `config`, `tracker`, `renderer`, `calibration`, `puffCalibration` for console debugging. With the debug panel open, **G** brings the stage's waterfront next, **W** starts a wedding (`game.spawnWeddingNow()`), **H** brings a fisherman in the ocean (`game.spawnAnglerNow()`) and **O** (or the "Start as pufferfish" button) starts a run that dives straight into the ocean (`startOceanRun()` → `game.diveNow()`). "Record a dataset session" (or `poopBird.openDatasetRecorder()`) pauses the game and opens `collect.html`. "Forget calibration" deletes both saved calibrations and reloads, for testing the first-time flow.

Leaderboard (README "Leaderboard"): opt-in at game over (`main.ts` `submitToLeaderboard`; the face only with "with my face" ticked, unticked every run). Two boards: score, and `strain.ts` `strainedness` of the finest-strain snapshot (raw blendshapes, calibration-free, so it compares players; the snapshot is offered only while `strain.active`). `src/leaderboard.ts` is the shared format/ranking (Node-safe like `session.ts`), `src/leaderboard-view.ts` the page side, `collector/leaderboard.ts` the routes and storage (`leaderboard/` on the data volume, top 100 per board kept), tested in `collector/leaderboard.test.ts`. Debug builds submit and list only `debug` runs, so testing never reaches the public boards.

Face dataset (README "Face dataset" has the full picture):
- `collect.html` + `src/collect.ts` record consented, labelled sessions (game calibration + "relax again", strain script, then after a break each: puff script, pufferfish face = puffing the cheeks while pursing the lips) and upload them to `/api/recordings`. It is the second page of every build (`vite.config.ts` `rolldownOptions.input`), so it is live at `/collect.html`; the game never links to it. In dev, `/api` is proxied to `npm run tunnel` (127.0.0.1:8788) or `COLLECTOR_URL`. The public site `https://24.hackathon.ethz.ch` is behind the ETH (VSETH) login, so scripts reach the VM over SSH (`viscon@24-direct.viscon-hackathon.ch`), never through the public URL. Bump `CONSENT_VERSION` in `collect.ts` when the consent text in `collect.html` changes.
- `src/session.ts` owns the scripts, the session format (schema 2: columns per frame, landmarks as Int16 deltas), validation, quality flags and index rows. The collector runs it in plain Node with types stripped, so it must have **no runtime imports and only erasable TypeScript** (no parameter properties, enums or namespaces); `tsconfig.node.json` (`erasableSyntaxOnly`) checks this for the collector, `scripts/**/*.ts` and `session.ts` (and `src/leaderboard.ts`, same rules).
- `collector/server.ts` (own container, `collector/Dockerfile`, no npm install) stores sessions on the `poopbird-data` volume. `deploy.yml` starts it on the `poopbird` network next to the game and creates its `COLLECTION_CODE` / `DEV_TOKEN` once in `~/poopbird-collector.env` on the VM. Caddy proxies `/api/*` to `collector:8787`.
- Recordings are personal data: never commit them (`data/`, `poopbird-face-*` are gitignored and dockerignored), and they live only on the VM and in devs' `data/` (deleted with `npm run data:purge` when the VM goes).
- `scripts/eval/` scores detection variants (`variants.ts`, first entry = the game today) against `data/`. It runs through `scripts/run-ts.mjs` (Vite's module runner), so it can import `src/` modules as they are; `scripts/data.ts` runs in plain Node and must not import `src/`.
