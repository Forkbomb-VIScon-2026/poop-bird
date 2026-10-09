# syntax=docker/dockerfile:1

# --- Build ---------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
# postinstall copies the MediaPipe WASM into public/mediapipe/wasm
RUN npm ci
COPY . .
# Uses the model from the build context if present, otherwise downloads it once.
RUN npm run fetch-model && npm run build

# --- Serve -----------------------------------------------------------------------
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
