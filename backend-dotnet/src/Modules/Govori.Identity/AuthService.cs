using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Identity;

/// <summary>
/// Application service for the Identity vertical slice (docs/07 §7.2 — keeps the API thin).
///
/// <para>PRODUCT DECISION (deliberate deviation from the Python port): auth is PHONE + OTP over
/// Telegram. There is no email/password login and no email verification. A single OTP round-trip
/// both logs an existing phone in and registers a new one. Email survives only as a DB column
/// (NOT NULL + UNIQUE): a phone user gets the derived placeholder <c>{+998…}@govori.uz</c> and a
/// NULL <c>password_hash</c> (passwordless). Google sign-in (email-keyed) is retained unchanged.</para>
///
/// Consumes the auth primitives (<see cref="TokenService"/>; <see cref="PasswordHasher"/> is no
/// longer called by the phone flow but stays a registered primitive), the OTP seams
/// (<see cref="IOtpStore"/>, <see cref="IOtpDeliverySender"/>), <see cref="IGoogleTokenVerifier"/>,
/// and <see cref="GovoriDbContext"/> as-is.
/// </summary>
public sealed class AuthService
{
    private readonly GovoriDbContext _db;
    private readonly TokenService _tokenService;
    private readonly IOtpStore _otpStore;
    private readonly IOtpDeliverySender _otpDelivery;
    private readonly IGoogleTokenVerifier _googleVerifier;
    private readonly OtpOptions _otpOptions;

    public AuthService(
        GovoriDbContext db,
        TokenService tokenService,
        IOtpStore otpStore,
        IOtpDeliverySender otpDelivery,
        IGoogleTokenVerifier googleVerifier,
        OtpOptions otpOptions)
    {
        _db = db;
        _tokenService = tokenService;
        _otpStore = otpStore;
        _otpDelivery = otpDelivery;
        _googleVerifier = googleVerifier;
        _otpOptions = otpOptions;
    }

    /// <summary>
    /// Step 1 of phone-OTP auth: normalise the phone, generate + store a code in Redis, and hand it
    /// to the delivery sender (Telegram in prod, a logging stub in dev). This NEVER reveals whether
    /// the phone already has an account — the same "sent" result is returned either way, so it is
    /// safe to call before knowing if the user exists. The dev bypass code is echoed as
    /// <c>DevHint</c> only when delivery is the dev stub.
    /// </summary>
    public async Task<OtpRequestResult> RequestOtpAsync(string rawPhone, CancellationToken ct = default)
    {
        string phone;
        try
        {
            phone = PhoneNumbers.NormalizeUz(rawPhone);
        }
        catch (FormatException ex)
        {
            return new OtpRequestResult(OtpRequestStatus.InvalidPhone, Error: ex.Message);
        }

        var code = await _otpStore.GenerateAndStoreAsync(phone, ct);
        var delivery = await _otpDelivery.SendAsync(phone, code, ct);

        var devHint = _otpDelivery.Channel == "dev" ? DevOtpDeliverySender.FixedDevCode : null;
        return new OtpRequestResult(
            OtpRequestStatus.Sent, _otpDelivery.Channel, _otpOptions.TtlSeconds, devHint, delivery.TelegramLink);
    }

    /// <summary>
    /// Step 2 of phone-OTP auth: verify the code, then log in / register / ask for a name.
    /// <list type="bullet">
    ///   <item>A user with this phone EXISTS + active → <b>login</b> (tokens).</item>
    ///   <item>No user + <paramref name="fullName"/> given → <b>register</b> a passwordless STUDENT
    ///         (email = <c>{phone}@govori.uz</c>, password_hash NULL) then issue tokens.</item>
    ///   <item>No user + no name → <see cref="OtpVerifyStatus.NeedsRegistration"/> so the UI can
    ///         collect the name and re-verify.</item>
    /// </list>
    ///
    /// <para><b>FAIL-CLOSED:</b> the Redis check denies on any store failure. The ONLY way to pass
    /// without a Redis match is the dev bypass (<see cref="IOtpDeliverySender.AcceptsDevCode"/>),
    /// which the real Telegram sender always refuses — so <c>000000</c> can never work in prod.</para>
    /// </summary>
    public async Task<OtpVerifyOutcome> VerifyOtpAsync(
        string rawPhone, string code, string? fullName, CancellationToken ct = default)
    {
        string phone;
        try
        {
            phone = PhoneNumbers.NormalizeUz(rawPhone);
        }
        catch (FormatException ex)
        {
            return new OtpVerifyOutcome(OtpVerifyStatus.InvalidPhone, Error: ex.Message);
        }

        if (!await VerifyCodeAsync(phone, code, ct))
            return new OtpVerifyOutcome(OtpVerifyStatus.InvalidCode);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Phone == phone, ct);
        if (user is not null)
        {
            if (!user.IsActive)
                return new OtpVerifyOutcome(OtpVerifyStatus.Inactive, Role: user.Role);
            return new OtpVerifyOutcome(OtpVerifyStatus.LoggedIn, MintPair(user));
        }

        // New phone. Without a name we can't create the account — ask the UI for it.
        var name = (fullName ?? string.Empty).Trim();
        if (name.Length == 0)
            return new OtpVerifyOutcome(OtpVerifyStatus.NeedsRegistration);

        var created = new User
        {
            Id = Guid.NewGuid(),                 // Id is ValueGeneratedNever → set client-side (uuid4)
            Phone = phone,                       // normalised +998XXXXXXXXX
            Email = $"{phone}@govori.uz",        // email is NOT NULL + UNIQUE — derive a placeholder
            PasswordHash = null,                 // passwordless — phone users authenticate by OTP only
            FullName = name,
            Role = UserRole.Student,             // self-service sign-up is always a student
            IsActive = true,                     // no DB default on is_active — set explicitly
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.Users.Add(created);
        await _db.SaveChangesAsync(ct);

        return new OtpVerifyOutcome(OtpVerifyStatus.Registered, MintPair(created));
    }

    /// <summary>Dev bypass first (dev-only, gated by the sender), else the fail-closed Redis check.</summary>
    private async Task<bool> VerifyCodeAsync(string phone, string code, CancellationToken ct)
    {
        // The dev stub accepts a fixed code; the real Telegram sender never does. This is the ONLY
        // path that skips Redis, so it can only ever pass in dev delivery.
        if (_otpDelivery.AcceptsDevCode(code))
            return true;

        try
        {
            return await _otpStore.VerifyAsync(phone, code, ct);
        }
        catch (OperationCanceledException)
        {
            throw; // genuine cancellation is not a verification decision
        }
        catch
        {
            return false; // fail-closed: a broken store denies, never approves
        }
    }

    /// <summary>
    /// Exchange a refresh token for a fresh access + refresh pair. Mirrors Python's
    /// <c>refresh</c> (auth.py:211-219): the token <c>type</c> MUST be <c>refresh</c>. Like
    /// Python this does NOT re-read the user or re-check <c>is_active</c> — it blindly
    /// re-mints from the token subject.
    /// </summary>
    public TokenResponse? Refresh(string refreshToken)
    {
        var data = _tokenService.Decode(refreshToken);
        if (data is null
            || !data.TryGetValue("type", out var type) || type != "refresh"
            || !data.TryGetValue("sub", out var sub) || string.IsNullOrEmpty(sub))
        {
            return null;
        }
        return new TokenResponse(
            _tokenService.CreateAccessToken(sub),
            _tokenService.CreateRefreshToken(sub));
    }

    /// <summary>
    /// Sign in (or sign up) with a Google ID token. Mirrors Python's <c>google_auth</c>
    /// (auth.py:176-207): verify the token, then find-or-create a STUDENT keyed by email.
    /// An existing blocked account is rejected (403); a missing <c>google_sub</c> is
    /// back-filled. Retained unchanged alongside phone-OTP.
    /// </summary>
    public async Task<GoogleAuthOutcome> GoogleAsync(string credential, string? groupCode, CancellationToken ct = default)
    {
        var verified = await _googleVerifier.VerifyAsync(credential, ct);
        switch (verified.Status)
        {
            case GoogleTokenStatus.NotConfigured:
                return new GoogleAuthOutcome(GoogleAuthStatus.NotConfigured);
            case GoogleTokenStatus.Unreachable:
                return new GoogleAuthOutcome(GoogleAuthStatus.Unreachable);
            case GoogleTokenStatus.Invalid:
                return new GoogleAuthOutcome(GoogleAuthStatus.InvalidToken);
        }

        var info = verified.User!;
        var email = info.Email.ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        if (user is null)
        {
            user = new User
            {
                Id = Guid.NewGuid(),
                Email = email,
                PasswordHash = null,           // Google accounts have no local password
                FullName = string.IsNullOrWhiteSpace(info.Name) ? email.Split('@')[0] : info.Name!,
                Role = UserRole.Student,
                GoogleSub = info.Sub,
                IsActive = true,
                IsPremium = false,
                PreferredLanguage = "uz",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);
            // TODO(groups domain): group_code referral auto-join lands with the Groups module.
        }
        else
        {
            if (!user.IsActive)
                return new GoogleAuthOutcome(GoogleAuthStatus.Blocked);
            if (string.IsNullOrEmpty(user.GoogleSub) && !string.IsNullOrEmpty(info.Sub))
            {
                user.GoogleSub = info.Sub;
                await _db.SaveChangesAsync(ct);
            }
        }

        return new GoogleAuthOutcome(GoogleAuthStatus.Success, MintPair(user));
    }

    /// <summary>
    /// Resolve the current user for a validated token subject. Mirrors Python's
    /// <c>get_current_user</c> (deps.py:15-33): <c>role</c> and <c>is_active</c> are read
    /// FROM THE DB on every request, never from the token. A missing or inactive user is a
    /// failure (<c>null</c> → 401 at the endpoint).
    /// </summary>
    public async Task<MeResponse?> GetMeAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;
        return Project(user);
    }

    /// <summary>
    /// Apply a partial profile update (region / district / address) to the authenticated user and
    /// return the refreshed <see cref="MeResponse"/>. Only NON-NULL fields are written (a null field
    /// is "leave unchanged"); a supplied-but-blank value clears the column. Backs the registration
    /// "Manzil" step. A missing or inactive user yields <c>null</c> → 401 at the endpoint.
    /// </summary>
    public async Task<MeResponse?> UpdateProfileAsync(Guid userId, UpdateProfileRequest req, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;

        if (req.Region is not null) user.Region = Normalize(req.Region);
        if (req.District is not null) user.District = Normalize(req.District);
        if (req.Address is not null) user.Address = Normalize(req.Address);
        user.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Project(user);
    }

    // Trim; a blank (whitespace-only) value clears the column back to NULL.
    private static string? Normalize(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private TokenResponse MintPair(User user)
    {
        var subject = user.Id.ToString();
        return new TokenResponse(
            _tokenService.CreateAccessToken(subject),
            _tokenService.CreateRefreshToken(subject));
    }

    // Role → lowercase PG enum label ("teacher"/"student"/"admin"), matching the Python
    // str-enum JSON value. Read straight off the DB entity, never from the token.
    private static MeResponse Project(User user)
        => new(user.Id, user.Email, user.FullName, user.Role.ToString().ToLowerInvariant(), user.IsActive, user.IsPremium,
            user.Region, user.District, user.Address);
}
