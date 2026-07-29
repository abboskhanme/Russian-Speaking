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
/// The recurring maintenance tasks: stuck-submission recovery, orphan-upload reclamation and
/// teacher/admin test-submission purging. Registered as recurring jobs on the Hangfire server
/// (docs/07 §7.7, Faza 3.9).
///
/// <para>Each method opens its own DI scope (fresh scoped <c>GovoriDbContext</c>) so it resolves the
/// same way whether Hangfire hands it a per-job scope or it is invoked directly. Every method is a
/// no-op unless <see cref="MaintenanceOptions.Enabled"/> — the destructive-work guard.</para>
/// </summary>
public sealed class MaintenanceJobs
{
    // Stuck-submission recovery windows. These must stay LONGER than the slowest legitimate
    // grading run, or this job will fail attempts that are still being processed:
    // 15 min in `processing` means a worker crashed mid-task; 20 min in `pending` means the job
    // was never picked up at all.
    private static readonly TimeSpan ProcessingStuckAfter = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan PendingStuckAfter = TimeSpan.FromMinutes(20);
    // Retention windows: teacher/admin TEST submissions are kept 6h; an uploaded object that never
    // became a submission is considered orphaned after 24h.
    private static readonly TimeSpan TestSubmissionTtl = TimeSpan.FromHours(6);
    private static readonly TimeSpan OrphanUploadTtl = TimeSpan.FromHours(24);
    // Student answer audio is reclaimed after 90 days: the row + transcript + evaluation stay (the
    // result history is intact), only the heavy audio object is deleted — so storage doesn't grow
    // unbounded. Marked with Submission.AudioDeletedAt so the UI can show an "expired" note.
    private static readonly TimeSpan AudioRetention = TimeSpan.FromDays(90);
    // The two audio key prefixes the storage layer writes under (answers = graded, shadow = practice).
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
    /// Recover submissions a worker never finished: stuck in <c>processing</c>
    /// for &gt;15 min (worker crashed mid-task) or in <c>pending</c> for &gt;20 min (task lost before
    /// pickup) → <c>failed</c> with a friendly message. Without this, such an attempt would spin
    /// forever in the student's UI. Returns the number recovered.
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
    /// Purge teacher/admin TEST submissions older than 6 h: they are view-only, never kept.
    /// Deletes the rows (Transcript/Evaluation cascade) then their audio objects.
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

        // Reclaim the audio only AFTER the rows are gone, and best-effort: a failed object delete
        // must not resurrect or block the row deletion. Worst case a stray object is retried next run.
        foreach (var key in rows.Select(r => r.AudioKey).Where(k => !string.IsNullOrEmpty(k)))
        {
            try { await storage.DeleteAsync(key, ct); }
            catch (Exception ex) { _logger.LogWarning(ex, "could not delete test audio {Key}", key); }
        }

        _logger.LogInformation("cleanup_test_submissions purged {Count} submissions", ids.Count);
        return ids.Count;
    }

    /// <summary>
    /// Delete audio objects older than 24 h that never became a submission — an upload that
    /// succeeded but whose create call failed. Returns the number reclaimed.
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

    /// <summary>
    /// Reclaim STUDENT answer audio older than 90 days: delete the audio object and stamp
    /// <c>Submission.AudioDeletedAt</c>, keeping the row + transcript + evaluation so the result
    /// history stays intact. Only rows whose object was actually deleted are stamped, so a failed
    /// object delete simply retries next run. Returns the number reclaimed.
    /// </summary>
    public async Task<int> PurgeExpiredAudioAsync(CancellationToken ct = default)
    {
        if (!Guard(nameof(PurgeExpiredAudioAsync))) return 0;

        var now = DateTime.UtcNow;
        var cutoff = now - AudioRetention;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();
        var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();

        var rows = await db.Submissions
            .Where(s => s.CreatedAt < cutoff && s.AudioDeletedAt == null && s.AudioKey != "")
            .Select(s => new { s.Id, s.AudioKey })
            .Take(500)                                             // bounded batch; the rest go next run
            .ToListAsync(ct);
        if (rows.Count == 0)
            return 0;

        // Delete the object first; only stamp rows we actually reclaimed, so a failed delete retries.
        var reclaimed = new List<Guid>(rows.Count);
        foreach (var r in rows)
        {
            try
            {
                await storage.DeleteAsync(r.AudioKey, ct);
                reclaimed.Add(r.Id);
            }
            catch (Exception ex) { _logger.LogWarning(ex, "could not delete expired audio {Key}", r.AudioKey); }
        }

        if (reclaimed.Count > 0)
        {
            await db.Submissions
                .Where(s => reclaimed.Contains(s.Id))
                .ExecuteUpdateAsync(set => set
                    .SetProperty(s => s.AudioDeletedAt, now)
                    .SetProperty(s => s.UpdatedAt, now), ct);
            _logger.LogInformation("purge_expired_audio reclaimed {Count} audio objects", reclaimed.Count);
        }
        return reclaimed.Count;
    }

    private bool Guard(string job)
    {
        if (_options.Enabled)
            return true;
        _logger.LogDebug("{Job} skipped — maintenance disabled (not the Hangfire host)", job);
        return false;
    }
}
