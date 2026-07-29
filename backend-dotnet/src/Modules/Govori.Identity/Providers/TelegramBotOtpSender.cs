using Govori.Platform.Telegram;

namespace Govori.Identity.Providers;

/// <summary>Config for <see cref="TelegramBotOtpSender"/>. <see cref="Username"/> ← the
/// <c>TELEGRAM_BOT_USERNAME</c> env var (the bot's @username, used to build both the deep link and the
/// plain chat URL). The bot TOKEN itself is not held here — the proactive push goes through
/// <see cref="ITelegramMessenger"/>, whose own options carry the token. When these are unset,
/// <c>Program.cs</c> registers <see cref="DevOtpDeliverySender"/> instead, so this sender only ever
/// exists with a real bot configured.</summary>
public sealed class TelegramBotOptions
{
    public string Username { get; init; } = string.Empty;
}

/// <summary>
/// Real OTP delivery via a FREE Telegram bot, deciding PER PHONE between two modes
/// ("Dehqon Bozor"-style login):
/// <list type="bullet">
///   <item><b>direct</b> — the phone already has a proven <see cref="ITelegramBindingStore">binding</see>,
///         so the code is DM'd STRAIGHT to the bound account(s) via <see cref="ITelegramMessenger"/>.
///         No start token, no contact re-share. <c>telegram_link</c> is the PLAIN
///         <c>https://t.me/&lt;username&gt;</c> chat URL (opens the chat so the user can read the code),
///         <c>telegram_mode = "direct"</c>. Chosen when at least one DM succeeds.</item>
///   <item><b>deep_link</b> — no binding yet (register, or a legacy user's first login) OR every direct
///         DM failed (blocked bot / Telegram unreachable). Stash <c>{phone, code}</c> behind a
///         short-lived start-token (<see cref="ITelegramOtpLinkStore"/>) and return
///         <c>https://t.me/&lt;username&gt;?start=&lt;token&gt;</c>; the Worker's poller DMs the code
///         once the user presses Start and proves ownership. <c>telegram_mode = "deep_link"</c>.</item>
/// </list>
/// A direct-DM failure ALWAYS falls back to deep_link, so the user is never left without a way to
/// receive a code. Both modes end the same way in the app: the user TYPES the code and verification
/// stays code-based against Redis (<see cref="IOtpStore"/>, fail-closed). This sender NEVER accepts
/// the dev bypass (<see cref="AcceptsDevCode"/> is always <c>false</c>), so <c>000000</c> cannot work
/// once a bot is configured.
///
/// <para>SECURITY: the code only ever reaches a Telegram account that PROVED (at binding time, via a
/// contact share) that it owns the phone — direct mode DMs that bound account, deep_link mode re-proves
/// first. The DM carries only the code, never the phone number. Because delivery is code-based (the
/// user must type it), triggering a proactive DM to a bound number cannot leak the code to whoever
/// entered the number; the only residual risk is DM-spam, bounded by the existing per-IP OTP-request
/// rate limit (same class as SMS-bombing) — no new policy needed.</para>
///
/// <para>Owner setup: create a bot via <c>@BotFather</c>, then set <c>TELEGRAM_BOT_TOKEN</c> +
/// <c>TELEGRAM_BOT_USERNAME</c> in <c>.env</c> and rebuild the api + worker images.</para>
/// </summary>
public sealed class TelegramBotOtpSender : IOtpDeliverySender
{
    private readonly ITelegramOtpLinkStore _links;
    private readonly TelegramBotOptions _options;
    private readonly OtpOptions _otp;
    private readonly ITelegramBindingStore _bindings;
    private readonly ITelegramMessenger _messenger;

    public TelegramBotOtpSender(
        ITelegramOtpLinkStore links,
        TelegramBotOptions options,
        OtpOptions otp,
        ITelegramBindingStore bindings,
        ITelegramMessenger messenger)
    {
        _links = links;
        _options = options;
        _otp = otp;
        _bindings = bindings;
        _messenger = messenger;
    }

    public string Channel => "telegram_bot";

    // A real bot means the fixed dev code is NEVER honoured — the dev bypass is impossible here.
    public bool AcceptsDevCode(string code) => false;

    public async Task<OtpDeliveryResult> SendAsync(string phone, string code, string requestId, CancellationToken ct = default)
    {
        var username = _options.Username.TrimStart('@');

        // DIRECT: the phone has proven binding(s) — DM the code straight to each bound account.
        var boundIds = await _bindings.TelegramIdsForPhoneAsync(phone, ct);
        if (boundIds.Count > 0)
        {
            var text = CodeText(code);
            var anySent = false;
            foreach (var id in boundIds)
            {
                // A single blocked/unreachable id must not abort the others, and never throws here.
                if (await _messenger.SendMessageAsync(id, text, ct))
                    anySent = true;
            }

            if (anySent)
            {
                // Delivered to at least one owner. Record the terminal state (a stale poll then reads
                // "sent", not "expired") and hand back the PLAIN chat URL. NO deep-link token is minted.
                await _links.SetStateAsync(requestId, "sent", _otp.TtlSeconds, ct);
                return new OtpDeliveryResult($"https://t.me/{username}", TelegramMode: "direct");
            }
            // Every DM failed → fall through to deep_link so the user still has a way to get the code.
        }

        // DEEP_LINK: no binding (or direct failed). Stash {phone, code} behind a start-token and hand
        // back the deep link; the Worker's poller DMs the code once the user presses Start and proves
        // ownership. Seed "pending" BEFORE returning so the client's first poll reads a real state.
        var token = await _links.CreateAsync(phone, code, requestId, _otp.TtlSeconds, ct);
        await _links.SetStateAsync(requestId, "pending", _otp.TtlSeconds, ct);
        return new OtpDeliveryResult($"https://t.me/{username}?start={token}", TelegramMode: "deep_link");
    }

    /// <summary>The code DM, matching the owner's reference screenshot (identical to the Worker's copy
    /// for a re-proof). <c>\n</c> is a real newline; minutes are the OTP TTL in minutes; the phone
    /// number is deliberately absent — a Telegram message must NEVER carry the number.</summary>
    private string CodeText(string code) =>
        $"🎓 Govori\nTasdiqlash kodingiz: {code}\n({_otp.TtlSeconds / 60} daqiqa amal qiladi)";
}
