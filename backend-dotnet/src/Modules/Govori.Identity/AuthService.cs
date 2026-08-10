using Govori.Contracts;
using Govori.Identity.Providers;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.Identity;

/// <summary>
/// Application service for the Identity vertical slice (docs/07 §7.2 — keeps the API thin).
///
/// <para>PRODUCT DECISION: auth is PHONE + OTP over Telegram. There is no email/password login and
/// no email verification. A single OTP round-trip
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
    /// <summary>Cap for <c>full_name</c>, matching the <c>users.full_name varchar(255)</c> column.
    /// Enforced here so an over-long name is a clean 400 rather than a Postgres length error
    /// surfacing as a 500. Counting UTF-16 units is safe against a column that counts CHARACTERS:
    /// a surrogate pair is 2 here and 1 there, so this can only ever be stricter, never looser.</summary>
    private const int FullNameMaxLength = 255;

    /// <summary>The three UI languages the app ships (docs/08 §4.7). Kept as an allow-list rather
    /// than a length check because <c>preferred_language</c> is only 8 characters wide, so an
    /// unrecognised locale would be silently TRUNCATED by Postgres into something meaningless
    /// instead of failing loudly.</summary>
    private static readonly HashSet<string> SupportedLanguages =
        new(StringComparer.Ordinal) { "uz", "ru", "en" };

    /// <summary>Ceiling for an uploaded avatar. 5 MB is generous for a raster profile photo and small
    /// enough that a rejected upload never buffers anything large — the size is checked before the
    /// stream is ever handed to storage.</summary>
    private const long MaxAvatarBytes = 5L * 1024 * 1024;

    /// <summary>The ONLY accepted avatar content-types, mapped to their storage-key extension. Raster
    /// only, on purpose: <c>image/svg+xml</c> is NOT here because an SVG can carry script and would be
    /// a stored-XSS vector when the presigned url is opened. Anything not in this map is a 400.</summary>
    private static readonly IReadOnlyDictionary<string, string> AvatarContentTypes =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["image/jpeg"] = "jpg",
            ["image/png"] = "png",
            ["image/webp"] = "webp",
        };

    private readonly GovoriDbContext _db;
    private readonly TokenService _tokenService;
    private readonly IOtpStore _otpStore;
    private readonly IOtpDeliverySender _otpDelivery;
    private readonly IGoogleTokenVerifier _googleVerifier;
    private readonly OtpOptions _otpOptions;
    private readonly IPendingPhoneChangeStore _pendingPhoneChanges;
    private readonly IObjectStorage _storage;

    public AuthService(
        GovoriDbContext db,
        TokenService tokenService,
        IOtpStore otpStore,
        IOtpDeliverySender otpDelivery,
        IGoogleTokenVerifier googleVerifier,
        OtpOptions otpOptions,
        IPendingPhoneChangeStore pendingPhoneChanges,
        IObjectStorage storage)
    {
        _db = db;
        _tokenService = tokenService;
        _otpStore = otpStore;
        _otpDelivery = otpDelivery;
        _googleVerifier = googleVerifier;
        _otpOptions = otpOptions;
        _pendingPhoneChanges = pendingPhoneChanges;
        _storage = storage;
    }

    /// <summary>
    /// Step 1 of phone-OTP auth: normalise the phone, generate + store a code in Redis, and hand it
    /// to the delivery sender (Telegram in prod, a logging stub in dev). This NEVER reveals whether
    /// the phone already has an account — the same "sent" result is returned either way, so it is
    /// safe to call before knowing if the user exists. The dev bypass code is echoed as
    /// <c>DevHint</c> only when delivery is the dev stub.
    ///
    /// <para>Also mints the <c>request_id</c>: a fresh random OPAQUE id that grants nothing (it maps
    /// only to a delivery-state string) and is handed to the sender so bot delivery can seed the
    /// <c>pending</c> state and the Worker-side poller can report progress under it. It is returned
    /// to the client for <c>GET /api/auth/otp/status</c>. It is NOT the deep-link token — that token
    /// is the secret and must never leave the link.</para>
    ///
    /// <para>Because the id is minted UNCONDITIONALLY, before any user lookup, and its initial state
    /// is identical for every phone, it leaks nothing about whether an account exists — the
    /// "never reveal" property of this endpoint is preserved.</para>
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

        var requestId = Guid.NewGuid().ToString("N");
        var code = await _otpStore.GenerateAndStoreAsync(phone, ct);
        var delivery = await _otpDelivery.SendAsync(phone, code, requestId, ct);

        var devHint = _otpDelivery.Channel == "dev" ? DevOtpDeliverySender.FixedDevCode : null;
        return new OtpRequestResult(
            OtpRequestStatus.Sent, _otpDelivery.Channel, _otpOptions.TtlSeconds, devHint, delivery.TelegramLink,
            RequestId: requestId, TelegramMode: delivery.TelegramMode);
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

        return await CompleteLoginAsync(phone, fullName, ct);
    }

    /// <summary>
    /// The login-or-register tail reached by <see cref="VerifyOtpAsync"/> after the code check. By the
    /// time we are here the phone is PROVEN — the caller typed the right code — so this method does no
    /// verification of its own; it only decides what that proven phone yields:
    /// <list type="bullet">
    ///   <item>existing + active → <b>login</b> (tokens);</item>
    ///   <item>existing + inactive → <see cref="OtpVerifyStatus.Inactive"/> (teacher-awaiting vs blocked);</item>
    ///   <item>new phone + name → <b>register</b> a passwordless student (tokens);</item>
    ///   <item>new phone, no name → <see cref="OtpVerifyStatus.NeedsRegistration"/> so the UI can
    ///         collect the name and retry.</item>
    /// </list>
    /// Splitting it out is a pure refactor: the manual verify path runs exactly the same code it did
    /// when this was inlined.
    /// </summary>
    private async Task<OtpVerifyOutcome> CompleteLoginAsync(string phone, string? fullName, CancellationToken ct)
    {
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
    /// Exchange a refresh token for a fresh access + refresh pair. The token <c>type</c> MUST be
    /// <c>refresh</c>, so an access token cannot be used to extend a session.
    ///
    /// <para>CAVEAT: this does NOT re-read the user or re-check <c>is_active</c> — it re-mints
    /// purely from the token subject, so a blocked user can keep refreshing until their refresh
    /// token expires. The per-request user lookup is what actually stops them.</para>
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
    /// Sign in (or sign up) with a Google ID token: verify the token, then find-or-create a
    /// STUDENT keyed by email. An existing blocked account is rejected (403); a missing
    /// <c>google_sub</c> is back-filled. Retained alongside the phone-OTP flow.
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
    /// Resolve the current user for a validated token subject. <c>role</c> and <c>is_active</c>
    /// are read FROM THE DB on every request, never from the token, so a demotion or a block
    /// applies immediately. A missing or inactive user is a failure (<c>null</c> → 401 at the
    /// endpoint).
    /// </summary>
    public async Task<MeResponse?> GetMeAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return null;
        return await ProjectAsync(user, await DeriveLevelAsync(userId, ct), ct);
    }

    /// <summary>
    /// Apply a partial profile update (full name / region / district / address) to the authenticated
    /// user and return the refreshed <see cref="MeResponse"/>. Only NON-NULL fields are written (a
    /// null field is "leave unchanged"). Backs the registration "Manzil" step and the profile
    /// "Tahrirlash" form. A missing or inactive user yields
    /// <see cref="UpdateProfileStatus.Unauthorized"/> → 401 at the endpoint.
    ///
    /// <para>The two field groups have DIFFERENT blank semantics, on purpose. Region / District /
    /// Address are nullable columns, so a supplied-but-blank value CLEARS them — that is how a user
    /// un-sets an address. <c>full_name</c> is NOT NULL and is rendered on every screen, so a blank
    /// one is not a clear but a broken profile: it is
    /// <see cref="UpdateProfileStatus.InvalidFullName"/> → 400, never stored. The name is also
    /// trimmed, capped at <see cref="FullNameMaxLength"/> (the column width — over-long is a 400,
    /// not a Postgres error surfacing as a 500) and refused if it carries control characters, which
    /// no real name contains and which would smuggle newlines into every place it is rendered.</para>
    ///
    /// <para>The PHONE is deliberately NOT updatable here. It is identity, not profile text, and it
    /// changes only through the verified <c>phone/change/request</c> → <c>/confirm</c> flow.</para>
    /// </summary>
    public async Task<UpdateProfileOutcome> UpdateProfileAsync(Guid userId, UpdateProfileRequest req, CancellationToken ct = default)
    {
        // Validate BEFORE loading the user: a rejected name must leave nothing written.
        string? fullName = null;
        if (req.FullName is not null && !TryNormalizeFullName(req.FullName, out fullName))
        {
            return new UpdateProfileOutcome(
                UpdateProfileStatus.InvalidFullName, Error: "Ism va familiya noto'g'ri kiritilgan");
        }

        string? language = null;
        if (req.PreferredLanguage is not null)
        {
            language = req.PreferredLanguage.Trim().ToLowerInvariant();
            if (!SupportedLanguages.Contains(language))
            {
                return new UpdateProfileOutcome(
                    UpdateProfileStatus.InvalidLanguage, Error: "Til qo'llab-quvvatlanmaydi");
            }
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new UpdateProfileOutcome(UpdateProfileStatus.Unauthorized);

        if (fullName is not null) user.FullName = fullName;
        if (req.Region is not null) user.Region = Normalize(req.Region);
        if (req.District is not null) user.District = Normalize(req.District);
        if (req.Address is not null) user.Address = Normalize(req.Address);
        // A nullable bool, so an absent field leaves the preference alone while an explicit `false`
        // turns notifications OFF — over JSON those two are otherwise the same request.
        if (req.NotificationsEnabled is { } notifications) user.NotificationsEnabled = notifications;
        if (language is not null) user.PreferredLanguage = language;
        user.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return new UpdateProfileOutcome(
            UpdateProfileStatus.Updated, await ProjectAsync(user, await DeriveLevelAsync(userId, ct), ct));
    }

    /// <summary>
    /// Set (or replace) the authenticated user's account photo. The upload is validated ENTIRELY
    /// server-side — never trusting the client — before anything is stored:
    /// <list type="bullet">
    ///   <item>the content-type must be one of <c>image/jpeg</c> / <c>image/png</c> / <c>image/webp</c>;
    ///         everything else (notably <c>image/svg+xml</c>, a stored-XSS vector) is a 400;</item>
    ///   <item>the body must be non-empty and at most <see cref="MaxAvatarBytes"/> (5 MB), with
    ///         DISTINCT statuses for wrong-type vs too-big so the client can show the right hint.</item>
    /// </list>
    ///
    /// <para>The object is stored under a RANDOM <c>avatars/</c> key (<see cref="IObjectStorage.NewKey"/>)
    /// with the extension derived from the VALIDATED content-type — the client's filename is ignored
    /// entirely, so a hostile name can never influence the stored key. The old object (if any) is then
    /// deleted BEST-EFFORT: an orphaned avatar is acceptable, a failed delete must never fail the
    /// request that already swapped the key.</para>
    ///
    /// <para>userId is always the token subject — a user can only ever set their OWN avatar. A missing
    /// or inactive user is <see cref="AvatarUpdateStatus.Unauthorized"/> → 401.</para>
    /// </summary>
    public async Task<AvatarUpdateOutcome> SetAvatarAsync(
        Guid userId, Stream content, string? contentType, long length, CancellationToken ct = default)
    {
        // Validate BEFORE loading the user or touching storage: a rejected upload writes nothing.
        var validation = ValidateAvatarUpload(contentType, length);
        if (!validation.IsValid)
            return new AvatarUpdateOutcome(validation.RejectStatus, Error: validation.Error);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new AvatarUpdateOutcome(AvatarUpdateStatus.Unauthorized);

        var oldKey = user.AvatarKey;
        var newKey = _storage.NewKey("avatars", validation.Ext);
        await _storage.PutAsync(newKey, content, validation.ContentType, ct);

        user.AvatarKey = newKey;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        // Only after the new key is committed: delete the superseded object so avatars don't orphan.
        // Best-effort — never surface a cleanup failure to a caller whose avatar already changed.
        if (!string.IsNullOrEmpty(oldKey) && oldKey != newKey)
            await TryDeleteObjectAsync(oldKey, ct);

        return new AvatarUpdateOutcome(
            AvatarUpdateStatus.Updated, await ProjectAsync(user, await DeriveLevelAsync(userId, ct), ct));
    }

    /// <summary>
    /// Clear the authenticated user's account photo. Idempotent: with no avatar it is still a 200 with
    /// a null <c>avatar_url</c>. The stored object is deleted BEST-EFFORT after the key is cleared, on
    /// the same reasoning as <see cref="SetAvatarAsync"/>. A missing or inactive user is a 401.
    /// </summary>
    public async Task<AvatarUpdateOutcome> RemoveAvatarAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new AvatarUpdateOutcome(AvatarUpdateStatus.Unauthorized);

        var oldKey = user.AvatarKey;
        if (oldKey is not null)
        {
            user.AvatarKey = null;
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await TryDeleteObjectAsync(oldKey, ct);
        }

        return new AvatarUpdateOutcome(
            AvatarUpdateStatus.Updated, await ProjectAsync(user, await DeriveLevelAsync(userId, ct), ct));
    }

    /// <summary>Delete an object, swallowing every failure. Used only for orphan cleanup after the
    /// authoritative key change has already been committed, so a storage hiccup here is harmless — it
    /// leaves an unreferenced object, never a broken request.</summary>
    private async Task TryDeleteObjectAsync(string key, CancellationToken ct)
    {
        try
        {
            await _storage.DeleteAsync(key, ct);
        }
        catch
        {
            // Best-effort: an orphaned object is acceptable; a failed delete must not fail the request.
        }
    }

    /// <summary>
    /// Pure, dependency-free validation of an avatar upload's DECLARED content-type and size — the
    /// security-critical decision, so it is <c>internal static</c> and unit-testable without a DB or
    /// storage (same convention as <c>ProfileService.BuildAchievements</c>). On accept it returns the
    /// normalised content-type and the storage-key extension; on reject the distinct 400 status and
    /// its user-facing message.
    ///
    /// <para>Only raster types pass. <c>image/svg+xml</c> is rejected on purpose: an SVG can carry
    /// script and, served back through the presigned url, would be a stored-XSS vector — so the
    /// allow-list is jpeg/png/webp and NOTHING else. Wrong-type and too-big are separate statuses so
    /// the client can surface the right hint (<c>errorType</c> vs <c>errorSize</c>).</para>
    /// </summary>
    internal static AvatarValidation ValidateAvatarUpload(string? contentType, long length)
    {
        var normalizedType = (contentType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
        if (!AvatarContentTypes.TryGetValue(normalizedType, out var ext))
        {
            return AvatarValidation.Reject(
                AvatarUpdateStatus.InvalidType, "Rasm faqat JPG, PNG yoki WebP formatida bo'lishi kerak");
        }
        if (length <= 0)
            return AvatarValidation.Reject(AvatarUpdateStatus.Empty, "Rasm fayli bo'sh");
        if (length > MaxAvatarBytes)
            return AvatarValidation.Reject(AvatarUpdateStatus.TooLarge, "Rasm hajmi 5 MB dan oshmasligi kerak");

        return AvatarValidation.Accept(normalizedType, ext);
    }

    /// <summary>
    /// Step 1 of a verified phone change: bind the pending change to the CALLING user, then run the
    /// ordinary OTP request against the NEW number.
    ///
    /// <para>ORDER IS THE SECURITY PROPERTY here, and each step is placed where it is on purpose:</para>
    /// <list type="number">
    ///   <item>Normalise — a bad number is a 400, never a 500.</item>
    ///   <item>Confirm the caller is a real active user.</item>
    ///   <item><b>Refuse a number owned by someone else (409) BEFORE any code exists.</b> Sending
    ///         first and checking later would walk the user through a full verification that is
    ///         guaranteed to fail — and would put a live code on a number they cannot claim.</item>
    ///   <item>Write the user→phone binding BEFORE minting the code, so there is never a live code
    ///         with no owner recorded for it.</item>
    ///   <item>Only then generate + deliver, through the SAME <see cref="IOtpStore"/> /
    ///         <see cref="IOtpDeliverySender"/> seams as login.</item>
    /// </list>
    ///
    /// <para><b>The Telegram contact-share proof applies here untouched, and that is the point.</b>
    /// In bot delivery the code is only released to a Telegram account that has proven it owns the
    /// number the code was minted for. The user's Telegram is still bound to their OLD number, so
    /// the binding cache MISSES, the bot re-asks for a contact share, and only a successful proof of
    /// the NEW number releases the code and rebinds. Nothing here may short-circuit that — the cache
    /// is a speed-up, never an authorization decision.</para>
    ///
    /// <para>Changing to the number you ALREADY hold is not an error: the "taken" check excludes the
    /// caller, so the flow runs normally and ends in a no-op write. There is no special case to get
    /// wrong, and the user still re-proves ownership.</para>
    /// </summary>
    public async Task<PhoneChangeRequestResult> RequestPhoneChangeAsync(
        Guid userId, string rawPhone, CancellationToken ct = default)
    {
        string phone;
        try
        {
            phone = PhoneNumbers.NormalizeUz(rawPhone);
        }
        catch (FormatException ex)
        {
            return new PhoneChangeRequestResult(PhoneChangeRequestStatus.InvalidPhone, Error: ex.Message);
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new PhoneChangeRequestResult(PhoneChangeRequestStatus.Unauthorized);

        if (await IsPhoneTakenByAnotherAsync(phone, userId, ct))
            return new PhoneChangeRequestResult(PhoneChangeRequestStatus.Taken);

        await _pendingPhoneChanges.SetAsync(userId, phone, _otpOptions.TtlSeconds, ct);

        var requestId = Guid.NewGuid().ToString("N");
        var code = await _otpStore.GenerateAndStoreAsync(phone, ct);
        var delivery = await _otpDelivery.SendAsync(phone, code, requestId, ct);

        var devHint = _otpDelivery.Channel == "dev" ? DevOtpDeliverySender.FixedDevCode : null;
        return new PhoneChangeRequestResult(
            PhoneChangeRequestStatus.Sent, _otpDelivery.Channel, _otpOptions.TtlSeconds, devHint,
            delivery.TelegramLink, RequestId: requestId, TelegramMode: delivery.TelegramMode);
    }

    /// <summary>
    /// Step 2 of a verified phone change: redeem the code against the number THIS user has pending,
    /// and write it.
    ///
    /// <para><b>The target number comes from the server-side binding, never from the request.</b>
    /// That is what makes one user unable to confirm another's pending change, and what stops an
    /// authenticated caller who has somehow observed a live code from redirecting it onto a number
    /// of their choosing. No pending change for this user ⇒ 401, indistinguishable from a wrong
    /// code — there is nothing to learn from the difference.</para>
    ///
    /// <para>The "not taken" check RUNS AGAIN here. The gap between request and confirm is a real
    /// window (an OTP TTL wide) in which another account can claim the number, and the check at
    /// request time says nothing about the state at write time. (There is no unique index on
    /// <c>users.phone</c>, so this re-read is the guard; it narrows the race to the moment between
    /// the check and the write rather than closing it outright, which would need a schema change.)</para>
    ///
    /// <para>The session is NOT invalidated: the user's id does not change, so every issued token
    /// stays valid and the user is not logged out for editing their own profile. The placeholder
    /// <c>email</c> of a phone-registered account keeps its ORIGINAL number too — it is a UNIQUE
    /// column, and silently rewriting it here could collide with another row and turn a profile edit
    /// into a 500.</para>
    /// </summary>
    public async Task<PhoneChangeConfirmOutcome> ConfirmPhoneChangeAsync(
        Guid userId, string code, CancellationToken ct = default)
    {
        var phone = await GetPendingPhoneChangeAsync(userId, ct);
        if (phone is null)
            return new PhoneChangeConfirmOutcome(PhoneChangeConfirmStatus.InvalidCode);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return new PhoneChangeConfirmOutcome(PhoneChangeConfirmStatus.Unauthorized);

        if (!await VerifyCodeAsync(phone, code, ct))
            return new PhoneChangeConfirmOutcome(PhoneChangeConfirmStatus.InvalidCode);

        if (await IsPhoneTakenByAnotherAsync(phone, userId, ct))
            return new PhoneChangeConfirmOutcome(PhoneChangeConfirmStatus.Taken);

        user.Phone = phone;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        // Only after the write: a cleared binding with an unwritten change would strand the user.
        await _pendingPhoneChanges.ClearAsync(userId, ct);

        return new PhoneChangeConfirmOutcome(
            PhoneChangeConfirmStatus.Changed, await ProjectAsync(user, await DeriveLevelAsync(userId, ct), ct));
    }

    /// <summary>Whether <paramref name="phone"/> already belongs to an account OTHER than
    /// <paramref name="userId"/>. Excluding the caller is what makes "change to the number I already
    /// have" a no-op success instead of a self-inflicted 409.</summary>
    private Task<bool> IsPhoneTakenByAnotherAsync(string phone, Guid userId, CancellationToken ct)
        => _db.Users.AnyAsync(u => u.Phone == phone && u.Id != userId, ct);

    /// <summary>FAIL-CLOSED read of the pending change: a store outage yields <c>null</c>, which the
    /// caller treats as "no pending change" → 401. A broken store must never let a change through to
    /// an unverified number.</summary>
    private async Task<string?> GetPendingPhoneChangeAsync(Guid userId, CancellationToken ct)
    {
        try
        {
            return await _pendingPhoneChanges.GetAsync(userId, ct);
        }
        catch (OperationCanceledException)
        {
            throw; // genuine cancellation is not a verification decision
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Trim a submitted display name and accept it only if it is storable: non-blank, within the
    /// column width, and free of control characters (a newline or NUL smuggled into a name would
    /// travel into every screen that renders it). Returns <c>false</c> — never a silently repaired
    /// value — so the caller can answer 400.
    /// </summary>
    private static bool TryNormalizeFullName(string raw, out string? normalized)
    {
        normalized = null;
        var trimmed = raw.Trim();
        if (trimmed.Length == 0 || trimmed.Length > FullNameMaxLength || trimmed.Any(char.IsControl))
            return false;
        normalized = trimmed;
        return true;
    }

    /// <summary>
    /// Derive the student's CEFR level from their graded work. NO STORED COLUMN and no schema
    /// change (docs/07 §7.4 rule 3): a single server-side AVG over the user's own evaluations,
    /// joined through <c>Evaluation.Submission</c>, fed to the shared <see cref="CefrScale"/>.
    /// Deriving it means the level can never drift out of sync with the underlying grades.
    /// Nothing graded ⇒ the AVG is SQL NULL ⇒ <c>(null, null)</c>, and the UI hides the badge.
    /// Scoped to <paramref name="userId"/> — a user can never see another user's level.
    /// </summary>
    private async Task<(string? Level, string? LabelUz)> DeriveLevelAsync(Guid userId, CancellationToken ct)
    {
        var avgBand = await _db.Evaluations
            .Where(e => e.Submission.StudentId == userId)
            .AverageAsync(e => (double?)e.OverallBand, ct);
        return CefrScale.FromAverageBand(avgBand);
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

    // Role → lowercase PG enum label ("teacher"/"student"/"admin"). The lower-casing is REQUIRED:
    // it is both the Postgres enum label and the value clients match on over the wire. Read
    // straight off the DB entity, never from the token. `level` is
    // supplied by the caller (DeriveLevelAsync) because it needs a query the entity can't answer;
    // omitting it yields the (null, null) "no graded attempts yet" shape.
    //
    // ASYNC because of the avatar: when AvatarKey is set, avatar_url is a fresh PRESIGNED-GET url
    // minted the same way PracticeService mints a submission's audio_url from its audio key — a
    // short-lived download link, never a stored value. A null AvatarKey yields a null avatar_url and
    // the UI falls back to name initials.
    private async Task<MeResponse> ProjectAsync(
        User user, (string? Level, string? LabelUz) level, CancellationToken ct)
    {
        var avatarUrl = user.AvatarKey is null
            ? null
            : await _storage.GetPresignedUrlAsync(user.AvatarKey, ct: ct);
        return new(user.Id, user.Email, user.FullName, user.Role.ToString().ToLowerInvariant(), user.IsActive, user.IsPremium,
            user.Region, user.District, user.Address,
            user.Phone, user.CreatedAt, level.Level, level.LabelUz, avatarUrl,
            user.NotificationsEnabled, user.PreferredLanguage);
    }
}
