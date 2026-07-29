using System.Security.Claims;

namespace Govori.Api.RateLimiting;

/// <summary>
/// Resolves the rate-limit identity (the partition key): the authenticated user id when the request
/// carries a valid bearer token (<c>u:{sub}</c>), falling back to the client IP otherwise
/// (<c>ip:{...}</c>).
///
/// <para>IP-only keying caused a real classroom bug: a school lab behind ONE NAT'd IP shares a
/// single counter, so a handful of students get spuriously limited while their classmates succeed.
/// Keying by user id whenever it is known avoids that. <c>sub</c> is read from the JWT that
/// <c>UseAuthentication</c> has ALREADY validated — so the limiter must be registered AFTER
/// authentication, or every request looks anonymous and collapses back onto IP keying. The first
/// X-Forwarded-For hop is preferred for the IP because behind nginx/DO the real client address is
/// there, not on the socket.</para>
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
