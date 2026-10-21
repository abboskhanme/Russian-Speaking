using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Sentry;
using Sentry.AspNetCore;

namespace Govori.Api.Startup;

/// <summary>
/// Optional error reporting to any Sentry-compatible endpoint (sentry.io, a self-hosted Sentry,
/// GlitchTip, …), switched by one environment variable: <c>SENTRY_DSN</c>.
///
/// <para><b>Unset means OFF, not "on with nowhere to send".</b> <see cref="UseGovoriErrorReporting"/>
/// does not call <c>UseSentry</c> at all when the DSN is blank, so no SDK is initialised, no
/// middleware is added, no background worker starts and nothing ever opens a socket. A DSN-less SDK
/// would also be inert, but "inert because the SDK happens to check" is not a property this host
/// should depend on — the package is simply not wired.</para>
///
/// <para><b>What it reports: unhandled request exceptions, and nothing else.</b> Serilog owns
/// logging (<c>UseSerilog</c> replaces the logger factory), so the SDK's logging integration never
/// sees a log line; its levels are additionally pinned to <c>None</c> so that stays true even if the
/// Serilog wiring changes. Tracing, sessions, failed-HTTP-client capture and client reports are off:
/// OpenTelemetry already owns traces, and every one of those is a second channel for request data.
/// A client that hung up is handled by <see cref="ClientAbort"/> before the exception handler, so it
/// is never reported either.</para>
///
/// <para><b>What it never sends.</b> This is a learner product: students' audio, phone numbers and
/// tokens flow through every request. So the event is reduced to the exception and the route:</para>
/// <list type="bullet">
///   <item>no request body (<c>MaxRequestBodySize = None</c>) — audio uploads and OTP payloads;</item>
///   <item>no headers at all (Authorization, Cookie, X-Forwarded-For live there), no cookies, no
///   query string (SignalR carries the JWT as <c>?access_token=</c>), no environment;</item>
///   <item>no user (id, IP, email) — <c>SendDefaultPii = false</c> and the user is cleared anyway;</item>
///   <item>no breadcrumbs — the HttpClient breadcrumb is the outgoing URL, and the Telegram Bot API
///   carries its token IN the URL path (the same leak <c>LoggingConfigTests</c> guards for logs);</item>
///   <item>exception messages are passed through <see cref="Redact"/>, which masks the token shapes
///   this codebase is known to handle (bot tokens, bearer tokens, <c>key=</c>/<c>token=</c>/
///   <c>signature=</c>/<c>password=</c> pairs).</item>
/// </list>
/// <para>The scrubbing is done in <see cref="Scrub"/>, a pure function, so "no secrets leave" is a
/// test rather than a code review.</para>
/// </summary>
public static class ErrorReporting
{
    /// <summary>The single switch. Read through configuration, so it is an env var in production.</summary>
    public const string DsnKey = "SENTRY_DSN";

    /// <summary>The DSN to report to, or <c>null</c> when reporting is off (unset, empty or blank).</summary>
    public static string? Dsn(IConfiguration configuration)
    {
        var dsn = configuration[DsnKey];
        return string.IsNullOrWhiteSpace(dsn) ? null : dsn.Trim();
    }

    /// <summary>
    /// Wire Sentry into the web host when — and only when — <c>SENTRY_DSN</c> is set. Returns whether
    /// it did, so Program can say so in the boot log.
    /// </summary>
    public static bool UseGovoriErrorReporting(
        this IWebHostBuilder webHost, IConfiguration configuration, string environmentName)
    {
        var dsn = Dsn(configuration);
        if (dsn is null)
            return false;

        webHost.UseSentry(options => Configure(options, dsn, environmentName));
        return true;
    }

    /// <summary>Every option this host sets. Public so the test asserts the real configuration.</summary>
    public static void Configure(SentryAspNetCoreOptions options, string dsn, string environmentName)
    {
        options.Dsn = dsn;
        options.Environment = environmentName.ToLowerInvariant();

        // Request data: none of it.
        options.SendDefaultPii = false;
        options.MaxRequestBodySize = Sentry.Extensibility.RequestSize.None;
        options.IsEnvironmentUser = false;

        // One channel only: exceptions from the request pipeline.
        options.MinimumEventLevel = LogLevel.None;
        options.MinimumBreadcrumbLevel = LogLevel.None;
        options.CaptureFailedRequests = false;
        options.TracesSampleRate = 0;
        options.AutoSessionTracking = false;
        options.SendClientReports = false;

        options.SetBeforeBreadcrumb((Breadcrumb _, SentryHint _) => null);
        options.SetBeforeSend((sentryEvent, _) => Scrub(sentryEvent));
    }

    /// <summary>
    /// Reduce an event to what is safe to leave the box: exception type, (redacted) message, stack,
    /// method and path. Mutates and returns the same event (the SDK's BeforeSend contract).
    /// </summary>
    public static SentryEvent Scrub(SentryEvent sentryEvent)
    {
        var request = sentryEvent.Request;
        request.Data = null;
        request.Cookies = null;
        request.QueryString = null;
        request.Headers.Clear();
        request.Env.Clear();
        if (request.Url is { } url)
        {
            var cut = url.IndexOfAny(['?', '#']);
            request.Url = cut >= 0 ? url[..cut] : url;
        }

        sentryEvent.User = new SentryUser();

        if (sentryEvent.Message is { } message)
        {
            message.Message = Redact(message.Message);
            message.Formatted = Redact(message.Formatted);
        }

        foreach (var exception in sentryEvent.SentryExceptions ?? [])
            exception.Value = Redact(exception.Value);

        return sentryEvent;
    }

    private static readonly Regex BotToken = new(
        @"bot\d{5,}:[A-Za-z0-9_-]{20,}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex Bearer = new(
        @"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SecretPair = new(
        @"(?i)\b(access_token|refresh_token|token|key|api_key|apikey|signature|x-amz-signature|x-amz-credential|password|pwd|secret)=[^&\s;,'""]+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Mask the credential shapes this codebase handles. Null in, null out.</summary>
    public static string? Redact(string? text)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        text = BotToken.Replace(text, "bot[redacted]");
        text = Bearer.Replace(text, "Bearer [redacted]");
        return SecretPair.Replace(text, match => match.Groups[1].Value + "=[redacted]");
    }
}
