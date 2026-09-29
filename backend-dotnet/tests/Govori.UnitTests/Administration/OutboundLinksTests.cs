using Govori.Administration;

namespace Govori.UnitTests.Administration;

/// <summary>
/// Drives the pure contact-link normaliser (<see cref="OutboundLinks.TryNormalize"/>) directly. The
/// values it guards become <c>href</c>s in every student's sidebar, so the two properties that matter
/// are asserted here without HTTP: what people actually paste for Telegram comes out as a working
/// link, and nothing that is not an http(s) link — <c>javascript:</c> above all — gets through. The
/// endpoint wiring (field name in the 400, "" still clearing) is covered by
/// AdministrationEndpointsTests.
/// </summary>
public class OutboundLinksTests
{
    [Theory]
    [InlineData("https://t.me/govori_support", "https://t.me/govori_support")]
    [InlineData("http://example.uz/help", "http://example.uz/help")]
    [InlineData("  https://t.me/x  ", "https://t.me/x")]                  // trimmed
    [InlineData("HTTPS://T.ME/Chan", "HTTPS://T.ME/Chan")]                // an explicit link is stored as typed
    // The two Telegram shapes people paste are rewritten to the canonical link.
    [InlineData("t.me/govori_channel", "https://t.me/govori_channel")]
    [InlineData("T.me/Govori", "https://t.me/Govori")]
    [InlineData("t.me/+AbCdEf123", "https://t.me/+AbCdEf123")]           // private invite links too
    [InlineData("@govori_support", "https://t.me/govori_support")]
    public void Accepts_links_and_normalises_telegram_shorthand(string raw, string expected)
    {
        Assert.True(OutboundLinks.TryNormalize(raw, out var link));
        Assert.Equal(expected, link);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_is_the_clear_value_not_an_error(string raw)
    {
        Assert.True(OutboundLinks.TryNormalize(raw, out var link));
        Assert.Equal("", link);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]          // the stored-XSS case
    [InlineData("ftp://t.me/x")]                 // wrong scheme
    [InlineData("/relative/path")]               // parses as file:// on Linux — must still fail
    [InlineData("govori.uz")]                    // a bare domain is not a link
    [InlineData("telegram.me/x")]                // only t.me shorthand is rewritten
    [InlineData("t.me/")]                        // Telegram's home page, not a chat
    [InlineData("@")]
    [InlineData("@bad handle")]
    [InlineData("@bad-handle")]
    [InlineData("https://t.me/a b")]             // prose, not a link
    [InlineData("https://")]
    public void Refuses_anything_that_is_not_an_http_link(string raw)
    {
        Assert.False(OutboundLinks.TryNormalize(raw, out var link));
        Assert.Null(link);
    }
}
