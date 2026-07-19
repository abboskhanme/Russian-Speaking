using System.Security.Claims;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Resolves the rate-limit identity (the partition key) exactly like <c>ratelimit.py</c>'s
/// <c>_client_identity</c> (ratelimit.py:35-41): the authenticated user id when the request carries
/// a valid bearer token (<c>u:{sub}</c>), falling back to the client IP otherwise (<c>ip:{...}</c>).
///
/// <para>IP-only keying was a real classroom bug (ratelimit.py:6-13): a school lab behind ONE NAT'd
/// IP shares a single counter, so a handful of students get spuriously limited while classmates
/// succeed. Keying by user id when known avoids that. Here <c>sub</c> comes from the JWT that
/// <c>UseAuthentication</c> already validated (so the limiter must run AFTER it), which is stricter
/// than Python's manual decode and never throws. First X-Forwarded-For hop mirrors
/// <c>_client_ip</c> (behind nginx/DO the real client IP is there).</para>
/// </summary>
internal static class RateLimitIdentity
{
    public static string Resolve(HttpContext context)
    {
        try
        {
            var sub = context.User?.FindFirstValue("sub");
            if (!string.IsNullOrEmpty(sub))
                return $"u:{sub}";
            return $"ip:{ClientIp(context)}";
        }
        catch
        {
            // Identity resolution must never throw into the limiter (which would 500). Degrade to a
            // shared partition rather than fail the request.
            return "ip:unknown";
        }
    }

    private static string ClientIp(HttpContext context)
    {
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrEmpty(forwarded))
            return forwarded.Split(',')[0].Trim();
        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
