using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One purchasable tariff (docs/08 Faza 6.6 — the <c>plans</c> table): what it is called, what it
/// costs, and how long it lasts.
///
/// <para><b>Why the price is an integer of MINOR units.</b> <see cref="PriceMinor"/> is tiyin, not
/// so'm, and it is a whole number rather than a decimal or a double. Both Uzbek providers speak
/// tiyin on the wire (Payme's <c>amount</c> and Click's are minor units), so storing so'm would mean
/// a ×100 conversion at every boundary — and the one place a rounding error is never acceptable is
/// the number a person is charged. A <c>double</c> price is the classic version of this bug: 49900.0
/// is exact today and 49899.999999 after one arithmetic step.</para>
///
/// <para>Plans are CONTENT the owner edits from the admin panel, not constants in a deploy — the
/// same reasoning that put roleplay scenarios in the database. A price change must not need a
/// release, because a price change that needs a release is a price that stays wrong.</para>
///
/// <para><b>Plans are never hard-deleted while anything references them.</b>
/// <see cref="IsActive"/> is the retire switch: an old subscription must keep pointing at the tariff
/// it was actually sold under, or every historical row starts lying about what was paid.</para>
/// </summary>
public partial class Plan
{
    public Guid Id { get; set; }

    /// <summary>Stable machine id (<c>monthly</c>, <c>yearly</c>). Used in requests and in support
    /// conversations; add, never rename — a renamed code silently orphans everything that quoted it.</summary>
    public string Code { get; set; } = null!;

    /// <summary>What the student sees on the card ("1 oylik Premium").</summary>
    public string Name { get; set; } = null!;

    /// <summary>Optional one-line pitch under the name. Null renders nothing.</summary>
    public string? Description { get; set; }

    /// <summary>Price in MINOR units (tiyin) — see the type remarks. 0 is legal and means a free
    /// tariff, which is how a promotional plan is expressed without a second concept.</summary>
    public long PriceMinor { get; set; }

    /// <summary>ISO-4217 code, <c>UZS</c> in practice. Stored per plan rather than assumed globally
    /// so a second currency is a row, not a migration.</summary>
    public string Currency { get; set; } = null!;

    /// <summary>How many days one purchase grants. The subscription's end date is computed from this
    /// AT PURCHASE TIME and then frozen on the row: changing the plan later must not silently extend
    /// or shorten subscriptions already sold.</summary>
    public int DurationDays { get; set; }

    /// <summary>Retired plans stay in the table and disappear from the student-facing list. See the
    /// type remarks for why this is not a delete.</summary>
    public bool IsActive { get; set; }

    /// <summary>Display order on the plans list, ascending.</summary>
    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
