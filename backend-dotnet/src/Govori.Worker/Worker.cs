namespace Govori.Worker;

/// <summary>
/// Placeholder heartbeat host. docs/07 §7.7 — this evolves into the grading pipeline
/// (RESUME → transcribe → pronounce → orthoepy → analyze → score → award), driven by
/// Hangfire jobs (ex-Celery). For now it only proves the host process is alive and
/// logging via Serilog.
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

        // TODO Faza 2/3 (docs/07 §7.7): replace this loop with Hangfire recurring /
        // queued jobs — grading pipeline, SRS rollups, backup verification (§7.9).
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
