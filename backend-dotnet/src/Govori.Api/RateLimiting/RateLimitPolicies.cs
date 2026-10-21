using System.Threading.RateLimiting;
using Govori.Contracts;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Wires the ASP.NET Core RateLimiter for the whole API (docs/07 §7.3: "ASP.NET Core RateLimiter +
/// Redis — fail-open!"). Registers one named policy per rate-limited scope, keyed per-user-or-IP
/// (<see cref="RateLimitIdentity"/>), backed by <see cref="IRateLimitStore"/>, and — critically —
/// FAIL-OPEN (the allow-on-store-error decision is in <see cref="StoreBackedRateLimiter"/>).
/// Rejections answer 429 with the <c>{ "detail": ... }</c> body shape used across the API.
/// </summary>
internal static class RateLimitPolicies
{
    /// <summary>(policy name / counter scope, max requests, window) — one row per rate-limited
    /// scope. The limits are deliberate product choices: email_code 5/600 (an OTP costs money to
    /// send), login 10/300 (also covers the Google sign-in route, which shares this policy),
    /// guest_placement 30/3600 (auth-less routes, so IP is the only key).</summary>
    private static readonly (string Name, int Limit, TimeSpan Window)[] Policies =
    {
        (RateLimitPolicyNames.EmailCode, 5, TimeSpan.FromSeconds(600)),
        // OTP delivery-status polling. NOT email_code: the client polls for the whole 10-minute OTP
        // window, so email_code's 5/600 would 429 the feature dead after ten seconds.
        //
        // Sized for a CLASSROOM behind one NAT, which is the normal case here — groups run ~18
        // students (docs/04 Guruh) on shared school wifi or a carrier CGNAT, and a whole class
        // signing up together is exactly when this must not break. At the client's 3 s interval one
        // user costs 20 calls/min, so 1200/60 s per-IP covers ~60 concurrent pollers on one address
        // while still capping a single abuser at 20 rps. The read is one Redis GET returning an
        // opaque state string that grants nothing, so a loose cap is cheap. Fail-open like the rest.
        (RateLimitPolicyNames.OtpStatus, 1200, TimeSpan.FromSeconds(60)),
        (RateLimitPolicyNames.Login, 10, TimeSpan.FromSeconds(300)),
        // Verified phone change, shared by request + confirm. A HUMAN rate: one successful change is
        // exactly 2 hits, so 10/3600 s is ~5 complete attempts an hour — room to mistype the number
        // or wait out a code that never arrived, no room to grind. Both routes require auth, so the
        // partition is the user id (see RateLimitIdentity) rather than a shared classroom IP.
        (RateLimitPolicyNames.PhoneChange, 10, TimeSpan.FromSeconds(3600)),
        // Public "try the placement" flow. A 3-answer session is ~4 hits; 30/hour
        // per IP allows a handful of retries/sessions while capping abuse. Fail-open like the rest.
        (RateLimitPolicyNames.GuestPlacement, 30, TimeSpan.FromSeconds(3600)),

        // Recording an answer — one Azure STT + one grader call, billed per request.
        //
        // 60/hour, and the number is derived rather than picked. A measured end-to-end grade takes
        // ~16 s and a student speaks for 15–60 s before it, so even a student doing nothing but
        // practising lands somewhere around 20–30 answers an hour. 60 is roughly double the most
        // energetic real user, which is the property that matters: NO real student should ever meet
        // this, so it costs the product nothing. What it does stop is the thing a human cannot do —
        // a client retry loop, or a script, running this route thousands of times an hour.
        //
        // Deliberately NOT tighter. This is a cost tail-trim, and a limit low enough to interrupt a
        // motivated learner would be a worse bug than the bill it prevents.
        //
        // The partition is the USER id (the route is authenticated), so a class of eighteen on one
        // school IP each get their own budget — see RateLimitIdentity for why that matters.
        (RateLimitPolicyNames.SubmitAudio, 60, TimeSpan.FromSeconds(3600)),

        // Authenticated placement submit — same vendor cost, but the flow is 3 answers and is taken
        // ONCE after registering. 30/hour is ten full sessions: room to retry a failed recording or
        // restart the test, no room for a loop.
        (RateLimitPolicyNames.PlacementSubmit, 30, TimeSpan.FromSeconds(3600)),

        // Admin key probe — one press bills up to five vendors. 10/hour is a person pasting keys
        // and checking them; it is a guard against a double-clicked button and a reloading settings
        // screen, not against the admin.
        (RateLimitPolicyNames.AdminProbe, 10, TimeSpan.FromSeconds(3600)),

        // Starting a purchase. A person buying premium presses once; a mistyped card and a retry is
        // a handful more. 20/hour per USER leaves that untouched and stops anyone minting a fresh
        // idempotency key in a loop — which is the one thing the key itself cannot stop.
        (RateLimitPolicyNames.BillingCheckout, 20, TimeSpan.FromSeconds(3600)),

        // Provider callbacks, per SOURCE IP (the caller is a provider, not a user). Deliberately
        // generous: providers retry callbacks they believe failed, and throttling a genuine payment
        // notification away would lose money we have already taken. The security control here is the
        // signature check, never this number.
        (RateLimitPolicyNames.BillingWebhook, 600, TimeSpan.FromSeconds(3600)),

        // One phoneme-drill attempt — one Azure call, and a second one when the learner missed.
        //
        // 120/hour, derived the same way submit_audio's 60 was. A drill utterance is a single word:
        // record, listen, retry takes maybe fifteen seconds, so an unusually determined learner
        // lands near 60–90 an hour once you allow for reading the result. 120 sits just past the
        // most energetic real session, which is the property that matters — no real student should
        // ever meet it. The per-student DAILY budget (DrillService, 40/day) is the product ceiling;
        // this one exists for the retry loop and the script, which is why it is higher than the
        // daily number rather than a fraction of it.
        //
        // Partitioned by USER id — the route is authenticated — so a class on one school IP each get
        // their own budget.
        (RateLimitPolicyNames.DrillAttempt, 120, TimeSpan.FromSeconds(3600)),
    };

    private const string TooManyRequestsBody = "{\"detail\":\"Too many requests. Please try again later.\"}";

    public static IServiceCollection AddGovoriRateLimiter(this IServiceCollection services, IConfiguration config)
    {
        // Default store is process-local (safe for tests, no Redis at boot). The deployed stacks opt
        // into the Redis-backed, cross-instance store with GOVORI_RATELIMIT_BACKEND=redis (both
        // compose files set it; docs/07 §7.3). TryAdd so integration tests can pre-register
        // a fake store (throwing → prove fail-open; counting → prove 429) via ConfigureTestServices.
        var backend = config["GOVORI_RATELIMIT_BACKEND"] ?? "memory";
        if (string.Equals(backend, "redis", StringComparison.OrdinalIgnoreCase))
            services.TryAddSingleton<IRateLimitStore, RedisRateLimitStore>();
        else
            services.TryAddSingleton<IRateLimitStore, InMemoryRateLimitStore>();

        services.AddRateLimiter(options =>
        {
            // ⚠ A rate-limit rejection MUST answer 429. ASP.NET Core's RateLimiter defaults to 503,
            // which clients read as "server down" and retry into — this override is deliberate.
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, ct) =>
            {
                context.HttpContext.Response.ContentType = "application/json";
                await context.HttpContext.Response.WriteAsync(TooManyRequestsBody, ct);
            };

            foreach (var (name, limit, window) in Policies)
            {
                // Capture per-policy values; partition per identity so each user/IP gets its own
                // fixed window under the counter key "rl:{scope}:{identity}".
                var policyLimit = limit;
                var policyWindow = window;
                var scope = name;

                options.AddPolicy(name, httpContext =>
                {
                    var identity = RateLimitIdentity.Resolve(httpContext);
                    var partitionKey = $"rl:{scope}:{identity}";
                    var store = httpContext.RequestServices.GetRequiredService<IRateLimitStore>();
                    return RateLimitPartition.Get(
                        partitionKey,
                        key => new StoreBackedRateLimiter(store, key, policyLimit, policyWindow));
                });
            }
        });

        return services;
    }
}
