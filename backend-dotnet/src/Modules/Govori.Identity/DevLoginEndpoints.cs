using Govori.Contracts;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Govori.Identity;

/// <summary>
/// One-click sign-in as a seeded demo account, for DEVELOPMENT ONLY.
///
/// <para><b>What it is for.</b> Two things cost real time while the app is being built: waiting for a
/// Telegram OTP on every sign-in, and the fact that one phone number is one account — so walking the
/// student, teacher and admin screens in a row means three numbers and three OTP round-trips. The
/// login page offers the three seeded demo accounts instead, and one tap issues their tokens.</para>
///
/// <para><b>This is an AUTHENTICATION BYPASS, and it must not EXIST in production — not be hidden
/// there.</b> "Production answers 403" is not the bar: a route that is registered is a route that can
/// be reached through a misconfiguration, a proxy rule, or the next person's refactor of the check
/// inside the handler. So the whole group is only ever mapped when
/// <see cref="IsEnabled"/> says so, and Production therefore answers <b>404</b> — because there is
/// nothing there.</para>
///
/// <para><b>Why <c>IsDevelopment()</c> and not <c>!IsProduction()</c>.</b> They are not complements. Staging, a one-off <c>Preview</c>
/// environment, and a container that simply forgot to set <c>ASPNETCORE_ENVIRONMENT</c> (which
/// defaults to Production, but a typo like <c>Prod</c> does not) all pass <c>!IsProduction()</c> and
/// none of them is a developer's laptop. An affirmative check has exactly one true case; a negated
/// one has every case nobody thought of.</para>
///
/// <para><b>The set is CLOSED.</b> <c>POST dev/login</c> takes a user id, but it only ever mints
/// tokens for a user whose email is in <see cref="SampleEmails"/>. An endpoint that accepted an
/// arbitrary id would be "sign in as anybody", and the difference between the two matters precisely
/// on the day this reaches an environment it should not — a bug in the layer above is survivable if
/// the blast radius is three demo accounts.</para>
///
/// <para><b>Not in the OpenAPI document.</b> The group is <c>ExcludeFromDescription()</c>d, so
/// <c>backend-dotnet/openapi.json</c> keeps describing the API production actually serves and stays
/// byte-identical whichever environment emits it (docs/09). Same reasoning as
/// <c>/openapi/v1.json</c>, which Program.cs registers after the emit for exactly this reason.</para>
///
/// <para><b>No new DTOs in Govori.Contracts and no new DI registration</b>, on purpose: everything
/// this feature is lives in this one file, so "does production have it?" is answered by one
/// <c>if</c> rather than by tracing a service through the composition root. That is also why the two
/// handlers read <see cref="GovoriDbContext"/> directly instead of going through a service — the
/// thin-endpoint rule buys testability and reuse, and a dev-only shortcut with one caller and no
/// production existence has neither to buy.</para>
/// </summary>
public static class DevLoginEndpoints
{
    /// <summary>
    /// The demo accounts the picker offers — one per role, matched by EMAIL.
    ///
    /// <para>By email and not by id: <c>users.id</c> is a <c>gen_random_uuid()</c> default, so every
    /// database (a fresh <c>docker compose down -v</c>, a colleague's machine, the per-run
    /// integration database) has different ones. The email is what the demo dump pins.</para>
    ///
    /// <para>These three already carry data — a group, attempts, a review queue — which is the
    /// reason they are reused rather than created here: a freshly-minted demo user lands on empty
    /// screens, and empty screens are exactly what this shortcut exists to stop wasting time on.</para>
    ///
    /// <para>Order is the order the picker renders: student, teacher, admin.</para>
    /// </summary>
    public static readonly IReadOnlyList<string> SampleEmails =
        new[] { "student@govori.uz", "teacher@govori.uz", "admin@govori.uz" };

    /// <summary>Email → its position in <see cref="SampleEmails"/>, for restoring that order after
    /// the database has returned the rows in its own.</summary>
    private static readonly IReadOnlyDictionary<string, int> SampleOrder =
        SampleEmails.Select((email, index) => (email, index))
            .ToDictionary(pair => pair.email, pair => pair.index, StringComparer.Ordinal);

    /// <summary>
    /// THE switch, and the only one. Kept public and called from two places on purpose: the mapping
    /// below, and <c>ProductionSecrets</c>, which refuses to boot a Production host if this ever
    /// answers true (see that class). Today the two can never disagree — <c>IsDevelopment</c> and
    /// <c>IsProduction</c> are mutually exclusive — and that is the point: the tripwire is wired to
    /// the REAL switch, so if this predicate is ever loosened, Production stops booting instead of
    /// quietly serving a login bypass.
    /// </summary>
    public static bool IsEnabled(IHostEnvironment environment) => environment.IsDevelopment();

    public static IEndpointRouteBuilder MapDevLoginEndpoints(this IEndpointRouteBuilder app)
    {
        var environment = app.ServiceProvider.GetRequiredService<IHostEnvironment>();

        // The ONLY line that keeps this out of production. Everything below is unreachable there
        // because it was never registered — the router has no entry, so the answer is 404.
        if (!IsEnabled(environment))
            return app;

        var dev = app.MapGroup("/api/auth/dev");
        dev.ExcludeFromDescription();

        // GET /api/auth/dev/users → the demo accounts that exist in THIS database.
        // Anonymous by necessity: the login page calls it before anyone is signed in. It returns
        // id + name + role and nothing else — no phone, no email — because the picker needs no more
        // and a list endpoint is a list of what it prints.
        dev.MapGet("/users", async (GovoriDbContext db, CancellationToken ct) =>
        {
            var emails = SampleEmails;
            // Inactive is treated as missing, like a row that is not there at all: minting tokens
            // for a blocked account would hand back a pair that every authed call then rejects,
            // which reads as a broken button rather than as a blocked account.
            var users = await db.Users.AsNoTracking()
                .Where(u => emails.Contains(u.Email) && u.IsActive)
                .Select(u => new { u.Id, u.Email, u.FullName, u.Role })
                .ToListAsync(ct);

            // Back into the declared order (student, teacher, admin) — the database returns rows in
            // whatever order it likes, and a picker whose buttons move between machines is a picker
            // people misclick.
            var ordered = users
                .OrderBy(u => SampleOrder.GetValueOrDefault(u.Email, int.MaxValue))
                .Select(u => new DevUserResponse(u.Id, u.FullName, Label(u.Role)))
                .ToList();

            return Results.Ok(ordered);
        }).AllowAnonymous();

        // POST /api/auth/dev/login { user_id } → the same access + refresh pair otp/verify issues.
        // Reuses TokenService, so there is no second way to mint a token in this codebase.
        // 403 for anything outside the closed set — including a real, existing user id.
        dev.MapPost("/login", async (DevLoginRequest req, GovoriDbContext db, TokenService tokens, CancellationToken ct) =>
        {
            var emails = SampleEmails;
            var user = await db.Users.AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == req.UserId && emails.Contains(u.Email) && u.IsActive, ct);

            if (user is null)
            {
                return Results.Json(
                    new { detail = "Dev login is only available for the seeded demo accounts." },
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var subject = user.Id.ToString();
            return Results.Ok(new TokenResponse(
                tokens.CreateAccessToken(subject),
                tokens.CreateRefreshToken(subject)));
        }).AllowAnonymous();

        return app;
    }

    /// <summary>Role → the lowercase PG enum label the rest of the API and the SPA match on
    /// ("student" / "teacher" / "admin"). Same projection <c>AuthService</c> uses for
    /// <c>MeResponse.Role</c>, so the picker cannot disagree with <c>/api/auth/me</c>.</summary>
    private static string Label(UserRole role) => role.ToString().ToLowerInvariant();
}

/// <summary>
/// One row of <c>GET /api/auth/dev/users</c>. JSON: <c>{ "id": ..., "full_name": ..., "role": ... }</c>.
/// Deliberately NOT in Govori.Contracts: that assembly is the published API contract and every type
/// in it lands in <c>openapi.json</c>, which must keep describing production only.
/// </summary>
public sealed record DevUserResponse(Guid Id, string FullName, string Role);

/// <summary>
/// Body of <c>POST /api/auth/dev/login</c>. JSON: <c>{ "user_id": "..." }</c>. The id must be one the
/// list above handed out; anything else is refused (see the endpoint).
/// </summary>
public sealed record DevLoginRequest(Guid UserId);
