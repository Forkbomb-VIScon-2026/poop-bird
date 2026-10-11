# Poop Bird migration audit

Audited commit: `4208bf7f765c6968283ea264aa49f2a9ab3dccde`.
Repository: https://github.com/Forkbomb-VIScon-2026/poop-bird.

## Scope and behavior

Read the simulation (4,340 lines), renderer (6,315), application orchestrator
(2,284), helpers, all tests, configuration, assets, collector/leaderboard,
recording/evaluation scripts, build and deployment configuration, and AGENTS.md.

The simulation is fixed at 120 Hz. main.ts clamps frame elapsed time to 100 ms
and accumulates ticks. Menu, tutorials and post-game effects have additional
timing semantics. Actors update before scrolling obstacles; collision and event
ordering affect projectile interceptions and stage transitions.

City behavior includes charge/release/overstrain, targets/scoring, power lines,
pigeons/drones, slingshot kids, weddings/bouquets/doves, cameras/photos/billboards,
balloons and parachutists. Ocean behavior includes piecewise puff buoyancy,
exponential drag, growing hitboxes, spike hysteresis/pop/stun, jellyfish,
wrecks/anchors, hook/line capture, shark theme/attacks and trophy photographs.
Demo, perch, lessons, calibration, pause/visibility, resize, touch/keyboard/face
controls, recorder and opt-in face-only leaderboards must remain functional.

## Findings

- main.ts writes simulation fields directly. Photograph rendering temporarily
  modifies live simulation state. Introduce commands and local photo overrides.
- Wedding participants/church and projectile shooters share object references.
  Rust needs stable IDs and explicit lifetime/ownership rather than RefCell graphs.
- Math.random is shared across simulation, drawing and playback. Drawing can
  influence future gameplay; seeded reference inputs are needed for parity.
- Repeated filters, temporary geometry and render paths create allocations;
  their frame-time impact has not been measured. Entity counts do not justify ECS
  or broadphase infrastructure. Preserve stable ordering when compacting buffers.
- Canvas procedural art, text, clipping and photos make a GPU rewrite high-risk.
  Retain Canvas; cache static geometry/layout only after visual checks.
- MediaPipe detectForVideo runs synchronously despite the separate video callback.
  UI stalls are suspected, not measured. A worker is a later profiling gate.
- Face locking, 384 px crops, GPU/CPU fallback, timestamp monotonicity, face-switch
  resets, dropout grace, calibration statistics and recorder data stay TypeScript.
- CONFIG_SPEC is authoritative and live debug tuning reads current values.
  Production ignores saved overrides. Preserve storage wrappers and Node-safe
  session/leaderboard modules.
- Audio is sample-based with random bags, strength-dependent release samples,
  sustained channels, delayed cues, proximity hum and simulation-synced shark theme.
  Centralize playback definitions and emit typed cues from simulation owners.

## Existing audio exceptions

Missing active asset IDs: smash, power_down, wedding_arrived, wedding_beat.
Registered release is also absent, but actual release playback selects other IDs.
Some files named .mp3 contain WAV; bonk.mp3 contains FLAC. Keep existing bytes and
fallbacks initially. File inspection does not establish browser decoding support.

## Measurements

Node 24.19.0, AMD EPYC 9V74 shared container. Five seeded runs per scenario,
1,200 warm-up ticks/run, 200 measured batches of 120 ticks/run. Width 1,000.
Bird position held safe in non-demo scenes; crashes disabled. Gate counts raised,
random shark/angler encounters disabled, events drained. No render, face, UI or
audio work measured. These are batch-average costs, not individual-tick tails.

| Scene | Median ms/tick | P95 ms/tick |
|---|---:|---:|
| Demo | 0.00136 | 0.00400 |
| City | 0.00088 | 0.00442 |
| Ocean | 0.00144 | 0.00314 |
| City / 600 particles | 0.00099 | 0.00732 |

No browser baseline is available yet. No performance improvement is claimed.

## Architecture and verification gates

`poop-bird-core` owns world, player, actors, physics/collisions, scoring, effects,
RNG, commands and events. `poop-bird-wasm` owns only batch protocol adaptation.
Keep f64 first, strict collision tangency, JavaScript rounding where required,
and the existing tick order. Use ordinary collections with explicit IDs.

One advance operation per rendered frame receives input/config changes/commands;
reusable frame buffers and events return in bulk. Do not serialize a whole world
as JSON or expose getters per particle. Typed-array copying is acceptable until
measured; views into WASM memory require growth/lifetime handling if added later.

Keep the TypeScript engine selectable until every encounter passes comparison.
Tests must cover discrete events exactly and numeric values with justified
tolerances. Check reset/resize/pause/tutorial/cancellation and live configuration.
Run Rust format/Clippy/tests, WASM integration tests, ESLint, Vitest, typechecks,
both builds and Docker/CI checks when available.

Profile production browser builds using repeated identical scenarios, input,
hardware, viewport and DPR. Measure frame p50/p95/p99, missed frames, simulation,
render, bridge, detection, long tasks, startup and memory. Establish run-to-run
noise first. Browser/webcam/audio checks cannot be substituted by native tests.

Detailed milestone order and current completion state: migration-progress.md.
# Upstream audit addendum (2026-10-11)

Main advanced to `79a9cf0` after the original audit. The migration branch now
includes those seven commits: optional photo graphics in `rtx.ts`, 57 lazy-loaded
image assets, persistent graphics settings, the named shark yelp recording,
and tutorial/test fixes. Canvas2D is still the shared renderer for both styles.
The photo mode is a sprite/texture style, despite its RTX label; it does not
use ray tracing, WebGL or WebGPU. Its sprite transforms, googly-eye physics,
wing animation and fish wobble are presentation state and remain TypeScript.
The world simulation and existing fixed-step behavior did not change upstream.
Renderer signatures retain presentation-only types and photo poses stay local.
All original kernel/audio fixtures remain applicable to the unchanged logic.
These new assets and settings are part of the behavior to preserve.
