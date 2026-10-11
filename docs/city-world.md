# Rust city world checkpoint

This world owns the attract demo, practice perch and idle animation. It is
connected through `CityWorld.advance()` to browser rendering and event audio;
it is available in debug builds without replacing the authoritative game run.
Ordinary city runs, buildings, lessons, advanced encounters and ocean transitions
are not supported by this checkpoint. No unsupported run command is exposed.

## Ownership and modules

- `city/mod.rs`: world ownership, mode/commands, reset/resize and update order.
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

## Boundary version 1

The world-frame protocol is separate from kernel audit protocol version 2.
`advance(parameters, request)` validates both inputs before any command executes.
Parameters are the 23 live config values listed in `CITY_PARAM_KEYS`, in order.
Requests contain `[dt, ticks, held, commandCount, (command, argument)...]`.
`dt` is 0..0.1 seconds; ticks is an integer 0..12; held is 0/1; there are at
most 64 commands. Codes: reset=0, resize=1, demo=2, perch=3, spawnCar=4.
Commands execute first, then the complete fixed-step batch, then one frame.
Events retain their order across the batch; the next call drains the previous
batch. Attract mode discards events, matching the existing menu behavior.

The response is a copied Float64Array. Its 38-number header contains version,
width/mode, clocks, bird/charge/perch, speed/stage time, score counters, shake,
message and seven collection counts. Ordered sections contain targets (including
IDs/rage/splats), projectiles, particles, decals, floaters, screen splats and
events. `city_bridge::encode` and `decodeCityFrame` define the exact field order.
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
city.dispose();
```

The existing rAF loop will redraw its own game after this console call. This is
a debug inspection hook; browser smoke renders sustained Rust-owned worlds on
separate canvases and routes their practice events through `Sound.event()`.

## Verification and measurements

- Three seeds and 27,300 batches compare all visible state and ordered events
  against the existing TypeScript demo/perch/idle modes: 6,156,276 numeric
  comparisons, maximum absolute difference 3.9436e-13. Inputs include one/twelve
  tick batches, resizing, reset, spawning a car, live tuning and overstrain.
- Native tests check atomic rejection, tick partitioning, stable IDs after
  compaction, effect limits, retained storage and practice clocks/release latch.
- WASM/decoder tests check malformed requests/frames and retained frame copies.
- Chromium checks twelve whole frames (six classic, six photo) pixel for pixel,
  frozen presentation data, practice accident events and real module loading.

Run `npm run test:wasm`, `npm run test:rust` and `npm run test:browser`.
Benchmark: `node scripts/run-ts.mjs scripts/migration/bench-city.ts`.

Synthetic Node 24 x64 measurements, five seeds, 1,200 warmup and 24,000 timed
ticks per seed. Times below are milliseconds per batch; actual rendering,
MediaPipe and rAF are excluded. All engines produced identical score checksums.

| Engine | Ticks/batch | Median batch | p95 batch | Median amortized tick |
|---|---:|---:|---:|---:|
| TypeScript | 1 | 0.00122 | 0.00414 | 0.00148 |
| Rust/WASM with decoding | 1 | 0.01183 | 0.02227 | 0.01363 |
| Rust/WASM raw frame | 1 | 0.00197 | 0.00921 | 0.00363 |
| TypeScript | 12 | 0.01184 | 0.02087 | 0.00107 |
| Rust/WASM with decoding | 12 | 0.01610 | 0.03172 | 0.00144 |
| Rust/WASM raw frame | 12 | 0.00517 | 0.00817 | 0.00048 |

Fresh frame decoding dominates this scoped WASM path. The raw twelve-tick
path is faster, but the renderable path is slower than TypeScript in this run.
The single-tick decoded path is about nine times slower in amortized cost.
Raw-frame results omit required presentation work and are not a game speedup.
Timer/JIT/GC noise and this synthetic workload limit generalization. Desktop
browser frame-time profiling remains pending. Before making Rust authoritative,
reduce presentation allocation/copying and measure realistic two-tick frames;
preserve safe frame lifetimes and visual parity while doing so.
