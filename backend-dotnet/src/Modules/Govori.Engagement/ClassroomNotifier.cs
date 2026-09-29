using Govori.Contracts;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Govori.Engagement;

/// <summary>
/// The <see cref="IClassroomNotifier"/> implementation — the in-app pings a student (or teacher)
/// gets when something happens in class. Lives in Engagement because Engagement owns the
/// <c>notifications</c> table and its read surface; Classroom and Practice reach it only through the
/// Contracts interface, the same way the grading pipeline reaches <see cref="SubmissionRewarder"/>.
///
/// <para><b>Rendered text, in the recipient's language.</b> A notification row stores its title and
/// body as finished prose, and the client prints them verbatim (it has no per-type templates) — which
/// is what <c>review_added</c> has always done. So the text is rendered HERE, per recipient, from
/// <c>users.preferred_language</c> (<c>uz</c> / <c>ru</c> / <c>en</c>; anything else falls back to
/// <c>uz</c>, the column's default). The machine-readable half is <c>type</c>
/// (<see cref="NotificationTypes"/>) plus an in-app <c>link</c>.</para>
///
/// <para><b>After the raising write, in its own save — never inside it.</b> The caller has already
/// committed the assignment / review / membership. A notification that fails to write must not undo
/// or fail that, so each method catches everything except the caller's own cancellation, logs it,
/// and DETACHES the rows it added: the DbContext is the request's shared one, and a failed insert
/// left in the change tracker would be retried — and fail again — by the next SaveChanges anyone in
/// the request makes.</para>
///
/// <para><b>Opt-out.</b> Recipients with <c>notifications_enabled = false</c> are filtered out in the
/// same query that loads their language — one read per batch, never one per recipient (the rule
/// TEACHER-PANEL-PLAN.md sets for every writer).</para>
/// </summary>
public sealed class ClassroomNotifier : IClassroomNotifier
{
    private readonly GovoriDbContext _db;
    private readonly ILogger<ClassroomNotifier>? _logger;

    // The logger is optional so a test can construct this directly over a bare DbContext.
    public ClassroomNotifier(GovoriDbContext db, ILogger<ClassroomNotifier>? logger = null)
    {
        _db = db;
        _logger = logger;
    }

    // In-app destinations. Kept beside the text they belong to; the frontend routes them (App.tsx).
    internal const string AssignmentsLink = "/practice?tab=assignments";
    internal const string GroupLink = "/group";
    internal const string JoinRequestsLink = "/teacher/classes?tab=requests";
    internal static string ResultLink(Guid submissionId) => $"/results/{submissionId}";

    // notifications.title is varchar(200); names and task titles are user-authored and can push a
    // rendered title past it, which Postgres would reject rather than truncate.
    private const int TitleMax = 200;

    /// <inheritdoc />
    public Task AssignmentsCreatedAsync(
        Guid teacherId, IReadOnlyCollection<Guid> studentIds, Guid? questionId, Guid? blockId,
        CancellationToken ct = default)
        => BestEffortAsync(NotificationTypes.AssignmentNew, async () =>
        {
            if (studentIds.Count == 0) return;

            var recipients = await RecipientsAsync(studentIds, ct);
            if (recipients.Count == 0) return;

            var teacher = await NameAsync(teacherId, ct);
            // What was assigned: a single task names the task, a module names the module. A module
            // assign is ONE ping per student however many tasks it produced — six notifications for
            // one gesture would bury everything else in the bell.
            string? task = null, module = null;
            if (questionId is { } qid)
                task = await _db.Questions.Where(q => q.Id == qid).Select(q => q.Title).FirstOrDefaultAsync(ct);
            else if (blockId is { } bid)
                module = await _db.QuestionBlocks.Where(b => b.Id == bid).Select(b => b.Name).FirstOrDefaultAsync(ct);

            foreach (var (userId, lang) in recipients)
            {
                var who = teacher ?? Text.SomeTeacher(lang);
                var (title, body) = module is not null
                    ? Text.ModuleAssigned(lang, who, module)
                    : Text.TaskAssigned(lang, who, task ?? Text.SomeTask(lang));
                Add(userId, NotificationTypes.AssignmentNew, title, body, AssignmentsLink);
            }
            await _db.SaveChangesAsync(ct);
        }, ct);

    /// <inheritdoc />
    public Task ReviewSavedAsync(Guid submissionId, CancellationToken ct = default)
        => BestEffortAsync(NotificationTypes.ReviewDone, async () =>
        {
            var sub = await _db.Submissions
                .AsNoTracking()
                .Where(s => s.Id == submissionId)
                .Select(s => new { s.StudentId, s.ReviewedBy, Task = s.Question != null ? s.Question.Title : null })
                .FirstOrDefaultAsync(ct);
            // Nobody to tell: a missing row, or someone reviewing their own attempt.
            if (sub is null || sub.ReviewedBy == sub.StudentId) return;

            var recipients = await RecipientsAsync([sub.StudentId], ct);
            foreach (var (userId, lang) in recipients)
            {
                var (title, body) = Text.Reviewed(lang, sub.Task ?? Text.SomeTask(lang));
                Add(userId, NotificationTypes.ReviewDone, title, body, ResultLink(submissionId));
            }
            await _db.SaveChangesAsync(ct);
        }, ct);

    /// <inheritdoc />
    public Task JoinRequestFiledAsync(Guid requestId, CancellationToken ct = default)
        => BestEffortAsync(NotificationTypes.JoinRequest, async () =>
        {
            var req = await _db.GroupJoinRequests
                .AsNoTracking()
                .Where(r => r.Id == requestId)
                .Select(r => new { r.Group.TeacherId, GroupName = r.Group.Name, StudentName = r.Student.FullName })
                .FirstOrDefaultAsync(ct);
            if (req is null) return;

            var recipients = await RecipientsAsync([req.TeacherId], ct);
            foreach (var (userId, lang) in recipients)
            {
                var (title, body) = Text.JoinRequested(lang, req.StudentName, req.GroupName);
                Add(userId, NotificationTypes.JoinRequest, title, body, JoinRequestsLink);
            }
            await _db.SaveChangesAsync(ct);
        }, ct);

    /// <inheritdoc />
    public Task JoinRequestDecidedAsync(Guid requestId, CancellationToken ct = default)
        => BestEffortAsync("join_decided", async () =>
        {
            var req = await _db.GroupJoinRequests
                .AsNoTracking()
                .Where(r => r.Id == requestId)
                .Select(r => new { r.StudentId, r.Status, GroupName = r.Group.Name })
                .FirstOrDefaultAsync(ct);
            // Only a DECIDED request has anything to say; a pending one is not news.
            if (req is null || req.Status == GroupJoinRequest.StatusPending) return;

            var approved = req.Status == GroupJoinRequest.StatusApproved;
            var recipients = await RecipientsAsync([req.StudentId], ct);
            foreach (var (userId, lang) in recipients)
            {
                var (title, body) = approved
                    ? Text.JoinApproved(lang, req.GroupName)
                    : Text.JoinRejected(lang, req.GroupName);
                Add(userId,
                    approved ? NotificationTypes.JoinApproved : NotificationTypes.JoinRejected,
                    title, body, GroupLink);
            }
            await _db.SaveChangesAsync(ct);
        }, ct);

    // ─── Plumbing ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Runs one writer under the best-effort contract: the caller's cancellation still propagates
    /// (the client is gone — there is nobody to answer), everything else is logged and swallowed, and
    /// any notification the failed attempt left in the shared change tracker is detached.
    /// </summary>
    private async Task BestEffortAsync(string what, Func<Task> write, CancellationToken ct)
    {
        try
        {
            await write();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            DetachPending();
            throw;
        }
        catch (Exception ex)
        {
            DetachPending();
            _logger?.LogWarning(ex, "classroom notification '{Type}' was not written; the action it reports stands", what);
        }
    }

    private void DetachPending()
    {
        foreach (var entry in _db.ChangeTracker.Entries<Notification>()
                     .Where(e => e.State == EntityState.Added)
                     .ToList())
            entry.State = EntityState.Detached;
    }

    /// <summary>The recipients who still want pings, with their language — one query for the whole
    /// batch. An opted-out user is simply absent.</summary>
    private async Task<List<(Guid Id, string Lang)>> RecipientsAsync(
        IReadOnlyCollection<Guid> userIds, CancellationToken ct)
    {
        var ids = userIds.Distinct().ToList();
        var rows = await _db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.NotificationsEnabled)
            .Select(u => new { u.Id, u.PreferredLanguage })
            .ToListAsync(ct);
        return rows.Select(r => (r.Id, Text.Lang(r.PreferredLanguage))).ToList();
    }

    private Task<string?> NameAsync(Guid userId, CancellationToken ct)
        => _db.Users.Where(u => u.Id == userId).Select(u => u.FullName).FirstOrDefaultAsync(ct);

    private void Add(Guid userId, string type, string title, string body, string link)
    {
        var now = DateTime.UtcNow;
        _db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Type = type,
            Title = title.Length <= TitleMax ? title : title[..(TitleMax - 1)] + "…",
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = now,
            UpdatedAt = now,
        });
    }

    /// <summary>
    /// The copy, per language. Uzbek follows the frontend's own locale typography (o‘ / g‘ with
    /// U+2018, the tutuq belgisi as U+2019) so a ping reads like the screen around it. Russian is
    /// phrased without a gendered past-tense verb ("Новое задание от …") because the teacher's
    /// gender is not something the product knows.
    /// </summary>
    private static class Text
    {
        public static string Lang(string? preferred) => preferred?.Trim().ToLowerInvariant() switch
        {
            "ru" => "ru",
            "en" => "en",
            _ => "uz",
        };

        public static string SomeTeacher(string lang) => lang switch
        {
            "ru" => "Преподаватель",
            "en" => "Your teacher",
            _ => "O‘qituvchi",
        };

        public static string SomeTask(string lang) => lang switch
        {
            "ru" => "Задание",
            "en" => "Task",
            _ => "Topshiriq",
        };

        public static (string Title, string Body) TaskAssigned(string lang, string teacher, string task) => lang switch
        {
            "ru" => ("Новое задание", $"Новое задание от {teacher}: «{task}»."),
            "en" => ("New assignment", $"{teacher} assigned you “{task}”."),
            _ => ("Yangi topshiriq", $"{teacher} sizga yangi topshiriq berdi: «{task}»."),
        };

        public static (string Title, string Body) ModuleAssigned(string lang, string teacher, string module) => lang switch
        {
            "ru" => ("Новые задания", $"Новые задания от {teacher}: модуль «{module}»."),
            "en" => ("New assignments", $"{teacher} assigned you tasks from the “{module}” module."),
            _ => ("Yangi topshiriqlar", $"{teacher} sizga «{module}» modulidan topshiriqlar berdi."),
        };

        public static (string Title, string Body) Reviewed(string lang, string task) => lang switch
        {
            "ru" => ("Ваш ответ проверен", $"«{task}» — посмотрите отзыв преподавателя."),
            "en" => ("Your answer was reviewed", $"“{task}” — see your teacher’s feedback."),
            _ => ("Javobingiz tekshirildi", $"«{task}» — o‘qituvchi fikrini ko‘ring."),
        };

        public static (string Title, string Body) JoinRequested(string lang, string student, string group) => lang switch
        {
            "ru" => ("Заявка на вступление", $"{student} хочет вступить в группу «{group}»."),
            "en" => ("Request to join", $"{student} wants to join “{group}”."),
            _ => ("Guruhga qo‘shilish so‘rovi", $"{student} «{group}» guruhiga qo‘shilmoqchi."),
        };

        public static (string Title, string Body) JoinApproved(string lang, string group) => lang switch
        {
            "ru" => ("Заявка принята", $"Вы в группе «{group}»."),
            "en" => ("Request approved", $"You have joined “{group}”."),
            _ => ("So‘rovingiz qabul qilindi", $"Siz «{group}» guruhiga qo‘shildingiz."),
        };

        public static (string Title, string Body) JoinRejected(string lang, string group) => lang switch
        {
            "ru" => ("Заявка отклонена", $"Заявка на вступление в группу «{group}» отклонена."),
            "en" => ("Request declined", $"Your request to join “{group}” was declined."),
            _ => ("So‘rovingiz rad etildi", $"«{group}» guruhiga qo‘shilish so‘rovingiz rad etildi."),
        };
    }
}
