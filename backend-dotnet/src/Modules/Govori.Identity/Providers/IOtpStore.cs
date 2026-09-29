namespace Govori.Identity.Providers;

/// <summary>
/// One-time OTP storage for phone codes. A code is stored under <c>otp:&lt;key&gt;</c> with a TTL
/// (the key is the normalised phone);
/// wrong guesses are attempt-limited under <c>otp_attempts:&lt;key&gt;</c> and burn the code once
/// the limit is hit. Two per-PHONE brakes sit on top of that (see <see cref="OtpOptions"/>): a request
/// cooldown between codes, and a cap on wrong guesses across every code in a window.
///
/// <para><b>FAIL-CLOSED:</b> verification must NEVER let an unverifiable code through. The
/// real (Redis) backend surfaces a store outage as a thrown exception; the caller
/// (<see cref="AuthService.VerifyOtpAsync"/>) treats any such failure as a denied verification. An
/// implementation must never report <see cref="OtpVerdict.Matched"/> when it cannot prove the code
/// matched. The ONLY exception is the dev-code bypass, which lives OUTSIDE this store (see
/// <see cref="IOtpDeliverySender.AcceptsDevCode"/>). The request cooldown fails closed the same way:
/// a store that cannot answer throws, and no code is minted.</para>
/// </summary>
public interface IOtpStore
{
    /// <summary>Claim the right to send <paramref name="key"/> a new code. Returns <c>null</c> when
    /// the caller may go ahead, or how long until it may when a code was sent too recently. Called
    /// BEFORE anything else in a request is written, so a refused request changes nothing.</summary>
    Task<TimeSpan?> ClaimRequestSlotAsync(string key, CancellationToken ct = default);

    /// <summary>Create a fresh code, store it under <paramref name="key"/> with the configured TTL,
    /// reset the attempt counter, and return the code (mirrors <c>otp.generate_and_store</c>). Does
    /// NOT reset the per-phone failure count.</summary>
    Task<string> GenerateAndStoreAsync(string key, CancellationToken ct = default);

    /// <summary>Check <paramref name="code"/> against the code stored under <paramref name="key"/>
    /// (one-shot, attempt-limited, and refused outright while the phone is locked out). Mirrors
    /// <c>otp.verify</c>.</summary>
    Task<OtpVerification> VerifyAsync(string key, string code, CancellationToken ct = default);

    // NOTE: there is deliberately no Invalidate/Burn member here. Burning a code after a failed
    // Telegram ownership proof happens in the WORKER, which cannot reference this module (host →
    // domain edge), so it goes through ITelegramOtpLinkStore.BurnAsync instead. An unused burn
    // method on this interface would read as if the Identity side covered that path when it does
    // not. Both delete the same key, derived once in Govori.Platform.Otp.OtpRedisKeys.
}

/// <summary>What <see cref="IOtpStore.VerifyAsync"/> concluded about one typed code.</summary>
public enum OtpVerdict
{
    /// <summary>The code matched and has been consumed.</summary>
    Matched,

    /// <summary>Wrong, expired, never issued, or burned — deliberately one answer for all four.</summary>
    Rejected,

    /// <summary>Too many wrong guesses for this phone in the current window; the code was not even
    /// compared. <see cref="OtpVerification.RetryAfter"/> says when the window ends.</summary>
    LockedOut,
}

/// <summary>The verdict plus, for <see cref="OtpVerdict.LockedOut"/>, how long the lock has left.</summary>
public readonly record struct OtpVerification(OtpVerdict Verdict, TimeSpan? RetryAfter = null)
{
    public static OtpVerification Match => new(OtpVerdict.Matched);

    public static OtpVerification Reject => new(OtpVerdict.Rejected);

    public static OtpVerification Locked(TimeSpan retryAfter) => new(OtpVerdict.LockedOut, retryAfter);
}
