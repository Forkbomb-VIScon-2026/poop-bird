# Rust/WASM build

Use Node 24 and rustup. rust-toolchain.toml pins stable Rust 1.90.0 (edition 2024)
with rustfmt, Clippy and wasm32-unknown-unknown. Cargo.lock pins dependencies.

```sh
rustup show
cargo install wasm-bindgen-cli --version 0.2.104 --locked
npm ci
npm run fetch-model
npm run check:rust
npm run test:rust
npm run build:wasm
npm run test:wasm
npm run lint
npm test
npm run build
npm run build:debug
npx playwright-core install chromium
npm run test:browser
npm run dev:debug -- --host 127.0.0.1 --port 5174
```

The dev/build lifecycle builds the game WASM before Vite starts. Generated
files live in public/game-wasm and are not committed. MediaPipe's generated
files remain separate in public/mediapipe. The collector does not need Rust.

Docker builds the same locked crate and bindgen version in a Rust stage, then
copies its generated module to the Node build stage. GAME_WASM_PREBUILT=1 is
only for that stage; do not use it to bypass local source rebuilds.

The original TypeScript simulation remains active until migration-progress.md
records complete parity. Building a WASM kernel is not a completed migration.
Native/WASM differential tests do not replace real browser, webcam or audio QA.

`test:browser` owns a localhost Vite server and checks keyboard takeoff,
pause/resume/menu, batched WASM shadow comparison, immutable rendering and audio
decoding. CHROMIUM_EXECUTABLE can select an existing Chromium binary; optional
CHROMIUM_ARGS_JSON supplies launch arguments. It does not verify a real webcam,
audible output, or other browsers.

For live shadow checking, open the debug game with `?rust-audit=1`, or call
`await poopBird.enableRustAudit()`. Inspect `poopBird.rustAudit` for comparisons
and failures. This checks the Rust kernels against the running TypeScript engine;
it does not make Rust the authoritative engine. This hook is excluded from
production builds.

```sh
npm run bench:simulation
node scripts/run-ts.mjs scripts/migration/reference.ts
node scripts/run-ts.mjs scripts/migration/bird-reference.ts
```

The benchmark is synthetic Node simulation only. The reference commands deliberately
regenerate frozen fixtures; do not run them to hide a failing comparison. Protocol 2
adds bird motion to the original kernel records; the world/frame ABI is still pending.
