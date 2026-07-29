namespace Govori.Identity.Providers;

/// <summary>Outcome of a Google ID-token verification.</summary>
public enum GoogleTokenStatus
{
    /// <summary>Token valid; <see cref="GoogleTokenResult.User"/> is populated.</summary>
    Valid,

    /// <summary>Google sign-in is not configured (no client id) → 503.</summary>
    NotConfigured,

    /// <summary>Google could not be reached (network/transport failure) → 502.</summary>
    Unreachable,

    /// <summary>Token rejected: bad token, audience mismatch, unverified/absent email → 401.</summary>
    Invalid,
}

/// <summary>The identity claims extracted from a valid Google ID token.</summary>
public sealed record GoogleUserInfo(string Email, string? Name, string? Sub);

/// <summary>Verification result. <see cref="User"/> is non-null only when <see cref="Status"/>
/// is <see cref="GoogleTokenStatus.Valid"/>.</summary>
public sealed record GoogleTokenResult(GoogleTokenStatus Status, GoogleUserInfo? User = null);

/// <summary>
/// Verifies a Google Identity Services ID token against Google's tokeninfo endpoint. Abstracted so
/// tests use a fake that returns a known (email, sub) instead of calling Google over the network.
/// </summary>
public interface IGoogleTokenVerifier
{
    Task<GoogleTokenResult> VerifyAsync(string credential, CancellationToken ct = default);
}
