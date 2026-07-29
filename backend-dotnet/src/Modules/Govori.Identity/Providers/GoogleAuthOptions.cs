namespace Govori.Identity.Providers;

/// <summary>
/// Google Sign-In config, bound from <c>GOOGLE_CLIENT_ID</c>. An empty client id means Google
/// sign-in is NOT configured, and the <c>/api/auth/google</c> endpoint returns 503 until one is
/// set — it never falls back to accepting an unverified token.
/// </summary>
public sealed class GoogleAuthOptions
{
    /// <summary>OAuth 2.0 Web Client ID. Empty when unconfigured.</summary>
    public string ClientId { get; init; } = string.Empty;
}
