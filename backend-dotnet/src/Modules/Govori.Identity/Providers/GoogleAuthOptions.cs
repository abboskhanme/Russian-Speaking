namespace Govori.Identity.Providers;

/// <summary>
/// Google Sign-In config, mirroring the Python <c>Settings.GOOGLE_CLIENT_ID</c>
/// (backend/app/core/config.py:97). Empty ⇒ Google sign-in is not configured
/// (endpoint returns 503, matching Python's <c>_verify_google_token</c>).
/// </summary>
public sealed class GoogleAuthOptions
{
    /// <summary>OAuth 2.0 Web Client ID. Empty when unconfigured.</summary>
    public string ClientId { get; init; } = string.Empty;
}
