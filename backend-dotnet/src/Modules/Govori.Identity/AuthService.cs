using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Identity;

/// <summary>
/// Application service for the Identity vertical slice (docs/07 §7.2 — keeps the API
/// thin). Owns the full auth behaviour ported from backend/app/api/v1/auth.py +
/// backend/app/api/deps.py, consuming the auth primitives (<see cref="PasswordHasher"/>,
/// <see cref="TokenService"/>), the external-provider interfaces
/// (<see cref="IOtpStore"/>, <see cref="IOtpSender"/>, <see cref="IGoogleTokenVerifier"/>)
/// and <see cref="GovoriDbContext"/> as-is.
/// </summary>
public sealed class AuthService
{
    private readonly GovoriDbContext _db;
    private readonly PasswordHasher _passwordHasher;
    private readonly TokenService _tokenService;
    private readonly IOtpStore _otpStore;
    private readonly IOtpSender _otpSender;
    private readonly IGoogleTokenVerifier _googleVerifier;
    private readonly OtpOptions _otpOptions;

    public AuthService(
        GovoriDbContext db,
        PasswordHasher passwordHasher,
        TokenService tokenService,
        IOtpStore otpStore,
        IOtpSender otpSender,
        IGoogleTokenVerifier googleVerifier,
        OtpOptions otpOptions)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _otpStore = otpStore;
        _otpSender = otpSender;
        _googleVerifier = googleVerifier;
        _otpOptions = otpOptions;
    }

    /// <summary>
    /// Authenticate by email + password. Mirrors Python's <c>login</c>
    /// (auth.py:147-168): an unknown email, an OAuth-only account (NULL <c>password_hash</c>)
    /// and a wrong password are all indistinguishable 401 failures. The
    /// <c>is_active</c> check runs AFTER password verification, exactly like Python — so an
    /// inactive user with the WRONG password still gets 401, not 403.
    /// </summary>
    public async Task<LoginResult> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        // Verify() null-checks the hash first, so a NULL password_hash safely fails.
        if (user is null || !_passwordHasher.Verify(password, user.PasswordHash))
            return new LoginResult(LoginStatus.InvalidCredentials, null, null);

        if (!user.IsActive)
            return new LoginResult(LoginStatus.Inactive, null, user.Role);

        return new LoginResult(LoginStatus.Success, MintPair(user), user.Role);
    }

    /// <summary>
    /// Self-service sign-up. Mirrors Python's <c>register</c> (auth.py:106-139): validates
    /// the profile fields (422), enforces the email-verify token when verification is
    /// enabled (400), rejects a duplicate email (409), then creates an active STUDENT.
    /// </summary>
    public async Task<RegisterResult> RegisterAsync(RegisterRequest req, CancellationToken ct = default)
    {
        // Field validation — mirrors the pydantic validators on UserRegister (→ 422).
        string phone;
        try
        {
            phone = PhoneNumbers.NormalizeUz(req.Phone);
        }
        catch (FormatException ex)
        {
            return new RegisterResult(RegisterStatus.InvalidInput, Error: ex.Message);
        }
        if (req.Age < 5 || req.Age > 100)
            return new RegisterResult(RegisterStatus.InvalidInput, Error: "Yoshni to'g'ri kiriting");
        var region = (req.Region ?? string.Empty).Trim();
        var district = (req.District ?? string.Empty).Trim();
        if (region.Length == 0 || district.Length == 0)
            return new RegisterResult(RegisterStatus.InvalidInput, Error: "Manzilni tanlang");

        // When email verification is enabled, require a valid email_verify token whose
        // subject is this (lower-cased) email — mirrors auth.py:109-116.
        if (_otpOptions.EmailVerificationEnabled)
        {
            var data = _tokenService.Decode(req.EmailVerifyToken ?? string.Empty);
            if (data is null
                || !data.TryGetValue("type", out var type) || type != "email_verify"
                || !data.TryGetValue("sub", out var sub) || sub != req.Email.ToLowerInvariant())
            {
                return new RegisterResult(RegisterStatus.EmailNotVerified, Error: "Email tasdiqlanmagan");
            }
        }

        if (await _db.Users.AnyAsync(u => u.Email == req.Email, ct))
            return new RegisterResult(RegisterStatus.EmailTaken, Error: "Email already registered");

        var user = new User
        {
            Id = Guid.NewGuid(),               // Id is ValueGeneratedNever → set client-side (uuid4)
            Email = req.Email,                 // Python stores the email as typed (token check uses .lower())
            PasswordHash = _passwordHasher.Hash(req.Password),
            FullName = req.FullName,
            Phone = phone,                     // normalised to +998XXXXXXXXX
            Age = req.Age,
            Region = region,
            District = district,
            Role = UserRole.Student,           // self-service sign-up is always a student
            IsActive = true,                   // no DB default on is_active — set explicitly
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);

        // TODO(groups domain): Python auto-joins the teacher's group when a `group_code` is
        // present (auth.py:136-138 → groups.add_member_by_code). That touches Group /
        // GroupMember / notifications, which land with the Groups module — deferred here.

        return new RegisterResult(RegisterStatus.Success, Project(user));
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
    /// back-filled.
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
    /// Issue an email-verification code. Mirrors Python's <c>request_email_code</c>
    /// (auth.py:78-85): reject an already-registered email (409), else generate + send a
    /// code and report the TTL.
    /// </summary>
    public async Task<EmailCodeRequestResult> RequestEmailCodeAsync(string email, CancellationToken ct = default)
    {
        email = email.ToLowerInvariant();
        if (await _db.Users.AnyAsync(u => u.Email == email, ct))
            return new EmailCodeRequestResult(EmailCodeRequestStatus.EmailTaken, 0);

        var code = await _otpStore.GenerateAndStoreAsync(email, ct);
        await _otpSender.SendOtpAsync(email, code, ct);
        return new EmailCodeRequestResult(EmailCodeRequestStatus.Sent, _otpOptions.TtlSeconds);
    }

    /// <summary>
    /// Check an email-verification code and, on success, mint the short-lived
    /// <c>email_verify</c> token. Mirrors Python's <c>verify_email_code</c> (auth.py:93-97):
    /// returns <c>null</c> (→ 400) when the code is wrong/expired.
    ///
    /// <para><b>FAIL-CLOSED:</b> any OTP-store failure (e.g. Redis down) is treated as a
    /// denied verification — we NEVER let an unverifiable code through.</para>
    /// </summary>
    public async Task<string?> VerifyEmailCodeAsync(string email, string code, CancellationToken ct = default)
    {
        bool ok;
        try
        {
            ok = await _otpStore.VerifyAsync(email, code, ct);
        }
        catch (OperationCanceledException)
        {
            throw; // genuine cancellation is not a verification decision
        }
        catch
        {
            ok = false; // fail-closed: a broken store denies, never approves
        }

        return ok ? _tokenService.CreateEmailVerifyToken(email) : null;
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
        => new(user.Id, user.Email, user.FullName, user.Role.ToString().ToLowerInvariant(), user.IsActive, user.IsPremium);
}
