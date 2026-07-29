namespace Govori.Identity.Providers;

/// <summary>
/// OTP generation config for the phone-OTP flow. <see cref="CodeLength"/> stays 4–6 digits. The
/// TTL and attempt limit are bound from the <c>EMAIL_OTP_*</c> environment variables, whose names
/// are kept for deployment compatibility even though the codes are now delivered by phone. Email
/// verification is gone from the auth flow, so there is no <c>EmailVerificationEnabled</c> flag.
/// </summary>
public sealed class OtpOptions
{
    /// <summary>EMAIL_OTP_LENGTH (default 6; the product allows 4–6).</summary>
    public int CodeLength { get; init; } = 6;

    /// <summary>EMAIL_OTP_TTL_SEC (default 600 = 10 minutes). Surfaced as <c>expires_in</c>.</summary>
    public int TtlSeconds { get; init; } = 600;

    /// <summary>EMAIL_OTP_MAX_ATTEMPTS — wrong guesses before the code is burned (default 5).</summary>
    public int MaxAttempts { get; init; } = 5;
}
