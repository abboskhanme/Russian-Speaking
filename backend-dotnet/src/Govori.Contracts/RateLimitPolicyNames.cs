namespace Govori.Contracts;

/// <summary>
/// Rate-limit policy names shared between the endpoint modules (which attach a policy with
/// <c>.RequireRateLimiting(...)</c>) and the composition root (Govori.Api), which registers the
/// matching ASP.NET Core RateLimiter policy. Kept here — a leaf every module + the host can see —
/// so a policy name is spelled once. Each name is also the Redis/counter key <c>scope</c>, so it
/// mirrors the string passed to <c>rate_limit("&lt;scope&gt;", ...)</c> in
/// <c>backend/app/core/ratelimit.py</c> usages (auth.py / guest.py). LIMITS live with the policy
/// registration in <c>Govori.Api</c> (RateLimitPolicies), not here.
/// </summary>
public static class RateLimitPolicyNames
{
    /// <summary>OTP request — guest.py sibling in auth.py:74-77 <c>email_code 5/600</c>.</summary>
    public const string EmailCode = "email_code";

    /// <summary>Password login — auth.py:143-146 <c>login 10/300</c> (also Google sign-in).</summary>
    public const string Login = "login";

    /// <summary>Guest demo assessment — guest.py:68 <c>guest_assess 15/3600</c>.</summary>
    public const string GuestAssess = "guest_assess";

    /// <summary>Guest demo TTS — guest.py:131 <c>guest_tts 60/3600</c>.</summary>
    public const string GuestTts = "guest_tts";

    /// <summary>Auth-less "try the placement test" flow (submit + complete). No Python sibling — a
    /// .NET-slice addition guarding the public guest placement endpoints, per-IP + FAIL-OPEN like the
    /// other guest policies. A full 3-answer session costs ~4 hits.</summary>
    public const string GuestPlacement = "guest_placement";
}
