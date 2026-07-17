using System.Security.Claims;
using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Identity;

/// <summary>
/// The Identity domain's HTTP surface (docs/07 §7.5, Faza 3.1), ported from
/// backend/app/api/v1/auth.py. This is the MODULAR-ENDPOINT PATTERN every future domain
/// (Catalog, Practice, …) copies: a single <c>Map*Endpoints</c> extension the composition
/// root calls, keeping <c>Program.cs</c> free of per-domain route wiring.
///
/// Endpoints are thin by design (§7.2): parse → <see cref="AuthService"/> → serialize. All
/// behaviour + status-code decisions live in the service; here we only map outcomes to HTTP.
/// Error bodies use <c>{ "detail": ... }</c> to match FastAPI's default shape.
/// </summary>
public static class IdentityEndpoints
{
    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        // GET /api/auth/config → public client config (auth.py:64-70).
        auth.MapGet("/config", (OtpOptions otp, GoogleAuthOptions google) =>
            Results.Ok(new AuthConfigResponse(otp.EmailVerificationEnabled, !string.IsNullOrEmpty(google.ClientId))));

        // POST /api/auth/email/request-code → 200 { ok, expires_in }, or 409 if the email is
        // already registered (auth.py:78-85).
        // RATE LIMIT (Python: email_code 5/600, FAIL-OPEN). Not yet enforced in .NET — see
        // the TODO at the bottom of this file; the fail-open intent must be preserved.
        auth.MapPost("/email/request-code", async (EmailCodeRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.RequestEmailCodeAsync(req.Email, ct);
            return result.Status == EmailCodeRequestStatus.EmailTaken
                ? Detail("Email already registered", StatusCodes.Status409Conflict)
                : Results.Ok(new EmailCodeSentResponse(true, result.ExpiresInSeconds));
        });

        // POST /api/auth/email/verify-code → 200 { email_verify_token }, or 400 on a
        // wrong/expired code (auth.py:93-97). FAIL-CLOSED: a broken OTP store denies (400).
        auth.MapPost("/email/verify-code", async (EmailCodeVerifyRequest req, AuthService svc, CancellationToken ct) =>
        {
            var token = await svc.VerifyEmailCodeAsync(req.Email, req.Code, ct);
            return token is null
                ? Detail("Tasdiqlash kodi noto'g'ri yoki muddati o'tgan", StatusCodes.Status400BadRequest)
                : Results.Ok(new EmailVerifyTokenResponse(token));
        });

        // POST /api/auth/register → 201 UserOut, 400 (email not verified), 409 (taken),
        // 422 (validation) (auth.py:106-139).
        auth.MapPost("/register", async (RegisterRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.RegisterAsync(req, ct);
            return result.Status switch
            {
                RegisterStatus.EmailNotVerified => Detail(result.Error!, StatusCodes.Status400BadRequest),
                RegisterStatus.EmailTaken => Detail(result.Error!, StatusCodes.Status409Conflict),
                RegisterStatus.InvalidInput => Detail(result.Error!, StatusCodes.Status422UnprocessableEntity),
                _ => Results.Json(result.User, statusCode: StatusCodes.Status201Created),
            };
        });

        // POST /api/auth/login → 200 TokenPair, 401 (bad creds), 403 (inactive) (auth.py:147-168).
        // Never leak which of email/password was wrong. 403 message differs for an unapproved
        // teacher vs a blocked account, mirroring Python.
        auth.MapPost("/login", async (LoginRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.LoginAsync(req.Email, req.Password, ct);
            return result.Status switch
            {
                LoginStatus.InvalidCredentials => Detail("Incorrect email or password", StatusCodes.Status401Unauthorized),
                LoginStatus.Inactive => Detail(
                    result.Role == UserRole.Teacher
                        ? "Your teacher account is awaiting admin approval."
                        : "Account is blocked",
                    StatusCodes.Status403Forbidden),
                _ => Results.Ok(result.Tokens),
            };
        });

        // POST /api/auth/google → 200 TokenPair, 503 (not configured), 502 (unreachable),
        // 401 (invalid token), 403 (blocked) (auth.py:176-207).
        auth.MapPost("/google", async (GoogleAuthRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.GoogleAsync(req.Credential, req.GroupCode, ct);
            return result.Status switch
            {
                GoogleAuthStatus.NotConfigured => Detail("Google sign-in is not configured", StatusCodes.Status503ServiceUnavailable),
                GoogleAuthStatus.Unreachable => Detail("Could not reach Google", StatusCodes.Status502BadGateway),
                GoogleAuthStatus.InvalidToken => Detail("Invalid Google token", StatusCodes.Status401Unauthorized),
                GoogleAuthStatus.Blocked => Detail("Account is blocked", StatusCodes.Status403Forbidden),
                _ => Results.Ok(result.Tokens),
            };
        });

        // POST /api/auth/refresh → 200 TokenPair, or 401 if the token isn't a refresh token
        // (auth.py:211-219).
        auth.MapPost("/refresh", (RefreshRequest req, AuthService svc) =>
        {
            var tokens = svc.Refresh(req.RefreshToken);
            return tokens is null
                ? Detail("Invalid refresh token", StatusCodes.Status401Unauthorized)
                : Results.Ok(tokens);
        });

        // POST /api/auth/logout → 204. Python exposes NO logout route: JWTs are stateless and
        // never server-revoked. We invent no revocation — the client simply discards its
        // tokens (they remain valid until expiry, exactly as in Python). This no-op exists
        // only to give the client a symmetric endpoint to call.
        auth.MapPost("/logout", () => Results.NoContent());

        // GET /api/auth/me → the authenticated user (auth.py:222-224). role/is_active come
        // from the DB, never the token (§7.5). Requires a valid *access* token — a refresh
        // token is rejected, per deps.py:25.
        auth.MapGet("/me", async (ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (principal.FindFirstValue("type") != "access"
                || !Guid.TryParse(principal.FindFirstValue("sub"), out var userId))
            {
                return Results.Unauthorized();
            }

            var me = await svc.GetMeAsync(userId, ct);
            return me is null ? Results.Unauthorized() : Results.Ok(me);
        }).RequireAuthorization();

        // TODO(§7.5 rate limiting): Python fixed-window limits login/register/email paths in
        // Redis, FAIL-OPEN (backend/app/core/ratelimit.py — a Redis outage must never take the
        // API down, and keying is per-user-or-IP to survive classroom NAT). Port as ASP.NET
        // Core RateLimiter middleware in a follow-up; preserve the fail-open semantics.
        return app;
    }

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
