# syntax=docker/dockerfile:1
# Govori.Api — ASP.NET Core host (REST /api/*, SignalR /hubs/attempts, /health,
# /health/ready, /metrics). docs/07 §2.8, §7.3.
#
# Build context = backend-dotnet/  (so the whole source tree — and every project
# reference — is available to restore). Only the Api project graph is published.

# ─────────────────────────── build ───────────────────────────
# `--platform=$BUILDPLATFORM`: the publish below is framework-dependent IL (no RID, no
# apphost), so the SDK stage runs natively on whatever machine builds the image and only
# the runtime stage is the target platform. Without it, building on an arm64 laptop for
# an amd64 droplet (deploy/build-images.sh) runs the whole SDK under emulation. On the
# droplet the two platforms are the same and nothing changes.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:9.0-bookworm-slim AS build
WORKDIR /src

# Source only (bin/obj/tests excluded via .dockerignore). Restore the Api project
# graph first, then publish framework-dependent (run via `dotnet Govori.Api.dll`).
#
# The `--mount=type=cache` on the NuGet packages folder makes builds resilient to
# nuget.org flakiness: already-downloaded packages persist across builds, so a
# retry after a mid-restore timeout resumes from what's cached instead of starting
# over. Both restore and publish mount the SAME cache so `--no-restore` publish
# still finds the packages. Requires BuildKit (the `# syntax` line above enables it).
#
# `sharing=locked` is not a refinement — without it the build FAILS. BuildKit cache
# mounts default to sharing=shared, and `docker compose build` builds api and worker
# CONCURRENTLY: two `dotnet restore` processes then extract into the same global
# packages folder, one deletes the other's rename-staging file, and the loser dies
# with `Could not find file '/root/.nuget/packages/<pkg>/<ver>/<random>.tmp'`. It is
# a race, so it passes locally and fails on the deploy. `locked` serialises the two.
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
        dotnet restore src/Govori.Api/Govori.Api.csproj
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
        dotnet publish src/Govori.Api/Govori.Api.csproj \
        -c Release \
        -o /app/publish \
        --no-restore \
        /p:UseAppHost=false

# ────────────────────────── runtime ──────────────────────────
# `-bookworm-slim` spelled out rather than the bare `:9.0` alias it currently
# points at: the alias is free to move to a new Debian on any .NET servicing
# release, and this image apt-installs distro packages (libasound2, ffmpeg) whose
# names change across Debian majors. An implicit base swap would turn into a
# failed `apt-get install` in the middle of a deploy.
FROM mcr.microsoft.com/dotnet/aspnet:9.0-bookworm-slim AS runtime

# Azure Speech SDK native deps (docs/07 §2.9 — needed once the real Azure STT
# provider lands) + ffmpeg + curl for the container healthcheck. aspnet:9.0 is
# Debian 12 (bookworm) and ships none of these.
#
# ffmpeg is not optional: the browser records webm/opus and Azure's REST endpoint
# only accepts 16 kHz mono PCM WAV, so without it every submission fails over to
# Whisper and silently loses its pronunciation score.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libasound2 \
        libssl3 \
        ca-certificates \
        ffmpeg \
        curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root runtime user.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin govori

WORKDIR /app
COPY --from=build /app/publish ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080 \
    DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 8080
USER govori

# /health is the LIVENESS probe (`Predicate = _ => false` — no dependency checks),
# which is the right one here: a container healthcheck that also probed Postgres
# would mark the api unhealthy during a database restart and — under
# `restart: unless-stopped` plus an orchestrator that acts on health — restart a
# process that was working fine. Readiness (/health/ready) is the load balancer's
# question, not the supervisor's.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=6 \
        CMD curl -fsS http://localhost:8080/health || exit 1

ENTRYPOINT ["dotnet", "Govori.Api.dll"]
