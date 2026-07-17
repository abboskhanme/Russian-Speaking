namespace Govori.Identity.Providers;

/// <summary>
/// One-time email-verification code storage, ported from backend/app/services/otp.py.
/// A code is stored under <c>emailotp:&lt;email&gt;</c> with a TTL; wrong guesses are
/// attempt-limited under <c>emailotp_attempts:&lt;email&gt;</c> and burn the code once the
/// limit is hit.
///
/// <para><b>FAIL-CLOSED:</b> verification must NEVER let an unverifiable code through. The
/// real (Redis) backend surfaces a store outage as a thrown exception; the caller
/// (<see cref="AuthService.VerifyEmailCodeAsync"/>) treats any such failure as a denied
/// verification. An implementation must never return <c>true</c> when it cannot prove the
/// code matched.</para>
/// </summary>
public interface IOtpStore
{
    /// <summary>Create a fresh code, store it with the configured TTL, reset the attempt
    /// counter, and return the code (mirrors <c>otp.generate_and_store</c>).</summary>
    Task<string> GenerateAndStoreAsync(string email, CancellationToken ct = default);

    /// <summary>Return <c>true</c> IFF <paramref name="code"/> matches the stored code
    /// (one-shot, attempt-limited). Mirrors <c>otp.verify</c>.</summary>
    Task<bool> VerifyAsync(string email, string code, CancellationToken ct = default);
}
