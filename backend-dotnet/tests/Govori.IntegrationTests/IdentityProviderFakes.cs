using System.Collections.Concurrent;
using Govori.Identity.Providers;

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

/// <summary>Test <see cref="IOtpSender"/> — captures the last code per email instead of
/// sending anything.</summary>
public sealed class FakeOtpSender : IOtpSender
{
    private readonly ConcurrentDictionary<string, string> _sent = new(StringComparer.OrdinalIgnoreCase);

    public Task SendOtpAsync(string email, string code, CancellationToken ct = default)
    {
        _sent[email] = code;
        return Task.CompletedTask;
    }

    public string? LastCodeFor(string email) => _sent.TryGetValue(email, out var c) ? c : null;
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
