using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// The DbSet for the AI spend ledger (<c>ai_spend_daily</c>). Mapping lives beside the entity and is
/// attached by <c>[EntityTypeConfiguration]</c>, the same arrangement as the audit and drill tables.
/// </summary>
public partial class GovoriDbContext
{
    /// <summary>Estimated AI spend per product day × backend × operation (see <see cref="AiSpendDay"/>).</summary>
    public virtual DbSet<AiSpendDay> AiSpendDaily { get; set; } = null!;
}
