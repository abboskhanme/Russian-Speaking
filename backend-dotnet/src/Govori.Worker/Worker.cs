namespace Govori.Worker;

/// <summary>
/// Liveness heartbeat: one log line every 30 s, so a Worker that is up but idle is observably up.
/// It does no work of its own. Everything this process actually does runs elsewhere — grading as
/// Hangfire jobs (<c>GradingJob</c>, docs/07 §7.7), the recurring maintenance schedule
/// (<c>MaintenanceJobs</c>, registered in Program.cs via <c>AddGovoriRecurringJobs</c>) and, when a
/// bot token is configured, the Telegram OTP poller.
/// </summary>
public class Worker : BackgroundService
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(30);
    private readonly ILogger<Worker> _logger;

    public Worker(ILogger<Worker> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Govori.Worker started; heartbeat every {IntervalSeconds}s", HeartbeatInterval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Worker heartbeat at {Timestamp:o}", DateTimeOffset.UtcNow);
            try
            {
                await Task.Delay(HeartbeatInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break; // graceful shutdown requested
            }
        }

        _logger.LogInformation("Govori.Worker stopping");
    }
}
