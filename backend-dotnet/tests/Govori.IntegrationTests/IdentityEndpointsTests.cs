using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Identity.Providers;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.IntegrationTests;

/// <summary>
/// Full Identity-domain (Faza 3.1) coverage over the real Govori.Api host for the PHONE + OTP auth
/// flow (product decision: login by phone, OTP over Telegram, no email/password): otp/request →
/// otp/verify login for an existing seeded phone → me; otp/verify register for a new phone + name;
/// wrong code → 401; new phone without a name → needs_registration; inactive → 403; refresh
/// rejecting an access token; Google find-or-create; and OTP fail-closed when the store errors.
///
/// External providers (OTP store + delivery, Google verifier) are swapped for fakes via
/// ConfigureTestServices so tests never touch Redis/Google/Telegram. The dev delivery fake accepts
/// the fixed code 000000. Every created/seeded row is deleted in a finally so runs are idempotent.
/// </summary>
public sealed class IdentityEndpointsTests : IClassFixture<IdentityEndpointsTests.IdentityApiFactory>, IDisposable
{
    private const string DevCode = "000000";

    private readonly IdentityApiFactory _factory;
    private readonly NpgsqlDataSourceHolder _db;

    public IdentityEndpointsTests(IdentityApiFactory factory)
    {
        _factory = factory;
        _db = new NpgsqlDataSourceHolder(factory.ConnectionString);
    }

    // ── 1. Existing phone: otp/request → otp/verify (dev 000000) → tokens → me ──
    [Fact]
    public async Task Otp_login_for_existing_phone_then_me_round_trip()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"login-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            // request → 200 { ok, delivery: "dev", expires_in, dev_hint: "000000" }
            var reqResp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);
            using (var reqDoc = JsonDocument.Parse(await reqResp.Content.ReadAsStringAsync()))
            {
                Assert.True(reqDoc.RootElement.GetProperty("ok").GetBoolean());
                Assert.Equal("dev", reqDoc.RootElement.GetProperty("delivery").GetString());
                Assert.True(reqDoc.RootElement.GetProperty("expires_in").GetInt32() > 0);
                Assert.Equal(DevCode, reqDoc.RootElement.GetProperty("dev_hint").GetString());
            }

            // verify with the dev code → 200 token pair (LOGIN, not register — no full_name needed).
            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));
            Assert.False(string.IsNullOrEmpty(verifyDoc.RootElement.GetProperty("refresh_token").GetString()));

            // me → 200, the seeded student (role from DB, not the token).
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email, meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 2. New phone + full_name → registers a passwordless student, issues tokens ──
    [Fact]
    public async Task Otp_verify_new_phone_with_full_name_registers_and_issues_tokens()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var verifyResp = await client.PostAsJsonAsync(
                "/api/auth/otp/verify", new { phone, code = DevCode, full_name = "Yangi Foydalanuvchi" });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            // me → the created student; email is the derived {phone}@govori.uz placeholder.
            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal($"{phone}@govori.uz", meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("Yangi Foydalanuvchi", meDoc.RootElement.GetProperty("full_name").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());

            // The row is real, passwordless (password_hash NULL), phone-matched.
            await using var ctx = _db.CreateContext();
            var created = await ctx.Users.SingleAsync(u => u.Phone == phone);
            Assert.Null(created.PasswordHash);
            Assert.True(created.IsActive);
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 3. New phone WITHOUT a name → 200 { needs_registration: true } (no row created) ──
    [Fact]
    public async Task Otp_verify_new_phone_without_name_returns_needs_registration()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
            using var doc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            Assert.True(doc.RootElement.GetProperty("needs_registration").GetBoolean());
            Assert.False(doc.RootElement.TryGetProperty("access_token", out _)); // NOT tokens

            // No account was created for that phone.
            await using var ctx = _db.CreateContext();
            Assert.Equal(0, await ctx.Users.CountAsync(u => u.Phone == phone));
        }
        finally
        {
            await DeleteByPhone(phone); // no-op if nothing created; keeps the run idempotent
        }
    }

    // ── 4. Wrong code → 401 (the dev bypass is 000000; anything else must fail against the store) ──
    [Fact]
    public async Task Otp_verify_wrong_code_returns_401()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"wrong-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone }); // FakeOtpStore stores "123456"

            // "111111" is neither the dev bypass nor the stored code → 401.
            var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = "111111" });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 5. Inactive (blocked) account → 403 even with a valid code ──
    [Fact]
    public async Task Otp_verify_returns_403_for_a_blocked_account()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"blocked-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: false);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });

            var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("Account is blocked", doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 6. refresh rejects an ACCESS token (only type=refresh is accepted) ──
    [Fact]
    public async Task Refresh_rejects_an_access_token()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        var email = $"refresh-{Guid.NewGuid():N}@example.test";
        await SeedUser(email, phone, UserRole.Student, isActive: true);

        try
        {
            await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            var verifyResp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
            using var verifyDoc = JsonDocument.Parse(await verifyResp.Content.ReadAsStringAsync());
            var accessToken = verifyDoc.RootElement.GetProperty("access_token").GetString();

            // Feed the ACCESS token to /refresh → 401 (type != "refresh").
            var resp = await client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = accessToken });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("Invalid refresh token", doc.RootElement.GetProperty("detail").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 7. Google sign-in via the fake verifier creates then returns the same user ──
    [Fact]
    public async Task Google_sign_in_creates_then_returns_user()
    {
        var email = $"google-{Guid.NewGuid():N}@example.test";
        var google = new FakeGoogleTokenVerifier(email, sub: $"sub-{Guid.NewGuid():N}", name: "Google User");
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), google);

        try
        {
            var first = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            using var firstDoc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
            var accessToken = firstDoc.RootElement.GetProperty("access_token").GetString();
            Assert.False(string.IsNullOrEmpty(accessToken));

            var me = await GetMe(client, accessToken!);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using var meDoc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
            Assert.Equal(email.ToLowerInvariant(), meDoc.RootElement.GetProperty("email").GetString());
            Assert.Equal("student", meDoc.RootElement.GetProperty("role").GetString());

            // Second call → returns the SAME user (login path), still 200; exactly one row exists.
            var second = await client.PostAsJsonAsync("/api/auth/google", new { credential = "fake-id-token" });
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);

            await using var ctx = _db.CreateContext();
            Assert.Equal(1, await ctx.Users.CountAsync(u => u.Email == email.ToLowerInvariant()));
        }
        finally
        {
            await DeleteByEmail(email.ToLowerInvariant());
        }
    }

    // ── 8. OTP fail-closed: a broken store denies verification (401), never approves/500s ──
    [Fact]
    public async Task Otp_verify_is_fail_closed_when_the_store_errors()
    {
        // Non-dev code ("123456") so the dev bypass can't mask the store failure.
        var client = _factory.CreateClientWith(new ThrowingOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();

        var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = "123456" });

        // Denied (401) — NOT a 500 crash and NOT a 200 pass.
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ── 9. PATCH /me writes full_name; blank / over-long / control-char names are refused ──
    [Fact]
    public async Task Patch_me_updates_full_name_and_rejects_unstorable_ones()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        await SeedUser($"name-{Guid.NewGuid():N}@example.test", phone, UserRole.Student, isActive: true);

        try
        {
            var token = await LoginAs(client, phone);

            // A good name is trimmed and stored, alongside the address fields.
            var ok = await Patch(client, token, new { full_name = "  Ali Valiyev  ", region = "Toshkent" });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            using (var doc = JsonDocument.Parse(await ok.Content.ReadAsStringAsync()))
            {
                Assert.Equal("Ali Valiyev", doc.RootElement.GetProperty("full_name").GetString());
                Assert.Equal("Toshkent", doc.RootElement.GetProperty("region").GetString());
            }

            // Blank, whitespace-only, over the varchar(255) column width, and control characters are
            // all 400 — a blank display name would break the avatar initials and every "Salom, {name}".
            foreach (var bad in new[] { "", "   ", new string('a', 256), "Ali\nValiyev" })
            {
                var resp = await Patch(client, token, new { full_name = bad });
                Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            }

            // …and none of those rejected writes touched the stored name.
            await using var ctx = _db.CreateContext();
            Assert.Equal("Ali Valiyev", (await ctx.Users.SingleAsync(u => u.Phone == phone)).FullName);
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 10. phone change: request → confirm writes the new number, session survives ──
    [Fact]
    public async Task Phone_change_request_then_confirm_updates_the_number()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var oldPhone = NewPhone();
        var newPhone = NewPhone();
        await SeedUser($"change-{Guid.NewGuid():N}@example.test", oldPhone, UserRole.Student, isActive: true);

        try
        {
            var token = await LoginAs(client, oldPhone);

            // request → the otp/request shape (delivery + expires_in + dev_hint + request_id).
            var reqResp = await PostAuthed(client, token, "/api/auth/phone/change/request", new { new_phone = newPhone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);
            using (var doc = JsonDocument.Parse(await reqResp.Content.ReadAsStringAsync()))
            {
                Assert.True(doc.RootElement.GetProperty("ok").GetBoolean());
                Assert.Equal("dev", doc.RootElement.GetProperty("delivery").GetString());
                Assert.True(doc.RootElement.GetProperty("expires_in").GetInt32() > 0);
                Assert.False(string.IsNullOrEmpty(doc.RootElement.GetProperty("request_id").GetString()));
            }

            // confirm carries ONLY the code — the number comes from the server-side pending change.
            var confirmResp = await PostAuthed(client, token, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.OK, confirmResp.StatusCode);
            using (var doc = JsonDocument.Parse(await confirmResp.Content.ReadAsStringAsync()))
                Assert.Equal(newPhone, doc.RootElement.GetProperty("phone").GetString());

            // The user id never changed, so the ORIGINAL token still works — no forced re-login.
            var me = await GetMe(client, token);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            using (var doc = JsonDocument.Parse(await me.Content.ReadAsStringAsync()))
                Assert.Equal(newPhone, doc.RootElement.GetProperty("phone").GetString());

            // Replaying the same code is refused: the pending change is gone once written.
            var replay = await PostAuthed(client, token, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        }
        finally
        {
            await DeleteByPhone(oldPhone);
            await DeleteByPhone(newPhone);
        }
    }

    // ── 11. A number owned by someone else → 409, and NO code is ever generated for it ──
    [Fact]
    public async Task Phone_change_request_rejects_a_taken_number_before_sending_a_code()
    {
        var delivery = new FakeOtpDeliverySender();
        var client = _factory.CreateClientWith(new FakeOtpStore(), delivery, AnyGoogle());
        var myPhone = NewPhone();
        var theirPhone = NewPhone();
        var myEmail = $"mine-{Guid.NewGuid():N}@example.test";
        await SeedUser(myEmail, myPhone, UserRole.Student, isActive: true);
        await SeedUser($"theirs-{Guid.NewGuid():N}@example.test", theirPhone, UserRole.Student, isActive: true);

        try
        {
            var token = await LoginAs(client, myPhone);

            var resp = await PostAuthed(client, token, "/api/auth/phone/change/request", new { new_phone = theirPhone });
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);

            // The whole point of checking BEFORE sending: no code was ever delivered to a number
            // that could not be claimed.
            Assert.Null(delivery.LastCodeFor(theirPhone));

            // …and with no pending change bound, confirm has nothing to redeem.
            var confirmResp = await PostAuthed(client, token, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.Unauthorized, confirmResp.StatusCode);

            await using var ctx = _db.CreateContext();
            Assert.Equal(myPhone, (await ctx.Users.SingleAsync(u => u.Email == myEmail)).Phone);
        }
        finally
        {
            await DeleteByPhone(myPhone);
            await DeleteByPhone(theirPhone);
        }
    }

    // ── 12. A malformed number is a 400, never an unhandled FormatException → 500 ──
    [Fact]
    public async Task Phone_change_request_returns_400_for_a_malformed_number()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        await SeedUser($"bad-{Guid.NewGuid():N}@example.test", phone, UserRole.Student, isActive: true);

        try
        {
            var token = await LoginAs(client, phone);

            var resp = await PostAuthed(client, token, "/api/auth/phone/change/request", new { new_phone = "12345" });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.False(string.IsNullOrEmpty(doc.RootElement.GetProperty("detail").GetString()));
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 13. SECURITY: one user cannot confirm ANOTHER user's pending phone change ──
    [Fact]
    public async Task Phone_change_confirm_is_bound_to_the_user_who_requested_it()
    {
        // Both users share one host, so they share the pending-change store — the ONLY thing keeping
        // them apart is that the store is keyed by user id.
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var victimPhone = NewPhone();
        var attackerPhone = NewPhone();
        var targetPhone = NewPhone();
        var attackerEmail = $"attacker-{Guid.NewGuid():N}@example.test";
        await SeedUser($"victim-{Guid.NewGuid():N}@example.test", victimPhone, UserRole.Student, isActive: true);
        await SeedUser(attackerEmail, attackerPhone, UserRole.Student, isActive: true);

        try
        {
            var victimToken = await LoginAs(client, victimPhone);
            var attackerToken = await LoginAs(client, attackerPhone);

            // The victim starts a change to targetPhone; a code for it is now live.
            var reqResp = await PostAuthed(
                client, victimToken, "/api/auth/phone/change/request", new { new_phone = targetPhone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);

            // The attacker — authenticated, and even holding the correct code — has no pending
            // change of their own, so there is no number their code could be redeemed against.
            var stolen = await PostAuthed(
                client, attackerToken, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.Unauthorized, stolen.StatusCode);

            await using (var ctx = _db.CreateContext())
            {
                // The attacker kept their own number, and nobody was moved onto the target.
                Assert.Equal(attackerPhone, (await ctx.Users.SingleAsync(u => u.Email == attackerEmail)).Phone);
                Assert.False(await ctx.Users.AnyAsync(u => u.Phone == targetPhone));
            }

            // The victim's own confirm still works — the request was never consumed by the attacker.
            var mine = await PostAuthed(
                client, victimToken, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.OK, mine.StatusCode);
        }
        finally
        {
            await DeleteByPhone(victimPhone);
            await DeleteByPhone(attackerPhone);
            await DeleteByPhone(targetPhone);
        }
    }

    // ── 14. Changing to the number you ALREADY hold is a no-op success, not a self-inflicted 409 ──
    [Fact]
    public async Task Phone_change_to_the_same_number_is_a_no_op_success()
    {
        var client = _factory.CreateClientWith(new FakeOtpStore(), new FakeOtpDeliverySender(), AnyGoogle());
        var phone = NewPhone();
        await SeedUser($"same-{Guid.NewGuid():N}@example.test", phone, UserRole.Student, isActive: true);

        try
        {
            var token = await LoginAs(client, phone);

            // The "taken" check excludes the caller, so this is an ordinary request…
            var reqResp = await PostAuthed(client, token, "/api/auth/phone/change/request", new { new_phone = phone });
            Assert.Equal(HttpStatusCode.OK, reqResp.StatusCode);

            // …that ends in a write of the number the user already had.
            var confirmResp = await PostAuthed(client, token, "/api/auth/phone/change/confirm", new { code = DevCode });
            Assert.Equal(HttpStatusCode.OK, confirmResp.StatusCode);
            using var doc = JsonDocument.Parse(await confirmResp.Content.ReadAsStringAsync());
            Assert.Equal(phone, doc.RootElement.GetProperty("phone").GetString());
        }
        finally
        {
            await DeleteByPhone(phone);
        }
    }

    // ── 15. PROACTIVE DM: a phone WITH a proven binding resolves to telegram_mode="direct" — the code
    //         is DM'd straight to the bound account and the PLAIN bot URL is returned (no start token) ──
    [Fact]
    public async Task Otp_request_with_a_binding_delivers_direct_and_returns_the_plain_bot_url()
    {
        var messenger = new FakeTelegramMessenger(result: true); // the bound account accepts the DM
        var client = _factory.CreateClientWithTelegramDelivery(messenger, botUsername: "govoribot");
        var phone = NewPhone();
        var telegramUserId = Random.Shared.NextInt64(1_000_000_000L, long.MaxValue);

        try
        {
            // A proven Telegram↔phone binding already exists (the durable telegram_bindings row the
            // worker writes on a contact-share). The sender must find it and DM the code directly.
            await SeedBinding(telegramUserId, phone);

            var resp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());

            Assert.Equal("telegram_bot", doc.RootElement.GetProperty("delivery").GetString());
            Assert.Equal("direct", doc.RootElement.GetProperty("telegram_mode").GetString());
            // Plain chat URL — NOT a ?start=<token> deep link.
            Assert.Equal("https://t.me/govoribot", doc.RootElement.GetProperty("telegram_link").GetString());
            Assert.True(messenger.WasCalled); // the code was pushed to the bound account
        }
        finally
        {
            await DeleteBindingsByPhone(phone);
        }
    }

    // ── 16. PROACTIVE DM: a phone WITHOUT a binding resolves to telegram_mode="deep_link" — no DM is
    //         attempted and a ?start=<token> deep link is returned (the legacy contact-share flow) ──
    [Fact]
    public async Task Otp_request_without_a_binding_falls_back_to_the_deep_link_mode()
    {
        var messenger = new FakeTelegramMessenger(result: true);
        var client = _factory.CreateClientWithTelegramDelivery(messenger, botUsername: "govoribot");
        var phone = NewPhone(); // brand-new number → no telegram_bindings row

        var resp = await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());

        Assert.Equal("telegram_bot", doc.RootElement.GetProperty("delivery").GetString());
        Assert.Equal("deep_link", doc.RootElement.GetProperty("telegram_mode").GetString());
        Assert.StartsWith(
            "https://t.me/govoribot?start=", doc.RootElement.GetProperty("telegram_link").GetString());
        Assert.False(messenger.WasCalled); // no binding → nothing to DM, so the messenger is untouched
    }

    // ── helpers ──
    private static FakeGoogleTokenVerifier AnyGoogle() => new("unused@example.test", sub: "unused");

    /// <summary>Log a seeded phone in through the real OTP flow and return its access token.</summary>
    private static async Task<string> LoginAs(HttpClient client, string phone)
    {
        await client.PostAsJsonAsync("/api/auth/otp/request", new { phone });
        var resp = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone, code = DevCode });
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("access_token").GetString()!;
    }

    private static async Task<HttpResponseMessage> PostAuthed(
        HttpClient client, string accessToken, string path, object body)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return await client.SendAsync(req);
    }

    private static async Task<HttpResponseMessage> Patch(HttpClient client, string accessToken, object body)
    {
        var req = new HttpRequestMessage(HttpMethod.Patch, "/api/auth/me") { Content = JsonContent.Create(body) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return await client.SendAsync(req);
    }

    // A fresh, valid +998 phone unlikely to collide with the seeded fixtures (which use 90/91 codes).
    private static string NewPhone() => "+99899" + Random.Shared.Next(0, 10_000_000).ToString("D7");

    private static async Task<HttpResponseMessage> GetMe(HttpClient client, string accessToken)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return await client.SendAsync(req);
    }

    private async Task SeedUser(string email, string phone, UserRole role, bool isActive)
    {
        await using var ctx = _db.CreateContext();
        ctx.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            Phone = phone,
            FullName = "Seed User",
            PasswordHash = null,        // phone users are passwordless
            Role = role,
            IsActive = isActive,
            IsPremium = false,
            PreferredLanguage = "uz",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private async Task DeleteByPhone(string phone)
    {
        await using var ctx = _db.CreateContext();
        await ctx.Users.Where(u => u.Phone == phone).ExecuteDeleteAsync();
    }

    private async Task DeleteByEmail(string email)
    {
        await using var ctx = _db.CreateContext();
        await ctx.Users.Where(u => u.Email == email).ExecuteDeleteAsync();
    }

    /// <summary>Seed a proven Telegram↔phone binding (the durable <c>telegram_bindings</c> row the
    /// worker writes on a contact-share) so the sender's DIRECT branch has a bound id to DM.</summary>
    private async Task SeedBinding(long telegramUserId, string phone)
    {
        await using var ctx = _db.CreateContext();
        ctx.TelegramBindings.Add(new TelegramBinding
        {
            TelegramUserId = telegramUserId,
            Phone = phone,
            VerifiedAt = DateTime.UtcNow,
        });
        await ctx.SaveChangesAsync();
    }

    private async Task DeleteBindingsByPhone(string phone)
    {
        await using var ctx = _db.CreateContext();
        await ctx.TelegramBindings.Where(b => b.Phone == phone).ExecuteDeleteAsync();
    }

    public void Dispose() => _db.Dispose();

    /// <summary>Owns an independent Npgsql data source for seed + cleanup, so tests read/write
    /// the same schema DB the host uses.</summary>
    private sealed class NpgsqlDataSourceHolder : IDisposable
    {
        private readonly Npgsql.NpgsqlDataSource _dataSource;

        public NpgsqlDataSourceHolder(string connectionString)
            => _dataSource = GovoriDataSourceFactory.Build(connectionString);

        public GovoriDbContext CreateContext()
        {
            var builder = new DbContextOptionsBuilder<GovoriDbContext>();
            builder.UseGovori(_dataSource);
            return new GovoriDbContext(builder.Options);
        }

        public void Dispose() => _dataSource.Dispose();
    }

    /// <summary>
    /// Boots Govori.Api against the schema DB with a fixed test SECRET_KEY, then swaps the external
    /// providers (OTP store + delivery, Google verifier) for fakes via ConfigureTestServices, which
    /// runs AFTER the app's own registrations so the fakes win. SECRET_KEY + the connection string
    /// go through env vars because Program.cs reads them at CreateBuilder, before the test host
    /// config applies.
    /// </summary>
    public sealed class IdentityApiFactory : WebApplicationFactory<Program>
    {
        public string ConnectionString { get; } =
            Environment.GetEnvironmentVariable("GOVORI_TEST_DB")
            ?? GovoriDataSourceFactory.DefaultConnectionString;

        private const string TestSecretKey =
            "identity-domain-integration-test-secret-key-do-not-use-in-prod";

        public IdentityApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }

        /// <summary>A client whose host uses the supplied provider fakes. Each call builds an
        /// isolated host via WithWebHostBuilder so tests don't share provider state. The pending
        /// phone-change store is swapped too (default: a fresh in-memory one), so the phone-change
        /// routes never reach Redis either.</summary>
        public HttpClient CreateClientWith(
            IOtpStore otpStore,
            IOtpDeliverySender otpDelivery,
            IGoogleTokenVerifier googleVerifier,
            IPendingPhoneChangeStore? pendingPhoneChanges = null)
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IOtpStore>();
                    services.AddSingleton(otpStore);
                    services.RemoveAll<IOtpDeliverySender>();
                    services.AddSingleton(otpDelivery);
                    services.RemoveAll<IGoogleTokenVerifier>();
                    services.AddSingleton(googleVerifier);
                    services.RemoveAll<IPendingPhoneChangeStore>();
                    services.AddSingleton(pendingPhoneChanges ?? new FakePendingPhoneChangeStore());
                })).CreateClient();
        }

        /// <summary>A client wired for the REAL <see cref="TelegramBotOtpSender"/> (channel
        /// "telegram_bot") so the proactive-DM tests drive the binding-vs-deep-link decision through the
        /// live otp/request endpoint. The messenger is faked (no real Telegram); the OTP store and the
        /// Telegram link store are faked (no Redis); but the <b>binding store stays the real EF one</b>,
        /// so <c>TelegramIdsForPhoneAsync</c> is exercised against a seeded <c>telegram_bindings</c>
        /// row.</summary>
        public HttpClient CreateClientWithTelegramDelivery(
            Govori.Platform.Telegram.ITelegramMessenger messenger, string botUsername)
        {
            return WithWebHostBuilder(builder =>
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IOtpStore>();
                    services.AddSingleton<IOtpStore>(new FakeOtpStore());
                    services.RemoveAll<IGoogleTokenVerifier>();
                    services.AddSingleton<IGoogleTokenVerifier>(AnyGoogle());
                    // No Redis in tests: fake the deep-link store the deep_link branch writes to.
                    services.RemoveAll<Govori.Platform.Telegram.ITelegramOtpLinkStore>();
                    services.AddSingleton<Govori.Platform.Telegram.ITelegramOtpLinkStore>(
                        new FakeTelegramOtpLinkStore());
                    services.RemoveAll<Govori.Platform.Telegram.ITelegramMessenger>();
                    services.AddSingleton(messenger);
                    services.AddSingleton(new TelegramBotOptions { Username = botUsername });
                    services.RemoveAll<IOtpDeliverySender>();
                    services.AddSingleton<IOtpDeliverySender, TelegramBotOtpSender>();
                })).CreateClient();
        }
    }
}
