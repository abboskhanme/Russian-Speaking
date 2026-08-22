using System.Security.Claims;
using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Infrastructure.Entities;
using Govori.Platform.Telegram;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

namespace Govori.Identity;

/// <summary>
/// The Identity domain's HTTP surface (docs/07 §7.5, Faza 3.1). PRODUCT DECISION: auth is
/// PHONE + OTP over Telegram — email/password login and email verification are GONE. The surface
/// is: <c>otp/request</c> + <c>otp/verify</c> (the whole login-or-register flow), plus the retained
/// <c>me</c> / <c>refresh</c> / <c>logout</c> / <c>google</c> / <c>config</c>, plus
/// <c>phone/change/request</c> + <c>phone/change/confirm</c> (changing an EXISTING account's number,
/// re-running the same OTP + Telegram ownership proof against the new one).
///
/// Endpoints are thin by design (§7.2): parse → <see cref="AuthService"/> → serialize. All
/// behaviour + status-code decisions live in the service; here we only map outcomes to HTTP.
/// Error bodies use the <c>{ "detail": ... }</c> shape used across the API.
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

        // POST /api/auth/otp/request → 200 { ok, delivery, expires_in, telegram_link? | dev_hint?,
        // request_id }, or 400 on a malformed phone. NEVER reveals whether the phone already has an
        // account. RATE LIMIT: reuses the email_code scope (5/600, per-user-or-IP, FAIL-OPEN — a
        // store outage ALLOWS the request; policy registered in Govori.Api/RateLimiting).
        auth.MapPost("/otp/request", async (OtpRequestRequest req, AuthService svc, CancellationToken ct) =>
        {
            var result = await svc.RequestOtpAsync(req.Phone, ct);
            return result.Status == OtpRequestStatus.InvalidPhone
                ? Detail(result.Error!, StatusCodes.Status400BadRequest)
                : Results.Ok(new OtpSentResponse(
                    true, result.Channel, result.ExpiresInSeconds, result.TelegramLink, result.DevHint,
                    result.RequestId, result.TelegramMode));
        }).RequireRateLimiting(RateLimitPolicyNames.EmailCode);

        // GET /api/auth/otp/status?request_id=… → 200 { state } — where Telegram delivery stands.
        //
        // The client polls this while the OTP step is on screen, because bot delivery can FAIL for a
        // security reason the user must be told about: the Telegram account that opened the deep link
        // did not prove it owns the requested phone (it forwarded someone else's contact, or shared a
        // different number). In those cases the code is already BURNED server-side and the UI must
        // stop inviting the user to type one.
        //
        // SECURITY PROPERTIES, all deliberate:
        //  • ANONYMOUS — the caller has no token yet; this runs before login completes.
        //  • ALWAYS 200. An unknown/expired id answers { state: "expired" }, never 404, so the
        //    endpoint cannot be used to probe which request ids exist.
        //  • The id itself grants NOTHING: it maps only to a state string, and it is not the
        //    deep-link token (that token is the secret that would fetch the code).
        //  • RATE LIMITED under its own otp_status scope — NOT email_code. See the XML doc on
        //    RateLimitPolicyNames.OtpStatus: email_code is 5/600 because SENDING costs money, but
        //    the client polls this ~300 times per login, so email_code would 429 the feature dead.
        //
        // DEV DELIVERY short-circuit: the dev sender has no Telegram step, so there is no ownership
        // proof to wait on — it reports "sent" immediately, without touching Redis. That keeps the
        // dev fixed-code path (and every test that swaps in a fake dev sender) free of a Redis
        // dependency it does not otherwise have.
        auth.MapGet("/otp/status", async (
            [FromQuery(Name = "request_id")] string? requestId,
            IOtpDeliverySender delivery,
            ITelegramOtpLinkStore links,
            ILoggerFactory logs,
            CancellationToken ct) =>
        {
            if (string.Equals(delivery.Channel, "dev", StringComparison.Ordinal))
                return Results.Ok(new OtpStatusResponse("sent"));

            if (string.IsNullOrWhiteSpace(requestId))
                return Results.Ok(new OtpStatusResponse("expired"));

            string? state;
            try
            {
                state = await links.GetStateAsync(requestId, ct);
            }
            catch (OperationCanceledException)
            {
                throw; // genuine cancellation is not a delivery outcome
            }
            catch (Exception ex)
            {
                // A store outage is NOT a terminal outcome. Reporting "expired" here would tell the
                // user their perfectly good code is dead and send them back to the phone step;
                // "pending" simply keeps them waiting, which is what is actually true.
                logs.CreateLogger("Govori.Identity.OtpStatus")
                    .LogWarning(ex, "OTP status lookup failed; reporting pending");
                state = "pending";
            }

            // Unknown id ⇒ expired. Same body as a genuinely timed-out request, on purpose.
            return Results.Ok(new OtpStatusResponse(state ?? "expired"));
        }).AllowAnonymous().RequireRateLimiting(RateLimitPolicyNames.OtpStatus);

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
            return MapOtpVerifyOutcome(result);
        }).RequireRateLimiting(RateLimitPolicyNames.Login);

        // POST /api/auth/google → 200 TokenPair, 503 (not configured), 502 (unreachable),
        // 401 (invalid token), 403 (blocked). Retained alongside phone-OTP.
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
        }).RequireRateLimiting(RateLimitPolicyNames.Login); // shares the "login" scope: same abuse surface

        // POST /api/auth/refresh → 200 TokenPair, or 401 when the token is not a refresh token, has
        // been revoked by logout, or belongs to an account that is now blocked or deleted. All four
        // refusals answer the SAME 401 with the same body: which one it was is not the caller's
        // business, and telling them apart would turn this into an account-status oracle.
        auth.MapPost("/refresh", async (RefreshRequest req, AuthService svc, CancellationToken ct) =>
        {
            var tokens = await svc.RefreshAsync(req.RefreshToken, ct);
            return tokens is null
                ? Detail("Invalid refresh token", StatusCodes.Status401Unauthorized)
                : Results.Ok(tokens);
        });

        // POST /api/auth/logout → 204, ALWAYS.
        //
        // The body is OPTIONAL and backward-compatible: the shipped frontend posts no body, which
        // still answers 204 exactly as before. Send { "refresh_token": "..." } and that token is
        // revoked, so the session on THIS device can never be refreshed again — the access token
        // still runs out its ≤30 minutes, but the seven-day refresh behind it is dead.
        //
        // ⚠ Until the client sends the token, this endpoint has nothing to revoke. The mechanism is
        // in place and tested; the one-line client change is what makes it bite.
        //
        // Not .RequireAuthorization(): the refresh token IS the credential being surrendered, and
        // requiring a live access token would mean a user whose access token has already expired —
        // the exact case where they most want out — cannot log out.
        auth.MapPost("/logout", async (LogoutRequest? req, AuthService svc, CancellationToken ct) =>
        {
            await svc.LogoutAsync(req?.RefreshToken, ct);
            return Results.NoContent();
        });

        // GET /api/auth/me → the authenticated user. role/is_active come from the DB, never the
        // token (§7.5). Requires a valid *access* token — a refresh token is rejected here, as it
        // may only be exchanged at the refresh endpoint.
        auth.MapGet("/me", async (ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();

            var me = await svc.GetMeAsync(userId, ct);
            return me is null ? Results.Unauthorized() : Results.Ok(me);
        }).RequireAuthorization();

        // PATCH /api/auth/me → partial profile update (full_name / region / district / address),
        // backing the registration "Manzil" step and the profile "Tahrirlash" form. Only the
        // NON-NULL fields in the body are written. Requires a valid *access* token (a refresh token
        // is rejected, same guard as GET /me). Returns the updated MeResponse; 400 if a supplied
        // full_name is unstorable; 401 if the token isn't an access token or the user is
        // missing/inactive. The PHONE is not editable here — it goes through phone/change/* below.
        auth.MapPatch("/me", async (UpdateProfileRequest req, ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();

            var result = await svc.UpdateProfileAsync(userId, req, ct);
            return result.Status switch
            {
                UpdateProfileStatus.InvalidFullName => Detail(result.Error!, StatusCodes.Status400BadRequest),
                UpdateProfileStatus.InvalidLanguage => Detail(result.Error!, StatusCodes.Status400BadRequest),
                UpdateProfileStatus.Unauthorized => Results.Unauthorized(),
                _ => Results.Ok(result.Me),
            };
        }).RequireAuthorization();

        // POST /api/auth/me/avatar → set/replace the caller's account photo (multipart/form-data,
        // field "avatar"). → 200 the updated MeResponse (with a fresh avatar_url), 400 on a rejected
        // upload (wrong type / too big / empty — each a distinct {detail} so the client shows the
        // right hint), 401 for a non-access token or a missing/inactive user.
        //
        // The form is read manually (not via IFormFile binding) to sidestep the antiforgery middleware
        // that form-binding minimal APIs require — the SAME pattern POST /api/submissions uses. All
        // validation is server-side: the content-type allow-list (image/jpeg|png|webp; svg REJECTED as
        // a stored-XSS vector) and the 5 MB ceiling are enforced in the service, never trusted from the
        // client. The stored key is random and the client filename is ignored entirely. userId comes
        // from the token, so a user can only ever set their OWN avatar.
        auth.MapPost("/me/avatar", async (
            HttpRequest request, ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();
            if (!request.HasFormContentType)
                return Detail("Expected multipart/form-data", StatusCodes.Status400BadRequest);

            var form = await request.ReadFormAsync(ct);
            var file = form.Files["avatar"] ?? (form.Files.Count > 0 ? form.Files[0] : null);
            if (file is null)
                return Detail("avatar file is required", StatusCodes.Status400BadRequest);

            await using var stream = file.OpenReadStream();
            var result = await svc.SetAvatarAsync(userId, stream, file.ContentType, file.Length, ct);
            return result.Status switch
            {
                AvatarUpdateStatus.InvalidType => Detail(result.Error!, StatusCodes.Status400BadRequest),
                AvatarUpdateStatus.TooLarge => Detail(result.Error!, StatusCodes.Status400BadRequest),
                AvatarUpdateStatus.Empty => Detail(result.Error!, StatusCodes.Status400BadRequest),
                AvatarUpdateStatus.Unauthorized => Results.Unauthorized(),
                _ => Results.Ok(result.Me),
            };
        }).RequireAuthorization().DisableAntiforgery();

        // DELETE /api/auth/me/avatar → clear the caller's account photo. → 200 the updated MeResponse
        // (avatar_url now null); idempotent (no avatar ⇒ still 200), 401 for a non-access token or a
        // missing/inactive user. The stored object is deleted best-effort behind the key clear.
        auth.MapDelete("/me/avatar", async (ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();

            var result = await svc.RemoveAvatarAsync(userId, ct);
            return result.Status == AvatarUpdateStatus.Unauthorized
                ? Results.Unauthorized()
                : Results.Ok(result.Me);
        }).RequireAuthorization();

        // POST /api/auth/phone/change/request → start a VERIFIED change of the caller's own phone.
        // 200 mirrors otp/request field-for-field (delivery, expires_in, telegram_link | dev_hint,
        // request_id) because it IS the same OTP flow — the client reuses its login OTP step,
        // GET /api/auth/otp/status polling included. 400 malformed number, 409 already taken.
        //
        // WHY THIS IS SAFE TO EXPOSE: the code is minted for the NEW number and, in bot delivery,
        // released only to a Telegram account that PROVES it owns that number via a contact share.
        // The caller's Telegram is still bound to their OLD number, so the binding cache misses and
        // the bot re-asks — which is exactly the intended behaviour, not an edge case to optimise
        // away. Possession of the old account is never, on its own, permission to claim a new number.
        auth.MapPost("/phone/change/request", async (
            PhoneChangeRequestRequest req, ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();

            var result = await svc.RequestPhoneChangeAsync(userId, req.NewPhone, ct);
            return result.Status switch
            {
                PhoneChangeRequestStatus.InvalidPhone => Detail(result.Error!, StatusCodes.Status400BadRequest),
                PhoneChangeRequestStatus.Taken => Detail(
                    "Bu raqam boshqa hisobga biriktirilgan", StatusCodes.Status409Conflict),
                PhoneChangeRequestStatus.Unauthorized => Results.Unauthorized(),
                _ => Results.Ok(new OtpSentResponse(
                    true, result.Channel, result.ExpiresInSeconds, result.TelegramLink, result.DevHint,
                    result.RequestId, result.TelegramMode)),
            };
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.PhoneChange);

        // POST /api/auth/phone/change/confirm → redeem the code and write the new number.
        // 200 the updated MeResponse, 401 wrong/expired code (or no pending change for this user),
        // 409 if another account claimed the number in the meantime.
        //
        // The body carries ONLY the code. The number being claimed is read from the server-side
        // pending change, keyed by the caller's user id — so a code can never be paired with a
        // number the client chose, and one user can never confirm another's pending change.
        // The session survives: the user id is unchanged, so existing tokens stay valid.
        auth.MapPost("/phone/change/confirm", async (
            PhoneChangeConfirmRequest req, ClaimsPrincipal principal, AuthService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId)) return Results.Unauthorized();

            var result = await svc.ConfirmPhoneChangeAsync(userId, req.Code, ct);
            return result.Status switch
            {
                PhoneChangeConfirmStatus.InvalidCode => Detail(
                    "Tasdiqlash kodi noto'g'ri yoki muddati o'tgan", StatusCodes.Status401Unauthorized),
                PhoneChangeConfirmStatus.Taken => Detail(
                    "Bu raqam boshqa hisobga biriktirilgan", StatusCodes.Status409Conflict),
                PhoneChangeConfirmStatus.Unauthorized => Results.Unauthorized(),
                _ => Results.Ok(result.Me),
            };
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.PhoneChange);

        return app;
    }

    // Requires a valid *access* token carrying a parseable `sub`; a refresh token is rejected here,
    // as it may only be exchanged at the refresh endpoint. is_active is re-read from the DB in the
    // service, never trusted from the token. Same helper as ProfileEndpoints.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    // The single HTTP mapping of an OtpVerifyOutcome for otp/verify. LoggedIn/Registered fall through
    // to the tokens; InvalidCode is the 401 for a wrong or expired typed code.
    private static IResult MapOtpVerifyOutcome(OtpVerifyOutcome result)
        => result.Status switch
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

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
