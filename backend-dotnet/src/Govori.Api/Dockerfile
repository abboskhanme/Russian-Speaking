# syntax=docker/dockerfile:1
# Govori.Api — ASP.NET Core host (REST /api/*, SignalR /hubs/attempts, /health,
# /health/ready, /metrics). docs/07 §2.8, §7.3.
#
# Build context = backend-dotnet/  (so the whole source tree — and every project
# reference — is available to restore). Only the Api project graph is published.

# ─────────────────────────── build ───────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Source only (bin/obj/tests excluded via .dockerignore). Restore the Api project
# graph first, then publish framework-dependent (run via `dotnet Govori.Api.dll`).
#
# The `--mount=type=cache` on the NuGet packages folder makes builds resilient to
# nuget.org flakiness: already-downloaded packages persist across builds, so a
# retry after a mid-restore timeout resumes from what's cached instead of starting
# over. Both restore and publish mount the SAME cache so `--no-restore` publish
# still finds the packages. Requires BuildKit (the `# syntax` line above enables it).
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages \
        dotnet restore src/Govori.Api/Govori.Api.csproj
RUN --mount=type=cache,target=/root/.nuget/packages \
        dotnet publish src/Govori.Api/Govori.Api.csproj \
        -c Release \
        -o /app/publish \
        --no-restore \
        /p:UseAppHost=false

# ────────────────────────── runtime ──────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime

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
ENTRYPOINT ["dotnet", "Govori.Api.dll"]
