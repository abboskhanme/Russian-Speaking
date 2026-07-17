namespace Govori.Contracts;

/// <summary>
/// Login credentials. JSON body <c>{ "email": ..., "password": ... }</c>.
/// The Python API takes an OAuth2 form (username/password); the .NET slice takes a
/// JSON body per docs/07 §7.5 — the shape a JSON client sends.
/// </summary>
public sealed record LoginRequest(string Email, string Password);

/// <summary>
/// Access + refresh token pair. Mirrors Python's <c>TokenPair</c>
/// (backend/app/schemas/auth.py): serialized snake_case as
/// <c>access_token</c> / <c>refresh_token</c> / <c>token_type</c> (default "bearer").
/// </summary>
public sealed record TokenResponse(string AccessToken, string RefreshToken, string TokenType = "bearer");

/// <summary>
/// Current-user projection returned by <c>GET /api/auth/me</c>. Subset of Python's
/// <c>UserOut</c>. <c>Role</c> is the lowercase PG enum label ("teacher"/"student"/"admin")
/// read from the DB on every request — never trusted from the JWT (docs/07 §7.5).
/// Serialized snake_case: <c>full_name</c> / <c>is_active</c> / <c>is_premium</c>.
/// </summary>
public sealed record MeResponse(Guid Id, string Email, string FullName, string Role, bool IsActive, bool IsPremium);
