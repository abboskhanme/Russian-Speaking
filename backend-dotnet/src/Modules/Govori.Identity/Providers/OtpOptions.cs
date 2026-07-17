namespace Govori.Identity.Providers;

/// <summary>
/// Email-OTP + email-verification config, mirroring the Python <c>Settings</c>
/// (backend/app/core/config.py:114-122). Defaults match Python's defaults.
/// </summary>
public sealed class OtpOptions
{
    /// <summary>EMAIL_OTP_LENGTH (default 6).</summary>
    public int CodeLength { get; init; } = 6;

    /// <summary>EMAIL_OTP_TTL_SEC (default 600 = 10 minutes).</summary>
    public int TtlSeconds { get; init; } = 600;

    /// <summary>EMAIL_OTP_MAX_ATTEMPTS — wrong guesses before the code is burned (default 5).</summary>
    public int MaxAttempts { get; init; } = 5;

    /// <summary>
    /// Whether registration requires a verified-email token (Python's
    /// <c>settings.email_enabled</c>, derived from SMTP config). SMTP is not wired in the
    /// .NET port yet, so this is an explicit flag — default <c>false</c> so sign-up works
    /// without email verification, exactly like Python when SMTP is unconfigured.
    /// </summary>
    public bool EmailVerificationEnabled { get; init; }
}
