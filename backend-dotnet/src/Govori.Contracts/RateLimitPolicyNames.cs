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

    /// <summary>Auth-less "try the placement test" flow (submit + complete). Guards the public guest
    /// placement endpoints, per-IP and FAIL-OPEN like the other policies. A full 3-answer
    /// session costs ~4 hits, so size the limit in multiples of that.</summary>
    public const string GuestPlacement = "guest_placement";

    /// <summary>
    /// Recording an answer (<c>POST /api/submissions</c>) — the app's most expensive route.
    ///
    /// <para>Every accepted submission spends one Azure STT call and one grader call at a vendor
    /// that bills per request. Nothing else on the authenticated surface costs money per call, and
    /// this one had no ceiling of any kind: the freemium gate stops a FREE student after three tasks
    /// per module, but a premium student, a teacher and an admin were all unbounded — as was any
    /// client-side retry loop that happened to run through this route.</para>
    ///
    /// <para>This is a COST tail-trim, not a security control. It is sized so no real student can
    /// reach it — see the limit's note in RateLimitPolicies — and the partition is the user id, so a
    /// whole classroom behind one school IP cannot spend each other's budget.</para>
    /// </summary>
    public const string SubmitAudio = "submit_audio";

    /// <summary>
    /// The authenticated placement test's per-answer submit (<c>POST /api/placement/submit</c>).
    /// Same vendor cost as a real submission — it runs the SAME STT + grader seams — but it stores
    /// nothing, so none of the freemium or attempt-budget logic touches it and it had no ceiling at
    /// all. A placement session is 3 answers, so the limit is sized in multiples of that.
    /// </summary>
    public const string PlacementSubmit = "placement_submit";

    /// <summary>
    /// The admin "does this key actually work?" probe (<c>POST /api/admin/settings/ai/test</c>).
    ///
    /// <para>One press makes one REAL call to every configured backend, so it is billed per press at
    /// up to five vendors. Admin-only, so this is not about abuse — it is about a double-clicked
    /// button, a retried request, or a settings screen someone leaves reloading. Sized for a human
    /// pasting keys and checking them, which is a handful of presses, not dozens.</para>
    /// </summary>
    public const string AdminProbe = "admin_probe";

    /// <summary>
    /// Starting a purchase (<c>POST /api/billing/checkout</c>).
    ///
    /// <para>Every hit writes a <c>payment_intents</c> row and — once a real adapter is wired —
    /// opens a transaction at a payment provider. The idempotency key already collapses a RETRY of
    /// the same attempt into one row; this caps someone minting a fresh key each time, which the key
    /// cannot. Authenticated, so the partition is the user id.</para>
    ///
    /// <para>Sized for a person buying something: a purchase is one press, a mistyped card is a few
    /// more. Nobody legitimately starts dozens of checkouts an hour.</para>
    /// </summary>
    public const string BillingCheckout = "billing_checkout";

    /// <summary>
    /// The payment-provider callback (<c>POST /api/billing/webhook/{provider}</c>).
    ///
    /// <para>Anonymous by necessity — the provider calls it, not a logged-in user — so the partition
    /// is the source IP. It is NOT the security control: signature verification is (an unverified
    /// webhook is a self-service premium button for anyone who can reach the URL). This only stops a
    /// flood of forged callbacks from spending database work on rejecting them one at a time.</para>
    ///
    /// <para>Generous, because a real provider legitimately retries a callback it thinks failed, and
    /// rate-limiting a genuine payment notification into oblivion would lose a payment we have
    /// already taken.</para>
    /// </summary>
    public const string BillingWebhook = "billing_webhook";

    /// <summary>
    /// One phoneme-drill attempt (<c>POST /api/drills/attempts</c>).
    ///
    /// <para>Deliberately NOT <see cref="SubmitAudio"/>, even though both spend Azure calls. A drill
    /// utterance is one word and takes a few seconds, so a learner legitimately runs through them
    /// many times faster than they submit graded answers; sharing the submit scope would mean a
    /// student who drilled for five minutes could no longer record a real answer, which is the
    /// feature getting in the way of the product.</para>
    ///
    /// <para>This is the burst ceiling. The per-student DAILY budget lives in
    /// <c>DrillService</c> — the two are separate because a daily count cannot stop a burst and a
    /// rate limit cannot express "forty a day".</para>
    /// </summary>
    public const string DrillAttempt = "drill_attempt";
}
