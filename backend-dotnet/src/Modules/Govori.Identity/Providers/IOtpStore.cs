namespace Govori.Identity.Providers;

/// <summary>
/// One-time OTP storage for phone codes. A code is stored under <c>otp:&lt;key&gt;</c> with a TTL
/// (the key is the normalised phone);
/// wrong guesses are attempt-limited under <c>otp_attempts:&lt;key&gt;</c> and burn the code once
/// the limit is hit.
///
/// <para><b>FAIL-CLOSED:</b> verification must NEVER let an unverifiable code through. The
/// real (Redis) backend surfaces a store outage as a thrown exception; the caller
/// (<see cref="AuthService.VerifyOtpAsync"/>) treats any such failure as a denied verification. An
/// implementation must never return <c>true</c> when it cannot prove the code matched. The ONLY
/// exception is the dev-code bypass, which lives OUTSIDE this store (see
/// <see cref="IOtpDeliverySender.AcceptsDevCode"/>).</para>
/// </summary>
public interface IOtpStore
{
    /// <summary>Create a fresh code, store it under <paramref name="key"/> with the configured TTL,
    /// reset the attempt counter, and return the code (mirrors <c>otp.generate_and_store</c>).</summary>
    Task<string> GenerateAndStoreAsync(string key, CancellationToken ct = default);

    /// <summary>Return <c>true</c> IFF <paramref name="code"/> matches the code stored under
    /// <paramref name="key"/> (one-shot, attempt-limited). Mirrors <c>otp.verify</c>.</summary>
    Task<bool> VerifyAsync(string key, string code, CancellationToken ct = default);

    // NOTE: there is deliberately no Invalidate/Burn member here. Burning a code after a failed
    // Telegram ownership proof happens in the WORKER, which cannot reference this module (host →
    // domain edge), so it goes through ITelegramOtpLinkStore.BurnAsync instead. An unused burn
    // method on this interface would read as if the Identity side covered that path when it does
    // not. Both delete the same key, derived once in Govori.Platform.Otp.OtpRedisKeys.
}
