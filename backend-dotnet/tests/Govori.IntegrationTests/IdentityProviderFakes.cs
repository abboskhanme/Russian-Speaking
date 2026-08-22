using System.Collections.Concurrent;
using Govori.Identity.Providers;
using Govori.Platform.Telegram;

namespace Govori.IntegrationTests;

/// <summary>
/// In-memory <see cref="IOtpStore"/> for tests — no Redis. Generates a fixed code, stores it
/// keyed by email, and verifies one-shot. Mirrors the real store's observable contract.
/// </summary>
public sealed class FakeOtpStore : IOtpStore
{
    private readonly ConcurrentDictionary<string, string> _codes = new(StringComparer.OrdinalIgnoreCase);

    public Task<string> GenerateAndStoreAsync(string email, CancellationToken ct = default)
    {
        const string code = "123456";
        _codes[email] = code;
        return Task.FromResult(code);
    }

    public Task<bool> VerifyAsync(string email, string code, CancellationToken ct = default)
    {
        var ok = _codes.TryGetValue(email, out var stored) && stored == (code ?? string.Empty).Trim();
        if (ok)
            _codes.TryRemove(email, out _); // one-shot
        return Task.FromResult(ok);
    }

}

/// <summary>
/// <see cref="IOtpStore"/> that always throws — simulates a Redis outage so a test can prove
/// the verify path is FAIL-CLOSED (the store failing must deny, never approve).
/// </summary>
public sealed class ThrowingOtpStore : IOtpStore
{
    public Task<string> GenerateAndStoreAsync(string email, CancellationToken ct = default)
        => throw new InvalidOperationException("simulated OTP store outage");

    public Task<bool> VerifyAsync(string email, string code, CancellationToken ct = default)
        => throw new InvalidOperationException("simulated OTP store outage");
}

/// <summary>Test <see cref="IOtpDeliverySender"/> — the DEV channel: captures the last code per
/// phone (instead of calling Telegram) and accepts the fixed dev code <c>000000</c>, so tests can
/// verify either with the captured real code or with the dev bypass.</summary>
public sealed class FakeOtpDeliverySender : IOtpDeliverySender
{
    private readonly ConcurrentDictionary<string, string> _sent = new(StringComparer.OrdinalIgnoreCase);

    public string Channel => "dev";

    // requestId is ignored on purpose: this fake is the DEV channel, which has no Telegram step and
    // therefore no delivery state machine to advance (same as the real DevOtpDeliverySender).
    public Task<OtpDeliveryResult> SendAsync(string phone, string code, string requestId, CancellationToken ct = default)
    {
        _sent[phone] = code;
        return Task.FromResult(new OtpDeliveryResult()); // no deep link in dev
    }

    public bool AcceptsDevCode(string code)
        => string.Equals((code ?? string.Empty).Trim(), "000000", StringComparison.Ordinal);

    public string? LastCodeFor(string phone) => _sent.TryGetValue(phone, out var c) ? c : null;
}

/// <summary>
/// In-memory <see cref="IPendingPhoneChangeStore"/> for tests — no Redis. Keyed by user id, exactly
/// like the real Redis store, so a test that tries to confirm ANOTHER user's pending change reads
/// its own (absent) entry and is refused, which is the property being asserted.
/// </summary>
public sealed class FakePendingPhoneChangeStore : IPendingPhoneChangeStore
{
    private readonly ConcurrentDictionary<Guid, string> _pending = new();

    public Task SetAsync(Guid userId, string newPhone, int ttlSeconds, CancellationToken ct = default)
    {
        _pending[userId] = newPhone; // TTL is irrelevant within a test's lifetime
        return Task.CompletedTask;
    }

    public Task<string?> GetAsync(Guid userId, CancellationToken ct = default)
        => Task.FromResult(_pending.TryGetValue(userId, out var phone) ? phone : null);

    public Task ClearAsync(Guid userId, CancellationToken ct = default)
    {
        _pending.TryRemove(userId, out _);
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory <see cref="ITelegramOtpLinkStore"/> for tests — no Redis. Models the key spaces the real
/// store owns (token → link, request_id → state, tg_user → pending), so the deep_link OTP delivery path
/// can be exercised end-to-end without touching Redis. The proactive-DM tests swap it in so the
/// TelegramBotOtpSender's <c>deep_link</c> branch (CreateAsync + SetStateAsync) has somewhere to write.
/// </summary>
public sealed class FakeTelegramOtpLinkStore : ITelegramOtpLinkStore
{
    private readonly ConcurrentDictionary<string, TelegramOtpLink> _tokens = new();
    private readonly ConcurrentDictionary<string, string> _states = new();
    private readonly ConcurrentDictionary<long, string> _pending = new();

    public Task<string> CreateAsync(string phone, string code, string requestId, int ttlSeconds, CancellationToken ct = default)
    {
        var token = Guid.NewGuid().ToString("N");
        _tokens[token] = new TelegramOtpLink(phone, code, requestId);
        return Task.FromResult(token);
    }

    public Task<TelegramOtpLink?> ResolveAsync(string token, CancellationToken ct = default)
        => Task.FromResult(_tokens.TryGetValue(token ?? string.Empty, out var link) ? link : null);

    public Task SetStateAsync(string requestId, string state, int ttlSeconds, CancellationToken ct = default)
    {
        _states[requestId] = state;
        return Task.CompletedTask;
    }

    public Task<string?> GetStateAsync(string requestId, CancellationToken ct = default)
        => Task.FromResult(_states.TryGetValue(requestId ?? string.Empty, out var s) ? s : null);

    public Task BurnAsync(string phone, string token, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(token))
            _tokens.TryRemove(token, out _);
        return Task.CompletedTask;
    }

    public Task SetPendingTokenAsync(long telegramUserId, string token, int ttlSeconds, CancellationToken ct = default)
    {
        _pending[telegramUserId] = token;
        return Task.CompletedTask;
    }

    public Task<string?> GetPendingTokenAsync(long telegramUserId, CancellationToken ct = default)
        => Task.FromResult(_pending.TryGetValue(telegramUserId, out var t) ? t : null);

    public Task ClearPendingTokenAsync(long telegramUserId, CancellationToken ct = default)
    {
        _pending.TryRemove(telegramUserId, out _);
        return Task.CompletedTask;
    }
}

/// <summary>Test <see cref="ITelegramMessenger"/> — records calls and returns a preset result instead
/// of hitting the Telegram Bot API, so the proactive-DM tests can drive the direct/deep_link decision
/// (true → at least one DM "succeeds" ⇒ direct; false → all fail ⇒ deep_link fallback).</summary>
public sealed class FakeTelegramMessenger : ITelegramMessenger
{
    private readonly bool _result;
    private int _calls;

    public FakeTelegramMessenger(bool result) => _result = result;

    public int Calls => _calls;

    public bool WasCalled => Calls > 0;

    public Task<bool> SendMessageAsync(long chatId, string text, CancellationToken ct = default)
    {
        Interlocked.Increment(ref _calls);
        return Task.FromResult(_result);
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenRevocationStore"/> — no Redis. Mirrors the real store's
/// observable contract, including that an entry expires with the token: a revocation whose deadline
/// has passed reports NOT revoked, because past its <c>exp</c> the token is refused by signature
/// validation anyway.
/// </summary>
public sealed class FakeRefreshTokenRevocationStore : IRefreshTokenRevocationStore
{
    private readonly ConcurrentDictionary<string, DateTimeOffset> _revoked = new(StringComparer.Ordinal);

    /// <summary>Keyed by the same hash the real store uses, so a test cannot accidentally pass by
    /// matching on something the production path would not.</summary>
    public Task RevokeAsync(string refreshToken, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        if (expiresAt > DateTimeOffset.UtcNow)
            _revoked[RefreshTokenKeys.Revoked(refreshToken)] = expiresAt;
        return Task.CompletedTask;
    }

    public Task<bool> IsRevokedAsync(string refreshToken, CancellationToken ct = default)
        => Task.FromResult(
            _revoked.TryGetValue(RefreshTokenKeys.Revoked(refreshToken), out var until)
            && until > DateTimeOffset.UtcNow);
}

/// <summary>
/// <see cref="IRefreshTokenRevocationStore"/> that always throws — simulates a Redis outage so a
/// test can prove the refresh path is FAIL-CLOSED. A deny-list that fails open is not a deny-list:
/// someone holding a revoked token would only have to wait for a blip.
/// </summary>
public sealed class ThrowingRefreshTokenRevocationStore : IRefreshTokenRevocationStore
{
    public Task RevokeAsync(string refreshToken, DateTimeOffset expiresAt, CancellationToken ct = default)
        => throw new InvalidOperationException("simulated revocation store outage");

    public Task<bool> IsRevokedAsync(string refreshToken, CancellationToken ct = default)
        => throw new InvalidOperationException("simulated revocation store outage");
}

/// <summary>Test <see cref="IGoogleTokenVerifier"/> — returns a preset result without calling
/// Google.</summary>
public sealed class FakeGoogleTokenVerifier : IGoogleTokenVerifier
{
    private readonly GoogleTokenResult _result;

    public FakeGoogleTokenVerifier(string email, string? sub = null, string? name = null)
        => _result = new GoogleTokenResult(GoogleTokenStatus.Valid, new GoogleUserInfo(email, name, sub));

    public FakeGoogleTokenVerifier(GoogleTokenResult result) => _result = result;

    public Task<GoogleTokenResult> VerifyAsync(string credential, CancellationToken ct = default)
        => Task.FromResult(_result);
}
