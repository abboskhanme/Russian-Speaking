using Govori.Contracts;
using Govori.Infrastructure.Entities;

namespace Govori.Identity;

// Discriminated outcomes returned by AuthService so the endpoints stay thin (docs/07 §7.2):
// each maps 1:1 to an HTTP status code in IdentityEndpoints, mirroring the Python router.

/// <summary>Outcome of <see cref="AuthService.LoginAsync"/>.</summary>
public enum LoginStatus
{
    /// <summary>Valid creds on an active account → 200 with tokens.</summary>
    Success,

    /// <summary>Unknown email, OAuth-only (NULL hash), or wrong password → 401.</summary>
    InvalidCredentials,

    /// <summary>Correct creds but the account is not active → 403.</summary>
    Inactive,
}

/// <summary><see cref="Role"/> is populated on <see cref="LoginStatus.Inactive"/> so the
/// endpoint can pick the teacher-vs-blocked message, mirroring Python's login.</summary>
public sealed record LoginResult(LoginStatus Status, TokenResponse? Tokens, UserRole? Role);

/// <summary>Outcome of <see cref="AuthService.RegisterAsync"/>.</summary>
public enum RegisterStatus
{
    /// <summary>Account created → 201 with the user projection.</summary>
    Success,

    /// <summary>Email verification is required and the token is missing/invalid → 400.</summary>
    EmailNotVerified,

    /// <summary>Email already registered → 409.</summary>
    EmailTaken,

    /// <summary>Field validation failed (phone/age/address) → 422.</summary>
    InvalidInput,
}

public sealed record RegisterResult(RegisterStatus Status, MeResponse? User = null, string? Error = null);

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

/// <summary>Outcome of <see cref="AuthService.RequestEmailCodeAsync"/>.</summary>
public enum EmailCodeRequestStatus
{
    /// <summary>Code generated + sent → 200.</summary>
    Sent,

    /// <summary>Email already registered → 409.</summary>
    EmailTaken,
}

public sealed record EmailCodeRequestResult(EmailCodeRequestStatus Status, int ExpiresInSeconds);
