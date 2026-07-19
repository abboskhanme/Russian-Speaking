using NetArchTest.Rules;

namespace Govori.ArchTests;

/// <summary>
/// Proof-of-teeth for Faza 2.2 DoD (docs/08 2.2): "a deliberately-broken reference fails the build."
///
/// Rather than commit a throwaway forbidden reference (which would break the build for everyone), we
/// point the SAME NetArchTest engine at a dependency edge that genuinely exists and assert it is
/// DETECTED as a violation when the allow-list is removed. If NetArchTest ever stopped seeing real
/// IL edges (wrong assembly loaded, engine no-op, vacuous pass), these facts would fail — so they
/// guarantee the guardrails in <see cref="BoundaryRuleTests"/> actually bite instead of rubber-stamp.
/// </summary>
public sealed class GuardrailBitesTests
{
    // The Practice→Catalog edge is real (PracticeService injects CatalogService for the frozen 402
    // gate). Rule 4 EXEMPTS it via the allow-list. Here we run the cross-domain check WITHOUT the
    // exemption and prove it fails and names a Practice type — i.e. drop the allow-list entry and the
    // build goes red. This is the exact "forbidden reference fails" demonstration for the DoD.
    [Fact]
    public void WithoutTheAllowList_TheRealPracticeToCatalogEdgeIsDetectedAsAViolation()
    {
        var result = Types.InAssembly(ArchitectureMap.Load(ArchitectureMap.Practice))
            .ShouldNot()
            .HaveDependencyOn(ArchitectureMap.Catalog) // <-- allow-list deliberately NOT applied
            .GetResult();

        Assert.False(
            result.IsSuccessful,
            "Expected NetArchTest to FLAG the real Practice→Catalog edge when unexempted — the guardrail " +
            "is not biting. If this passed, Rule 4 would rubber-stamp any cross-domain edge.");

        Assert.NotNull(result.FailingTypeNames);
        Assert.Contains(
            result.FailingTypeNames!,
            t => t.StartsWith(ArchitectureMap.Practice, StringComparison.Ordinal));
    }

    // Second, independent proof the engine reads real inter-assembly IL: Realtime genuinely depends on
    // Assessment (GradingJob / MaintenanceJobs). A "should not depend on Assessment" rule MUST fail —
    // confirming HaveDependencyOnAny observes true edges, not just self-namespace matches.
    [Fact]
    public void EngineObservesRealInterAssemblyEdges_RealtimeDependsOnAssessment()
    {
        var result = Types.InAssembly(ArchitectureMap.Load(ArchitectureMap.Realtime))
            .ShouldNot()
            .HaveDependencyOn(ArchitectureMap.Assessment)
            .GetResult();

        Assert.False(
            result.IsSuccessful,
            "Expected the known Realtime→Assessment edge to be detected; if not, dependency detection is broken.");
    }
}
