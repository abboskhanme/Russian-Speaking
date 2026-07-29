using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// A student's request to join a group by code, awaiting the owning teacher's decision.
///
/// <para><b>Additive table</b> (<c>group_join_requests</c>) — no existing table is touched.
/// <c>group_members</c> keeps its exact old meaning: a row there is a REAL member. This table holds
/// only the intent. Approving moves a student across (request row decided, membership row created);
/// rejecting decides the request and creates nothing. Nothing reads this table to answer "is X in
/// group Y" — that question is still <c>group_members</c> alone, so every existing roster, gradebook
/// and assignment query keeps working untouched.</para>
///
/// <para><b>Why <see cref="Status"/> is plain text and not a native PG enum.</b> The enums in
/// <c>Enums.cs</c> are pre-existing PG types that must round-trip through BOTH
/// <c>NpgsqlDataSourceBuilder.MapEnum</c> and <c>HasPostgresEnum</c> — dropping either silently
/// corrupts the value. A brand-new <c>CREATE TYPE</c> would mean editing the shared data-source
/// factory and the model builder for one additive table's three states. A <c>text</c> column with a
/// CHECK constraint gives the same guarantee at the database level with none of that coupling.</para>
/// </summary>
public partial class GroupJoinRequest
{
    /// <summary>The three states, matching the CHECK constraint on <c>status</c>. Kept as consts
    /// rather than a C# enum so the persisted value and the comparison are literally one token.</summary>
    public const string StatusPending = "pending";
    public const string StatusApproved = "approved";
    public const string StatusRejected = "rejected";

    public Guid Id { get; set; }

    public Guid GroupId { get; set; }

    /// <summary>The requesting user. Named <c>StudentId</c> to match <see cref="GroupMember"/>.</summary>
    public Guid StudentId { get; set; }

    /// <summary>One of <see cref="StatusPending"/> / <see cref="StatusApproved"/> /
    /// <see cref="StatusRejected"/>. A partial unique index allows only ONE pending row per
    /// (group, student), so a rejected student may ask again but can never queue twice.</summary>
    public string Status { get; set; } = StatusPending;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    /// <summary>When the teacher decided. Null while pending.</summary>
    public DateTime? DecidedAt { get; set; }

    /// <summary>Which teacher decided. Null while pending; kept for audit, so a rejection is
    /// attributable rather than anonymous.</summary>
    public Guid? DecidedBy { get; set; }

    public virtual Group Group { get; set; } = null!;

    public virtual User Student { get; set; } = null!;
}
