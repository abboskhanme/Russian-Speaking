using System.Net.Http.Json;
using System.Text.Json;
using Govori.Contracts;
using Govori.Platform.Telegram;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Govori.Worker;

/// <summary>Config for <see cref="TelegramBotPoller"/> — the bot API token from
/// <c>TELEGRAM_BOT_TOKEN</c>. Registered (with the poller) only when the token is present.</summary>
public sealed record TelegramBotPollerOptions(string Token);

/// <summary>
/// The Telegram bot poller for phone-OTP delivery (deep-link + bot-sends-code). Long-polls the Bot
/// API <c>getUpdates</c>; when a user opens the <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link
/// minted by <c>TelegramBotOtpSender</c>, Telegram delivers a <c>/start &lt;token&gt;</c> message —
/// this resolves the token via <see cref="ITelegramOtpLinkStore"/> (shared Redis) and DMs the code
/// back with <c>sendMessage</c>.
///
/// <para><b>Ownership proof (docs/08 — the one invariant).</b> A <c>/start</c> update carries NO phone
/// number, so opening the deep link proves nothing: an attacker who guessed a victim's phone could
/// request the OTP and press Start in their OWN Telegram. A code is therefore only ever delivered to
/// a Telegram account that has PROVEN, via a <c>request_contact</c> share, that it owns that exact
/// number. The share is proof ONLY when <c>contact.user_id == message.from.id</c> — Telegram lets a
/// user forward anyone's contact card, so without that check the whole feature is decorative. Any
/// failed proof BURNS the pending code (<see cref="ITelegramOtpLinkStore.BurnAsync"/>) so it cannot
/// be retried. <see cref="ITelegramBindingStore"/> is a speed cache of already-proven pairs, never on
/// its own an authorization decision.</para>
///
/// <para><b>Privacy.</b> Bot copy NEVER echoes the requested phone number — the reader may be an
/// attacker who merely guessed it, and printing it back confirms the guess. For the same reason
/// neither the phone nor the code is ever logged; log lines carry the Telegram user id and the
/// opaque request id only.</para>
///
/// <para>Runs ONLY in the Worker, and ONLY when <c>TELEGRAM_BOT_TOKEN</c> is set (dev stacks have no
/// token → no poller; the dev delivery stub + fixed code 000000 cover local testing). The update
/// offset is kept in-memory and advanced past processed updates so nothing is reprocessed within a
/// run. Errors are logged and retried with a short backoff — a Telegram/Redis blip never crashes the
/// host.</para>
/// </summary>
public sealed class TelegramBotPoller : BackgroundService
{
    // ── Update states written to otp_req:{request_id} (docs/08 state machine) ────────────────────
    private const string StateAwaitingContact = "awaiting_contact";
    private const string StateSent = "sent";
    private const string StateMismatch = "mismatch";
    private const string StateNotOwnContact = "not_own_contact";

    // otp_req:{request_id} mirrors the OTP's own lifetime (Identity's OtpOptions.TtlSeconds, 600s).
    // The Worker cannot reach Govori.Identity to read that value, so it is restated here; the state
    // key is a status hint for the app's poll, never an authorization input, so drift is harmless.
    private const int StateTtlSeconds = 600;

    // tg_pending:{tg_user_id} — the window the user has to answer the contact prompt. Owned by
    // Platform (RedisTelegramOtpLinkStore) so both sides cannot drift.
    private const int PendingTokenTtlSeconds = RedisTelegramOtpLinkStore.PendingTokenTtlSeconds;

    // ── Bot copy (docs/08 "Bot copy" — literal strings; none of them contains a phone number) ────
    private const string UnknownTokenText =
        "Kod topilmadi yoki muddati o'tgan. Iltimos, ilovada qaytadan urinib ko'ring.";
    private const string AskContactText =
        "Xavfsizlik uchun telefon raqamingizni tasdiqlang. Pastdagi tugmani bosing.";
    private const string NotOwnContactText =
        "⚠️ Iltimos, o'zingizning raqamingizni yuboring — boshqa odamning kontakti qabul qilinmaydi. Kod yuborilmadi.";
    private const string MismatchText =
        "⚠️ Telegram raqamingiz ilovada kiritilgan raqamga mos kelmadi. Kod yuborilmadi. Ilovada to'g'ri raqamni kiriting va qaytadan urinib ko'ring.";
    // Sent ONCE, on the first-time contact-share bind, immediately before the code (docs/08 "Bot copy").
    private const string ContactBoundText =
        "✅ Raqamingiz ulandi. Kirish kodlari shu yerga keladi.";

    /// <summary>The one-tap <c>request_contact</c> reply keyboard — the ONLY way to obtain a phone
    /// number from Telegram.</summary>
    private static readonly object ContactKeyboard = new
    {
        keyboard = new[] { new[] { new { text = "📱 Raqamni yuborish", request_contact = true } } },
        resize_keyboard = true,
        one_time_keyboard = true,
    };

    /// <summary>Clears the contact keyboard once the flow is over.</summary>
    private static readonly object RemoveKeyboard = new { remove_keyboard = true };

    private readonly IHttpClientFactory _httpFactory;
    private readonly ITelegramOtpLinkStore _links;
    private readonly ITelegramBindingStore _bindings;
    private readonly TelegramBotPollerOptions _options;
    private readonly ILogger<TelegramBotPoller> _log;

    private long _offset; // last confirmed update_id + 1; in-memory (a restart re-reads pending updates)

    public TelegramBotPoller(
        IHttpClientFactory httpFactory,
        ITelegramOtpLinkStore links,
        ITelegramBindingStore bindings,
        TelegramBotPollerOptions options,
        ILogger<TelegramBotPoller> log)
    {
        _httpFactory = httpFactory;
        _links = links;
        // Safe to hold on a singleton: EfTelegramBindingStore opens its OWN scope (and therefore its
        // own short-lived DbContext) per call, so nothing scoped is captured here.
        _bindings = bindings;
        _options = options;
        _log = log;
    }

    private string ApiBase => $"https://api.telegram.org/bot{_options.Token}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Telegram bot OTP poller started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break; // shutting down
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Telegram bot poller iteration failed; backing off.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
        _log.LogInformation("Telegram bot OTP poller stopped.");
    }

    private async Task PollOnceAsync(CancellationToken ct)
    {
        // Long-poll: the server holds the request up to `timeout`s; give the client more headroom.
        var http = _httpFactory.CreateClient("telegram-bot");
        http.Timeout = TimeSpan.FromSeconds(45);

        // allowed_updates stays ["message"] — a shared contact arrives as a message.contact.
        var url = $"{ApiBase}/getUpdates?timeout=30&allowed_updates=%5B%22message%22%5D"
                  + (_offset > 0 ? $"&offset={_offset}" : string.Empty);

        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("getUpdates returned {Status}; backing off.", (int)resp.StatusCode);
            await Task.Delay(TimeSpan.FromSeconds(3), ct);
            return;
        }

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True
            || !root.TryGetProperty("result", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var update in results.EnumerateArray())
        {
            if (update.TryGetProperty("update_id", out var idEl) && idEl.TryGetInt64(out var updateId))
                _offset = Math.Max(_offset, updateId + 1); // advance past this update either way

            try
            {
                await HandleUpdateAsync(http, update, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw; // shutting down — let ExecuteAsync end the loop
            }
            catch (Exception ex)
            {
                // One poisoned update must not abandon the rest of the batch. The offset has already
                // advanced past it, so it is not retried either.
                _log.LogError(ex, "Failed to handle Telegram update; skipping it.");
            }
        }
    }

    private async Task HandleUpdateAsync(HttpClient http, JsonElement update, CancellationToken ct)
    {
        if (!update.TryGetProperty("message", out var message) || message.ValueKind != JsonValueKind.Object)
            return;
        if (!message.TryGetProperty("from", out var from) || !from.TryGetProperty("id", out var fromIdEl)
            || !fromIdEl.TryGetInt64(out var fromUserId))
        {
            return; // no sender identity → nothing can ever be proven about this update
        }
        if (!message.TryGetProperty("chat", out var chat) || !chat.TryGetProperty("id", out var chatId))
            return;

        if (message.TryGetProperty("contact", out var contact) && contact.ValueKind == JsonValueKind.Object)
        {
            await HandleContactAsync(http, chatId, fromUserId, contact, ct);
            return;
        }

        var token = ExtractStartToken(message);
        if (token is not null)
            await HandleStartAsync(http, chatId, fromUserId, token, ct);
    }

    /// <summary>
    /// <c>/start &lt;token&gt;</c>. Delivers the code immediately only when this Telegram account has
    /// ALREADY proven it owns the requested number (the binding fast path); otherwise it asks for the
    /// contact share and delivers nothing.
    /// </summary>
    private async Task HandleStartAsync(HttpClient http, JsonElement chatId, long fromUserId, string token, CancellationToken ct)
    {
        var link = await _links.ResolveAsync(token, ct);
        if (link is null)
        {
            await SendMessageAsync(http, chatId, UnknownTokenText, replyMarkup: null, ct);
            return;
        }

        // Speed cache only: a binding is a record that THIS Telegram account already proved ownership
        // of THIS number via a contact share. Anything else falls through to a fresh proof.
        var binding = await _bindings.GetAsync(fromUserId, ct);
        if (binding is not null && string.Equals(binding.Phone, link.Phone, StringComparison.Ordinal))
        {
            // Already bound (proved ownership on an earlier flow) → just the code, no "ulandi" line.
            await DeliverCodeAsync(http, chatId, fromUserId, link, firstTimeBind: false, ct);
            return;
        }

        await _links.SetPendingTokenAsync(fromUserId, token, PendingTokenTtlSeconds, ct);
        await _links.SetStateAsync(link.RequestId, StateAwaitingContact, StateTtlSeconds, ct);
        await SendMessageAsync(http, chatId, AskContactText, ContactKeyboard, ct);
    }

    /// <summary>
    /// A shared contact — the ONLY evidence Telegram will give us about a phone number. Two gates must
    /// both pass before a code moves: the card must be the sender's OWN
    /// (<c>contact.user_id == from.id</c>), and its number must be the one the app asked for. Failing
    /// either burns the code.
    /// </summary>
    private async Task HandleContactAsync(HttpClient http, JsonElement chatId, long fromUserId, JsonElement contact, CancellationToken ct)
    {
        var token = await _links.GetPendingTokenAsync(fromUserId, ct);
        if (token is null)
        {
            // Nothing was asked of this user (stale share, or the answer window lapsed). Reply with the
            // same number-free line as an unknown token and drop the keyboard.
            await SendMessageAsync(http, chatId, UnknownTokenText, RemoveKeyboard, ct);
            return;
        }

        var link = await _links.ResolveAsync(token, ct);
        if (link is null)
        {
            await _links.ClearPendingTokenAsync(fromUserId, ct);
            await SendMessageAsync(http, chatId, UnknownTokenText, RemoveKeyboard, ct);
            return;
        }

        // GATE 1 — ownership. Telegram happily forwards ANY contact card; only a card whose user_id is
        // the sender's own is proof. Absent user_id (a manually-typed contact) is not proof either.
        var isOwnContact = contact.TryGetProperty("user_id", out var contactUserIdEl)
                           && contactUserIdEl.TryGetInt64(out var contactUserId)
                           && contactUserId == fromUserId;
        if (!isOwnContact)
        {
            await RejectAsync(http, chatId, fromUserId, link, token, StateNotOwnContact, NotOwnContactText, ct);
            _log.LogWarning(
                "Telegram contact share rejected (not own contact) for tg_user={TelegramUserId}, request={RequestId}; code burned.",
                fromUserId, link.RequestId);
            return;
        }

        // GATE 2 — same number. Compare the canonical +998XXXXXXXXX on both sides.
        var sharedPhone = contact.TryGetProperty("phone_number", out var phoneEl)
                          && phoneEl.ValueKind == JsonValueKind.String
            ? phoneEl.GetString()
            : null;
        if (!PhonesMatch(sharedPhone, link.Phone))
        {
            await RejectAsync(http, chatId, fromUserId, link, token, StateMismatch, MismatchText, ct);
            _log.LogWarning(
                "Telegram contact share rejected (phone mismatch) for tg_user={TelegramUserId}, request={RequestId}; code burned.",
                fromUserId, link.RequestId);
            return;
        }

        // Proven. Whether this share CREATED the binding (first-time) or re-proved an existing one is
        // decided by the binding lookup BEFORE the upsert: no prior row ⇒ first-time ⇒ send the "ulandi"
        // line ahead of the code. Remember the pair so this account skips the prompt next time, then
        // deliver.
        var priorBinding = await _bindings.GetAsync(fromUserId, ct);
        await _bindings.UpsertAsync(fromUserId, link.Phone, ct);
        await DeliverCodeAsync(http, chatId, fromUserId, link, firstTimeBind: priorBinding is null, ct);
    }

    /// <summary>Terminal failure: burn the pending OTP FIRST (so it is dead even if the reply fails),
    /// record the state for the app's status poll, then warn the user without naming any number.</summary>
    private async Task RejectAsync(
        HttpClient http, JsonElement chatId, long fromUserId, TelegramOtpLink link, string token,
        string state, string text, CancellationToken ct)
    {
        await _links.BurnAsync(link.Phone, token, ct);
        await _links.SetStateAsync(link.RequestId, state, StateTtlSeconds, ct);
        await _links.ClearPendingTokenAsync(fromUserId, ct);
        await SendMessageAsync(http, chatId, text, RemoveKeyboard, ct);
    }

    /// <summary>Success path for BOTH the <c>/start</c> binding fast path and a fresh contact-share
    /// proof: ownership of <c>link.Phone</c> is established, so DM the code for the user to TYPE into the
    /// app (there is NO auto-login — the code is the secret the user copies back). The state is set to
    /// <c>sent</c>, never "verified". When <paramref name="firstTimeBind"/> is set — a contact share that
    /// CREATED the binding — the "raqamingiz ulandi" confirmation is sent first, then the code; otherwise
    /// only the code goes out. The phone number never appears in any copy.</summary>
    private async Task DeliverCodeAsync(
        HttpClient http, JsonElement chatId, long fromUserId, TelegramOtpLink link, bool firstTimeBind, CancellationToken ct)
    {
        if (firstTimeBind)
        {
            // First-time bind: confirm the link, then the code. The confirmation clears the contact
            // keyboard so the follow-up code message needs no reply markup.
            await SendMessageAsync(http, chatId, ContactBoundText, RemoveKeyboard, ct);
            await SendMessageAsync(http, chatId, CodeText(link.Code), replyMarkup: null, ct);
        }
        else
        {
            // Fast path / re-proof: just the code (clearing any lingering keyboard).
            await SendMessageAsync(http, chatId, CodeText(link.Code), RemoveKeyboard, ct);
        }

        await _links.SetStateAsync(link.RequestId, StateSent, StateTtlSeconds, ct);
        await _links.ClearPendingTokenAsync(fromUserId, ct);
        _log.LogInformation(
            "Delivered OTP code via bot for tg_user={TelegramUserId}, request={RequestId}.", fromUserId, link.RequestId);
    }

    /// <summary>The code DM, matching the owner's reference screenshot. <c>\n</c> is a real newline in
    /// the sendMessage payload. Minutes are the OTP/link TTL (<see cref="StateTtlSeconds"/>) in minutes.
    /// The phone number is deliberately absent.</summary>
    private static string CodeText(string code) =>
        $"🎓 Govori\nTasdiqlash kodingiz: {code}\n({StateTtlSeconds / 60} daqiqa amal qiladi)";

    /// <summary>Canonical-form phone comparison. <see cref="PhoneNumbers.NormalizeUz"/> THROWS on
    /// anything that is not a 9-digit UZ number, so a foreign or malformed Telegram number is a plain
    /// NON-MATCH here — never an exception that escapes into the poll loop.</summary>
    private static bool PhonesMatch(string? a, string? b)
    {
        try
        {
            return string.Equals(PhoneNumbers.NormalizeUz(a), PhoneNumbers.NormalizeUz(b), StringComparison.Ordinal);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    // Match "/start <token>" (Telegram passes the deep-link start param as the message text).
    private static string? ExtractStartToken(JsonElement message)
    {
        if (!message.TryGetProperty("text", out var textEl) || textEl.ValueKind != JsonValueKind.String)
            return null;

        var text = textEl.GetString() ?? string.Empty;
        const string prefix = "/start ";
        if (!text.StartsWith(prefix, StringComparison.Ordinal))
            return null;

        var token = text[prefix.Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    private async Task SendMessageAsync(HttpClient http, JsonElement chatId, string text, object? replyMarkup, CancellationToken ct)
    {
        // chat_id may be a JSON number; forward it verbatim as a long.
        object chat = chatId.ValueKind == JsonValueKind.Number && chatId.TryGetInt64(out var id)
            ? id
            : chatId.ToString();

        var payload = new Dictionary<string, object> { ["chat_id"] = chat, ["text"] = text };
        if (replyMarkup is not null)
            payload["reply_markup"] = replyMarkup;

        using var resp = await http.PostAsJsonAsync($"{ApiBase}/sendMessage", payload, ct);
        if (!resp.IsSuccessStatusCode)
            _log.LogWarning("sendMessage returned {Status}.", (int)resp.StatusCode);
    }
}
