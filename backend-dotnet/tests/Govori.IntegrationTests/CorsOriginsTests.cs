using Govori.Api.Startup;

namespace Govori.IntegrationTests;

/// <summary>
/// Parsing and validation of <c>BACKEND_CORS_ORIGINS</c> (<see cref="CorsOrigins"/>).
///
/// <para>The value decides which OTHER websites a logged-in user's browser will hand this API's
/// answers to, so both halves matter: what a well-formed list parses to, and which malformed lists
/// are refused rather than quietly honoured.</para>
/// </summary>
public sealed class CorsOriginsTests
{
    // ── parsing ──────────────────────────────────────────────────────────────

    [Fact]
    public void Absent_or_empty_means_no_cors_at_all()
    {
        // The production deployment is same-origin (nginx proxies /api), so this is the NORMAL case
        // and must produce no policy rather than a permissive one.
        Assert.Empty(CorsOrigins.Parse(null));
        Assert.Empty(CorsOrigins.Parse(""));
        Assert.Empty(CorsOrigins.Parse("   "));
        Assert.Empty(CorsOrigins.Parse(",, ,"));
    }

    [Fact]
    public void Origins_are_split_and_trimmed()
    {
        var origins = CorsOrigins.Parse(" https://govorim.uz , https://www.govorim.uz ");
        Assert.Equal(new[] { "https://govorim.uz", "https://www.govorim.uz" }, origins);
    }

    /// <summary>The browser's <c>Origin</c> header never carries a trailing slash, so
    /// <c>WithOrigins("https://govorim.uz/")</c> matches nothing — a typo that presents as "CORS is
    /// broken" rather than as a bad value.</summary>
    [Fact]
    public void A_trailing_slash_is_stripped_so_the_origin_actually_matches()
    {
        Assert.Equal(new[] { "https://govorim.uz" }, CorsOrigins.Parse("https://govorim.uz/"));
    }

    [Fact]
    public void Duplicates_collapse()
    {
        Assert.Equal(
            new[] { "https://govorim.uz" },
            CorsOrigins.Parse("https://govorim.uz,https://govorim.uz/,HTTPS://GOVORIM.UZ"));
    }

    // ── validation ───────────────────────────────────────────────────────────

    [Fact]
    public void A_healthy_production_list_reports_no_problems()
    {
        Assert.Empty(CorsOrigins.Problems("https://govorim.uz,https://www.govorim.uz"));
    }

    [Fact]
    public void The_dev_origins_report_no_problems()
    {
        Assert.Empty(CorsOrigins.Problems("http://localhost:5173,http://localhost:3000"));
    }

    [Theory]
    [InlineData("*")]
    [InlineData("https://govorim.uz,*")]
    [InlineData("https://*.govorim.uz")]
    public void A_wildcard_is_refused_rather_than_downgraded(string raw)
    {
        // This API is called with a bearer token. A wildcard origin means any site can read a
        // logged-in user's data, and silently dropping AllowCredentials instead would turn a
        // security mistake into a mysteriously broken feature.
        Assert.Contains(CorsOrigins.Problems(raw), p => p.Contains("wildcard", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("govorim.uz")]                     // no scheme — never matches an Origin header
    [InlineData("https://govorim.uz/app")]         // an Origin has no path
    [InlineData("ftp://govorim.uz")]               // not a browser origin scheme
    public void A_value_that_is_not_an_origin_is_reported(string raw)
    {
        Assert.Contains(CorsOrigins.Problems(raw), p => p.Contains("is not an origin", StringComparison.Ordinal));
    }

    [Fact]
    public void An_explicit_port_is_a_valid_origin()
    {
        Assert.Empty(CorsOrigins.Problems("http://localhost:5173"));
    }
}
