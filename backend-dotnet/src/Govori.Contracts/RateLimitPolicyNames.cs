namespace Govori.Contracts;

/// <summary>
/// Rate-limit policy names shared between the endpoint modules (which attach a policy with
/// <c>.RequireRateLimiting(...)</c>) and the composition root (Govori.Api), which registers the
/// matching ASP.NET Core RateLimiter policy. Kept here — a leaf every module + the host can see —
/// so a policy name is spelled once. Each name doubles as the Redis/counter key <c>scope</c>, so
/// changing a string here silently resets the live counters — treat them as stable identifiers.
/// LIMITS live with the policy registration in <c>Govori.Api</c> (RateLimitPolicies), not here.
/// </summary>
public static class RateLimitPolicyNames
{
    /// <summary>OTP request — 5 per 600 s.</summary>
    public const string EmailCode = "email_code";

    /// <summary>
    /// OTP delivery-status POLLING (<c>GET /api/auth/otp/status</c>) — 300 per 60 s.
    ///
    /// <para>Deliberately NOT <see cref="EmailCode"/>: that policy is 5 per 600 s because SENDING a
    /// code is expensive, but the client polls this endpoint every 2 s for the whole 10-minute OTP
    /// window (~300 calls per login). Attaching email_code here would 429 the feature after ten
    /// seconds. This is a separate, generous scope for a read that costs one Redis GET, returns only
    /// an opaque state string, and (always answering 200) cannot be used to probe which request ids
    /// exist. 300/60 s per-IP still caps a flood at 5 rps while leaving room for several users
    /// behind one NAT.</para>
    /// </summary>
    public const string OtpStatus = "otp_status";

    /// <summary>
    /// Verified phone change (<c>POST /api/auth/phone/change/request</c> + <c>/confirm</c>) —
    /// 10 per 3600 s, shared by both routes.
    ///
    /// <para>Sized for a HUMAN, not a poller: one successful change costs exactly 2 hits
    /// (request + confirm), so this allows ~5 complete attempts an hour — enough to mistype the
    /// number, give up on a code that never arrived, and try again, while capping anyone hunting for
    /// a code. Both routes are authenticated, so the partition key is the user id, not a shared
    /// NAT'd IP — a classroom cannot exhaust one member's budget.</para>
    ///
    /// <para>Deliberately NOT <see cref="EmailCode"/>: that scope is spent by ordinary logins, and
    /// sharing it would mean a user who just logged in a few times cannot change their number, and a
    /// user who changed their number cannot log back in. Deliberately NOT <see cref="Login"/> for
    /// the same reason.</para>
    /// </summary>
    public const string PhoneChange = "phone_change";

    /// <summary>Password login — 10 per 300 s (also covers Google sign-in).</summary>
    public const string Login = "login";

    /// <summary>Guest demo assessment — 15 per 3600 s.</summary>
    public const string GuestAssess = "guest_assess";

    /// <summary>Guest demo TTS — 60 per 3600 s.</summary>
    public const string GuestTts = "guest_tts";

    /// <summary>Auth-less "try the placement test" flow (submit + complete). Guards the public guest
    /// placement endpoints, per-IP and FAIL-OPEN like the other guest policies. A full 3-answer
    /// session costs ~4 hits, so size the limit in multiples of that.</summary>
    public const string GuestPlacement = "guest_placement";
}
