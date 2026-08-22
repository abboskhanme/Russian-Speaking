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
# node 22 matches .github/workflows/ci.yml. A build that passes CI on 22 and ships
# from 20 is a difference nobody is measuring — and the two versions do not agree
# on every transitive native dep.
FROM node:22-alpine AS build
WORKDIR /app

# `npm ci` ONLY — the previous `npm ci || npm install` fallback made the image
# unreproducible in exactly the situation where reproducibility matters: a drifted
# lockfile silently resolved fresh versions at build time, so the artefact tested
# in CI and the artefact deployed could differ. A drifted lockfile must fail the
# build and be fixed in the repo, not papered over per-build.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: @playwright/test is a devDependency and its
# postinstall pulls ~500 MB of browsers. Nothing in this image runs them.
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

# VITE_GOOGLE_CLIENT_ID is inlined into the bundle at build time (import.meta.env).
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ────────────────────────── runtime ──────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html

# Minimal built-in server block so the image serves the SPA even standalone.
# Both composes replace it:
#   dev  — mounts deploy/nginx/govori.conf over /etc/nginx/conf.d/default.conf
#   prod — mounts deploy/nginx/govori-prod.conf.template into /etc/nginx/templates/,
#          and the base image's entrypoint envsubsts it to the same path.
# /healthz is baked in here rather than only in those files so the container
# healthcheck works in every mode, including a bare `docker run` of this image.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location = /healthz { access_log off; default_type text/plain; return 200 "ok\\n"; }\n  location / { try_files $uri /index.html; }\n}\n' \
        > /etc/nginx/conf.d/default.conf

EXPOSE 80

# In the image, not only in compose: a plain `docker run` of this image — which is
# how an image gets smoke-tested on a droplet before it is wired into the stack —
# would otherwise report "healthy" the instant the container started.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
        CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
