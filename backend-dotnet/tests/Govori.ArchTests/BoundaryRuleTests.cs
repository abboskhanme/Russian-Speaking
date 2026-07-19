using System.Reflection;
using NetArchTest.Rules;

namespace Govori.ArchTests;

/// <summary>
/// Faza 2.2 boundary guardrails (docs/07 §7.2, docs/08 2.2). Each fact loads real Govori assemblies
/// and asserts a dependency direction so the modular monolith can't silently rot back into K7
/// ("domen chegarasi yo'q"). NetArchTest reads IL (Mono.Cecil) from every ProjectReference'd DLL, so
/// these run in the SDK container with no DB/network needed.
///
/// Helper convention: every rule ends in <c>.GetResult()</c>; we assert <c>IsSuccessful</c> and, on
/// failure, surface <c>FailingTypeNames</c> so a broken build names the offending type.
/// </summary>
public sealed class BoundaryRuleTests
{
    private static void AssertPasses(TestResult result, string rule)
    {
        Assert.True(
            result.IsSuccessful,
            $"Boundary rule VIOLATED — {rule}. Offending types: " +
            (result.FailingTypeNames is { } names ? string.Join(", ", names) : "(none reported)"));
    }

    // ── Rule 1 — Platform is the outside world: never depends on a domain, never on a host ──────
    // docs/07 §7.2: "Govori.Platform.* hech qachon Govori.Domains.* ga reference qilmaydi (bir tomonlama)."
    // Covers: Govori.Platform  →  must not reference any of the 8 domain modules, nor Api/Worker.
    [Fact]
    public void Platform_DoesNotDependOnAnyDomainModule_NorHost()
    {
        var forbidden = ArchitectureMap.DomainModules
            .Concat(ArchitectureMap.Hosts)
            .ToArray();

        var result = Types.InAssembly(ArchitectureMap.Load(ArchitectureMap.Platform))
            .ShouldNot()
            .HaveDependencyOnAny(forbidden)
            .GetResult();

        AssertPasses(result, "Govori.Platform must not depend on any domain module or on Api/Worker");
    }

    // ── Rule 2 — Contracts is pure DTOs: depends on nothing else in the solution ─────────────────
    // docs/07 §7.2: Contracts feed OpenAPI → the frontend TS client; they carry no domain/EF/host code.
    // Covers: Govori.Contracts  →  must not reference any other Govori assembly.
    [Fact]
    public void Contracts_DependsOnNothingElseInTheSolution()
    {
        var result = Types.InAssembly(ArchitectureMap.Load(ArchitectureMap.Contracts))
            .ShouldNot()
            .HaveDependencyOnAny(ArchitectureMap.EverythingElse(ArchitectureMap.Contracts))
            .GetResult();

        AssertPasses(result, "Govori.Contracts must be pure DTOs (no domain / Infrastructure / Platform / host deps)");
    }

    // ── Rule 3 — No domain module depends on a host (Api / Worker) ───────────────────────────────
    // A module is a library consumed BY the hosts; the arrow never points back up.
    // Covers: all 8 domain modules  →  must not reference Govori.Api or Govori.Worker.
    [Theory]
    [MemberData(nameof(DomainModuleNames))]
    public void DomainModule_DoesNotDependOnHost(string module)
    {
        var result = Types.InAssembly(ArchitectureMap.Load(module))
            .ShouldNot()
            .HaveDependencyOnAny(ArchitectureMap.Hosts.ToArray())
            .GetResult();

        AssertPasses(result, $"{module} must not depend on Govori.Api / Govori.Worker");
    }

    // ── Rule 4 — Cross-domain isolation, WITH the documented Practice→Catalog allow-list ─────────
    // docs/07 §7.2: "Govori.<Domain> boshqa domenning modeliga reference qilmaydi. Faqat .Contracts
    // yoki event." Decision 3a (codified exception, see ArchitectureMap.AllowedCrossDomainEdges and
    // the Practice/Catalog csproj notes): Practice→Catalog is the single sanctioned edge; every OTHER
    // domain→domain edge must fail. For each module we forbid all sibling domains EXCEPT its allow-list.
    [Theory]
    [MemberData(nameof(DomainModuleNames))]
    public void DomainModule_DoesNotDependOnAnotherDomain_ExceptAllowList(string module)
    {
        ArchitectureMap.AllowedCrossDomainEdges.TryGetValue(module, out var allowed);
        allowed ??= Array.Empty<string>();

        var forbidden = ArchitectureMap.DomainModules
            .Where(d => d != module)          // a module referencing its own namespace is fine
            .Where(d => !allowed.Contains(d)) // …and its documented allow-list is exempt
            .ToArray();

        var result = Types.InAssembly(ArchitectureMap.Load(module))
            .ShouldNot()
            .HaveDependencyOnAny(forbidden)
            .GetResult();

        var allowNote = allowed.Length > 0 ? $" (allowed edges: {string.Join(", ", allowed)})" : "";
        AssertPasses(result, $"{module} must not depend on another domain module{allowNote}");
    }

    // ── Rule 5 — Api is thin: endpoints/handlers never touch GovoriDbContext directly ────────────
    // docs/07 §7.2 / task: Api = parse → service → serialize. The composition root (Program, in the
    // GLOBAL namespace) legitimately registers AddDbContext<GovoriDbContext>; every hand-written Api
    // type lives under the Govori.Api namespace and must go through a module SERVICE, not the DbContext.
    // Scoping to `ResideInNamespace("Govori.Api")` cleanly excludes Program + its top-level-statement
    // nested types (which have no namespace) while still covering the real handler/helper types.
    [Fact]
    public void Api_TypesUnderGovoriApiNamespace_DoNotUseDbContextDirectly()
    {
        var apiAssembly = ArchitectureMap.Load(ArchitectureMap.Api);

        // Guard against a vacuous pass: there must be real Api-namespace types to inspect.
        var inspected = Types.InAssembly(apiAssembly)
            .That().ResideInNamespace(ArchitectureMap.Api)
            .GetTypes()
            .ToList();
        Assert.NotEmpty(inspected);

        var result = Types.InAssembly(apiAssembly)
            .That().ResideInNamespace(ArchitectureMap.Api)
            .ShouldNot()
            .HaveDependencyOn(ArchitectureMap.DbContextType)
            .GetResult();

        AssertPasses(result,
            "Api endpoints/handlers (Govori.Api.*) must not reference GovoriDbContext directly — go through a module service");
    }

    // ── Guard — every inspected assembly actually loaded and carries types ───────────────────────
    // Without this, a mis-typed assembly name would make the rules above pass VACUOUSLY (NetArchTest
    // treats "no types" as success). This makes the whole guardrail non-vacuous by construction.
    [Theory]
    [MemberData(nameof(AllInspectedAssemblyNames))]
    public void EveryInspectedAssembly_LoadsAndHasTypes(string assemblyName)
    {
        var assembly = ArchitectureMap.Load(assemblyName);
        Assert.NotNull(assembly);

        var count = Types.InAssembly(assembly).GetTypes().Count();
        Assert.True(count > 0, $"{assemblyName} loaded but exposed no inspectable types — rules over it would pass vacuously");
    }

    public static IEnumerable<object[]> DomainModuleNames() =>
        ArchitectureMap.DomainModules.Select(m => new object[] { m });

    public static IEnumerable<object[]> AllInspectedAssemblyNames() => new[]
    {
        ArchitectureMap.Api, ArchitectureMap.Worker, ArchitectureMap.Contracts,
        ArchitectureMap.Infrastructure, ArchitectureMap.Platform, ArchitectureMap.Realtime,
        ArchitectureMap.Identity, ArchitectureMap.Catalog, ArchitectureMap.Practice,
        ArchitectureMap.Assessment, ArchitectureMap.Classroom, ArchitectureMap.Engagement,
        ArchitectureMap.Administration, ArchitectureMap.Guest,
    }.Select(a => new object[] { a });
}
