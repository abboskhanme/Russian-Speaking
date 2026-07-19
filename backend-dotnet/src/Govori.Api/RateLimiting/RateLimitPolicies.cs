using System.Threading.RateLimiting;
using Govori.Contracts;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Wires the ASP.NET Core RateLimiter to mirror <c>backend/app/core/ratelimit.py</c> (docs/07 §7.3:
/// "ASP.NET Core RateLimiter + Redis, ratelimit.py semantikasi saqlanadi — fail-open!"). Registers
/// one named policy per Python <c>rate_limit(scope, max, window)</c> usage the .NET slice enforces,
/// keyed per-user-or-IP (<see cref="RateLimitIdentity"/>), backed by <see cref="IRateLimitStore"/>,
/// and — critically — FAIL-OPEN (the allow-on-store-error decision is in
/// <see cref="StoreBackedRateLimiter"/>). Rejections answer 429 with FastAPI's <c>{ "detail": ... }</c>
/// body, matching ratelimit.py:56-59.
/// </summary>
internal static class RateLimitPolicies
{
    /// <summary>(policy name / counter scope, max requests, window) — one row per enforced Python
    /// <c>rate_limit(...)</c>. Limits are the Python literals: email_code 5/600 (auth.py:76),
    /// login 10/300 (auth.py:145; also Google auth.py:174 uses the same policy), guest_assess
    /// 15/3600 (guest.py:68), guest_tts 60/3600 (guest.py:131).</summary>
    private static readonly (string Name, int Limit, TimeSpan Window)[] Policies =
    {
        (RateLimitPolicyNames.EmailCode, 5, TimeSpan.FromSeconds(600)),
        (RateLimitPolicyNames.Login, 10, TimeSpan.FromSeconds(300)),
        (RateLimitPolicyNames.GuestAssess, 15, TimeSpan.FromSeconds(3600)),
        (RateLimitPolicyNames.GuestTts, 60, TimeSpan.FromSeconds(3600)),
    };

    private const string TooManyRequestsBody = "{\"detail\":\"Too many requests. Please try again later.\"}";

    public static IServiceCollection AddGovoriRateLimiter(this IServiceCollection services, IConfiguration config)
    {
        // Default store is process-local (safe for tests, no Redis at boot). Opt into the
        // implemented Redis-backed, cross-instance store with GOVORI_RATELIMIT_BACKEND=redis
        // (distributed-limiting TODO, docs/07 §7.3). TryAdd so integration tests can pre-register
        // a fake store (throwing → prove fail-open; counting → prove 429) via ConfigureTestServices.
        var backend = config["GOVORI_RATELIMIT_BACKEND"] ?? "memory";
        if (string.Equals(backend, "redis", StringComparison.OrdinalIgnoreCase))
            services.TryAddSingleton<IRateLimitStore, RedisRateLimitStore>();
        else
            services.TryAddSingleton<IRateLimitStore, InMemoryRateLimitStore>();

        services.AddRateLimiter(options =>
        {
            // Python answers 429 (ratelimit.py:57). ASP.NET Core defaults to 503 — override it.
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, ct) =>
            {
                context.HttpContext.Response.ContentType = "application/json";
                await context.HttpContext.Response.WriteAsync(TooManyRequestsBody, ct);
            };

            foreach (var (name, limit, window) in Policies)
            {
                // Capture per-policy values; partition per identity so each user/IP gets its own
                // fixed window (ratelimit.py key = "rl:{scope}:{identity}").
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
