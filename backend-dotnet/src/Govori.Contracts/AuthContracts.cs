namespace Govori.Contracts;

// ─────────────────────────────────────────────────────────────────────────────
// PHONE-OTP AUTH (product decision: login by phone + OTP over Telegram; email is
// removed from the auth flow entirely). This DELIBERATELY deviates from the faithful
// Python port. There is no email/password login and no self-service email register:
// a single OTP round-trip (request → verify) both logs an existing phone in AND
// registers a new one. Email still exists as a DB column (NOT NULL + UNIQUE), so a
// phone user gets a derived placeholder `{+998XXXXXXXXX}@govori.uz` and a NULL
// password_hash (passwordless). All bodies (de)serialize snake_case.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Access + refresh token pair. Mirrors Python's <c>TokenPair</c>
/// (backend/app/schemas/auth.py): serialized snake_case as
/// <c>access_token</c> / <c>refresh_token</c> / <c>token_type</c> (default "bearer").
/// </summary>
public sealed record TokenResponse(string AccessToken, string RefreshToken, string TokenType = "bearer");

/// <summary>
/// Current-user projection returned by <c>GET /api/auth/me</c> AND the register branch of
/// <c>POST /api/auth/otp/verify</c>. Subset of Python's <c>UserOut</c>. <c>Role</c> is the
/// lowercase PG enum label ("teacher"/"student"/"admin") read from the DB on every request —
/// never trusted from the JWT (docs/07 §7.5). For a phone user <c>Email</c> is the derived
/// placeholder <c>{+998XXXXXXXXX}@govori.uz</c>. Serialized snake_case: <c>full_name</c> /
/// <c>is_active</c> / <c>is_premium</c>. <c>Region</c> / <c>District</c> / <c>Address</c> are the
/// registration "Manzil" (address) fields — nullable, absent on legacy rows.
/// </summary>
public sealed record MeResponse(
    Guid Id, string Email, string FullName, string Role, bool IsActive, bool IsPremium,
    string? Region = null, string? District = null, string? Address = null);

/// <summary>
/// Partial profile update body for <c>PATCH /api/auth/me</c> (auth-required). All fields are
/// optional: only the NON-NULL ones are written, so a request may carry just the address bits.
/// Feeds the registration "Manzil" step (region/district/address). JSON: <c>{ "region": "...",
/// "district": "...", "address": "..." }</c> — snake_case in/out.
/// </summary>
public sealed record UpdateProfileRequest(string? Region = null, string? District = null, string? Address = null);

/// <summary>
/// Refresh-token exchange body. Mirrors Python's <c>RefreshRequest</c>
/// (backend/app/schemas/auth.py:88). JSON: <c>{ "refresh_token": ... }</c>.
/// </summary>
public sealed record RefreshRequest(string RefreshToken);

/// <summary>
/// Google Identity Services sign-in body. Mirrors Python's <c>GoogleAuth</c>. <c>Credential</c>
/// is the Google ID token (JWT); <c>GroupCode</c> is an optional referral code. Google sign-in
/// is retained alongside phone-OTP. JSON: <c>{ "credential": ..., "group_code": ... }</c>.
/// </summary>
public sealed record GoogleAuthRequest(string Credential, string? GroupCode = null);

/// <summary>
/// Request an OTP for a phone number. <c>Phone</c> is normalised server-side to
/// <c>+998XXXXXXXXX</c> (via <c>PhoneNumbers.NormalizeUz</c>). Sending an OTP NEVER reveals
/// whether the phone already has an account — the same response is returned either way.
/// JSON: <c>{ "phone": "+998901112233" }</c>.
/// </summary>
public sealed record OtpRequestRequest(string Phone);

/// <summary>
/// Response of <c>POST /api/auth/otp/request</c>. <c>Delivery</c> is <c>"telegram_bot"</c> (a real
/// bot is configured) or <c>"dev"</c> (no bot — the code is only logged and the fixed dev code
/// <c>000000</c> is accepted on verify). In bot delivery, <c>TelegramLink</c> is the
/// <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link the UI shows as an "Open Telegram" button
/// (the bot DMs the code once the user presses Start). In dev delivery, <c>DevHint</c> is the code
/// to type (<c>000000</c>) and <c>TelegramLink</c> is null. JSON (bot): <c>{ "ok": true,
/// "delivery": "telegram_bot", "expires_in": 600, "telegram_link": "https://t.me/&lt;bot&gt;?start=&lt;token&gt;" }</c>;
/// JSON (dev): <c>{ "ok": true, "delivery": "dev", "expires_in": 600, "dev_hint": "000000" }</c>.
/// </summary>
public sealed record OtpSentResponse(
    bool Ok, string Delivery, int ExpiresIn, string? TelegramLink = null, string? DevHint = null);

/// <summary>
/// Verify an OTP and log in OR register. <c>Phone</c> is normalised server-side; <c>Code</c> is
/// the OTP the user received (or <c>000000</c> in dev). <c>FullName</c> is required ONLY to
/// register a phone that has no account yet — omit it and the server replies
/// <see cref="NeedsRegistrationResponse"/> so the UI can show the name field, then retry with it.
/// JSON: <c>{ "phone": "+998901112233", "code": "123456", "full_name": "Ali Valiyev" }</c>.
/// </summary>
public sealed record OtpVerifyRequest(string Phone, string Code, string? FullName = null);

/// <summary>
/// The "need more info" outcome of <c>POST /api/auth/otp/verify</c>: the OTP was valid but the
/// phone has no account and no <c>full_name</c> was supplied. Returned with HTTP 200 so the UI
/// can prompt for the name and re-verify. JSON: <c>{ "needs_registration": true }</c>. (The
/// login/register success branch returns a <see cref="TokenResponse"/> instead.)
/// </summary>
public sealed record NeedsRegistrationResponse(bool NeedsRegistration = true);

/// <summary>
/// Response of <c>GET /api/auth/config</c> — public client config. <c>Google</c> is whether
/// Google sign-in is configured; <c>OtpDelivery</c> is the active OTP channel
/// (<c>"telegram"</c> or <c>"dev"</c>). Email verification is gone from the auth flow, so it is
/// no longer reported. JSON: <c>{ "google": true, "otp_delivery": "telegram" }</c>.
/// </summary>
public sealed record AuthConfigResponse(bool Google, string OtpDelivery);
