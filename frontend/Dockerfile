# syntax=docker/dockerfile:1
# Govori SPA (production build) — the `frontend` service in docker-compose.yml.
#
# Multi-stage: build the Vite bundle, serve it (and reverse-proxy /api + /hubs) with
# nginx. The full server block (SPA fallback + API/hub proxy + WebSocket upgrade) is
# mounted at runtime from deploy/nginx/govori.conf by compose, so this image stays
# environment-agnostic.
#
# Build context = frontend/.

# ─────────────────────────── build ───────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first for layer caching. Prefer reproducible `npm ci`; fall back to
# `npm install` if the lockfile drifts from package.json.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# VITE_GOOGLE_CLIENT_ID is inlined into the bundle at build time (import.meta.env).
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ────────────────────────── runtime ──────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html

# Minimal built-in server block so the image serves the SPA even standalone;
# compose mounts deploy/nginx/govori.conf over this to add the /api + /hubs
# reverse-proxy (with the SignalR WebSocket upgrade).
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri /index.html; }\n}\n' \
        > /etc/nginx/conf.d/default.conf

EXPOSE 80
