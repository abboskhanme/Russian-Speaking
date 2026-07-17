namespace Govori.Identity.Providers;

/// <summary>
/// Delivers a one-time verification code to the user (email today; SMS later). Ported from
/// backend/app/services/email.py <c>send_otp_email</c>. Abstracted so tests never hit a real
/// mail/SMS provider — a test fake captures the code instead.
/// </summary>
public interface IOtpSender
{
    /// <summary>Deliver <paramref name="code"/> to <paramref name="email"/>.</summary>
    Task SendOtpAsync(string email, string code, CancellationToken ct = default);
}
