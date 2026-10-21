using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// The DbSet for the admin audit trail (<c>admin_audit_log</c>). The column mapping sits beside the
/// entity and is attached by <c>[EntityTypeConfiguration]</c> — the same arrangement as the drill
/// tables, for the same reason: no edit to the scaffolded context body, and no second claim on the
/// single <c>OnModelCreatingPartial</c> implementation.
/// </summary>
public partial class GovoriDbContext
{
    /// <summary>Every successful admin mutation, append-only (see <see cref="AdminAuditEntry"/>).</summary>
    public virtual DbSet<AdminAuditEntry> AdminAuditLog { get; set; } = null!;
}
