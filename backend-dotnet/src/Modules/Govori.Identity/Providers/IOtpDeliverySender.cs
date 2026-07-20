namespace Govori.Identity.Providers;

/// <summary>Outcome of an OTP delivery. <see cref="TelegramLink"/> is the
/// <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link the client shows as an "Open Telegram"
/// button (bot delivery); it is <c>null</c> for dev delivery (the code is only logged).</summary>
public sealed record OtpDeliveryResult(string? TelegramLink = null);

/// <summary>
/// Delivers a one-time login code to a phone via Telegram. This is the single delivery seam for
/// the phone-OTP auth flow (product decision: OTP over a FREE Telegram bot, no SMS/email/paid
/// gateway). Two impls sit behind it, chosen by config in <c>Program.cs</c>:
/// <list type="bullet">
///   <item><see cref="TelegramBotOtpSender"/> — real delivery via a bot deep link: it stashes the
///         code behind a start-token and returns a <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> link;
///         the Worker's bot poller DMs the code when the user presses Start. Active when
///         <c>TELEGRAM_BOT_TOKEN</c> + <c>TELEGRAM_BOT_USERNAME</c> are set.</item>
///   <item><see cref="DevOtpDeliverySender"/> — the default when no bot token: logs the code and
///         accepts the fixed dev code <c>000000</c> so local testing needs no Telegram.</item>
/// </list>
/// The OTP value is generated + stored in Redis by <see cref="IOtpStore"/> (keyed by phone); this
/// seam only DELIVERS it. Verification always re-checks Redis (fail-closed) EXCEPT the dev bypass,
/// gated behind <see cref="AcceptsDevCode"/> so it can NEVER pass in bot delivery.
/// </summary>
public interface IOtpDeliverySender
{
    /// <summary>The active delivery channel, surfaced via <c>GET /api/auth/config</c> and the
    /// <c>otp/request</c> response: <c>"telegram_bot"</c> (real) or <c>"dev"</c> (stub).</summary>
    string Channel { get; }

    /// <summary>Deliver <paramref name="code"/> for <paramref name="phone"/> (E.164, e.g.
    /// <c>+998901112233</c>). Bot delivery returns a deep link (the code is pushed later, when the
    /// user presses Start); dev delivery returns no link. Best-effort — never throws for a delivery
    /// hiccup, since the code is already persisted in Redis for verify.</summary>
    Task<OtpDeliveryResult> SendAsync(string phone, string code, CancellationToken ct = default);

    /// <summary>
    /// <c>true</c> IFF <paramref name="code"/> is the fixed dev bypass code AND this sender is the
    /// dev stub. The real bot sender ALWAYS returns <c>false</c>, so the <c>000000</c> bypass is
    /// impossible once a real token is configured. This is the ONLY path that skips the Redis
    /// (fail-closed) OTP check.
    /// </summary>
    bool AcceptsDevCode(string code);
}
