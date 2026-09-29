using System.Net;
using System.Security.Claims;
using Govori.Api.RateLimiting;
using Microsoft.AspNetCore.Http;

namespace Govori.IntegrationTests;

/// <summary>
/// The rate-limit partition key must not be movable by the caller.
///
/// <para>It used to take the FIRST X-Forwarded-For hop, which is whatever the client wrote — and
/// nginx appended to that header rather than replacing it. So an anonymous caller could send a fresh
/// <c>X-Forwarded-For: &lt;random&gt;</c> on every request, land in a fresh partition each time, and
/// never meet a per-IP limit: OTP sends, guest grading and the public placement were all unlimited.
/// These pin the fix on the API side (the LAST hop, the one the nearest proxy wrote); the nginx side
/// now overwrites the header as well.</para>
///
/// <para>Driven with a hand-built <see cref="HttpContext"/> rather than through a host: the rule is a
/// pure function of the request, and a TestServer has no real socket peer to make the fallback case
/// meaningful.</para>
/// </summary>
public sealed class RateLimitIdentityTests
{
    private static HttpContext Anonymous(string? forwardedFor, string socketPeer = "172.18.0.5")
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(socketPeer);
        if (forwardedFor is not null)
            context.Request.Headers["X-Forwarded-For"] = forwardedFor;
        return context;
    }

    [Fact]
    public void A_spoofed_first_hop_does_not_change_the_partition()
    {
        // What nginx with $proxy_add_x_forwarded_for produced: "<whatever the client sent>, <real peer>".
        var first = RateLimitIdentity.Resolve(Anonymous("1.1.1.1, 203.0.113.7"));
        var second = RateLimitIdentity.Resolve(Anonymous("9.9.9.9, 203.0.113.7"));
        var third = RateLimitIdentity.Resolve(Anonymous("10.0.0.1, 8.8.8.8, 203.0.113.7"));

        Assert.Equal("ip:203.0.113.7", first);
        Assert.Equal(first, second);
        Assert.Equal(first, third);
    }

    [Fact]
    public void The_single_hop_the_edge_writes_is_the_client_address()
        // What the nginx configs now send: X-Forwarded-For overwritten with $remote_addr.
        => Assert.Equal("ip:203.0.113.7", RateLimitIdentity.Resolve(Anonymous("203.0.113.7")));

    [Fact]
    public void Several_forwarded_headers_are_read_as_one_list_and_the_last_hop_wins()
    {
        var context = Anonymous(forwardedFor: null);
        context.Request.Headers.Append("X-Forwarded-For", "1.2.3.4");
        context.Request.Headers.Append("X-Forwarded-For", " 203.0.113.7 ");

        Assert.Equal("ip:203.0.113.7", RateLimitIdentity.Resolve(context));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" , ")]
    public void Without_a_usable_header_the_socket_peer_is_the_key(string? forwardedFor)
        => Assert.Equal("ip:172.18.0.5", RateLimitIdentity.Resolve(Anonymous(forwardedFor)));

    [Fact]
    public void An_authenticated_caller_is_keyed_by_user_whatever_the_header_says()
    {
        var context = Anonymous("9.9.9.9, 203.0.113.7");
        context.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", "user-42") }, "test"));

        Assert.Equal("u:user-42", RateLimitIdentity.Resolve(context));
    }
}
