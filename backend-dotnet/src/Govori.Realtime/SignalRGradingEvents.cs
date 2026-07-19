using Govori.Contracts;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace Govori.Realtime;

/// <summary>
/// The real <see cref="IGradingEvents"/> — fans a grading-progress event out to the attempt's
/// SignalR group via <see cref="IHubContext{AttemptsHub}"/> (docs/08 Faza 3.10). Because the hub uses
/// the Redis backplane, a publish from the Hangfire Worker process reaches the clients connected to
/// the API process. Emitting the strongly-typed <see cref="GradingProgressEvent"/> serializes it with
/// the hub's snake_case JSON protocol (client method <c>progress</c>).
///
/// <para>BEST-EFFORT: a dead hub / backplane must never break grading, so publish failures are
/// swallowed and logged (belt-and-suspenders with AssessmentService's own guard).</para>
/// </summary>
public sealed class SignalRGradingEvents : IGradingEvents
{
    private readonly IHubContext<AttemptsHub> _hub;
    private readonly ILogger<SignalRGradingEvents> _logger;

    public SignalRGradingEvents(IHubContext<AttemptsHub> hub, ILogger<SignalRGradingEvents> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public async Task PublishAsync(GradingProgressEvent evt, CancellationToken ct = default)
    {
        try
        {
            await _hub.Clients
                .Group(AttemptsHub.GroupFor(evt.SubmissionId))
                .SendAsync("progress", evt, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex, "SignalR progress publish failed (submission {SubmissionId}, state {State})",
                evt.SubmissionId, evt.State);
        }
    }
}
