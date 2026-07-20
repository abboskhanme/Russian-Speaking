using Govori.Platform.Telegram;

namespace Govori.Identity.Providers;

/// <summary>Config for <see cref="TelegramBotOtpSender"/>. <see cref="Username"/> ← the
/// <c>TELEGRAM_BOT_USERNAME</c> env var (the bot's @username, used to build the deep link). The bot
/// TOKEN is NOT needed here — the API only mints the link; the Worker's poller holds the token and
/// pushes the code. When these are unset, <c>Program.cs</c> registers <see cref="DevOtpDeliverySender"/>
/// instead, so this sender only ever exists with a real bot configured.</summary>
public sealed class TelegramBotOptions
{
    public string Username { get; init; } = string.Empty;
}

/// <summary>
/// Real OTP delivery via a FREE Telegram bot using the deep-link + bot-sends-code pattern:
/// <list type="number">
///   <item>stash <c>{phone, code}</c> behind a short-lived start-token in Redis
///         (<see cref="ITelegramOtpLinkStore"/>, same TTL as the OTP);</item>
///   <item>return the deep link <c>https://t.me/&lt;username&gt;?start=&lt;token&gt;</c> — the
///         client shows an "Open Telegram" button.</item>
/// </list>
/// The code is NOT pushed here — the Worker's bot poller resolves the token and DMs the code once
/// the user presses Start. Verification stays code-based against Redis (<see cref="IOtpStore"/>,
/// fail-closed). This sender NEVER accepts the dev bypass (<see cref="AcceptsDevCode"/> is always
/// <c>false</c>), so <c>000000</c> cannot work once a bot is configured.
///
/// <para>Owner setup: create a bot via <c>@BotFather</c>, then set <c>TELEGRAM_BOT_TOKEN</c> +
/// <c>TELEGRAM_BOT_USERNAME</c> in <c>.env</c> and rebuild the api + worker images.</para>
/// </summary>
public sealed class TelegramBotOtpSender : IOtpDeliverySender
{
    private readonly ITelegramOtpLinkStore _links;
    private readonly TelegramBotOptions _options;
    private readonly OtpOptions _otp;

    public TelegramBotOtpSender(ITelegramOtpLinkStore links, TelegramBotOptions options, OtpOptions otp)
    {
        _links = links;
        _options = options;
        _otp = otp;
    }

    public string Channel => "telegram_bot";

    // A real bot means the fixed dev code is NEVER honoured — the dev bypass is impossible here.
    public bool AcceptsDevCode(string code) => false;

    public async Task<OtpDeliveryResult> SendAsync(string phone, string code, CancellationToken ct = default)
    {
        var token = await _links.CreateAsync(phone, code, _otp.TtlSeconds, ct);
        var username = _options.Username.TrimStart('@');
        return new OtpDeliveryResult($"https://t.me/{username}?start={token}");
    }
}
