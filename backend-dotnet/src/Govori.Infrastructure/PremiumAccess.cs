using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// THE definition of "this user has premium" (docs/08 Faza 6.6). One rule, one implementation:
///
/// <code>premium  ==  users.is_premium  OR  an ACTIVE subscription covering now</code>
///
/// <para><b>Why it is here and not in a module.</b> Two callers need it and they are in different
/// domains: <c>Govori.Catalog</c> owns the 402 freemium gate (the frozen
/// <c>CatalogService.NeedsPremiumAsync</c>) and <c>Govori.Billing</c> owns the subscription surface.
/// A domain→domain reference between them is exactly what the Faza 2.2 boundary guardrail forbids
/// (Govori.ArchTests rule 4), and the only sanctioned alternative — copying the rule into both —
/// is the failure this method exists to prevent: the day the two copies disagree, a student who has
/// paid gets a 402 and nobody can say which half is wrong. It is a query over two tables this
/// project already owns, which is what Infrastructure is for.</para>
///
/// <para><b>The teacher grant still comes first.</b> <c>users.is_premium</c> is the freemium model
/// the product actually runs on: a teacher grants premium and it takes effect immediately. The
/// subscription layer is strictly ADDITIVE — with no rows in <c>subscriptions</c>, every answer here
/// is identical to the pre-6.6 <c>user.IsPremium</c> it replaced, which is what keeps the existing
/// 402 behaviour byte-for-byte unchanged.</para>
///
/// <para><b>Short-circuit, deliberately.</b> A granted user never reaches the database at all —
/// <c>||</c> is not an optimisation detail here but the reason adding this layer costs the common
/// path nothing.</para>
/// </summary>
public static class PremiumAccess
{
    /// <summary>True when <paramref name="user"/> has premium by either route.</summary>
    /// <param name="nowUtc">Evaluation instant. Passed in rather than read from the clock so a
    /// caller resolving several users judges them all against one moment, and so tests can stand at
    /// a chosen point inside or outside a window.</param>
    public static async Task<bool> HasPremiumAsync(
        GovoriDbContext db, User user, DateTime nowUtc, CancellationToken ct = default)
        => user.IsPremium || await HasActiveSubscriptionAsync(db, user.Id, nowUtc, ct);

    /// <summary>Same rule, for a caller that has an id but no loaded <see cref="User"/>.</summary>
    public static async Task<bool> HasPremiumAsync(
        GovoriDbContext db, Guid userId, DateTime nowUtc, CancellationToken ct = default)
        => await db.Users.AnyAsync(u => u.Id == userId && u.IsPremium, ct)
           || await HasActiveSubscriptionAsync(db, userId, nowUtc, ct);

    /// <summary>
    /// Does this user hold a subscription that is BOTH marked active AND inside its window right now?
    ///
    /// <para>Both halves are load-bearing. Status alone would keep granting premium after a paid
    /// window lapsed, because nothing flips a row to <c>expired</c> at the instant it expires — the
    /// row's own dates are the authority, and a sweep job that has not run yet is not a reason to
    /// give away access. The window alone would grant premium to a <c>pending</c> row, i.e. to
    /// someone who started a checkout and never paid.</para>
    ///
    /// <para><c>EndsAt is null</c> means open-ended, which only a manually granted subscription
    /// ever is.</para>
    /// </summary>
    public static Task<bool> HasActiveSubscriptionAsync(
        GovoriDbContext db, Guid userId, DateTime nowUtc, CancellationToken ct = default)
        => db.Subscriptions.AnyAsync(
            s => s.UserId == userId
                 && s.Status == SubscriptionStatuses.Active
                 && s.StartsAt <= nowUtc
                 && (s.EndsAt == null || s.EndsAt > nowUtc),
            ct);

    /// <summary>The caller's current subscription — the active one, else the most recent row of any
    /// status so the profile can say "expired on …" instead of "you have never subscribed".
    /// <c>null</c> when they have never had one.</summary>
    public static async Task<Subscription?> CurrentSubscriptionAsync(
        GovoriDbContext db, Guid userId, DateTime nowUtc, CancellationToken ct = default)
    {
        var active = await db.Subscriptions
            .Include(s => s.Plan)
            .Where(s => s.UserId == userId
                        && s.Status == SubscriptionStatuses.Active
                        && s.StartsAt <= nowUtc
                        && (s.EndsAt == null || s.EndsAt > nowUtc))
            .OrderByDescending(s => s.EndsAt)
            .FirstOrDefaultAsync(ct);
        if (active is not null)
            return active;

        return await db.Subscriptions
            .Include(s => s.Plan)
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }
}
