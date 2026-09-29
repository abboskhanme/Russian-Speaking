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
///
/// <para><b>Four keys per phone</b>, all derived in <see cref="OtpRedisKeys"/>: the code, its
/// per-code wrong-guess counter, the request cooldown, and the per-phone failure count. The first two
/// are reset by every new code; the last two deliberately are not, because resetting on a new code is
/// exactly what used to make the per-code limit meaningless.</para>
/// </summary>
public sealed class RedisOtpStore : IOtpStore
{
    /// <summary>INCR the failure counter and, if it carries no TTL yet, start the window — as ONE
    /// atomic step. Two separate calls would leave a gap in which a crash (or a lost connection)
    /// strands the counter without an expiry, and a counter without an expiry is a phone that can
    /// never log in again. Checking <c>TTL &lt; 0</c> rather than <c>n == 1</c> also heals such a key
    /// if one ever existed. Plain EVAL, so it needs no particular Redis version.</summary>
    private const string CountFailureScript = """
        local n = redis.call('INCR', KEYS[1])
        if redis.call('TTL', KEYS[1]) < 0 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return n
        """;

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

    /// <summary>SET NX with the cooldown as its TTL — atomic, so two requests racing for the same
    /// phone cannot both win. The loser learns how long is left.</summary>
    public async Task<TimeSpan?> ClaimRequestSlotAsync(string key, CancellationToken ct = default)
    {
        if (_options.RequestCooldownSeconds <= 0)
            return null;

        var db = _redis.GetDatabase();
        var slot = OtpRedisKeys.RequestCooldown(key);
        if (await db.StringSetAsync(slot, "1", TimeSpan.FromSeconds(_options.RequestCooldownSeconds), When.NotExists))
            return null;
        return await RemainingAsync(db, slot);
    }

    /// <summary>Mirrors <c>otp.generate_and_store</c>: store a fresh code with the TTL and
    /// reset the per-code attempt counter. The per-phone failure count is left alone.</summary>
    public async Task<string> GenerateAndStoreAsync(string key, CancellationToken ct = default)
    {
        var code = GenerateCode(_options.CodeLength);
        var db = _redis.GetDatabase();
        await db.StringSetAsync(CodeKey(key), code, TimeSpan.FromSeconds(_options.TtlSeconds));
        await db.KeyDeleteAsync(AttemptsKey(key)); // reset attempt counter for the new code
        return code;
    }

    /// <summary>Mirrors <c>otp.verify</c>: one-shot, attempt-limited, constant-time compare — behind a
    /// per-phone failure cap that a new code does not reset.</summary>
    public async Task<OtpVerification> VerifyAsync(string key, string code, CancellationToken ct = default)
    {
        var db = _redis.GetDatabase();
        var stored = await db.StringGetAsync(CodeKey(key));
        if (stored.IsNullOrEmpty)
            return OtpVerification.Reject; // never issued, or already expired/used — nothing to guess

        // The per-PHONE cap. The attempt is counted BEFORE the compare (a match below clears the
        // count again) so the check and the increment are one atomic step: two guesses racing each
        // other cannot both read "9" and both get compared. Past the cap even the right code is
        // refused, because a lock that a lucky guess can open is not a lock. Only attempts against a
        // LIVE code count — with nothing stored there was nothing to guess.
        if (_options.MaxFailuresPerWindow > 0)
        {
            var failuresKey = OtpRedisKeys.Failures(key);
            var failures = (long)await db.ScriptEvaluateAsync(
                CountFailureScript, new[] { failuresKey }, new RedisValue[] { _options.FailureWindowSeconds });
            if (failures > _options.MaxFailuresPerWindow)
                return OtpVerification.Locked(await RemainingAsync(db, failuresKey));
        }

        var attempts = await db.StringIncrementAsync(AttemptsKey(key));
        if (attempts == 1)
            await db.KeyExpireAsync(AttemptsKey(key), TimeSpan.FromSeconds(_options.TtlSeconds));
        if (attempts > _options.MaxAttempts)
        {
            await db.KeyDeleteAsync(CodeKey(key)); // burn the code after too many tries
            return OtpVerification.Reject;
        }

        if (FixedTimeEquals(stored!, (code ?? string.Empty).Trim()))
        {
            // Possession is proven, so everything that was guarding the phone goes: the code, both
            // wrong-guess counts, and the request cooldown. Clearing the cooldown is what lets the
            // login screen ask for a fresh code straight away when the phone turns out to be new and
            // it has to collect a name first (the verify it just made consumed this code).
            await db.KeyDeleteAsync(new[]
            {
                CodeKey(key), AttemptsKey(key), OtpRedisKeys.Failures(key), OtpRedisKeys.RequestCooldown(key),
            });
            return OtpVerification.Match;
        }
        return OtpVerification.Reject;
    }

    // How long a TTL-bearing key has left, for Retry-After. A key that expired between the write
    // and this read reports one second rather than zero: "try again now" would be answered by a
    // request that races the expiry, and one second is never a wrong thing to tell a person.
    private static async Task<TimeSpan> RemainingAsync(IDatabase db, RedisKey key)
    {
        var ttl = await db.KeyTimeToLiveAsync(key);
        return ttl is { } left && left > TimeSpan.Zero ? left : TimeSpan.FromSeconds(1);
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
