# Base images come from Google's Docker Hub mirror: Docker Hub rate-limits
# anonymous pulls, which breaks builds on shared CI runners.

# --- Build ---------------------------------------------------------------------
FROM mirror.gcr.io/library/node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
# postinstall copies the MediaPipe WASM into public/mediapipe/wasm
RUN npm ci
COPY . .
# Uses the model from the build context if present, otherwise downloads it once.
# Plain build on purpose: the image must not ship the debug tooling.
RUN npm run fetch-model && npm run build

# --- Serve -----------------------------------------------------------------------
FROM mirror.gcr.io/library/caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
