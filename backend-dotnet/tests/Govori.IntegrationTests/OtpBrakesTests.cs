using Govori.Identity.Providers;
using Govori.Platform.Otp;
using StackExchange.Redis;

namespace Govori.IntegrationTests;

/// <summary>
/// The two per-PHONE brakes on OTP guessing, against the real <see cref="RedisOtpStore"/> on the
/// govori-net Redis (the same one AuthEndpointsTests already exercises through HTTP).
///
/// <para><b>Why they exist.</b> The per-code attempt counter reset with every new code, and nothing
/// limited how often a new code could be requested — so "5 wrong guesses per code" capped nothing,
/// and the per-IP rate limit (bypassable, see RateLimitIdentityTests) was the only brake. Now a phone
/// can be sent a code at most once per cooldown, and a phone's wrong guesses are capped per window
/// across EVERY code, which a new code does not reset.</para>
///
/// <para>Each test uses its own random phone and deletes every key it could have written, so the
/// shared dev Redis is left as it was found.</para>
/// </summary>
public sealed class OtpBrakesTests : IAsyncLifetime
{
    private IConnectionMultiplexer _redis = null!;
    private readonly List<string> _phones = new();

    public async Task InitializeAsync()
    {
        var options = ConfigurationOptions.Parse(Environment.GetEnvironmentVariable("GOVORI_REDIS") ?? "govori-redis:6379");
        options.AbortOnConnectFail = false;
        _redis = await ConnectionMultiplexer.ConnectAsync(options);
    }

    public async Task DisposeAsync()
    {
        var db = _redis.GetDatabase();
        foreach (var phone in _phones)
            await db.KeyDeleteAsync(new[]
            {
                OtpRedisKeys.Code(phone), OtpRedisKeys.Attempts(phone),
                OtpRedisKeys.RequestCooldown(phone), OtpRedisKeys.Failures(phone),
            });
        await _redis.DisposeAsync();
    }

    private string NewPhone()
    {
        var phone = "+99890" + Random.Shared.Next(0, 10_000_000).ToString("D7");
        _phones.Add(phone);
        return phone;
    }

    private RedisOtpStore Store(int cooldownSeconds = 60, int maxFailures = 10, int maxAttempts = 5)
        => new(_redis, new OtpOptions
        {
            RequestCooldownSeconds = cooldownSeconds,
            MaxFailuresPerWindow = maxFailures,
            FailureWindowSeconds = 3600,
            MaxAttempts = maxAttempts,
        });

    // A code the stored one can never equal: the store only ever mints digits.
    private const string Wrong = "wrong!";

    // ── Request cooldown ─────────────────────────────────────────────────────

    [Fact]
    public async Task A_second_code_inside_the_cooldown_is_refused_with_the_time_left()
    {
        var store = Store(cooldownSeconds: 60);
        var phone = NewPhone();

        Assert.Null(await store.ClaimRequestSlotAsync(phone));

        var retryAfter = await store.ClaimRequestSlotAsync(phone);
        Assert.NotNull(retryAfter);
        Assert.InRange(retryAfter!.Value, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(60));

        // Keyed by the phone: a different number is not held up by it.
        Assert.Null(await store.ClaimRequestSlotAsync(NewPhone()));
    }

    [Fact]
    public async Task A_successful_verify_clears_the_cooldown_so_a_fresh_code_can_follow()
    {
        // The login screen does exactly this for a new phone: verify (consuming the code) → "needs a
        // name" → request a fresh code at once. The cooldown must not stand in the way of it.
        var store = Store(cooldownSeconds: 60);
        var phone = NewPhone();
        Assert.Null(await store.ClaimRequestSlotAsync(phone));
        var code = await store.GenerateAndStoreAsync(phone);

        Assert.Equal(OtpVerdict.Matched, (await store.VerifyAsync(phone, code)).Verdict);

        Assert.Null(await store.ClaimRequestSlotAsync(phone));
    }

    [Fact]
    public async Task A_zero_cooldown_disables_it()
    {
        var store = Store(cooldownSeconds: 0);
        var phone = NewPhone();

        Assert.Null(await store.ClaimRequestSlotAsync(phone));
        Assert.Null(await store.ClaimRequestSlotAsync(phone));
    }

    // ── Per-phone failure cap ────────────────────────────────────────────────

    [Fact]
    public async Task The_failure_cap_survives_a_new_code_and_then_refuses_even_the_right_one()
    {
        // Cap 3 failures, 5 attempts per code: so the cap, not the per-code burn, is what trips.
        var store = Store(cooldownSeconds: 0, maxFailures: 3, maxAttempts: 5);
        var phone = NewPhone();

        await store.GenerateAndStoreAsync(phone);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);

        // A NEW code — the old attempt counter resets with it, the per-phone count must not.
        var code = await store.GenerateAndStoreAsync(phone);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);   // 3rd failure

        // Over the cap: refused without comparing, even though this IS the live code.
        var locked = await store.VerifyAsync(phone, code);
        Assert.Equal(OtpVerdict.LockedOut, locked.Verdict);
        Assert.InRange(locked.RetryAfter!.Value, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(3600));

        // And the lock was not a burn: the code is still there once the window passes (simulated by
        // dropping the counter), which is what "denied until the window passes" means.
        await _redis.GetDatabase().KeyDeleteAsync(OtpRedisKeys.Failures(phone));
        Assert.Equal(OtpVerdict.Matched, (await store.VerifyAsync(phone, code)).Verdict);
    }

    [Fact]
    public async Task A_success_before_the_cap_resets_the_count()
    {
        var store = Store(cooldownSeconds: 0, maxFailures: 3);
        var phone = NewPhone();

        var code = await store.GenerateAndStoreAsync(phone);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);
        Assert.Equal(OtpVerdict.Matched, (await store.VerifyAsync(phone, code)).Verdict);   // two typos, then right

        // A real user who got there is not carrying two strikes into their next login.
        code = await store.GenerateAndStoreAsync(phone);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);
        Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);
        Assert.Equal(OtpVerdict.Matched, (await store.VerifyAsync(phone, code)).Verdict);
    }

    [Fact]
    public async Task Guessing_with_no_live_code_is_not_counted()
    {
        // Nothing stored means nothing to guess; counting it would let anyone lock a stranger's phone
        // out by typing at the verify route without ever asking for a code.
        var store = Store(cooldownSeconds: 0, maxFailures: 1);
        var phone = NewPhone();

        for (var i = 0; i < 3; i++)
            Assert.Equal(OtpVerdict.Rejected, (await store.VerifyAsync(phone, Wrong)).Verdict);

        var code = await store.GenerateAndStoreAsync(phone);
        Assert.Equal(OtpVerdict.Matched, (await store.VerifyAsync(phone, code)).Verdict);
    }

    [Fact]
    public async Task The_failure_window_always_has_an_expiry()
    {
        // A failure counter without a TTL is a phone locked out for good. The count and its expiry are
        // set in one atomic script, so the counter can never exist without one.
        var store = Store(cooldownSeconds: 0, maxFailures: 10);
        var phone = NewPhone();
        await store.GenerateAndStoreAsync(phone);

        await store.VerifyAsync(phone, Wrong);

        var ttl = await _redis.GetDatabase().KeyTimeToLiveAsync(OtpRedisKeys.Failures(phone));
        Assert.NotNull(ttl);
        Assert.InRange(ttl!.Value, TimeSpan.FromSeconds(3500), TimeSpan.FromSeconds(3600));
    }
}
