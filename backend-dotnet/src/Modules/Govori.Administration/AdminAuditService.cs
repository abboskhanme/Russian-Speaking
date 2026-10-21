using System.Text.Json;
using Govori.Contracts;
using Govori.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Govori.Administration;

/// <summary>
/// The read side of the admin audit trail (<c>GET /api/admin/audit</c>). The write side is
/// <c>Govori.Infrastructure.Audit.AdminAuditFilter</c>, attached per endpoint; this class only pages
/// through what it wrote. The admin gate is the caller's job (the endpoint runs AdminGate first).
/// </summary>
public sealed class AdminAuditService
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    private static readonly IReadOnlyDictionary<string, string> NoValues = new Dictionary<string, string>();

    private readonly GovoriDbContext _db;

    public AdminAuditService(GovoriDbContext db) => _db = db;

    /// <summary>
    /// One page, newest first. <paramref name="action"/> is a PREFIX — <c>settings</c> finds every
    /// settings change, <c>settings.ai</c> only the AI ones — because the action names are dotted
    /// for exactly that. <paramref name="from"/>/<paramref name="to"/> are inclusive calendar days in
    /// the product's time zone (<see cref="ProductDay"/>), the same "day" every other screen uses; a
    /// UTC day would put a Tashkent-morning change on the previous date.
    /// </summary>
    public async Task<AdminAuditPageResponse> ListAsync(
        Guid? actorId, string? action, DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var q = _db.AdminAuditLog.AsNoTracking();
        if (actorId is { } actor) q = q.Where(e => e.ActorUserId == actor);
        if (!string.IsNullOrWhiteSpace(action))
        {
            var prefix = action.Trim();
            q = q.Where(e => e.Action.StartsWith(prefix));
        }
        if (from is { } f)
        {
            var start = ProductDay.StartUtc(f);
            q = q.Where(e => e.CreatedAt >= start);
        }
        if (to is { } t)
        {
            var end = ProductDay.StartUtc(t.AddDays(1));
            q = q.Where(e => e.CreatedAt < end);
        }

        var total = await q.CountAsync(ct);

        // Id breaks ties: rows written in the same microsecond must still page deterministically,
        // and the ids are v7 (time-ordered), so the tie-break agrees with the main order.
        var rows = await q
            .OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(e => new
            {
                Entry = e,
                ActorName = _db.Users.Where(u => u.Id == e.ActorUserId).Select(u => u.FullName).FirstOrDefault(),
            })
            .ToListAsync(ct);

        var items = rows.Select(r =>
        {
            var (fields, values) = ParseDetails(r.Entry.Details);
            return new AdminAuditEntryResponse(
                r.Entry.Id, DateTime.SpecifyKind(r.Entry.CreatedAt, DateTimeKind.Utc), r.Entry.ActorUserId, r.ActorName,
                r.Entry.Action, r.Entry.TargetType, r.Entry.TargetId, r.Entry.TargetLabel,
                fields, values, r.Entry.Ip);
        }).ToList();

        return new AdminAuditPageResponse(items, total, page, pageSize);
    }

    // The column is written by one filter in one shape, but it is jsonb, so read it defensively: a
    // row that does not parse still lists (with no details) rather than failing the whole page.
    private static (IReadOnlyList<string> Fields, IReadOnlyDictionary<string, string> Values) ParseDetails(string? json)
    {
        if (string.IsNullOrEmpty(json)) return (Array.Empty<string>(), NoValues);
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var fields = root.TryGetProperty("fields", out var f) && f.ValueKind == JsonValueKind.Array
                ? f.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
                : new List<string>();
            var values = new SortedDictionary<string, string>(StringComparer.Ordinal);
            if (root.TryGetProperty("values", out var v) && v.ValueKind == JsonValueKind.Object)
                foreach (var p in v.EnumerateObject())
                    values[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText();
            return (fields, values);
        }
        catch (JsonException)
        {
            return (Array.Empty<string>(), NoValues);
        }
    }
}
