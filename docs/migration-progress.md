# Rust/WASM migration progress

## Authorization and baseline

The audit and migration plan were approved on 2026-10-11. Work belongs on
`migration/rust-wasm`; do not merge or deploy an incomplete migration.
Baseline: `4208bf7f765c6968283ea264aa49f2a9ab3dccde` on `main`.
Upstream integration: `79a9cf0dad3d5ca0d06fd6d832e21f075ed7a771` preserves
the optional photo graphics, settings, shark sample and tutorial/test fixes.

## Decisions

- Rust 2024 owns deterministic simulation; Canvas2D remains in TypeScript.
- MediaPipe, strain/puff calibration, browser input, DOM, storage, Web Audio,
  collector and leaderboard services remain TypeScript.
- Two crates: browser-independent `poop-bird-core`, thin `poop-bird-wasm`.
- Preserve 120 Hz stepping, update/collision/event order, and f64 arithmetic.
- Use composition, enums and stable entity IDs; no ECS, unsafe, shared mutable
  object graphs, or per-object WASM calls.
- Commands enter in batches; rendering consumes frame data without modifying
  the simulation. Start with safe copies, then measure before optimizing.
- Preserve CONFIG_SPEC as the tuning source, audio assets, privacy/consent,
  stage tutorials, debug controls, and desktop browser compatibility.
- Isolate gameplay randomness from renderer/audio randomness. Establish seeded
  TypeScript/Rust comparisons before replacing systems.

## Milestones

| # | Work | Status |
|---|---|---|
| 0 | Audit, branch, baseline fixtures and progress record | Complete |
| 1 | Rust/WASM toolchain, crates, build/CI/Docker integration | Complete; local checks and remote check/docker jobs pass |
| 2 | Charge, swimming, collision and RNG kernels with differential tests | Complete |
| 3 | Commands, immutable render frames, batched bridge and audio registry | Partial: commands/frames/audio/shadow complete; world/frame ABI pending |
| 4 | Basic city, effects, scoring, demo, perch and lessons | Pending |
| 5 | Power lines, kids, weddings, balloons and photo events | Pending |
| 6 | Ocean transitions, fish, hazards, anglers and sharks | Pending |
| 7 | Full browser lifecycle and input/audio integration; Rust default | Pending |
| 8 | Profile-driven optimization, verified cleanup and build documentation | Pending |

Each milestone must compile and pass applicable checks before the next one.
Record exact commands, results, remaining manual checks and commit IDs below.
No placeholder or disconnected module counts as a completed milestone.

## Verified baseline

- `npm run lint`: passed.
- `npm test`: 206 tests passed in 12 files.
- `npm run build` and `npm run build:debug`: passed, including typechecks.
- `npm run eval`: no recordings available; detection accuracy not evaluated.
- Docker unavailable. Browser gameplay/webcam/audio/visual checks not run:
  Chromium download failed; cloud browser cannot reach local development server.
- Synthetic Node simulation measurements are documented in migration-audit.md;
  these are not browser frame-time results or evidence of a WASM speedup.

## Continuation checklist

1. Read this file and migration-audit.md, inspect the branch and working tree.
2. Run the recorded checks; never assume the Rust engine has feature parity.
3. Keep legacy gameplay available until all encounters and browser flows pass.
4. Preserve existing audio exceptions; do not invent replacement assets.
5. Capture production browser profiles before claiming performance gains.

## Work log

- 2026-10-11: created the dedicated migration branch; no main changes.
- Frozen 2,067 charge/spike/swimming/drag/collision cases from the audited
  TypeScript implementation in tests/fixtures/kernels-v1.csv. Regenerate only
  intentionally with `node scripts/run-ts.mjs scripts/migration/reference.ts`.
- Reproducible synthetic simulation benchmark:
  `node scripts/run-ts.mjs scripts/migration/baseline.ts`.
- `9db41e4`: audit and frozen references. `4be3530`: Rust kernels and thin
  batch validation adapter; no live world simulation has been replaced yet.
- Installed pinned stable Rust 1.90.0, rustfmt/Clippy/WASM target and matching
  wasm-bindgen CLI 0.2.104. Both crates forbid unsafe code.
- Rust format/Clippy (`-D warnings`) and 4 native tests pass. The actual
  browser-target WASM passes all 2,067 reference cases in Node, rejects invalid
  records, and returns safe copies across a larger subsequent allocation.
- ESLint, original 206 tests, production/debug builds passed after WASM build
  integration. CI and Docker files were updated but Docker is unavailable here.
- Explicit seeded RNG injection is being added to the TypeScript reference;
  legacy production randomness remains unchanged until engine parity is ready.
- `8b47df9`: renderer now accepts presentation data and uses local photo poses.
  Six bird/wedding/trophy variants are pixel-identical to the audited renderer
  in the same Chromium run; drawing and capture accept deeply frozen state.
- `a54e97a`: injected seeded reference RNG and batched kernel observer. All
  24,000 live demo/ocean charge/spike steps match WASM exactly (2,000 batches).
- Centralized fixed/random/bag/state-dependent audio event routing. Frozen
  61 original playback traces verify sample IDs, volume, delay and variant
  selection; bag tests cover no-repeat boundaries. Continuous channels/theme
  scheduling are preserved. Assets have not been changed.
- Added explicit application commands for reset/resize/demo/perch/takeoff,
  lessons, guidance and debug spawning. Continuous inputs still enter the
  TypeScript tick loop until the full Rust world is implemented.
- Local browser smoke passed in Chromium 153.0.8010.0: actual WASM load and
  shadow checks, keyboard takeoff, pause/resume/menu, immutable capture/draw,
  and all 49 available logical audio IDs decoded. Five missing IDs are baseline
  exceptions. Actual audible output, real webcam, Firefox/Safari and reliable
  desktop frame-time comparisons remain unverified.
- Vite needs an absolute URL for the public WASM JS module; relative dynamic
  imports were rewritten with ?import and rejected. The loader is fixed and
  exercised in the browser smoke test. Production output excludes the audit hook.

## Next implementation work

Bird motion is now a separate, allocation-free Rust state component: gravity,
grace, charging fall cap, top clamp, spring/timers and rotation. Protocol 2 adds
batched flight comparisons. 1,024 frozen motion cases include negative half-turn
rounding, stun/dying/over states and varied live tuning; those outputs also match
the unmodified upstream checkout. Total frozen kernel cases: 3,091. Live demo
and ocean checks now compare 36,000 cases in 2,000 batches with zero maximum
error. Floor/obstacle contacts, effects and complete world ownership remain pending.

Remote CI run 38104383784 passed both `check` and `docker` at merge commit
`642ef7b`, including Chromium smoke and both container builds. This verifies
the build integration remotely; Docker is still unavailable locally.

Upstream merge verification: 211 TypeScript tests, lint/typechecks, Rust checks,
2,067 WASM fixtures, 24,000 live comparisons and both builds pass. Chromium
loads all 57 photo assets, persists the graphics setting, renders/captures
frozen state in both styles and decodes 49 sound IDs. Twelve photo variants
(six per style) are pixel-identical to `79a9cf0` in the same Chromium version.
The new named shark sample replaces only the upstream placeholder asset.

The game is still authoritative TypeScript. No complete Rust world, entity/frame
ABI, advanced encounter migration or default engine switch is claimed. Implement
the Rust city world against seeded snapshots next, then advanced city and ocean
encounters, before connecting authoritative frame output and retiring legacy code.


Latest local checks: ESLint and both TypeScript checks passed; 211 TypeScript
unit tests in 14 files, 5 native Rust tests, 3,091 frozen WASM cases and 36,000
live batched comparisons passed; production and debug builds passed. Chromium
smoke passed in classic/RTX styles with 57 photo assets and 49 sound IDs decoded.
Remote CI passed check and Docker jobs at `642ef7b`; the latest bird component
is also verified locally. No performance gain or complete migration is claimed.
