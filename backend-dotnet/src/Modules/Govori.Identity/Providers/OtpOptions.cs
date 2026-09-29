namespace Govori.Identity.Providers;

/// <summary>
/// OTP generation config for the phone-OTP flow. <see cref="CodeLength"/> stays 4–6 digits. The
/// TTL and attempt limit are bound from the <c>EMAIL_OTP_*</c> environment variables, whose names
/// are kept for deployment compatibility even though the codes are now delivered by phone. Email
/// verification is gone from the auth flow, so there is no <c>EmailVerificationEnabled</c> flag.
///
/// <para><b>Three brakes, three different things they stop.</b> <see cref="MaxAttempts"/> caps the
/// guesses against ONE code. On its own that is no cap at all, because every new code starts a fresh
/// count and nothing limited how often a new code could be asked for — so per-IP rate limiting was
/// the only thing between a script and the code space. <see cref="RequestCooldownSeconds"/> limits how
/// often a phone can be sent a code, and <see cref="MaxFailuresPerWindow"/> caps wrong guesses per
/// PHONE across every code issued in <see cref="FailureWindowSeconds"/>, which a new code does not
/// reset. Both are keyed by the phone, never by who asks, so they apply identically to a registered
/// number and an unregistered one and reveal nothing about which it is.</para>
/// </summary>
public sealed class OtpOptions
{
    /// <summary>EMAIL_OTP_LENGTH (default 6; the product allows 4–6).</summary>
    public int CodeLength { get; init; } = 6;

    /// <summary>EMAIL_OTP_TTL_SEC (default 600 = 10 minutes). Surfaced as <c>expires_in</c>.</summary>
    public int TtlSeconds { get; init; } = 600;

    /// <summary>EMAIL_OTP_MAX_ATTEMPTS — wrong guesses before the code is burned (default 5).</summary>
    public int MaxAttempts { get; init; } = 5;

    /// <summary>OTP_REQUEST_COOLDOWN_SEC — minimum gap between two codes for the same phone (default
    /// 60). A human waiting for a Telegram message does not need a second code inside a minute; a
    /// script cycling codes to reset <see cref="MaxAttempts"/> does. A successful verify clears it, so
    /// the login screen's "unknown phone → ask for a name → fresh code" step is never held up by it.
    /// 0 disables the cooldown.</summary>
    public int RequestCooldownSeconds { get; init; } = 60;

    /// <summary>OTP_MAX_FAILURES — wrong guesses allowed per phone per
    /// <see cref="FailureWindowSeconds"/>, across every code issued in that window (default 10). Past
    /// it, verification is refused — even of the right code — until the window ends. 0 disables the
    /// cap.</summary>
    public int MaxFailuresPerWindow { get; init; } = 10;

    /// <summary>OTP_FAILURE_WINDOW_SEC — the fixed window <see cref="MaxFailuresPerWindow"/> counts
    /// in, anchored at the first failure (default 3600 = 1 hour).</summary>
    public int FailureWindowSeconds { get; init; } = 3600;
}
