namespace Govori.Catalog;

/// <summary>
/// Catalog-domain settings, mirroring the relevant fields of the Python <c>Settings</c>
/// (backend/app/core/config.py). Registered as a singleton in the composition root from
/// configuration, the same way <c>OtpOptions</c> is.
/// </summary>
public sealed class CatalogOptions
{
    /// <summary>
    /// How many tasks at the start of an official PUBLIC module a non-premium student may
    /// answer for free. Mirrors <c>FREE_TASKS_PER_MODULE</c> (config.py:35, default 3). A value
    /// &lt;= 0 means the whole module is free (no positional paywall) — see
    /// <see cref="CatalogService.NeedsPremiumAsync"/>.
    /// </summary>
    public int FreeTasksPerModule { get; init; } = 3;
}
