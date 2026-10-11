# Base images come from Google's Docker Hub mirror: Docker Hub rate-limits
# anonymous pulls, which breaks builds on shared CI runners.

# --- Build ---------------------------------------------------------------------
FROM mirror.gcr.io/library/rust:1.90.0-bookworm AS rust-build
WORKDIR /app
RUN rustup target add wasm32-unknown-unknown && cargo install wasm-bindgen-cli --version 0.2.104 --locked
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
RUN cargo build --locked --release --target wasm32-unknown-unknown -p poop-bird-wasm && \
    wasm-bindgen --target web --out-dir /game-wasm target/wasm32-unknown-unknown/release/poop_bird_wasm.wasm

FROM mirror.gcr.io/library/node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
# postinstall copies the MediaPipe WASM into public/mediapipe/wasm
RUN npm ci
COPY . .
COPY --from=rust-build /game-wasm ./public/game-wasm
ENV GAME_WASM_PREBUILT=1
# Uses the model from the build context if present, otherwise downloads it once.
# Plain build on purpose: the image must not ship the debug tooling.
# APP_COMMIT is stored with face dataset sessions (the context has no .git).
ARG APP_COMMIT=unknown
RUN npm run fetch-model && APP_COMMIT=$APP_COMMIT npm run build

# --- Serve -----------------------------------------------------------------------
FROM mirror.gcr.io/library/caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
