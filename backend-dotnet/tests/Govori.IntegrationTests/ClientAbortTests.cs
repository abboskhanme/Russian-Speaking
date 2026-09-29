using Govori.Api.Startup;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Govori.IntegrationTests;

/// <summary>
/// A request the client walked away from is a 499 at Debug, not a 500 at Error
/// (<see cref="ClientAbort"/>). Before, the cancellation escaped through Serilog's request logger,
/// which wrote every tab-close and dropped mobile connection as "responded 500" at Error.
///
/// <para>Driven with a hand-built context: an aborted request cannot be produced deterministically
/// through a TestServer, and the decision is entirely a function of the exception and the context's
/// <c>RequestAborted</c> token.</para>
/// </summary>
public sealed class ClientAbortTests
{
    private static DefaultHttpContext Context(bool clientAborted)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "POST";
        context.Request.Path = "/api/submissions";
        context.RequestAborted = clientAborted ? new CancellationToken(canceled: true) : CancellationToken.None;
        return context;
    }

    public static IEnumerable<object[]> AbortExceptions() => new[]
    {
        new object[] { new OperationCanceledException() },
        new object[] { new TaskCanceledException() },
        // A half-sent multipart upload surfaces as an I/O failure while reading the body.
        new object[] { new IOException("The client reset the request stream.") },
    };

    [Theory]
    [MemberData(nameof(AbortExceptions))]
    public async Task A_client_abort_is_swallowed_as_499_and_logged_at_debug(Exception thrown)
    {
        var context = Context(clientAborted: true);
        var log = new RecordingLogger();

        await ClientAbort.InvokeAsync(context, _ => throw thrown, log);

        Assert.Equal(StatusCodes.Status499ClientClosedRequest, context.Response.StatusCode);
        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Debug, entry);
    }

    [Fact]
    public async Task A_cancellation_the_client_did_not_cause_is_still_an_error()
    {
        // A vendor timeout or a shutdown cancels too — but with the client still connected that is a
        // real failure, and it must reach the exception handler as one.
        var context = Context(clientAborted: false);
        var log = new RecordingLogger();

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => ClientAbort.InvokeAsync(context, _ => throw new OperationCanceledException(), log));
        Assert.Empty(log.Entries);
    }

    [Fact]
    public async Task Any_other_failure_of_an_aborted_request_still_propagates()
    {
        var context = Context(clientAborted: true);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => ClientAbort.InvokeAsync(context, _ => throw new InvalidOperationException("a real bug"), new RecordingLogger()));
    }

    [Fact]
    public async Task A_normal_request_passes_through_untouched()
    {
        var context = Context(clientAborted: false);

        await ClientAbort.InvokeAsync(context, ctx => { ctx.Response.StatusCode = 201; return Task.CompletedTask; }, new RecordingLogger());

        Assert.Equal(201, context.Response.StatusCode);
    }

    /// <summary>Records the level of every entry written.</summary>
    private sealed class RecordingLogger : ILogger
    {
        public List<LogLevel> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Entries.Add(logLevel);
    }
}
