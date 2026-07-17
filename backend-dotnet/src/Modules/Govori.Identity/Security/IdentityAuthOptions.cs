namespace Govori.Identity.Security;

/// <summary>
/// Auth configuration mirroring backend/app/core/config.py (the Python
/// Settings). Defaults match the Python defaults so behaviour is identical when
/// values are not overridden from the environment.
/// </summary>
public sealed class IdentityAuthOptions
{
    /// <summary>
    /// HS256 signing secret. Used as RAW UTF-8 bytes (python-jose does NOT
    /// base64-decode the key). Maps to Python's <c>SECRET_KEY</c>.
    /// </summary>
    public string SecretKey { get; init; } = string.Empty;

    /// <summary>ACCESS_TOKEN_EXPIRE_MINUTES (default 30).</summary>
    public int AccessTokenExpireMinutes { get; init; } = 30;

    /// <summary>REFRESH_TOKEN_EXPIRE_DAYS (default 7).</summary>
    public int RefreshTokenExpireDays { get; init; } = 7;

    /// <summary>EMAIL_VERIFY_TOKEN_EXPIRE_MINUTES (default 20).</summary>
    public int EmailVerifyTokenExpireMinutes { get; init; } = 20;
}
