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
}

/// <summary>
/// Result of requesting an OTP. On <see cref="OtpRequestStatus.Sent"/>, <see cref="Channel"/> is
/// the delivery channel ("telegram_bot"/"dev"), <see cref="ExpiresInSeconds"/> the TTL,
/// <see cref="DevHint"/> the dev bypass code (only in dev delivery, else null), and
/// <see cref="TelegramLink"/> the <c>t.me/&lt;bot&gt;?start=…</c> deep link (only in bot delivery).
/// On <see cref="OtpRequestStatus.InvalidPhone"/>, <see cref="Error"/> carries the format message.
/// </summary>
public sealed record OtpRequestResult(
    OtpRequestStatus Status,
    string Channel = "",
    int ExpiresInSeconds = 0,
    string? DevHint = null,
    string? TelegramLink = null,
    string? Error = null);

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
}

/// <summary>
/// Result of verifying an OTP. <see cref="Tokens"/> is set on
/// <see cref="OtpVerifyStatus.LoggedIn"/>/<see cref="OtpVerifyStatus.Registered"/>;
/// <see cref="Role"/> is populated on <see cref="OtpVerifyStatus.Inactive"/> so the endpoint can
/// pick the teacher-awaiting-approval vs blocked message; <see cref="Error"/> carries the format
/// message on <see cref="OtpVerifyStatus.InvalidPhone"/>.
/// </summary>
public sealed record OtpVerifyOutcome(
    OtpVerifyStatus Status,
    TokenResponse? Tokens = null,
    UserRole? Role = null,
    string? Error = null);

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
