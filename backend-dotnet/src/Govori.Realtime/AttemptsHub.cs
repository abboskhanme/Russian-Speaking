using System.Security.Claims;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Govori.Realtime;

/// <summary>
/// The real-time attempt-progress hub (docs/08 Faza 3.10 — the SignalR replacement for the 2 s
/// <c>GET /submissions/{id}</c> poll). A client connects with its JWT and calls
/// <see cref="SubscribeToAttempt"/> to join a per-submission group; the grading pipeline then pushes
/// <c>progress</c> events (see <see cref="SignalRGradingEvents"/>) to that group as it advances.
///
/// <para><b>Auth (§7.5):</b> the hub is <c>[Authorize]</c> (same JWT bearer config as the REST API;
/// the token is read from the <c>access_token</c> query string for the WebSocket/SSE transports — see
/// Program.cs). Subscription is OWNERSHIP-CHECKED: a student may join ONLY their own attempt's group;
/// teachers/admins follow the exact same visibility rules as <c>GET /submissions/{id}</c>.
/// A caller who may not view the attempt gets a <see cref="HubException"/>
/// and never joins — so progress for an attempt only ever reaches people allowed to see it.</para>
/// </summary>
[Authorize]
public sealed class AttemptsHub : Hub
{
    private readonly GovoriDbContext _db;

    public AttemptsHub(GovoriDbContext db) => _db = db;

    /// <summary>The group name that carries progress for one attempt.</summary>
    public static string GroupFor(Guid submissionId) => $"attempt:{submissionId}";

    /// <summary>Join the caller to an attempt's progress group, after an ownership/visibility check.</summary>
    public async Task SubscribeToAttempt(Guid submissionId)
    {
        if (!TryGetUserId(Context.User, out var userId))
            throw new HubException("unauthorized");

        var sub = await _db.Submissions
            .Include(s => s.Question)
            .FirstOrDefaultAsync(s => s.Id == submissionId, Context.ConnectionAborted);

        // A missing OR not-visible attempt both answer "forbidden" — never leak existence, matching
        // the REST endpoint, which returns the same status for both.
        if (sub is null || !await CanViewAsync(userId, sub))
            throw new HubException("forbidden");

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(submissionId), Context.ConnectionAborted);
    }

    /// <summary>Leave an attempt's progress group.</summary>
    public Task UnsubscribeFromAttempt(Guid submissionId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupFor(submissionId), Context.ConnectionAborted);

    // Visibility, kept in lockstep with PracticeService.GetAsync:
    // the owner always sees it; a student only their own; an admin any; a teacher only their OWN
    // question answered by a student in their OWN roster.
    private async Task<bool> CanViewAsync(Guid userId, Submission sub)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, Context.ConnectionAborted);
        if (user is null || !user.IsActive)
            return false;
        if (sub.StudentId == userId)
            return true;
        if (user.Role == UserRole.Student)
            return false;
        if (user.Role == UserRole.Admin)
            return true;
        // teacher
        if (sub.Question is null || sub.Question.TeacherId != userId)
            return false;
        return await _db.GroupMembers.AnyAsync(
            gm => gm.Group.TeacherId == userId && gm.StudentId == sub.StudentId, Context.ConnectionAborted);
    }

    // A valid ACCESS token carrying a parseable `sub`. A refresh token is deliberately REJECTED
    // here, same as PracticeEndpoints.TryGetUserId. role/is_active are read from the DB above,
    // never trusted from the token.
    private static bool TryGetUserId(ClaimsPrincipal? principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal is not null
               && principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }
}
