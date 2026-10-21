using System.Runtime.CompilerServices;
using System.Security.Claims;

// The partition-key rule below is a security property (it is what a spoofed header must NOT be able
// to move), so it is pinned by a test that calls Resolve directly with a hand-built HttpContext.
// Internal stays internal; this only widens visibility to that sibling test assembly.
[assembly: InternalsVisibleTo("Govori.IntegrationTests")]

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
/// authentication, or every request looks anonymous and collapses back onto IP keying.</para>
///
/// <para><b>Which X-Forwarded-For hop, and why it is the LAST one.</b> Behind nginx the socket peer
/// is the proxy container, so the client address has to come from X-Forwarded-For. But that header
/// is a list that anyone can START: a client may send <c>X-Forwarded-For: 1.2.3.4</c> itself, and a
/// proxy configured with <c>$proxy_add_x_forwarded_for</c> APPENDS to it rather than replacing it.
/// The first hop is therefore whatever the caller chose to write, and keying on it let every
/// anonymous request pick a fresh partition — every per-IP limit (OTP sends, the public
/// placement) was one header away from unlimited. The last hop is the one written by the
/// proxy nearest to us, which is the only entry the client cannot forge.</para>
///
/// <para>Two layers hold this, on purpose. The edge nginx (deploy/nginx/*.conf) OVERWRITES the header
/// with <c>$remote_addr</c>, so today it carries exactly one hop; reading the last hop here means a
/// future revert to <c>$proxy_add_x_forwarded_for</c> — the value most nginx examples show — is still
/// safe rather than silently reopening the bypass. Both rest on one deployment fact: the API is
/// reachable ONLY through that nginx. Production publishes no API port; the dev compose publishes
/// one for convenience, and a request sent straight to it can still write this header — acceptable on
/// a laptop, never on a server. There is no ForwardedHeaders middleware in this host, so nothing else
/// rewrites <c>RemoteIpAddress</c> from the header either.</para>
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
        // Several X-Forwarded-For headers arrive joined with commas, so this reads the last hop of
        // the last header — the same entry a single appended header would put last.
        var hops = context.Request.Headers["X-Forwarded-For"].ToString()
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (hops.Length > 0)
            return hops[^1];
        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
