namespace Govori.Identity.Security;

/// <summary>
/// Auth configuration: the JWT signing secret and the token lifetimes. Every
/// value can be overridden from the environment; the defaults below apply when
/// it is not.
/// </summary>
public sealed class IdentityAuthOptions
{
    /// <summary>
    /// HS256 signing secret, bound from <c>SECRET_KEY</c>. Consumed as the RAW
    /// UTF-8 BYTES of this string — it is NOT base64-decoded, so do not store a
    /// base64 blob here expecting it to be decoded first.
    /// </summary>
    public string SecretKey { get; init; } = string.Empty;

    /// <summary>ACCESS_TOKEN_EXPIRE_MINUTES (default 30).</summary>
    public int AccessTokenExpireMinutes { get; init; } = 30;

    /// <summary>REFRESH_TOKEN_EXPIRE_DAYS (default 7).</summary>
    public int RefreshTokenExpireDays { get; init; } = 7;

    /// <summary>EMAIL_VERIFY_TOKEN_EXPIRE_MINUTES (default 20).</summary>
    public int EmailVerifyTokenExpireMinutes { get; init; } = 20;
}
