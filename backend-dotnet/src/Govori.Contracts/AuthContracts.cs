namespace Govori.Contracts;

// ─────────────────────────────────────────────────────────────────────────────
// PHONE-OTP AUTH (product decision: login by phone + OTP over Telegram; email is
// removed from the auth flow entirely). There is no email/password login and no
// self-service email register:
// a single OTP round-trip (request → verify) both logs an existing phone in AND
// registers a new one. Email still exists as a DB column (NOT NULL + UNIQUE), so a
// phone user gets a derived placeholder `{+998XXXXXXXXX}@govori.uz` and a NULL
// password_hash (passwordless). All bodies (de)serialize snake_case.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Access + refresh token pair. Serialized snake_case as
/// <c>access_token</c> / <c>refresh_token</c> / <c>token_type</c> (default "bearer").
/// </summary>
public sealed record TokenResponse(string AccessToken, string RefreshToken, string TokenType = "bearer");

/// <summary>
/// Current-user projection returned by <c>GET /api/auth/me</c> AND the register branch of
/// <c>POST /api/auth/otp/verify</c>. <c>Role</c> is the
/// lowercase PG enum label ("teacher"/"student"/"admin") read from the DB on every request —
/// never trusted from the JWT (docs/07 §7.5). For a phone user <c>Email</c> is the derived
/// placeholder <c>{+998XXXXXXXXX}@govori.uz</c>. Serialized snake_case: <c>full_name</c> /
/// <c>is_active</c> / <c>is_premium</c>. <c>Region</c> / <c>District</c> / <c>Address</c> are the
/// registration "Manzil" (address) fields — nullable, absent on legacy rows.
///
/// <para>APPEND-ONLY CONTRACT. The profile redesign added <c>Phone</c>, <c>CreatedAt</c>,
/// <c>Level</c> and <c>LevelLabel</c> at the END of the positional list so every existing consumer
/// (and every existing construction site) keeps working — members are never renamed, removed or
/// reordered. <c>Phone</c> and <c>CreatedAt</c> are read straight off the user row and back the
/// "Telefon" / "Ro'yxatdan o'tgan" rows of the Ma'lumot tab. <c>Level</c> / <c>LevelLabel</c> are
/// DERIVED (there is no level column — docs/07 §7.4 rule 3 forbids adding one): the student's
/// average <c>Evaluation.OverallBand</c> run through the shared <see cref="CefrScale"/>. With no
/// graded attempts both are <c>null</c> and the UI hides the badge.</para>
///
/// <para>APPEND-ONLY, again: <c>AvatarUrl</c> was added at the very END. It is the account photo's
/// PRESIGNED-GET url, minted on the fly from <c>User.AvatarKey</c> the same way a submission's
/// <c>audio_url</c> is minted from its audio key — so it is a short-lived download link, never a
/// stored column. It is <c>null</c> when the user has no avatar, and the UI then falls back to the
/// name initials. Because the url is signed per request, building this projection is async and
/// storage-dependent, unlike the rest of the row which reads straight off the user entity.</para>
/// </summary>
public sealed record MeResponse(
    Guid Id, string Email, string FullName, string Role, bool IsActive, bool IsPremium,
    string? Region = null, string? District = null, string? Address = null,
    string? Phone = null, DateTime CreatedAt = default,
    string? Level = null, string? LevelLabel = null,
    string? AvatarUrl = null,
    /// <summary>APPEND-ONLY, again: the notification preference. Defaults to <c>true</c> so a client
    /// reading an older response — or a row predating the column — behaves as it always did.</summary>
    bool NotificationsEnabled = true,
    /// <summary>The user's UI language (<c>uz</c> · <c>ru</c> · <c>en</c>). The column has existed
    /// since the baseline but nothing ever read or wrote it after registration, so the choice lived
    /// only in each device's <c>localStorage</c> and did not follow the account. This is what makes
    /// it an account setting.</summary>
    string PreferredLanguage = "uz");

/// <summary>
/// Partial profile update body for <c>PATCH /api/auth/me</c> (auth-required). All fields are
/// optional: only the NON-NULL ones are written, so a request may carry just the address bits.
/// Feeds the registration "Manzil" step (region/district/address) and the profile "Tahrirlash"
/// form. JSON: <c>{ "full_name": "...", "region": "...", "district": "...", "address": "..." }</c>
/// — snake_case in/out.
///
/// <para>APPEND-ONLY CONTRACT. <c>FullName</c> was added at the END of the positional list (no
/// member renamed, removed or reordered), so every existing construction site keeps compiling and
/// every existing client keeps working.</para>
///
/// <para><c>FullName</c> does NOT share the tri-state semantics of the address fields. Region /
/// District / Address are nullable columns, so a supplied-but-blank value legitimately CLEARS them.
/// <c>full_name</c> is NOT NULL and is rendered everywhere — avatar initials, "Salom, {name}" — so
/// a blank one is not a clear, it is a broken profile. Supplying a blank or whitespace-only name is
/// therefore rejected (400), not stored. It is also trimmed, capped at the column width
/// (<c>varchar(255)</c>) and refused if it carries control characters.</para>
/// </summary>
/// <para>APPEND-ONLY, like <see cref="MeResponse"/>. <c>NotificationsEnabled</c> was added at the END:
/// it is a genuine user PREFERENCE with a column behind it, so unlike the other fields here an
/// absent value means "leave it alone" and an explicit <c>false</c> means "turn it off". A nullable
/// bool is what makes those two distinguishable over JSON.</para>
public sealed record UpdateProfileRequest(
    string? Region = null, string? District = null, string? Address = null, string? FullName = null,
    bool? NotificationsEnabled = null, string? PreferredLanguage = null);

/// <summary>
/// Body of <c>POST /api/auth/phone/change/request</c> (auth-required) — start a verified change of
/// the CALLING user's phone number. <c>NewPhone</c> is normalised server-side to
/// <c>+998XXXXXXXXX</c> (via <c>PhoneNumbers.NormalizeUz</c>). JSON:
/// <c>{ "new_phone": "+998901112233" }</c>.
///
/// <para>Unlike <see cref="OtpRequestRequest"/>, this endpoint DOES reveal that a number is already
/// taken (409). That is deliberate and not a new leak: the caller is authenticated, and the
/// alternative — sending a code for a number that can never be claimed — is strictly worse, because
/// it walks the user through a full verification that is guaranteed to fail at the end.</para>
/// </summary>
public sealed record PhoneChangeRequestRequest(string NewPhone);

/// <summary>
/// Body of <c>POST /api/auth/phone/change/confirm</c> (auth-required) — finish the change started
/// by <see cref="PhoneChangeRequestRequest"/>. JSON: <c>{ "code": "123456" }</c>.
///
/// <para>There is deliberately NO phone field. The pending number is held server-side, keyed by the
/// calling user id, so the code can only ever be redeemed against the number THAT user asked for.
/// Accepting a phone from the client here would let a caller pair someone else's live code with an
/// arbitrary number.</para>
/// </summary>
public sealed record PhoneChangeConfirmRequest(string Code);

/// <summary>
/// Refresh-token exchange body. JSON: <c>{ "refresh_token": ... }</c>.
/// </summary>
public sealed record RefreshRequest(string RefreshToken);

/// <summary>
/// Google Identity Services sign-in body. <c>Credential</c>
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
///
/// <para>APPEND-ONLY CONTRACT. <c>RequestId</c> was added at the END of the positional list (no
/// member renamed, removed or reordered). It is a fresh random OPAQUE id that grants NOTHING — it
/// maps only to a delivery-state string, so it is safe in a query string. The client polls it at
/// <c>GET /api/auth/otp/status?request_id=…</c> to learn whether the bot actually delivered the
/// code, or refused because the Telegram account did not prove ownership of the phone. It is NOT
/// the deep-link token: that token is the secret and must never be used as the polling key.</para>
///
/// <para><c>TelegramMode</c> (also appended at the END) tells the client HOW the code is being
/// delivered over Telegram, so it can render the right UI:
/// <list type="bullet">
///   <item><c>"direct"</c> — the phone already has a proven Telegram binding, so the API DM'd the
///         code straight to the bound account(s). <c>TelegramLink</c> is the PLAIN bot URL
///         (<c>t.me/&lt;bot&gt;</c>) that just opens the chat to read the code — there is NO start
///         token and no ownership re-proof, so the client does NOT poll <c>otp/status</c>.</item>
///   <item><c>"deep_link"</c> — no binding yet, so <c>TelegramLink</c> is the
///         <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link; the user presses Start, shares
///         their contact to prove ownership, and the worker DMs the code. The client polls
///         <c>otp/status</c> to surface a mismatch.</item>
/// </list>
/// It is <c>null</c> for dev delivery (no Telegram step).</para>
/// </summary>
public sealed record OtpSentResponse(
    bool Ok, string Delivery, int ExpiresIn, string? TelegramLink = null, string? DevHint = null,
    string? RequestId = null, string? TelegramMode = null);

/// <summary>
/// Response of <c>GET /api/auth/otp/status?request_id=…</c> — where the OTP delivery for that
/// request currently stands. JSON: <c>{ "state": "pending" }</c>. States:
/// <list type="bullet">
///   <item><c>pending</c> — code minted; the user has not opened Telegram yet.</item>
///   <item><c>awaiting_contact</c> — the user pressed Start; the bot asked them to share their
///         contact so it can prove they own the number.</item>
///   <item><c>sent</c> — the code was delivered to a Telegram account that PROVED it owns the
///         requested phone (terminal success; the user reads it and TYPES it into the app).</item>
///   <item><c>mismatch</c> — the shared phone is not the requested phone. The code is BURNED
///         server-side; the UI must refuse to accept a code and offer "start over".</item>
///   <item><c>not_own_contact</c> — someone else's contact was forwarded. Code BURNED, same UI
///         treatment as <c>mismatch</c>.</item>
///   <item><c>expired</c> — unknown or timed-out request id.</item>
/// </list>
///
/// <para>SECURITY: an unknown id answers <c>expired</c> with HTTP <b>200</b>, never 404, so the
/// endpoint cannot be used to probe which request ids exist.</para>
/// </summary>
public sealed record OtpStatusResponse(string State);

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
