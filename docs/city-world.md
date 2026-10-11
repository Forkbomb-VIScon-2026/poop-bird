# Rust city world checkpoint

This world owns the attract demo, practice perch, idle animation and scoped
first-city runs, including takeoff, ordinary buildings/towers, scoring, crashes
and calm-city lessons. It is
connected through `CityWorld.advance()` to browser rendering and event audio;
it is available in debug builds without replacing the authoritative game run.
Advanced encounters and waterfront/ocean transitions are not supported yet.
Run configurations must explicitly disable power lines, balloons, weddings,
paparazzi and kids; other configurations reject atomically. At the first
waterfront tick the world pauses with `frame.blocked === true`, before mutating
that tick. Reset clears the boundary. The production game retains all encounters.

## Ownership and modules

- `city/mod.rs`: world ownership, mode/commands, reset/resize and update order.
- `city/run.rs`: flight lifecycle, contacts, calm bounce, crash and gameover.
- `city/obstacles.rs`: difficulty, ordinary building/tower spawning and scrolling.
- `city/entities.rs`: typed objects, stable target/projectile IDs, events and
  semantic floater text. IDs are monotonic within a reset epoch.
- `city/targets.rs`: target spawning, rage and attract-mode aim/autopilot.
- `city/projectiles.rs`: charge reactions, projectiles, scoring and splats.
- `city/effects.rs`: in-place effect updates and stable compaction.
- `city_bridge.rs`: request validation and packed frame encoding.
- `poop-bird-wasm`: owns a world and reusable output buffer; returns safe copies.
- `src/runtime/city-world.ts`: live config packing, frame decoding and browser load.

Simulation has no browser dependencies. Vec storage is retained on reset and
compaction preserves object order and IDs. No ECS, unsafe, synchronization,
serialization dependency or per-object boundary calls are used.

## Boundary version 2

The world-frame protocol is separate from kernel audit protocol version 2.
`advance(parameters, request)` validates both inputs before any command executes.
Parameters are the 43 live config values listed in `CITY_PARAM_KEYS`, in order.
Requests contain `[dt, ticks, held, commandCount, (command, argument)...]`.
`dt` is 0..0.1 seconds; ticks is an integer 0..12; held is 0/1; there are at
most 64 commands. Codes: reset=0, resize=1, demo=2, perch=3, spawnCar=4, takeOff=5, lesson=6
(lesson argument is enabled=0/1). Mode codes are idle=0/demo=1/practice=2/run=3.
Commands execute first, then the complete fixed-step batch, then one frame.
Events retain their order across the batch; the next call drains the previous
batch. Attract mode discards events, matching the existing menu behavior.

The response is a copied Float64Array. Its 45-number header contains version,
width/mode, clocks, bird/charge/perch, speed/stage time, score counters, shake,
message and seven original collection counts, followed by phase, calmCity,
dyingTime, blocked, obstacle count, stage obstacle count and score. Ordered sections contain targets (including
IDs/rage/splats), projectiles, particles, decals, floaters, screen splats and
obstacles (IDs, geometry, bottom/color enums, seed, passed and splats), then
events (including crash/gameover). `city_bridge::encode` and `decodeCityFrame` define the exact field order.
Colors and captions use small enums; presentation resolves them to existing
strings. Numeric coordinates remain f64. Frames can be deeply frozen or retained
across subsequent advances without aliasing Rust memory or newer frames.

## Browser use

In the debug console:

```js
const city = await poopBird.createRustCity(1000, 1234);
let frame = city.advance(0, 0, false, [{ type: "demo" }]);
frame = city.advance(1 / 120, 2);
poopBird.renderer.draw(frame, 1 / 60);
// Reset to practice, then feed the held input in fixed-step batches.
frame = city.advance(0, 0, false, [{ type: "reset" }, { type: "perch" }]);
frame = city.advance(1 / 120, 2, true);
// Scoped run: disable unsupported encounters before reset.
Object.assign(poopBird.config, { powerLineChance: 0, balloonChance: 0,
  weddingChance: 0, paparazziChance: 0, kidChance: 0 });
frame = city.advance(0, 0, false, [{ type: "reset" }, { type: "perch" },
  { type: "takeOff" }, { type: "lesson", enabled: true }]);
frame = city.advance(1 / 120, 2, false);
// Inspect frame.blocked before continuing a run toward the waterfront.
city.dispose();
```

The existing rAF loop will redraw its own game after this console call. This is
a debug inspection hook; browser smoke renders sustained Rust-owned worlds on
separate canvases and routes their practice/run events through `Sound.event()`.

## Verification and measurements

- Three seeds and 51,300 batches compare all visible state and ordered events
  against the existing TypeScript demo/perch/idle and run/lesson modes: 8,488,814 numeric
  comparisons, maximum absolute difference 3.9436e-13. Inputs include one/twelve
  tick batches, resizing, reset, spawning a car, live tuning, overstrain, takeoff,
  building splats, six crashes/gameovers and nine observed calm floor bounces.
- Native tests check atomic rejection, tick partitioning, stable IDs after
  compaction, effect limits, retained storage, practice clocks/release latch, takeoff statistics, strict building
  tangency, collision-before-scroll, crash lifecycle and unsupported boundaries.
- WASM/decoder tests check malformed requests/frames and retained frame copies.
- Chromium checks twelve demo frames plus forty run/lesson/crash/gameover frames
  across both graphics styles pixel for pixel,
  frozen presentation data, practice/run audio events and real module loading.

Run `npm run test:wasm`, `npm run test:rust` and `npm run test:browser`.
Benchmark: `node scripts/run-ts.mjs scripts/migration/bench-city.ts`.

City frame version 2, synthetic Node 24 x64 measurements, five seeds, 1,200 warmup and 24,000 timed
ticks per seed. Times below are milliseconds per batch; actual rendering,
MediaPipe and rAF are excluded. All engines produced identical score checksums.

| Engine | Ticks/batch | Median batch | p95 batch | Median amortized tick |
|---|---:|---:|---:|---:|
| TypeScript | 1 | 0.00120 | 0.00418 | 0.00139 |
| Rust/WASM with decoding | 1 | 0.01247 | 0.01840 | 0.01356 |
| Rust/WASM raw frame | 1 | 0.00210 | 0.00960 | 0.00366 |
| TypeScript | 2 | 0.00222 | 0.00463 | 0.00130 |
| Rust/WASM with decoding | 2 | 0.01293 | 0.01850 | 0.00700 |
| Rust/WASM raw frame | 2 | 0.00221 | 0.00774 | 0.00120 |
| TypeScript | 12 | 0.01168 | 0.02533 | 0.00114 |
| Rust/WASM with decoding | 12 | 0.01660 | 0.03012 | 0.00145 |
| Rust/WASM raw frame | 12 | 0.00521 | 0.00868 | 0.00047 |

Fresh frame decoding dominates this scoped WASM path. The raw twelve-tick
path is faster, but the renderable path is slower than TypeScript in this run.
The single-tick decoded path is about ten times slower in amortized cost.
At two ticks per batch (typical 60 Hz rendering over 120 Hz simulation), decoded
Rust costs 0.00700 ms per amortized tick versus 0.00130 ms in TypeScript.
Raw-frame results omit required presentation work and are not a game speedup.
Timer/JIT/GC noise and this synthetic workload limit generalization. Desktop
browser frame-time profiling remains pending. Before making Rust authoritative,
reduce presentation allocation/copying and measure actual browser frame timing;
preserve safe frame lifetimes and visual parity while doing so.
