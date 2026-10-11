# Rust/WASM migration progress

## Authorization and baseline

The audit and migration plan were approved on 2026-10-11. Work belongs on
`migration/rust-wasm`; do not merge or deploy an incomplete migration.
Baseline: `4208bf7f765c6968283ea264aa49f2a9ab3dccde` on `main`.

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
| 1 | Rust/WASM toolchain, crates, build/CI/Docker integration | Pending |
| 2 | Charge, swimming, collision and RNG kernels with differential tests | Pending |
| 3 | Commands, immutable render frames, batched bridge and audio registry | Pending |
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

