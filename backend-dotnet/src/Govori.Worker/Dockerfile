# syntax=docker/dockerfile:1
# Govori.Worker — the grading pipeline host: Hangfire server + recurring maintenance jobs +
# SignalR publish over the Redis backplane. docs/07 §7.7.
#
# Runtime = aspnet:9.0 (NOT the plain runtime) because the Worker
# FrameworkReferences Microsoft.AspNetCore.App for AddSignalR / IHubContext.
#
# Build context = backend-dotnet/.

# ─────────────────────────── build ───────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0-bookworm-slim AS build
WORKDIR /src

# `--mount=type=cache` on the NuGet folder makes builds resilient to nuget.org
# flakiness: downloaded packages persist across builds, so a retry after a
# mid-restore timeout resumes from cache. Restore + publish share the SAME cache
# so `--no-restore` publish still finds them. Requires BuildKit (see `# syntax`).
#
# `sharing=locked` must match the Api Dockerfile's: `docker compose build` runs
# both concurrently against this one cache, and two parallel `dotnet restore`
# processes corrupt each other's extraction staging. See the longer note there.
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
        dotnet restore src/Govori.Worker/Govori.Worker.csproj
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
        dotnet publish src/Govori.Worker/Govori.Worker.csproj \
        -c Release \
        -o /app/publish \
        --no-restore \
        /p:UseAppHost=false

# ────────────────────────── runtime ──────────────────────────
# `-bookworm-slim` spelled out rather than the bare `:9.0` alias: the alias may
# move to a new Debian on any servicing release, and this image apt-installs
# distro packages whose names change across majors. See the Api Dockerfile.
FROM mcr.microsoft.com/dotnet/aspnet:9.0-bookworm-slim AS runtime

# Azure Speech SDK native deps (docs/07 §2.9 — the Worker runs the grading pipeline)
# + ffmpeg + procps (pgrep) for the process-liveness healthcheck.
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
        procps \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin govori

WORKDIR /app
COPY --from=build /app/publish ./

# Generic host reads DOTNET_ENVIRONMENT (not ASPNETCORE_ENVIRONMENT).
ENV DOTNET_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

USER govori

# The Worker serves no HTTP, so liveness is "is the process still there". That is
# a weaker guarantee than the Api's — it cannot see a wedged Hangfire server — but
# it does catch the failure that actually happens: an unhandled exception on a
# background thread taking the host down while the container lingers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
        CMD pgrep -f Govori.Worker.dll > /dev/null || exit 1

ENTRYPOINT ["dotnet", "Govori.Worker.dll"]
