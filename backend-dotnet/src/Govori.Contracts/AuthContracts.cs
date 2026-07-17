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
/// Current-user projection returned by <c>GET /api/auth/me</c> AND <c>POST /api/auth/register</c>.
/// Subset of Python's <c>UserOut</c> (backend/app/schemas/auth.py:99). <c>Role</c> is the
/// lowercase PG enum label ("teacher"/"student"/"admin") read from the DB on every request —
/// never trusted from the JWT (docs/07 §7.5).
/// Serialized snake_case: <c>full_name</c> / <c>is_active</c> / <c>is_premium</c>.
/// </summary>
public sealed record MeResponse(Guid Id, string Email, string FullName, string Role, bool IsActive, bool IsPremium);

/// <summary>
/// Self-service sign-up body. Mirrors Python's <c>UserRegister</c>
/// (backend/app/schemas/auth.py:24). Always creates a STUDENT — there is no role field
/// (teacher accounts are admin-created). <c>Phone</c> is normalised server-side to
/// <c>+998XXXXXXXXX</c>; <c>EmailVerifyToken</c> is the proof-of-ownership token from
/// <c>/auth/email/verify-code</c> (required only when email verification is enabled).
/// <c>GroupCode</c> is an optional teacher referral code. Deserialized snake_case
/// (<c>full_name</c>, <c>email_verify_token</c>, <c>group_code</c>).
/// </summary>
public sealed record RegisterRequest(
    string Email,
    string Password,
    string FullName,
    string Phone,
    int Age,
    string Region,
    string District,
    string? EmailVerifyToken = null,
    string? GroupCode = null);

/// <summary>
/// Refresh-token exchange body. Mirrors Python's <c>RefreshRequest</c>
/// (backend/app/schemas/auth.py:88). JSON: <c>{ "refresh_token": ... }</c>.
/// </summary>
public sealed record RefreshRequest(string RefreshToken);

/// <summary>
/// Google Identity Services sign-in body. Mirrors Python's <c>GoogleAuth</c>
/// (backend/app/schemas/auth.py:92). <c>Credential</c> is the Google ID token (JWT);
/// <c>GroupCode</c> is an optional referral code. JSON: <c>{ "credential": ..., "group_code": ... }</c>.
/// </summary>
public sealed record GoogleAuthRequest(string Credential, string? GroupCode = null);

/// <summary>
/// Email-verification code request. Mirrors Python's <c>EmailCodeRequest</c>
/// (backend/app/schemas/auth.py:68). JSON: <c>{ "email": ... }</c>.
/// </summary>
public sealed record EmailCodeRequest(string Email);

/// <summary>
/// Email-verification code check. Mirrors Python's <c>EmailCodeVerify</c>
/// (backend/app/schemas/auth.py:72). JSON: <c>{ "email": ..., "code": ... }</c>.
/// </summary>
public sealed record EmailCodeVerifyRequest(string Email, string Code);

/// <summary>
/// Response of <c>/auth/email/request-code</c>. Mirrors Python's inline dict
/// <c>{ "ok": true, "expires_in": TTL }</c> (backend/app/api/v1/auth.py:85).
/// </summary>
public sealed record EmailCodeSentResponse(bool Ok, int ExpiresIn);

/// <summary>
/// Response of <c>/auth/email/verify-code</c>. Mirrors Python's <c>EmailVerifyToken</c>
/// (backend/app/schemas/auth.py:77). JSON: <c>{ "email_verify_token": ... }</c>.
/// </summary>
public sealed record EmailVerifyTokenResponse(string EmailVerifyToken);

/// <summary>
/// Response of <c>GET /auth/config</c>. Mirrors Python's inline dict
/// <c>{ "email_verification": ..., "google": ... }</c> (backend/app/api/v1/auth.py:64).
/// </summary>
public sealed record AuthConfigResponse(bool EmailVerification, bool Google);
