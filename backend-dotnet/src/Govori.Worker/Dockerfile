# syntax=docker/dockerfile:1
# Govori.Worker — the grading pipeline host: Hangfire server + recurring maintenance jobs +
# SignalR publish over the Redis backplane. docs/07 §7.7.
#
# Runtime = aspnet:9.0 (NOT the plain runtime) because the Worker
# FrameworkReferences Microsoft.AspNetCore.App for AddSignalR / IHubContext.
#
# Build context = backend-dotnet/.

# ─────────────────────────── build ───────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# `--mount=type=cache` on the NuGet folder makes builds resilient to nuget.org
# flakiness: downloaded packages persist across builds, so a retry after a
# mid-restore timeout resumes from cache. Restore + publish share the SAME cache
# so `--no-restore` publish still finds them. Requires BuildKit (see `# syntax`).
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages \
        dotnet restore src/Govori.Worker/Govori.Worker.csproj
RUN --mount=type=cache,target=/root/.nuget/packages \
        dotnet publish src/Govori.Worker/Govori.Worker.csproj \
        -c Release \
        -o /app/publish \
        --no-restore \
        /p:UseAppHost=false

# ────────────────────────── runtime ──────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime

# Azure Speech SDK native deps (docs/07 §2.9 — the Worker runs the grading pipeline)
# + procps (pgrep) for the process-liveness healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libasound2 \
        libssl3 \
        ca-certificates \
        procps \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin govori

WORKDIR /app
COPY --from=build /app/publish ./

# Generic host reads DOTNET_ENVIRONMENT (not ASPNETCORE_ENVIRONMENT).
ENV DOTNET_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

USER govori
ENTRYPOINT ["dotnet", "Govori.Worker.dll"]
