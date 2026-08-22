namespace Govori.Identity.Providers;

/// <summary>
/// The deny-list that makes <c>POST /api/auth/logout</c> mean something.
///
/// <para><b>The hole this closes.</b> JWTs are stateless: until now logout returned 204 and did
/// nothing at all, so a refresh token kept working for its full lifetime after the user pressed
/// "Chiqish". Someone who logged out on a borrowed phone believed they were safe while the session
/// on it stayed live, and a token copied off a device could not be cut off at all. The access token
/// expires in 30 minutes, but the refresh token behind it does not — that is the window.</para>
///
/// <para><b>Per-token, not per-user.</b> Revocation is keyed by the token itself, so pressing logout
/// on one phone ends THAT session and leaves the tablet alone — which is what a logout button means
/// to the person pressing it. The alternative (a per-user "everything before now is invalid" stamp)
/// would be simpler but would sign the user out everywhere, and would need a schema change on a
/// database that carries live production rows.</para>
///
/// <para><b>Tokens are keyed by HASH, never stored.</b> A refresh token is a bearer credential; a
/// deny-list holding them verbatim would turn a Redis dump into a pile of working logins. The key is
/// a SHA-256 of the token, which is enough to recognise one we have seen and useless to anyone who
/// steals the list. See <see cref="RefreshTokenKeys"/>.</para>
///
/// <para><b>FAIL-CLOSED, like <see cref="IOtpStore"/> and unlike the rate limiter.</b> If the store
/// cannot answer, the refresh is refused. The reasoning is that a deny-list which fails OPEN is not
/// a deny-list — an attacker holding a revoked token only has to wait for (or cause) a Redis blip
/// for it to work again. The availability cost is bounded and consistent: OTP verification is
/// already fail-closed, so a Redis outage means nobody can log in either way. It makes authentication
/// uniformly unavailable rather than selectively wrong.</para>
/// </summary>
public interface IRefreshTokenRevocationStore
{
    /// <summary>
    /// Mark <paramref name="refreshToken"/> as no longer usable, until <paramref name="expiresAt"/>.
    ///
    /// <para>The entry's lifetime is the token's OWN remaining lifetime: once the JWT expires it is
    /// refused by signature validation anyway, so holding the deny-list row any longer would grow
    /// the list forever to protect against nothing. A token that has already expired needs no entry
    /// at all.</para>
    /// </summary>
    Task RevokeAsync(string refreshToken, DateTimeOffset expiresAt, CancellationToken ct = default);

    /// <summary>
    /// Whether <paramref name="refreshToken"/> has been revoked. Throws if the store cannot answer —
    /// the caller turns that into a refused refresh (fail-closed); it must never be reported as
    /// "not revoked".
    /// </summary>
    Task<bool> IsRevokedAsync(string refreshToken, CancellationToken ct = default);
}
