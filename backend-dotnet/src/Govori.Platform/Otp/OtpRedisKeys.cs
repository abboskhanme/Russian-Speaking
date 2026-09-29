using StackExchange.Redis;

namespace Govori.Platform.Otp;

/// <summary>
/// The ONE canonical derivation of the phone-OTP Redis keys.
///
/// <para>Two different assemblies read and delete these keys: <c>RedisOtpStore</c> in
/// Govori.Identity issues and verifies the code, while <c>RedisTelegramOtpLinkStore</c> here in
/// Platform burns it when the Telegram phone check fails — the Worker cannot reference a domain
/// module, so it cannot go through <c>IOtpStore</c>. Both previously carried their own private copy
/// of the format string, kept in step only by a comment. If those ever drifted the burn would
/// silently delete nothing and a rejected login code would stay live for the rest of its TTL, which
/// is precisely the failure the Telegram check exists to prevent. Deriving both from here makes that
/// drift impossible.</para>
///
/// <para>The <c>ToLowerInvariant()</c> is load-bearing, not cosmetic: it is what makes the key
/// stable for a caller that varies the casing of the identifier.</para>
/// </summary>
public static class OtpRedisKeys
{
    /// <summary>The stored one-time code for an identifier (a normalised phone).</summary>
    public static RedisKey Code(string key) => $"otp:{key.ToLowerInvariant()}";

    /// <summary>The wrong-guess counter guarding <see cref="Code"/>. Reset with every new code.</summary>
    public static RedisKey Attempts(string key) => $"otp_attempts:{key.ToLowerInvariant()}";

    /// <summary>Present while the identifier may not be sent another code yet (the request
    /// cooldown). Only <c>RedisOtpStore</c> reads it; it lives here so every OTP key has one home.</summary>
    public static RedisKey RequestCooldown(string key) => $"otp_cooldown:{key.ToLowerInvariant()}";

    /// <summary>Wrong guesses for the identifier across ALL its codes in the current window. Unlike
    /// <see cref="Attempts"/>, a new code does not reset it — that is the whole point of it.</summary>
    public static RedisKey Failures(string key) => $"otp_failures:{key.ToLowerInvariant()}";
}
