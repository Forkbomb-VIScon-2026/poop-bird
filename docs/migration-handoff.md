# Instructions for continuing the Rust/WASM migration

This is a continuation guide for another coding model. The user approved the
migration plan and requested a separate branch. Continue implementation on
`migration/rust-wasm`; preserve the draft PR
[77](https://github.com/Forkbomb-VIScon-2026/poop-bird/pull/77). Do not merge,
enable auto-merge, deploy, or report the full migration complete at a checkpoint.
This overrides AGENTS.md's normal auto-merge workflow for this migration.

## Start here

1. Read AGENTS.md, docs/migration-progress.md (current status and work log),
   docs/migration-audit.md (audit and approved architecture), docs/city-world.md
   (current scope and ABI) and docs/rust-build.md (reproducible setup).
2. Inspect `git status`, branch, recent commits, PR head and upstream `main`.
   Preserve uncommitted work. Compare upstream changes before assuming the
   frozen reference still covers newly added gameplay. Never overwrite user work.
3. Establish the recorded checks below. Read the relevant TypeScript subsystem
   completely before migrating it; the audit need not be repeated globally.
4. Pick the next dependency-ordered slice below, implement its connected Rust
   state, live parameters, frame data and events, then prove parity before moving
   on. Commit small logical changes and update the progress document each time.

Git objects, progress docs and fixtures in this repository are durable context.
Scratch logs, installed tools, browser binaries and old dev servers are not.
Do not rely on another session's absolute paths or tool memory.

## What is actually implemented

Rust owns charge, swimming/spike/drag kernels, strict circle/rectangle collision,
LCG RNG, bird motion and a scoped city world: idle, attract demo, practice perch,
takeoff, first-city buildings/towers, ordinary targets/rage, projectile hits,
score/combo, effects, crash/gameover and calm-city lessons. Rust runs complete
batches internally; TypeScript decodes a copied presentation frame. Actual WASM,
seeded differential tests and classic/RTX pixel comparisons exercise this path.

**The application still runs the TypeScript Game.** Rust CityWorld is opt-in via
`poopBird.createRustCity()` in debug builds and automated browser checks. It is
not wired as the authoritative engine in main.ts. Ocean kernels being migrated
does not mean ocean world behavior is migrated.

Scoped runs require powerLineChance, balloonChance, weddingChance,
paparazziChance and kidChance to be zero before creating/resetting the reference
world. Rust rejects other run configurations atomically with UnsupportedRun.
This is an explicit test/debug scope restriction, not a change to production
settings. At the first unsupported waterfront tick, `frame.blocked` becomes true;
the world pauses before that tick, remaining batches do not advance, and reset
clears it. Do not mistake this boundary for a migrated stage transition. Remove
restrictions individually only after their replacements and tests are connected.

## Ownership and compatibility rules

- Keep Rust on pinned stable 1.90.0, edition 2024. Two crates: dependency-free
  browser-independent core and thin wasm-bindgen adapter (exact CLI/library
  version 0.2.104). No unsafe, ECS, synchronization, or framework without evidence.
- Canvas2D and RTX photo rendering stay TypeScript. Preserve all classic/photo
  visual behavior; no WebGL/WebGPU rewrite was justified by measurement.
- MediaPipe, strain/puff detection and calibration, camera/video scheduling,
  keyboard/pointer input, DOM/HUD, storage/consent, Web Audio, collector and
  leaderboard remain TypeScript. Feed normalized input into Rust once per batch.
- Keep fixed 120 Hz simulation independent of rendering; preserve main.ts's
  accumulator/pause behavior. Batch multiple ticks; avoid per-entity calls.
- CONFIG_SPEC remains the tuning source. Extend CITY_PARAM_KEYS, Rust Params and
  validation together, reading live values each call. Distinguish parameters
  captured on reset (e.g. first obstacle delay) from live ones during a run.
- Preserve f64, strict tangency rules, update order, JS rounding semantics and
  RNG draw order, including draws for disabled encounters. Renderer/audio RNG
  must not alter Rust's simulation stream. The production TS reference still
  uses its legacy default RNG; isolate intentionally when switching engines.
- Preserve entity order while compacting, stable IDs within a reset epoch,
  retained Vec capacity and event order across batched ticks. Ground/obstacle
  collision order and collision-before-scroll are observable behavior.
- Kernel audit protocol is version 2; city frame protocol is independently
  version 2. Extend encode/decode/validation/tests together; bump the appropriate
  version for incompatible formats. No borrowed WASM memory may outlive growth.
- Audio objects emit semantic events; audio-cues.ts resolves fixed/random/bag/
  state-dependent samples. Keep existing assets, live release thresholds and
  continuous channel/theme scheduling. Do not scatter playback across modules.

## Remaining dependency-ordered work

| Slice | Implementation entry points | Required parity and likely regressions |
|---|---|---|
| City power lines and balloons | Read Game.updatePowerLines/updateBalloons, touchesWire/zap, pigeon/drone/projectile interactions, obstacleSpan/Rects; add typed core modules, entities, params and frame/event sections | Pole and wire hitboxes; moving balloon/passenger and pigeon behavior; seed alignment, zap particles/timers, points, audio cues and hum lifecycle; classic/RTX pixels. Remove only the corresponding scope guards. |
| Paparazzi, slingshot kids and front pages | Game.updateTargets, paparazzoDue/kidDue, camera/pebble/bonk/photo helpers; Rust target behavior enums, projectile contacts and photo request/event contracts | Eligibility spacing/progression, rage coexistence, camera captures, frozen presentation poses, live timing, projectile interception, stun/charge latches, pending tabloid billboards, audio. Keep DOM/canvas capture in TS. |
| Weddings and bouquet | Game.weddingDue/spawnWedding/updateWedding/updateBouquet, weddings' target scoring and church geometry | Reset-time plan draw, church/bird collisions, multi-target event order, ruin/arrival/theme scheduling, photographs, doves, bouquet catching and scoring; extend existing wedding tests. Remove wedding guard only when full behavior passes. |
| Waterfront and alternating stages | Game.updateShore/startTransition/updateTransition/switch-stage helpers, floorY/overWater/stageOffset/cameraY, gates and cityStage progression | Gate holds for photos/weddings, no targets walking off quay, dive/leap takeover, camera motion, stage-local coordinate mapping, held strain release latch, shore audio. Replace blocked boundary with real transition only after this is verified. |
| Ocean ordinary world | Game.updateFish, spike/buoyancy/drag kernels, ocean obstacle spawning, anchors/drop states, jellies, ocean collisions and effects | Floor/grace rules, calm-water lesson and guide input, pop/stun, boats/anchors/wreck geometry, scoring/events, paired city/ocean transitions, pixel comparisons. A tested kernel alone is insufficient. |
| Ocean anglers and sharks | Game angler/shark state machines and themes, hooked/landed/eaten lifecycle, trophy/capture paths | Fishing line/range collisions, reel/pull states, frozen photo capture, lunge/spike contacts, theme scheduling and resets, special gameover delays, spawning-room gates. |
| Authoritative application integration | main.ts Game dependencies, commands, normalized input, event handling, HUD/leaderboard/storage/debug tooling, renderer RenderFrame | Introduce only a small engine interface needed by both worlds. Replace mutable direct accesses with explicit commands/input snapshots. Verify menu/calibration/ready/play/pause/resume/restart, webcam lessons, keyboard/pointer fallback, resize, visibility and all debug spawns; preserve privacy/consent. Keep legacy fallback until full parity is established. |
| Performance and cleanup | CityRuntime decode, CityWorld output copy, rAF/render loop, synthetic benchmarks and real browser profiles | Address measured frame-copy/decode allocation before making Rust default. Compare identical seeded workloads and realistic 2-tick frames, dense effects and both graphics modes. Record median/p95/p99 and allocations; then remove verified obsolete TS simulation/dependencies, update build/docs and validate fresh setup/CI/Docker. |

Composition, enums and module-local behavior are sufficient. Prefer adding a
focused module over enlarging one world file or inventing an abstraction hierarchy.
Choose the next slice's size so it can be tested and committed independently.

## Verification recipe

Setup is detailed in rust-build.md. Generated MediaPipe files and game-wasm are
ignored; do not commit them. Fresh checkout needs npm dependencies and the real
face_landmarker.task model, not a Vite HTML fallback at that URL.

```sh
npm run check:rust
npm run test:rust
npm run build:wasm
npm run test:wasm
npm run lint
npm test
npm run build
npm run build:debug
npm run test:browser
node scripts/run-ts.mjs scripts/migration/bench-city.ts
```

Run relevant checks per slice, and the full suite before publishing a checkpoint.
`test-city.ts` loads actual WASM and compares full scoped world state and ordered
events to seeded Game traces. Extend it with the newly migrated entities/modes,
not just selected counters. Assert coverage of important rare states, not merely
that a long trace completed. Preserve the existing fixture files as independent
oracles; do not regenerate them to make a divergent implementation pass.

Native tests cover invariants and atomic request rejection. WASM tests also cover
malformed packets, memory growth and retained frame copies. Browser smoke loads
the real modules, compares frozen whole frames pixel for pixel in both graphics
styles, and routes Rust events through actual decoded sound buffers. Use a real
Chromium executable via CHROMIUM_EXECUTABLE/CHROMIUM_ARGS_JSON when needed; CI
installs Playwright Chromium. The browser script owns its Vite server. In some
Work environments separate tool calls have separate network namespaces; start
server and browser/request in the same process if localhost is unreachable.

Manual verification is still required for real webcam controls/calibration,
audible speakers, Firefox/Safari and desktop frame-time profiles. Headless audio
buffer decoding does not prove audible playback. Do not claim those checks passed.

Measured decoded Rust frame cost is currently higher than TypeScript in the
synthetic city workload. Raw WASM timing omits required decoding and is not a game
speedup. Use measurements in city-world.md with their scope/version; do not
promise Rust automatically improves rendering or frame consistency.

## Finish every checkpoint

Update migration-progress.md's current status, exact passed checks, manual gaps,
performance observations and next concrete slice. Update this guide when scope,
interfaces or restrictions change. Commit logical units on the migration branch,
publish to draft PR 77, and inspect its check/docker results. If shell git push
has no credentials, use available GitHub Git Data tools with a base-tree SHA,
commit parents and an expected-head lease; never force over newer work. Verify
published tree content matches local content even if API commit SHAs differ.

Leave a localhost debug server running with a verified URL as AGENTS.md requires.
Final response must say what checkpoint is verified and what remains; no merge
or full-migration claims while any remaining slice is unfinished.
