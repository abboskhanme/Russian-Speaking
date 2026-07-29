using System.Security.Cryptography;
using System.Text;
using Govori.Platform.Otp;
using StackExchange.Redis;

namespace Govori.Identity.Providers;

/// <summary>
/// Redis-backed OTP store over StackExchange.Redis (the real implementation targets
/// <c>govori-redis:6379</c>).
///
/// <para><b>FAIL-CLOSED:</b> this store never swallows a Redis outage into a "pass". If Redis
/// is unreachable the underlying call throws, and the caller
/// (<see cref="AuthService.VerifyOtpAsync"/>) denies the verification. Verification MUST fail
/// closed when the store is down — an unverifiable code is never let through.</para>
/// </summary>
public sealed class RedisOtpStore : IOtpStore
{
    private readonly IConnectionMultiplexer _redis;
    private readonly OtpOptions _options;

    public RedisOtpStore(IConnectionMultiplexer redis, OtpOptions options)
    {
        _redis = redis;
        _options = options;
    }

    // Derived in Platform so the Telegram burn path cannot drift from this one. See OtpRedisKeys.
    private static RedisKey CodeKey(string key) => OtpRedisKeys.Code(key);
    private static RedisKey AttemptsKey(string key) => OtpRedisKeys.Attempts(key);

    /// <summary>Mirrors <c>otp.generate_and_store</c>: store a fresh code with the TTL and
    /// reset the attempt counter.</summary>
    public async Task<string> GenerateAndStoreAsync(string key, CancellationToken ct = default)
    {
        var code = GenerateCode(_options.CodeLength);
        var db = _redis.GetDatabase();
        await db.StringSetAsync(CodeKey(key), code, TimeSpan.FromSeconds(_options.TtlSeconds));
        await db.KeyDeleteAsync(AttemptsKey(key)); // reset attempt counter for the new code
        return code;
    }

    /// <summary>Mirrors <c>otp.verify</c>: one-shot, attempt-limited, constant-time compare.</summary>
    public async Task<bool> VerifyAsync(string key, string code, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        var stored = await db.StringGetAsync(CodeKey(key));
        if (stored.IsNullOrEmpty)
            return false; // never issued, or already expired/used

        var attempts = await db.StringIncrementAsync(AttemptsKey(key));
        if (attempts == 1)
            await db.KeyExpireAsync(AttemptsKey(key), TimeSpan.FromSeconds(_options.TtlSeconds));
        if (attempts > _options.MaxAttempts)
        {
            await db.KeyDeleteAsync(CodeKey(key)); // burn the code after too many tries
            return false;
        }

        if (FixedTimeEquals(stored!, (code ?? string.Empty).Trim()))
        {
            await db.KeyDeleteAsync(CodeKey(key));
            await db.KeyDeleteAsync(AttemptsKey(key));
            return true;
        }
        return false;
    }

    // secrets.choice("0123456789") × length, but cryptographically strong.
    private static string GenerateCode(int length)
    {
        var sb = new StringBuilder(length);
        for (var i = 0; i < length; i++)
            sb.Append((char)('0' + RandomNumberGenerator.GetInt32(10)));
        return sb.ToString();
    }

    // secrets.compare_digest equivalent — constant-time, returns false on length mismatch.
    private static bool FixedTimeEquals(string a, string b)
        => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}
