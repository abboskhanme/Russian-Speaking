using System.Reflection;

namespace Govori.ArchTests;

/// <summary>
/// The single source of truth for the boundary guardrails in docs/07-ARCHITECTURE-DOTNET.md §7.2
/// ("Chegara qoidalari") — the compiler already enforces the reference graph via project
/// references; these ArchTests prove in CI that the graph can't silently rot (docs/08 Faza 2.2).
///
/// Every constant here is a namespace/assembly PREFIX. NetArchTest's dependency checks match a
/// referenced type when its full name starts with one of these strings, and each Govori assembly's
/// root namespace equals its assembly name (verified: Govori.Catalog types live under the
/// <c>Govori.Catalog</c> namespace, Govori.Platform under <c>Govori.Platform.*</c>, etc.).
/// </summary>
public static class ArchitectureMap
{
    // --- host & shared-kernel assemblies -------------------------------------------------------
    public const string Api = "Govori.Api";
    public const string Worker = "Govori.Worker";
    public const string Contracts = "Govori.Contracts";
    public const string Infrastructure = "Govori.Infrastructure";
    public const string Platform = "Govori.Platform";
    public const string Realtime = "Govori.Realtime";

    /// <summary>The EF Core aggregate root the Api layer must NOT touch outside the composition root.</summary>
    public const string DbContextType = "Govori.Infrastructure.GovoriDbContext";

    // --- the domain modules (docs/07 §7.2; Billing joined them in Faza 6.6) --------------------
    public const string Identity = "Govori.Identity";
    public const string Catalog = "Govori.Catalog";
    public const string Practice = "Govori.Practice";
    public const string Assessment = "Govori.Assessment";
    public const string Classroom = "Govori.Classroom";
    public const string Engagement = "Govori.Engagement";
    public const string Administration = "Govori.Administration";
    public const string Guest = "Govori.Guest";

    /// <summary>Tariffs, subscriptions and payment attempts (docs/08 Faza 6.6). The ninth module:
    /// docs/07 §7.2 froze the list at eight, and this one is added rather than folded into an
    /// existing domain because it owns three tables of its own and a provider seam, and because the
    /// module that would otherwise host it — Administration — must stay reachable from nothing.</summary>
    public const string Billing = "Govori.Billing";

    /// <summary>Every domain-module namespace/assembly prefix.</summary>
    public static readonly IReadOnlyList<string> DomainModules = new[]
    {
        Identity, Catalog, Practice, Assessment,
        Classroom, Engagement, Administration, Guest, Billing,
    };

    /// <summary>The two application-host assemblies no library/module may depend on.</summary>
    public static readonly IReadOnlyList<string> Hosts = new[] { Api, Worker };

    /// <summary>
    /// The ONLY sanctioned cross-domain edge (docs/07 §7.2 + Practice/Catalog csproj notes,
    /// "task decision 3a"): Practice's 402 freemium gate calls Catalog's frozen, C4/C9-characterized
    /// <c>CatalogService.NeedsPremiumAsync</c> / <c>StudentTeacherIdsAsync</c> — the single source of
    /// truth already proven end-to-end by <c>CatalogAccessSqlParityTests</c> — instead of
    /// re-implementing (and risking divergence from) that frozen logic. This allow-list keeps that
    /// one edge legal while every OTHER domain→domain edge still fails the guardrail.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string[]> AllowedCrossDomainEdges =
        new Dictionary<string, string[]>
        {
            [Practice] = new[] { Catalog },
        };

    /// <summary>
    /// Loads an inspected assembly by its simple name. Every Govori project is a ProjectReference of
    /// Govori.ArchTests, so each DLL is copied next to the test assembly; <see cref="Assembly.Load(AssemblyName)"/>
    /// resolves it from the default load context, with a filesystem fallback for belt-and-braces.
    /// </summary>
    public static Assembly Load(string simpleName)
    {
        try
        {
            return Assembly.Load(new AssemblyName(simpleName));
        }
        catch (Exception)
        {
            var path = Path.Combine(AppContext.BaseDirectory, simpleName + ".dll");
            return Assembly.LoadFrom(path);
        }
    }

    /// <summary>Every namespace prefix in the solution EXCEPT <paramref name="self"/> — used to assert isolation.</summary>
    public static string[] EverythingElse(string self)
    {
        var all = new List<string>
        {
            Api, Worker, Contracts, Infrastructure, Platform, Realtime,
            Identity, Catalog, Practice, Assessment,
            Classroom, Engagement, Administration, Guest, Billing,
        };
        all.RemoveAll(ns => ns == self);
        return all.ToArray();
    }
}
