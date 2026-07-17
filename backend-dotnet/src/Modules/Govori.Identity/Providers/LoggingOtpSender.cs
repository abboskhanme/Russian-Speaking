using Microsoft.Extensions.Logging;

namespace Govori.Identity.Providers;

/// <summary>
/// Dev-fallback OTP sender. Mirrors the Python "SMTP not configured" branch in
/// backend/app/services/email.py, which LOGS the code instead of sending it so local/dev
/// sign-up works without a mail server.
///
/// <para>TODO(providers): wire a real transactional email/SMS provider (port
/// <c>send_otp_email</c>'s SMTP path, or an SMS gateway) and register it in place of this
/// sender. Until then codes are only logged — never delivered.</para>
/// </summary>
public sealed class LoggingOtpSender : IOtpSender
{
    private readonly ILogger<LoggingOtpSender> _log;

    public LoggingOtpSender(ILogger<LoggingOtpSender> log) => _log = log;

    public Task SendOtpAsync(string email, string code, CancellationToken ct = default)
    {
        _log.LogWarning(
            "OTP not sent (no email/SMS provider wired). email={Email} code={Code}", email, code);
        return Task.CompletedTask;
    }
}
