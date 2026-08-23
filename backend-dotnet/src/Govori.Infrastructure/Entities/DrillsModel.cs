using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// The DbSets for the two phoneme-drill tables (docs/01 F2). Their column mapping lives in
/// <see cref="MinimalPairConfiguration"/> / <see cref="DrillConfiguration"/>, attached to the
/// entities by <c>[EntityTypeConfiguration]</c>.
///
/// <para><b>Why the attribute rather than the <c>OnModelCreatingPartial</c> hook the roleplay tables
/// use:</b> that hook is a partial METHOD, so the language permits exactly one implementation, and
/// <c>RoleplayModel.cs</c> already holds it. The alternatives were to append this feature's mapping
/// to a file named after a different feature — which also makes one file two agents' merge target —
/// or to edit the 865-line scaffolded context whose own comment says it is regenerated wholesale.
/// The attribute is discovered automatically when EF walks these DbSets, requires no shared edit,
/// and keeps the mapping beside the entities it maps.</para>
/// </summary>
public partial class GovoriDbContext
{
    /// <summary>The authored minimal pairs (see <see cref="MinimalPair"/>).</summary>
    public virtual DbSet<MinimalPair> MinimalPairs { get; set; } = null!;

    /// <summary>Every drill attempt anyone has made (see <see cref="Drill"/>).</summary>
    public virtual DbSet<Drill> Drills { get; set; } = null!;
}
