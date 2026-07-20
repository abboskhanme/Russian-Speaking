using System.Security.Claims;
using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Identity;

/// <summary>
/// The Identity domain's HTTP surface (docs/07 §7.5, Faza 3.1). PRODUCT DECISION: auth is
/// PHONE + OTP over Telegram — email/password login and email verification are GONE. The surface
/// is: <c>otp/request</c> + <c>otp/verify</c> (the whole login-or-register flow), plus the retained
/// <c>me</c> / <c>refresh</c> / <c>logout</c> / <c>google</c> / <c>config</c>.
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

        // GET /api/auth/config → public client config: whether Google sign-in is configured and
        // which OTP delivery channel is active ("telegram" | "dev"). Email verification is gone.
        auth.MapGet("/config", (IOtpDeliverySender delivery, GoogleAuthOptions google) =>
            Results.Ok(new AuthConfigResponse(!string.IsNullOrEmpty(google.ClientId), delivery.Channel)));

        // POST /api/auth/otp/request → 200 { ok, delivery, expires_in, telegram_link? | dev_hint? },
        // or 400 on a malformed phone. NEVER reveals whether the phone already has an account.
        // RATE LIMIT: reuses the email_code scope (5/600, per-user-or-IP, FAIL-OPEN — a store
        // outage ALLOWS the request; policy registered in Govori.Api/RateLimiting).
        auth.MapPost("/otp/request", async (OtpRequestRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.RequestOtpAsync(req.Phone, ct);
            return result.Status == OtpRequestStatus.InvalidPhone
                ? Detail(result.Error!, StatusCodes.Status400BadRequest)
                : Results.Ok(new OtpSentResponse(
                    true, result.Channel, result.ExpiresInSeconds, result.TelegramLink, result.DevHint));
        }).RequireRateLimiting(RateLimitPolicyNames.EmailCode);

        // POST /api/auth/otp/verify → verify the code, then login/register/ask-for-name:
        //   • existing active phone  → 200 TokenPair (login)
        //   • new phone + full_name  → 200 TokenPair (register a passwordless student)
        //   • new phone, no name     → 200 { needs_registration: true }
        //   • wrong/expired code     → 401
        //   • matched but inactive   → 403 (teacher-awaiting-approval vs blocked)
        //   • malformed phone        → 400
        // FAIL-CLOSED: a broken OTP store denies (401), never approves.
        // RATE LIMIT: reuses the login scope (10/300), the OTP analogue of password login.
        auth.MapPost("/otp/verify", async (OtpVerifyRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.VerifyOtpAsync(req.Phone, req.Code, req.FullName, ct);
            return result.Status switch
            {
                OtpVerifyStatus.InvalidPhone => Detail(result.Error!, StatusCodes.Status400BadRequest),
                OtpVerifyStatus.InvalidCode => Detail(
                    "Tasdiqlash kodi noto'g'ri yoki muddati o'tgan", StatusCodes.Status401Unauthorized),
                OtpVerifyStatus.Inactive => Detail(
                    result.Role == UserRole.Teacher
                        ? "Your teacher account is awaiting admin approval."
                        : "Account is blocked",
                    StatusCodes.Status403Forbidden),
                OtpVerifyStatus.NeedsRegistration => Results.Ok(new NeedsRegistrationResponse(true)),
                _ => Results.Ok(result.Tokens), // LoggedIn or Registered
            };
        }).RequireRateLimiting(RateLimitPolicyNames.Login);

        // POST /api/auth/google → 200 TokenPair, 503 (not configured), 502 (unreachable),
        // 401 (invalid token), 403 (blocked) (auth.py:176-207). Retained alongside phone-OTP.
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
        }).RequireRateLimiting(RateLimitPolicyNames.Login); // auth.py:174 uses the same "login" scope

        // POST /api/auth/refresh → 200 TokenPair, or 401 if the token isn't a refresh token
        // (auth.py:211-219).
        auth.MapPost("/refresh", (RefreshRequest req, AuthService svc) =>
        {
            var tokens = svc.Refresh(req.RefreshToken);
            return tokens is null
                ? Detail("Invalid refresh token", StatusCodes.Status401Unauthorized)
                : Results.Ok(tokens);
        });

        // POST /api/auth/logout → 204. JWTs are stateless and never server-revoked; the client
        // simply discards its tokens. This no-op exists only to give the client a symmetric endpoint.
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

        return app;
    }

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
