using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Govori.Api.Startup;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Sentry;
using Sentry.AspNetCore;
using Sentry.Extensibility;
using Sentry.Protocol.Envelopes;

namespace Govori.IntegrationTests;

/// <summary>
/// Optional Sentry-compatible error reporting (<see cref="ErrorReporting"/>): OFF and unwired without
/// <c>SENTRY_DSN</c>; with it, an unhandled exception is reported and nothing the request carried —
/// body, headers, cookies, query string, user — leaves the host.
///
/// <para>The end-to-end case runs the real host with a DSN that points nowhere routable and swaps the
/// SDK's transport for one that records envelopes in memory, so no packet is sent. It then searches
/// the SERIALIZED envelope — exactly the bytes that would go over the wire — for the secrets the
/// request carried. Checking the event object instead would miss anything the SDK adds while
/// serializing.</para>
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class ErrorReportingTests
{
    private const string BoomPath = "/__test/boom";

    // ── The switch ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_dsn_means_off(string? value)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [ErrorReporting.DsnKey] = value })
            .Build();

        Assert.Null(ErrorReporting.Dsn(configuration));
    }

    [Fact]
    public void Without_a_dsn_the_sdk_is_not_wired_into_the_host()
    {
        using var factory = new ReportingApiFactory(dsn: null, transport: null);
        _ = factory.CreateClient();

        // UseSentry registers IHub; its absence means no SDK, no middleware, no background worker.
        Assert.Null(factory.Services.GetService<IHub>());
    }

    // ── The options ─────────────────────────────────────────────────────────

    [Fact]
    public void Every_secondary_channel_is_off()
    {
        var options = new SentryAspNetCoreOptions();
        ErrorReporting.Configure(options, "https://k@example.invalid/1", "Production");

        Assert.False(options.SendDefaultPii);
        Assert.Equal(RequestSize.None, options.MaxRequestBodySize);
        Assert.False(options.CaptureFailedRequests);
        Assert.Equal(0, options.TracesSampleRate);
        Assert.False(options.AutoSessionTracking);
        Assert.Equal(Microsoft.Extensions.Logging.LogLevel.None, options.MinimumEventLevel);
        Assert.Equal(Microsoft.Extensions.Logging.LogLevel.None, options.MinimumBreadcrumbLevel);
        Assert.Equal("production", options.Environment);
    }

    // ── The scrubber ────────────────────────────────────────────────────────

    [Fact]
    public void Scrub_strips_everything_the_request_carried()
    {
        var sentryEvent = new SentryEvent(new InvalidOperationException(
            "call to https://api.telegram.org/bot1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/sendMessage failed"));
        sentryEvent.Request.Method = "POST";
        sentryEvent.Request.Url = "https://govorim.uz/hubs/attempts?access_token=SECRET-QUERY";
        sentryEvent.Request.QueryString = "access_token=SECRET-QUERY";
        sentryEvent.Request.Cookies = "refresh=SECRET-COOKIE";
        sentryEvent.Request.Data = "SECRET-BODY";
        sentryEvent.Request.Headers["Authorization"] = "Bearer SECRET-HEADER";
        sentryEvent.Request.Env["REMOTE_ADDR"] = "203.0.113.7";
        sentryEvent.User = new SentryUser { Id = "42", IpAddress = "203.0.113.7", Email = "s@govorim.uz" };
        sentryEvent.Message = new SentryMessage { Message = "key=SECRET-KEY", Formatted = "key=SECRET-KEY" };

        var scrubbed = ErrorReporting.Scrub(sentryEvent);

        Assert.Equal("https://govorim.uz/hubs/attempts", scrubbed.Request.Url);
        Assert.Null(scrubbed.Request.QueryString);
        Assert.Null(scrubbed.Request.Cookies);
        Assert.Null(scrubbed.Request.Data);
        Assert.Empty(scrubbed.Request.Headers);
        Assert.Empty(scrubbed.Request.Env);
        Assert.Null(scrubbed.User.Id);
        Assert.Null(scrubbed.User.IpAddress);
        Assert.Null(scrubbed.User.Email);
        Assert.Equal("key=[redacted]", scrubbed.Message!.Formatted);
        Assert.Equal("POST", scrubbed.Request.Method);
    }

    [Theory]
    [InlineData("GET https://api.telegram.org/bot1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/getUpdates", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "eyJhbGciOiJIUzI1NiJ9")]
    [InlineData("https://generativelanguage.googleapis.com/v1/models:generate?key=AIzaSECRET123", "AIzaSECRET123")]
    [InlineData("/govori-audio/a.webm?X-Amz-Credential=govori-app%2F2026&X-Amz-Signature=abc123def", "abc123def")]
    [InlineData("Host=db;Username=russpeak;Password=hunter2;Database=russpeak", "hunter2")]
    public void Redact_masks_the_credential_shapes_this_codebase_handles(string text, string secret)
    {
        var redacted = ErrorReporting.Redact(text);

        Assert.DoesNotContain(secret, redacted, StringComparison.Ordinal);
        Assert.Contains("[redacted]", redacted, StringComparison.Ordinal);
    }

    [Fact]
    public void Redact_leaves_ordinary_messages_alone()
    {
        const string text = "Object reference not set to an instance of an object.";
        Assert.Equal(text, ErrorReporting.Redact(text));
        Assert.Null(ErrorReporting.Redact(null));
    }

    // ── End to end ──────────────────────────────────────────────────────────

    [Fact]
    public async Task An_unhandled_exception_is_reported_without_anything_the_request_carried()
    {
        var transport = new RecordingTransport();
        using var factory = new ReportingApiFactory("https://publickey@sentry.invalid/1", transport);
        var client = factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Post, BoomPath + "?access_token=SECRET-QUERY")
        {
            Content = new StringContent("{\"phone\":\"+998901234567\",\"otp\":\"SECRET-BODY\"}", Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Authorization", "Bearer SECRET-HEADER");
        request.Headers.Add("Cookie", "refresh=SECRET-COOKIE");
        request.Headers.Add("X-Forwarded-For", "203.0.113.7");

        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        // The SDK hands envelopes to the transport from a background worker.
        var wire = await transport.WaitForEventAsync(TimeSpan.FromSeconds(15));

        Assert.Contains(nameof(ErrorReportingBoomException), wire, StringComparison.Ordinal);
        foreach (var secret in new[] { "SECRET-QUERY", "SECRET-BODY", "SECRET-HEADER", "SECRET-COOKIE", "203.0.113.7", "+998901234567" })
            Assert.DoesNotContain(secret, wire, StringComparison.Ordinal);
    }

    /// <summary>A distinctive type, so the assertion finds THIS exception in the envelope.</summary>
    public sealed class ErrorReportingBoomException(string message) : Exception(message);

    /// <summary>Captures what the SDK would send, serialized exactly as it would go over the wire.</summary>
    private sealed class RecordingTransport : ITransport
    {
        private readonly ConcurrentQueue<string> _sent = new();

        public async Task SendEnvelopeAsync(Envelope envelope, CancellationToken cancellationToken = default)
        {
            using var stream = new MemoryStream();
            await envelope.SerializeAsync(stream, null, cancellationToken);
            _sent.Enqueue(Encoding.UTF8.GetString(stream.ToArray()));
        }

        public async Task<string> WaitForEventAsync(TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                var hit = _sent.FirstOrDefault(s => s.Contains("\"type\":\"event\"", StringComparison.Ordinal));
                if (hit is not null)
                    return hit;
                await Task.Delay(50);
            }
            throw new TimeoutException("no event reached the transport — the exception was not reported");
        }
    }

    private sealed class ReportingApiFactory : WebApplicationFactory<Program>
    {
        private readonly string? _dsn;
        private readonly ITransport? _transport;

        internal const string TestSecretKey =
            "error-reporting-integration-test-secret-key-do-not-use-in-prod";

        public ReportingApiFactory(string? dsn, ITransport? transport)
        {
            _dsn = dsn;
            _transport = transport;
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", TestDatabase.ConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Host configuration, so Program reads it while the builder is still being set up.
            builder.UseSetting(ErrorReporting.DsnKey, _dsn ?? string.Empty);

            builder.ConfigureTestServices(services =>
            {
                if (_transport is not null)
                    services.PostConfigure<SentryAspNetCoreOptions>(o => o.Transport = _transport);

                // A route that throws, appended INSIDE the real pipeline (exception handler, client
                // abort handling, Sentry's own middleware all wrap it), reached when no endpoint matched.
                services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, BoomRoute>();
            });
        }
    }

    private sealed class BoomRoute : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.Map(BoomPath, branch => branch.Run(_ =>
                throw new ErrorReportingBoomException("boom from the error-reporting test")));
        };
    }
}
