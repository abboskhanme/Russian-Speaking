using Govori.Contracts;
using Govori.Infrastructure.Entities;

namespace Govori.Identity;

// Discriminated outcomes returned by AuthService so the endpoints stay thin (docs/07 §7.2):
// each maps 1:1 to an HTTP status code in IdentityEndpoints.

/// <summary>Outcome of <see cref="AuthService.RequestOtpAsync"/>.</summary>
public enum OtpRequestStatus
{
    /// <summary>Code generated, stored, and handed to the delivery sender → 200.</summary>
    Sent,

    /// <summary>The phone failed <c>PhoneNumbers.NormalizeUz</c> → 400.</summary>
    InvalidPhone,

    /// <summary>A code was sent to this phone less than the request cooldown ago → 429 with
    /// Retry-After. Nothing was minted or sent. Keyed by the phone alone, so a registered and an
    /// unregistered number answer this identically.</summary>
    TooSoon,
}

/// <summary>
/// Result of requesting an OTP. On <see cref="OtpRequestStatus.Sent"/>, <see cref="Channel"/> is
/// the delivery channel ("telegram_bot"/"dev"), <see cref="ExpiresInSeconds"/> the TTL,
/// <see cref="DevHint"/> the dev bypass code (only in dev delivery, else null), and
/// <see cref="TelegramLink"/> the <c>t.me/&lt;bot&gt;?start=…</c> deep link (only in bot delivery).
/// On <see cref="OtpRequestStatus.InvalidPhone"/>, <see cref="Error"/> carries the format message.
/// <see cref="RequestId"/> is the opaque, non-secret id the client polls at
/// <c>GET /api/auth/otp/status</c> (appended at the END — this record is constructed positionally).
/// <see cref="TelegramMode"/> (<c>"direct"</c> | <c>"deep_link"</c>, or null in dev delivery) is how
/// the code is being pushed over Telegram; it flows through to <c>OtpSentResponse.TelegramMode</c>.
/// On <see cref="OtpRequestStatus.TooSoon"/>, <see cref="RetryAfter"/> is how long the cooldown has
/// left (appended at the END, same reason as <see cref="RequestId"/>).
/// </summary>
public sealed record OtpRequestResult(
    OtpRequestStatus Status,
    string Channel = "",
    int ExpiresInSeconds = 0,
    string? DevHint = null,
    string? TelegramLink = null,
    string? Error = null,
    string? RequestId = null,
    string? TelegramMode = null,
    TimeSpan? RetryAfter = null);

/// <summary>Outcome of <see cref="AuthService.VerifyOtpAsync"/>.</summary>
public enum OtpVerifyStatus
{
    /// <summary>Valid code, existing active phone → 200 with tokens (login).</summary>
    LoggedIn,

    /// <summary>Valid code, new phone + full_name → account created, 200 with tokens (register).</summary>
    Registered,

    /// <summary>Valid code, new phone, NO full_name → 200 { needs_registration: true }.</summary>
    NeedsRegistration,

    /// <summary>Wrong/expired code, or an unverifiable (fail-closed) store → 401.</summary>
    InvalidCode,

    /// <summary>Correct code but the matched account is not active → 403.</summary>
    Inactive,

    /// <summary>The phone failed <c>PhoneNumbers.NormalizeUz</c> → 400.</summary>
    InvalidPhone,

    /// <summary>Too many wrong codes for this phone in the current window → 429 with Retry-After.
    /// The typed code was not even compared. Keyed by the phone alone, so it reveals nothing about
    /// whether the phone has an account.</summary>
    LockedOut,
}

/// <summary>
/// Result of verifying an OTP. <see cref="Tokens"/> is set on
/// <see cref="OtpVerifyStatus.LoggedIn"/>/<see cref="OtpVerifyStatus.Registered"/>;
/// <see cref="Role"/> is populated on <see cref="OtpVerifyStatus.Inactive"/> so the endpoint can
/// pick the teacher-awaiting-approval vs blocked message; <see cref="Error"/> carries the format
/// message on <see cref="OtpVerifyStatus.InvalidPhone"/>; <see cref="RetryAfter"/> is how long a
/// <see cref="OtpVerifyStatus.LockedOut"/> lock has left.
/// </summary>
public sealed record OtpVerifyOutcome(
    OtpVerifyStatus Status,
    TokenResponse? Tokens = null,
    UserRole? Role = null,
    string? Error = null,
    TimeSpan? RetryAfter = null);

/// <summary>Outcome of <see cref="AuthService.UpdateProfileAsync"/>.</summary>
public enum UpdateProfileStatus
{
    /// <summary>Written; <see cref="UpdateProfileOutcome.Me"/> is the refreshed user → 200.</summary>
    Updated,

    /// <summary>No such user, or the account is not active → 401.</summary>
    Unauthorized,

    /// <summary>The supplied <c>full_name</c> is blank, over the column width, or carries control
    /// characters → 400. Deliberately NOT silently ignored: a caller that sent a name expects it
    /// stored, and a blank display name breaks the avatar initials and every "Salom, {name}".</summary>
    InvalidFullName,

    /// <summary>The supplied <c>preferred_language</c> is not one of the three the app ships → 400.
    /// Refused rather than coerced to the default: silently storing "uz" for a caller that asked for
    /// something else would report success for a change that did not happen, and the column is only
    /// 8 characters wide anyway.</summary>
    InvalidLanguage,
}

/// <summary>Result of a partial profile update. <see cref="Error"/> carries the user-facing message
/// on <see cref="UpdateProfileStatus.InvalidFullName"/>.</summary>
public sealed record UpdateProfileOutcome(
    UpdateProfileStatus Status, MeResponse? Me = null, string? Error = null);

/// <summary>Outcome of <see cref="AuthService.SetAvatarAsync"/> and
/// <see cref="AuthService.RemoveAvatarAsync"/>.</summary>
public enum AvatarUpdateStatus
{
    /// <summary>Stored (or cleared); <see cref="AvatarUpdateOutcome.Me"/> is the refreshed user → 200.</summary>
    Updated,

    /// <summary>The upload's content-type is not one of the allowed raster types
    /// (<c>image/jpeg</c> / <c>image/png</c> / <c>image/webp</c>) → 400. <c>image/svg+xml</c> is
    /// deliberately in the reject set: an SVG can carry script and would be a stored-XSS vector.</summary>
    InvalidType,

    /// <summary>The upload exceeds the 5 MB ceiling → 400 (a message distinct from
    /// <see cref="InvalidType"/> so the client can show the right hint).</summary>
    TooLarge,

    /// <summary>The upload was empty (zero bytes) → 400.</summary>
    Empty,

    /// <summary>No such user, or the account is not active → 401.</summary>
    Unauthorized,
}

/// <summary>Result of setting or removing the caller's avatar. <see cref="Me"/> is the refreshed
/// user on <see cref="AvatarUpdateStatus.Updated"/>; <see cref="Error"/> carries the user-facing
/// message on the three 400 statuses.</summary>
public sealed record AvatarUpdateOutcome(
    AvatarUpdateStatus Status, MeResponse? Me = null, string? Error = null);

/// <summary>Result of the pure <c>AuthService.ValidateAvatarUpload</c> check. <see cref="IsValid"/>
/// splits accept from reject: on accept, <see cref="ContentType"/> is the normalised type stored with
/// the object and <see cref="Ext"/> the storage-key extension; on reject, <see cref="RejectStatus"/>
/// is the distinct 400 status and <see cref="Error"/> its user-facing message. Internal + a value
/// type so the security-critical decision is unit-testable without a DB or storage.</summary>
internal readonly record struct AvatarValidation(
    bool IsValid, AvatarUpdateStatus RejectStatus, string? Error, string ContentType, string Ext)
{
    public static AvatarValidation Accept(string contentType, string ext)
        => new(true, default, null, contentType, ext);

    public static AvatarValidation Reject(AvatarUpdateStatus status, string error)
        => new(false, status, error, string.Empty, string.Empty);
}

/// <summary>Outcome of <see cref="AuthService.RequestPhoneChangeAsync"/>.</summary>
public enum PhoneChangeRequestStatus
{
    /// <summary>Pending change bound to the caller, code generated and handed to delivery → 200.</summary>
    Sent,

    /// <summary>The new phone failed <c>PhoneNumbers.NormalizeUz</c> → 400.</summary>
    InvalidPhone,

    /// <summary>The number already belongs to a DIFFERENT account → 409. Decided BEFORE any code is
    /// generated, so a number that cannot be claimed never has a code sent for it.</summary>
    Taken,

    /// <summary>No such user, or the account is not active → 401.</summary>
    Unauthorized,

    /// <summary>A code was sent to the NEW number less than the request cooldown ago → 429 with
    /// Retry-After. The same per-phone cooldown as login, because it is the same code key. Decided
    /// before the pending change is written, so a refused request changes nothing.</summary>
    TooSoon,
}

/// <summary>
/// Result of starting a phone change. On <see cref="PhoneChangeRequestStatus.Sent"/> the payload
/// mirrors <c>POST /api/auth/otp/request</c> field-for-field (channel, TTL, dev hint, Telegram deep
/// link, request id) because it IS the same OTP flow — the client can reuse its login OTP step,
/// polling <c>GET /api/auth/otp/status</c> included. <see cref="RetryAfter"/> is set on
/// <see cref="PhoneChangeRequestStatus.TooSoon"/>.
/// </summary>
public sealed record PhoneChangeRequestResult(
    PhoneChangeRequestStatus Status,
    string Channel = "",
    int ExpiresInSeconds = 0,
    string? DevHint = null,
    string? TelegramLink = null,
    string? Error = null,
    string? RequestId = null,
    string? TelegramMode = null,
    TimeSpan? RetryAfter = null);

/// <summary>Outcome of <see cref="AuthService.ConfirmPhoneChangeAsync"/>.</summary>
public enum PhoneChangeConfirmStatus
{
    /// <summary>Number written; <see cref="PhoneChangeConfirmOutcome.Me"/> is the updated user → 200.</summary>
    Changed,

    /// <summary>Wrong/expired code, no pending change for this user, or an unverifiable
    /// (fail-closed) store → 401.</summary>
    InvalidCode,

    /// <summary>Another account claimed the number between request and confirm → 409.</summary>
    Taken,

    /// <summary>No such user, or the account is not active → 401.</summary>
    Unauthorized,

    /// <summary>Too many wrong codes for the new number in the current window → 429 with
    /// Retry-After (the same per-phone lock as login).</summary>
    LockedOut,
}

/// <summary>Result of confirming a phone change. <see cref="Me"/> is set only on
/// <see cref="PhoneChangeConfirmStatus.Changed"/>; <see cref="RetryAfter"/> only on
/// <see cref="PhoneChangeConfirmStatus.LockedOut"/>.</summary>
public sealed record PhoneChangeConfirmOutcome(
    PhoneChangeConfirmStatus Status, MeResponse? Me = null, TimeSpan? RetryAfter = null);

/// <summary>Outcome of <see cref="AuthService.GoogleAsync"/>.</summary>
public enum GoogleAuthStatus
{
    /// <summary>Signed in (or signed up) → 200 with tokens.</summary>
    Success,

    /// <summary>Google sign-in not configured → 503.</summary>
    NotConfigured,

    /// <summary>Could not reach Google → 502.</summary>
    Unreachable,

    /// <summary>Google token rejected → 401.</summary>
    InvalidToken,

    /// <summary>Existing account is blocked → 403.</summary>
    Blocked,
}

public sealed record GoogleAuthOutcome(GoogleAuthStatus Status, TokenResponse? Tokens = null);
