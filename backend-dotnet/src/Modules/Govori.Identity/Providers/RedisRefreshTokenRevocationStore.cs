using System.Security.Cryptography;
using System.Text;
using StackExchange.Redis;

namespace Govori.Identity.Providers;

/// <summary>
/// Redis key derivation for the refresh-token deny-list.
///
/// <para>The token is hashed, never stored. A refresh token is a bearer credential: a deny-list
/// holding them verbatim would mean anyone who could read the Redis keyspace — a dump, a misconfigured
/// bind address, a support export — would be holding a stack of working logins, which is a strictly
/// worse position than the one revocation exists to improve. SHA-256 is the right primitive here
/// rather than a password hash: the input is a long, high-entropy, server-generated JWT, so there is
/// nothing to brute-force and a deliberately slow hash would only add latency to every refresh.</para>
/// </summary>
public static class RefreshTokenKeys
{
    private const string Prefix = "auth:revoked_rt:";

    /// <summary>The deny-list key for one refresh token: <c>auth:revoked_rt:{sha256-hex}</c>.</summary>
    public static string Revoked(string refreshToken)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken ?? string.Empty));
        return Prefix + Convert.ToHexString(digest).ToLowerInvariant();
    }
}

/// <summary>
/// The real <see cref="IRefreshTokenRevocationStore"/>, over the same
/// <see cref="IConnectionMultiplexer"/> the OTP store already uses.
///
/// <para>Both operations let a Redis failure PROPAGATE rather than swallowing it, exactly like
/// <see cref="RedisOtpStore"/>: the fail-closed decision belongs to the caller
/// (<c>AuthService.RefreshAsync</c>), and keeping the throw here is what lets a test inject a
/// throwing store and prove that a refresh is refused when the deny-list cannot be read.</para>
/// </summary>
public sealed class RedisRefreshTokenRevocationStore : IRefreshTokenRevocationStore
{
    private readonly IConnectionMultiplexer _redis;

    public RedisRefreshTokenRevocationStore(IConnectionMultiplexer redis) => _redis = redis;

    public async Task RevokeAsync(string refreshToken, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        // An already-expired token is refused by signature validation anyway; an entry for it would
        // be a row that protects nothing and still has to be stored.
        var ttl = expiresAt - DateTimeOffset.UtcNow;
        if (ttl <= TimeSpan.Zero)
            return;

        // The VALUE is deliberately meaningless — presence is the whole signal. Storing anything
        // about the user here would put identity data behind a key derived from a credential.
        await _redis.GetDatabase().StringSetAsync(RefreshTokenKeys.Revoked(refreshToken), "1", ttl);
    }

    public async Task<bool> IsRevokedAsync(string refreshToken, CancellationToken ct = default)
        => await _redis.GetDatabase().KeyExistsAsync(RefreshTokenKeys.Revoked(refreshToken));
}
