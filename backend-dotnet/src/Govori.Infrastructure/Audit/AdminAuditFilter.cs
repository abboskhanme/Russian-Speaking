using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Govori.Infrastructure.Audit;

/// <summary>
/// The admin audit trail's one write path: an endpoint filter that records a successful mutation
/// made by an admin into <c>admin_audit_log</c>. An endpoint joins the trail with ONE line —
/// <c>.AdminAudited("plan.delete", "plan")</c> — see <see cref="AdminAuditEndpointExtensions"/>.
///
/// <para><b>Why a filter, not a call in each service.</b> The admin surface spans three modules
/// (Administration, Billing, Catalog's shared authoring routes) that are forbidden to reference each
/// other (Govori.ArchTests). A per-service call would be ~20 hand-written writes that each have to
/// remember the actor, the IP and the "success only" rule; a forgotten one is invisible. The filter
/// sees exactly what the HTTP layer sees — the token, the route, the request DTO and the handler's
/// result — which is everything an audit row needs, and it lives here in Infrastructure because
/// that is the one assembly every one of those modules already references.</para>
///
/// <para><b>What gets recorded.</b> Only a 2xx result from a caller whose role is <c>admin</c> right
/// now. The role check is what makes the filter safe on Catalog's routes, which teachers use too: a
/// teacher's own module edit is product activity, not administration. A 4xx/5xx or a thrown handler
/// records nothing — the trail lists what HAPPENED, and a refused request changed nothing.</para>
///
/// <para><b>Secrets never reach the row.</b> <c>details.fields</c> holds the NAMES of the request
/// fields the admin sent (for the settings PATCHes, exactly "which keys changed"); values are
/// recorded only for an explicit per-endpoint allow-list, and even then a name that looks like a
/// credential (<see cref="LooksSecret"/>) is dropped. Saving <c>gemini_api_key</c> therefore leaves
/// <c>{"fields":["gemini_api_key"]}</c> and nothing else.</para>
/// </summary>
public sealed class AdminAuditFilter : IEndpointFilter
{
    private const int MaxValueLength = 200;

    private readonly AdminAuditSpec _spec;

    public AdminAuditFilter(AdminAuditSpec spec) => _spec = spec;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (!TryActor(http.User, out var actorId))
            return await next(context);

        // Role is read BEFORE the handler, once: it is the caller's role at the moment of the call,
        // and on Catalog's shared routes it lets a teacher's request skip every other audit query.
        var db = http.RequestServices.GetRequiredService<GovoriDbContext>();
        var role = await db.Users.AsNoTracking()
            .Where(u => u.Id == actorId).Select(u => (UserRole?)u.Role)
            .FirstOrDefaultAsync(http.RequestAborted);
        if (role != UserRole.Admin)
            return await next(context);

        var targetId = http.Request.RouteValues.TryGetValue(_spec.TargetRoute, out var raw) ? raw?.ToString() : null;
        // The label is read before the handler too: after a delete there is nothing left to name.
        var label = await LabelBeforeAsync(db, _spec.TargetType, targetId, http.RequestAborted);

        var result = await next(context);
        if (!IsSuccess(result))
            return result;

        try
        {
            // A create has no id in its route — the new row's id comes back in the response body.
            var value = (result as IValueHttpResult)?.Value;
            targetId ??= ReadProperty<Guid>(value, "Id") is { } created && created != Guid.Empty ? created.ToString() : null;
            label ??= ReadProperty<string>(value, "FullName") ?? ReadProperty<string>(value, "Name") ?? ReadProperty<string>(value, "Title");

            var entry = new AdminAuditEntry
            {
                Id = Guid.CreateVersion7(),
                ActorUserId = actorId,
                Action = _spec.Action,
                TargetType = _spec.TargetType,
                TargetId = Truncate(targetId, 64),
                TargetLabel = Truncate(label, 200),
                Details = BuildDetails(context, _spec.RecordValuesOf),
                Ip = Truncate(ClientIp(http), 64),
                CreatedAt = DateTime.UtcNow,
            };

            // A FRESH context, not the request's: the handler's context has already saved its work,
            // and the audit insert must not be the thing that flushes anything else it still tracks.
            // CancellationToken.None because the mutation is committed — a client that hangs up a
            // millisecond later must not erase the record of what it just did.
            var options = http.RequestServices.GetRequiredService<DbContextOptions<GovoriDbContext>>();
            await using var audit = new GovoriDbContext(options);
            audit.AdminAuditLog.Add(entry);
            await audit.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            // The mutation already happened; answering 500 now would invite the client to retry a
            // change that succeeded. Fail loud in the log instead — a gap in the trail is an incident.
            http.RequestServices.GetRequiredService<ILogger<AdminAuditFilter>>()
                .LogError(ex, "Admin audit write failed for {Action} by {ActorId} on {TargetId}",
                    _spec.Action, actorId, targetId);
        }

        return result;
    }

    // Handlers here return IResult; a typed one without a status (Results.Json with no code) is 200.
    private static bool IsSuccess(object? result)
    {
        var status = (result as IStatusCodeHttpResult)?.StatusCode ?? StatusCodes.Status200OK;
        return status is >= 200 and < 300;
    }

    // Same rule every endpoint uses: an ACCESS token with a parseable sub. A refresh token is no actor.
    private static bool TryActor(ClaimsPrincipal principal, out Guid actorId)
    {
        actorId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out actorId);
    }

    private static async Task<string?> LabelBeforeAsync(GovoriDbContext db, string targetType, string? targetId, CancellationToken ct)
    {
        if (!Guid.TryParse(targetId, out var id)) return null;
        try
        {
            return targetType switch
            {
                AdminAuditTargets.User => await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.FullName).FirstOrDefaultAsync(ct),
                AdminAuditTargets.Module => await db.QuestionBlocks.AsNoTracking().Where(b => b.Id == id).Select(b => b.Name).FirstOrDefaultAsync(ct),
                AdminAuditTargets.Task => await db.Questions.AsNoTracking().Where(q => q.Id == id).Select(q => q.Title).FirstOrDefaultAsync(ct),
                AdminAuditTargets.Plan => await db.Plans.AsNoTracking().Where(p => p.Id == id).Select(p => p.Name).FirstOrDefaultAsync(ct),
                AdminAuditTargets.Group => await db.Groups.AsNoTracking().Where(g => g.Id == id).Select(g => g.Name).FirstOrDefaultAsync(ct),
                _ => null,
            };
        }
        catch (OperationCanceledException)
        {
            return null;   // the request is going away anyway; the handler will see the same token
        }
    }

    /// <summary>
    /// <c>{"fields":[...],"values":{...}}</c> from the request DTO, or null when there is none. The
    /// DTO is found by namespace — every request body on this API is a <c>Govori.Contracts</c>
    /// record — and serialised with the HOST's JSON options, so the names recorded are the snake_case
    /// wire names the admin UI sent, not C# property names.
    /// </summary>
    internal static string? BuildDetails(EndpointFilterInvocationContext context, IReadOnlyCollection<string> recordValuesOf)
    {
        var body = context.Arguments.FirstOrDefault(a =>
            a is not null && a.GetType().Namespace == "Govori.Contracts" && a.GetType().IsClass);
        if (body is null) return null;

        var json = context.HttpContext.RequestServices.GetService<IOptions<JsonOptions>>()?.Value.SerializerOptions
                   ?? new JsonSerializerOptions(JsonSerializerDefaults.Web);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(body, body.GetType(), json));

        var fields = new List<string>();
        var values = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            // null = "omitted" on every PATCH here (the tri-state's transport half), so it changed nothing.
            if (prop.Value.ValueKind == JsonValueKind.Null) continue;
            fields.Add(prop.Name);
            if (recordValuesOf.Contains(prop.Name) && !LooksSecret(prop.Name))
                values[prop.Name] = Truncate(
                    prop.Value.ValueKind == JsonValueKind.String ? prop.Value.GetString() : prop.Value.GetRawText(),
                    MaxValueLength)!;
        }
        fields.Sort(StringComparer.Ordinal);

        return JsonSerializer.Serialize(values.Count > 0
            ? new { fields, values }
            : (object)new { fields });
    }

    /// <summary>A last line of defence under the allow-list: even if someone lists
    /// <c>openai_api_key</c> as recordable, its value is still not written.</summary>
    internal static bool LooksSecret(string name)
        => name.Contains("key", StringComparison.OrdinalIgnoreCase)
           || name.Contains("secret", StringComparison.OrdinalIgnoreCase)
           || name.Contains("token", StringComparison.OrdinalIgnoreCase)
           || name.Contains("password", StringComparison.OrdinalIgnoreCase);

    private static T? ReadProperty<T>(object? value, string name)
    {
        if (value is null) return default;
        var prop = value.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        return prop is not null && prop.GetValue(value) is T typed ? typed : default;
    }

    // The rate limiter's rule (Govori.Api/RateLimiting/RateLimitIdentity): the LAST X-Forwarded-For
    // hop, because it is the one written by our own nginx and the only entry a client cannot forge.
    // Copied rather than shared because that class lives in the host, which nothing may reference.
    private static string? ClientIp(HttpContext http)
    {
        var hops = http.Request.Headers["X-Forwarded-For"].ToString()
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return hops.Length > 0 ? hops[^1] : http.Connection.RemoteIpAddress?.ToString();
    }

    private static string? Truncate(string? s, int max) => s is null || s.Length <= max ? s : s[..max];
}

/// <summary>What one audited endpoint records. Built by <see cref="AdminAuditEndpointExtensions.AdminAudited{TBuilder}"/>.</summary>
/// <param name="Action">Dotted verb, e.g. <c>teacher.delete</c>.</param>
/// <param name="TargetType">One of <see cref="AdminAuditTargets"/>.</param>
/// <param name="TargetRoute">The route value holding the target id (default <c>id</c>).</param>
/// <param name="RecordValuesOf">Wire names whose VALUES are safe and useful to keep (e.g.
/// <c>is_premium</c>). Everything else is recorded by name only.</param>
public sealed record AdminAuditSpec(
    string Action,
    string TargetType,
    string TargetRoute,
    IReadOnlyCollection<string> RecordValuesOf);

/// <summary>The target kinds the trail knows how to name. Plain strings on the wire.</summary>
public static class AdminAuditTargets
{
    public const string User = "user";
    public const string Module = "module";
    public const string Task = "task";
    public const string Plan = "plan";
    public const string Group = "group";
    public const string Settings = "settings";
    public const string Secret = "secret";
}

public static class AdminAuditEndpointExtensions
{
    /// <summary>
    /// Put this endpoint on the admin audit trail. One line per endpoint:
    /// <code>
    /// admin.MapPost("/groups/{id:guid}/transfer", ...)
    ///      .RequireAuthorization()
    ///      .AdminAudited("group.transfer", AdminAuditTargets.Group, values: ["teacher_id"]);
    /// </code>
    /// The target id is read from the <paramref name="targetRoute"/> route value, or — for a create —
    /// from the response's <c>Id</c>. Only a 2xx answer to an admin caller is recorded.
    /// </summary>
    public static TBuilder AdminAudited<TBuilder>(
        this TBuilder builder,
        string action,
        string targetType,
        string[]? values = null,
        string targetRoute = "id")
        where TBuilder : IEndpointConventionBuilder
    {
        var spec = new AdminAuditSpec(action, targetType, targetRoute, values ?? Array.Empty<string>());
        builder.WithMetadata(spec);
        builder.AddEndpointFilter(new AdminAuditFilter(spec));
        return builder;
    }
}
