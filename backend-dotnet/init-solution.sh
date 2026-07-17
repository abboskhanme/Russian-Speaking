#!/usr/bin/env bash
# Scaffold the .NET 9 solution. Runs entirely inside the SDK container —
# nothing is installed on the host.
#
#   docker run --rm -v "$PWD/backend-dotnet:/src" -w /src \
#     mcr.microsoft.com/dotnet/sdk:9.0 bash init-solution.sh
#
# Idempotent: re-running skips whatever already exists.

set -Eeuo pipefail

echo "==> .NET $(dotnet --version)"

[ -f Govori.sln ] || dotnet new sln -n Govori

# ---------------------------------------------------------------------------
# Projects.
#
# Boundaries here are enforced by the COMPILER, not a linter: Catalog cannot
# see Practice because no ProjectReference exists. That is the single biggest
# structural win of the .NET move (docs/07 §7.1) — the Python audit (K7) needed
# a linter for this and never got one.
#
# Domain modules are added one at a time as they are ported (Phase 3).
# Identity comes first because auth is the Phase 2 exit criterion.
# ---------------------------------------------------------------------------
new_proj() { # <template> <path> <name>
  if [ ! -f "$2/$3.csproj" ]; then
    echo "==> new $1 → $2"
    dotnet new "$1" -o "$2" -n "$3" --force >/dev/null
  fi
  dotnet sln Govori.sln add "$2/$3.csproj" >/dev/null 2>&1 || true
}

new_proj web       src/Govori.Api            Govori.Api
new_proj worker    src/Govori.Worker         Govori.Worker
new_proj classlib  src/Govori.Contracts      Govori.Contracts
new_proj classlib  src/Govori.Infrastructure Govori.Infrastructure
new_proj classlib  src/Govori.Platform       Govori.Platform
new_proj classlib  src/Modules/Govori.Identity Govori.Identity

new_proj xunit tests/Govori.Characterization Govori.Characterization
new_proj xunit tests/Govori.UnitTests        Govori.UnitTests
new_proj xunit tests/Govori.IntegrationTests Govori.IntegrationTests
new_proj xunit tests/Govori.ArchTests        Govori.ArchTests

# Remove the boilerplate Class1.cs / UnitTest1.cs the templates drop.
find src tests -name 'Class1.cs' -o -name 'UnitTest1.cs' | xargs -r rm -f

# ---------------------------------------------------------------------------
# References. Direction is one-way and deliberate:
#
#   Api ──> Modules ──> Contracts
#    │         │
#    │         └──> Platform (interfaces only)
#    └──> Infrastructure ──> Modules   (implements their repository interfaces)
#
# Platform NEVER references a Module. Infrastructure owns the DbContext and
# therefore may see every Module; Modules never see Infrastructure.
# ---------------------------------------------------------------------------
ref() { dotnet add "$1" reference "$2" >/dev/null 2>&1 || true; }

ref src/Govori.Platform/Govori.Platform.csproj             src/Govori.Contracts/Govori.Contracts.csproj
ref src/Modules/Govori.Identity/Govori.Identity.csproj     src/Govori.Contracts/Govori.Contracts.csproj
ref src/Modules/Govori.Identity/Govori.Identity.csproj     src/Govori.Platform/Govori.Platform.csproj
ref src/Govori.Infrastructure/Govori.Infrastructure.csproj src/Modules/Govori.Identity/Govori.Identity.csproj
ref src/Govori.Api/Govori.Api.csproj                       src/Govori.Infrastructure/Govori.Infrastructure.csproj
ref src/Govori.Api/Govori.Api.csproj                       src/Modules/Govori.Identity/Govori.Identity.csproj
ref src/Govori.Worker/Govori.Worker.csproj                 src/Govori.Infrastructure/Govori.Infrastructure.csproj

ref tests/Govori.Characterization/Govori.Characterization.csproj src/Modules/Govori.Identity/Govori.Identity.csproj
ref tests/Govori.UnitTests/Govori.UnitTests.csproj               src/Modules/Govori.Identity/Govori.Identity.csproj
ref tests/Govori.IntegrationTests/Govori.IntegrationTests.csproj src/Govori.Api/Govori.Api.csproj
ref tests/Govori.ArchTests/Govori.ArchTests.csproj               src/Govori.Api/Govori.Api.csproj

# ---------------------------------------------------------------------------
# Packages.
# ---------------------------------------------------------------------------
pkg() { dotnet add "$1" package "$2" >/dev/null 2>&1 || echo "    WARN: $2 failed"; }

echo "==> packages: Infrastructure (EF Core + Npgsql)"
pkg src/Govori.Infrastructure/Govori.Infrastructure.csproj Npgsql.EntityFrameworkCore.PostgreSQL
pkg src/Govori.Infrastructure/Govori.Infrastructure.csproj EFCore.NamingConventions
pkg src/Govori.Infrastructure/Govori.Infrastructure.csproj Microsoft.EntityFrameworkCore.Design

echo "==> packages: Identity (bcrypt — MUST verify existing \$2b\$12\$ hashes)"
pkg src/Modules/Govori.Identity/Govori.Identity.csproj BCrypt.Net-Next

echo "==> packages: Api"
pkg src/Govori.Api/Govori.Api.csproj Microsoft.AspNetCore.Authentication.JwtBearer
pkg src/Govori.Api/Govori.Api.csproj FluentValidation.AspNetCore
pkg src/Govori.Api/Govori.Api.csproj Serilog.AspNetCore
pkg src/Govori.Api/Govori.Api.csproj OpenTelemetry.Extensions.Hosting
pkg src/Govori.Api/Govori.Api.csproj OpenTelemetry.Instrumentation.AspNetCore
pkg src/Govori.Api/Govori.Api.csproj Hangfire.AspNetCore
pkg src/Govori.Api/Govori.Api.csproj Hangfire.PostgreSql

echo "==> packages: tests"
pkg tests/Govori.IntegrationTests/Govori.IntegrationTests.csproj Testcontainers.PostgreSql
pkg tests/Govori.IntegrationTests/Govori.IntegrationTests.csproj Microsoft.AspNetCore.Mvc.Testing
pkg tests/Govori.ArchTests/Govori.ArchTests.csproj NetArchTest.Rules
pkg tests/Govori.Characterization/Govori.Characterization.csproj BCrypt.Net-Next
pkg tests/Govori.Characterization/Govori.Characterization.csproj System.IdentityModel.Tokens.Jwt

echo "==> build"
dotnet build --nologo -v q

echo
echo "OK — solution scaffolded."
dotnet sln Govori.sln list
