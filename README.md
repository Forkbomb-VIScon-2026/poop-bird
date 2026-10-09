# Poop Bird 💩🐦

A browser game you control by **straining your face**. The bird keeps falling;
the only way up is to poop. Make a constipated face at your webcam to charge,
relax to let go. Dodge the city, splat the cars, people and statues below.

Everything runs in the browser: face tracking runs locally with MediaPipe, and
no video, snapshot or score leaves the device.

## Run it

Needs Node 24 and npm.

```sh
npm install          # also copies the MediaPipe WASM into public/mediapipe/wasm
npm run fetch-model  # downloads face_landmarker.task into public/mediapipe/ (once)
npm run dev          # http://localhost:5173
```

Webcam access needs a secure context. `localhost` counts, so the dev server is
fine. To play from another device, serve over HTTPS.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the build locally |
| `npm test` | Vitest unit tests (strain math, charge logic) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck only |
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
access on anything other than localhost, put it behind HTTPS.

## Controls

| Input | Action |
| --- | --- |
| Strain face (webcam) | Charge; relax to poop |
| Hold **Space** / mouse / touch | Same as straining (always works, also in face mode) |
| **P** / Esc | Pause |
| **M** | Mute |
| **R** | Restart from game over |
| **C** | Re-run calibration |
| **D** | Debug / tuning panel |
| **Enter** | Start after calibration |

## How it plays

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
- **Score** = distance + target bonuses.

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
   fails if too few frames had a face, if the summed weights are below
   `minCalibrationChange`, if fewer than 60% of strain frames would cross the
   on threshold, or if more than 25% of neutral frames would stay above the
   off threshold. The player sees why and can retry, play anyway or switch to
   keyboard.
7. **No face** shows "Can't see you" over the preview, and the strain is set to
   0 at once, so leaving the frame releases.
8. **Decoupled loops.** Detection runs on `requestVideoFrameCallback` (or rAF
   with a `currentTime` check), so only when there's a new video frame. Physics
   runs on a fixed 120 Hz timestep in the render loop.

The last calibration is saved in `localStorage`. Press **C** (or click
"Recalibrate") when a new player sits down.

## Tuning

**Every tunable is in [`src/config.ts`](src/config.ts)**: physics, charge and
overstrain timing, thresholds, EMA, calibration, world scroll, gaps and
spacing, difficulty ramp, targets and scoring.

Press **D** in game for the debug panel:

- FPS, detections per second, the delegate, and whether a face is visible
- a live plot of raw and smoothed strain, the on/off threshold lines, the
  charge, and the windows where "straining" was on
- each blendshape feature as a bar, with neutral (blue) and strain (red)
  calibration markers and its share of the weight (features at 0% are greyed
  out)
- a slider and number field for every tunable. Changes apply live and persist
  in `localStorage`, changed values are highlighted, and there are "Reset to
  defaults" and "Copy config JSON" buttons. When you find good values, paste
  them back into `config.ts`.

`window.poopBird` exposes `game`, `config`, `tracker` and `calibration` in the
console.

## Privacy

- Video frames go to MediaPipe running in the page (WASM/WebGL) and nowhere
  else.
- The "finest strain" snapshot is **opt-in** (off by default). It's a 200 px
  JPEG of your face at peak strain, kept in memory, shown on the game-over
  screen, and saved only if you add the run to the local Hall of Fame
  (`localStorage`, top 5).
- All storage access is wrapped in try/catch, so the game works without
  storage.

## Project layout

```
src/
  config.ts     all tunables, persisted overrides
  strain.ts     blendshapes → strain (pure)        strain.test.ts
  charge.ts     charge / release / overstrain (pure) charge.test.ts
  face.ts       MediaPipe + webcam, detection loop
  game.ts       simulation (fixed timestep)
  render.ts     canvas drawing
  audio.ts      WebAudio synth sounds
  debug.ts      debug / tuning panel
  snapshot.ts   peak-strain face crop
  storage.ts    safe localStorage, best score, Hall of Fame
  main.ts       screens, input, loops, calibration flow
scripts/
  copy-wasm.mjs    node_modules → public/mediapipe/wasm
  fetch-model.mjs  downloads face_landmarker.task
```
