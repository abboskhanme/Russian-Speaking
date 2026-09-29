using Microsoft.Extensions.Configuration;
using Serilog;
using Serilog.Core;
using Serilog.Events;

namespace Govori.IntegrationTests;

/// <summary>
/// The Telegram bot token must never reach the log.
///
/// <para>IHttpClientFactory logs every request URL at Information under
/// <c>System.Net.Http.HttpClient.{client}.LogicalHandler</c> / <c>.ClientHandler</c>, and the Telegram
/// Bot API carries the token IN the URL path — <c>https://api.telegram.org/bot&lt;token&gt;/…</c>. With
/// no override for that category, both hosts wrote the token in plaintext: the Worker on every
/// getUpdates long-poll, the API on every OTP delivered by DM. The fix is a Serilog override in every
/// appsettings file; this pins it.</para>
///
/// <para>It builds the logger exactly as the hosts do — <c>ReadFrom.Configuration</c> over the host's
/// own JSON files, layered the way the host layers them (base, then the environment file on top) —
/// and asks the resulting logger the real question: is Information enabled for the HttpClient
/// categories? That tests the override the way Serilog applies it (prefix match, key-by-key merge),
/// rather than just that a string exists in a file.</para>
/// </summary>
public sealed class LoggingConfigTests
{
    public static IEnumerable<object[]> HostEnvironments() => new[]
    {
        new object[] { "Govori.Api", null! },
        new object[] { "Govori.Api", "Development" },
        new object[] { "Govori.Worker", null! },
        new object[] { "Govori.Worker", "Development" },
    };

    [Theory]
    [MemberData(nameof(HostEnvironments))]
    public void HttpClient_request_urls_are_not_logged(string host, string? environment)
    {
        using var logger = BuildLogger(host, environment);

        // The typed/named clients that talk to api.telegram.org, plus a made-up one: the override is
        // a category PREFIX, so it must hold for any client name.
        foreach (var client in new[] { "ITelegramMessenger", "telegram-bot", "any-future-client" })
        foreach (var handler in new[] { "LogicalHandler", "ClientHandler" })
        {
            var category = $"System.Net.Http.HttpClient.{client}.{handler}";
            var scoped = logger.ForContext(Constants.SourceContextPropertyName, category);
            Assert.False(
                scoped.IsEnabled(LogEventLevel.Information),
                $"{host} ({environment ?? "base"}) logs {category} at Information — the bot token is in those URLs");
            // Failures still surface: the override silences the per-request chatter, not the errors.
            Assert.True(scoped.IsEnabled(LogEventLevel.Warning), $"{category} warnings must still be logged");
        }
    }

    private static Logger BuildLogger(string host, string? environment)
    {
        var directory = Path.Combine(SourceRoot(), host);
        var builder = new ConfigurationBuilder()
            .SetBasePath(directory)
            .AddJsonFile("appsettings.json", optional: false);
        if (environment is not null)
            builder.AddJsonFile($"appsettings.{environment}.json", optional: false);

        return new LoggerConfiguration().ReadFrom.Configuration(builder.Build()).CreateLogger();
    }

    // backend-dotnet/src, found by walking up from the test binary — the same approach the fixture
    // loaders use, so it works from any working directory (including the /repo mount in Docker).
    private static string SourceRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "Govori.Api", "appsettings.json")))
            dir = dir.Parent;
        return dir is null
            ? throw new InvalidOperationException(
                "Could not find src/Govori.Api/appsettings.json above " + AppContext.BaseDirectory)
            : Path.Combine(dir.FullName, "src");
    }
}
