using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Govori.Assessment;

/// <summary>
/// Options gating the recurring maintenance jobs. Destructive cleanup (row/object deletion, status
/// resets) runs ONLY where <see cref="Enabled"/> is true — the Hangfire host (Govori.Worker) sets it;
/// it defaults to <c>false</c> everywhere else so the jobs can never touch the shared schema DB from
/// a test host that happens to resolve them (docs/08 Faza 3.9 — "guard destructive cleanup").
/// </summary>
public sealed class MaintenanceOptions
{
    public bool Enabled { get; init; }
}

/// <summary>
/// The recurring maintenance tasks — a faithful port of Celery's beat schedule
/// (backend/app/workers/celery_app.py + tasks.py:327-406): stuck-submission recovery,
/// orphan-upload reclamation and teacher/admin test-submission purging. Registered on the Hangfire
/// server with the SAME cadence as Python's beat (docs/07 §7.7, Faza 3.9).
///
/// <para>Each method opens its own DI scope (fresh scoped <c>GovoriDbContext</c>) so it resolves the
/// same way whether Hangfire hands it a per-job scope or it is invoked directly. Every method is a
/// no-op unless <see cref="MaintenanceOptions.Enabled"/> — the destructive-work guard.</para>
/// </summary>
public sealed class MaintenanceJobs
{
    // tasks.py:337-338 — a worker crashed mid-task; tasks.py:337-338 pending never picked up.
    private static readonly TimeSpan ProcessingStuckAfter = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan PendingStuckAfter = TimeSpan.FromMinutes(20);
    // tasks.py:367 — teacher/admin TEST submissions kept 6h; tasks.py:390 — uploads orphaned after 24h.
    private static readonly TimeSpan TestSubmissionTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan OrphanUploadTtl = TimeSpan.FromHours(24);
    // storage.py — the two audio prefixes new_key() writes under (answers = graded, shadow = practice).
    private static readonly string[] AudioPrefixes = { "answers/", "shadow/" };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MaintenanceOptions _options;
    private readonly ILogger<MaintenanceJobs> _logger;

    public MaintenanceJobs(
        IServiceScopeFactory scopeFactory, MaintenanceOptions options, ILogger<MaintenanceJobs> logger)
    {
        _scopeFactory = scopeFactory;
        _options = options;
        _logger = logger;
    }

    /// <summary>
    /// Recover submissions a worker never finished (tasks.py:327-359): stuck in <c>processing</c>
    /// for &gt;15 min (worker crashed mid-task) or in <c>pending</c> for &gt;20 min (task lost before
    /// pickup) → <c>failed</c> with a friendly message. Returns the number recovered.
    /// </summary>
    public async Task<int> FailStuckSubmissionsAsync(CancellationToken ct = default)
    {
        if (!Guard(nameof(FailStuckSubmissionsAsync))) return 0;

        var now = DateTime.UtcNow;
        var processingCutoff = now - ProcessingStuckAfter;
        var pendingCutoff = now - PendingStuckAfter;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();

        var recovered = await db.Submissions
            .Where(s => (s.Status == SubmissionStatus.Processing && s.UpdatedAt < processingCutoff)
                     || (s.Status == SubmissionStatus.Pending && s.UpdatedAt < pendingCutoff))
            .ExecuteUpdateAsync(set => set
                .SetProperty(s => s.Status, SubmissionStatus.Failed)
                .SetProperty(s => s.ErrorMessage, "Processing timed out — please try again.")
                .SetProperty(s => s.UpdatedAt, now), ct);

        if (recovered > 0)
            _logger.LogInformation("fail_stuck_submissions recovered {Count} submissions", recovered);
        return recovered;
    }

    /// <summary>
    /// Purge teacher/admin TEST submissions older than 6 h (tasks.py:362-385): they are view-only,
    /// never kept. Deletes the rows (Transcript/Evaluation cascade) then their audio objects.
    /// Returns the number purged.
    /// </summary>
    public async Task<int> CleanupTestSubmissionsAsync(CancellationToken ct = default)
    {
        if (!Guard(nameof(CleanupTestSubmissionsAsync))) return 0;

        var cutoff = DateTime.UtcNow - TestSubmissionTtl;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();

        var rows = await (
            from s in db.Submissions
            join u in db.Users on s.StudentId equals u.Id
            where u.Role != UserRole.Student && s.CreatedAt < cutoff
            select new { s.Id, s.AudioKey }).ToListAsync(ct);
        if (rows.Count == 0)
            return 0;

        var ids = rows.Select(r => r.Id).ToList();
        await db.Submissions.Where(s => ids.Contains(s.Id)).ExecuteDeleteAsync(ct);

        // Reclaim the audio after the rows are gone (best-effort — a failed delete must not resurrect
        // the row). Mirrors Python's storage.delete_keys(keys) after the DB commit.
        foreach (var key in rows.Select(r => r.AudioKey).Where(k => !string.IsNullOrEmpty(k)))
        {
            try { await storage.DeleteAsync(key, ct); }
            catch (Exception ex) { _logger.LogWarning(ex, "could not delete test audio {Key}", key); }
        }

        _logger.LogInformation("cleanup_test_submissions purged {Count} submissions", ids.Count);
        return ids.Count;
    }

    /// <summary>
    /// Delete audio objects older than 24 h that never became a submission (tasks.py:388-405) — a
    /// presigned upload that succeeded but whose create call failed. Returns the number reclaimed.
    /// </summary>
    public async Task<int> CleanupOrphanUploadsAsync(CancellationToken ct = default)
    {
        if (!Guard(nameof(CleanupOrphanUploadsAsync))) return 0;

        var cutoff = DateTimeOffset.UtcNow - OrphanUploadTtl;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();

        var orphans = new List<string>();
        foreach (var prefix in AudioPrefixes)
        {
            foreach (var obj in await storage.ListObjectsAsync(prefix, ct))
            {
                if (obj.LastModified >= cutoff)
                    continue; // too new — a submission may still be in flight
                var claimed = await db.Submissions.AnyAsync(s => s.AudioKey == obj.Key, ct);
                if (!claimed)
                    orphans.Add(obj.Key);
            }
        }

        foreach (var key in orphans)
        {
            try { await storage.DeleteAsync(key, ct); }
            catch (Exception ex) { _logger.LogWarning(ex, "could not delete orphan upload {Key}", key); }
        }

        if (orphans.Count > 0)
            _logger.LogInformation("cleanup_orphan_uploads reclaimed {Count} objects", orphans.Count);
        return orphans.Count;
    }

    private bool Guard(string job)
    {
        if (_options.Enabled)
            return true;
        _logger.LogDebug("{Job} skipped — maintenance disabled (not the Hangfire host)", job);
        return false;
    }
}
