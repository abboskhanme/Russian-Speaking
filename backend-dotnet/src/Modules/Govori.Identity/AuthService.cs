using Govori.Contracts;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Govori.Identity;

/// <summary>
/// Application service for the Identity vertical slice (docs/07 §7.2 — keeps the API
/// thin). Owns the login/me behaviour ported from backend/app/api/v1/auth.py +
/// backend/app/api/deps.py, consuming the auth primitives (<see cref="PasswordHasher"/>,
/// <see cref="TokenService"/>) and <see cref="GovoriDbContext"/> as-is.
/// </summary>
public sealed class AuthService
{
    private readonly GovoriDbContext _db;
    private readonly PasswordHasher _passwordHasher;
    private readonly TokenService _tokenService;

    public AuthService(GovoriDbContext db, PasswordHasher passwordHasher, TokenService tokenService)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
    }

    /// <summary>
    /// Authenticate by email + password. Mirrors Python's <c>login</c>: an unknown email,
    /// an OAuth-only account (NULL <c>password_hash</c>) and a wrong password are all
    /// indistinguishable failures — return <c>null</c> (no token). On success mint an
    /// access + refresh pair whose subject is the user id.
    /// </summary>
    public async Task<TokenResponse?> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        // Verify() null-checks the hash first, so a NULL password_hash (Google/OAuth
        // account) safely fails instead of throwing — matching Python's
        // `user.password_hash is None or not verify_password(...)`.
        if (user is null || !_passwordHasher.Verify(password, user.PasswordHash))
            return null;

        var subject = user.Id.ToString();
        return new TokenResponse(
            _tokenService.CreateAccessToken(subject),
            _tokenService.CreateRefreshToken(subject));
    }

    /// <summary>
    /// Resolve the current user for a validated token subject. Mirrors Python's
    /// <c>get_current_user</c> (deps.py §7.5): <c>role</c> and <c>is_active</c> are read
    /// FROM THE DB on every request, never from the token. A missing or inactive user is a
    /// failure (<c>null</c> → 401 at the endpoint).
    /// </summary>
    public async Task<MeResponse?> GetMeAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        // Role → lowercase PG enum label ("teacher"/"student"/"admin"), matching the
        // Python str-enum JSON value. Read straight off the DB entity.
        return new MeResponse(
            user.Id,
            user.Email,
            user.FullName,
            user.Role.ToString().ToLowerInvariant(),
            user.IsActive,
            user.IsPremium);
    }
}
