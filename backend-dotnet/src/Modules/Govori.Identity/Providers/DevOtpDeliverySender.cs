using Microsoft.Extensions.Logging;

namespace Govori.Identity.Providers;

/// <summary>
/// Dev-fallback OTP delivery — the DEFAULT when <c>TELEGRAM_GATEWAY_TOKEN</c> is not configured.
/// It never contacts Telegram: it LOGS the real generated code (Serilog) so a developer can read
/// it, AND it accepts the fixed dev code <see cref="FixedDevCode"/> on verify so local sign-in
/// works with no Telegram at all.
///
/// <para><b>Dev-only bypass:</b> <see cref="AcceptsDevCode"/> returns <c>true</c> for
/// <see cref="FixedDevCode"/> ONLY here. The real <see cref="TelegramBotOtpSender"/> returns
/// <c>false</c>, so once a real bot is set the <c>000000</c> bypass is gone — it can never leak
/// into prod. The channel this reports is <c>"dev"</c>.</para>
/// </summary>
public sealed class DevOtpDeliverySender : IOtpDeliverySender
{
    /// <summary>The fixed code accepted on verify in dev delivery only. Also returned as the
    /// <c>dev_hint</c> on <c>otp/request</c> so no log-reading is needed.</summary>
    public const string FixedDevCode = "000000";

    private readonly ILogger<DevOtpDeliverySender> _log;

    public DevOtpDeliverySender(ILogger<DevOtpDeliverySender> log) => _log = log;

    public string Channel => "dev";

    /// <summary>
    /// Logs the code; contacts nothing. <paramref name="requestId"/> is accepted for signature
    /// parity but deliberately unused: dev delivery has NO Telegram step, so there is no ownership
    /// proof to wait on and no state machine to advance. The status endpoint short-circuits the dev
    /// channel to <c>sent</c> rather than reading a state this sender never writes — which also
    /// keeps dev/test runs free of a Redis dependency they do not otherwise have.
    /// </summary>
    public Task<OtpDeliveryResult> SendAsync(string phone, string code, string requestId, CancellationToken ct = default)
    {
        _log.LogWarning(
            "OTP (dev delivery — Telegram bot not configured). phone={Phone} code={Code}  (dev code {DevCode} also accepted)",
            phone, code, FixedDevCode);
        return Task.FromResult(new OtpDeliveryResult()); // no deep link in dev
    }

    public bool AcceptsDevCode(string code)
        => string.Equals((code ?? string.Empty).Trim(), FixedDevCode, StringComparison.Ordinal);
}
