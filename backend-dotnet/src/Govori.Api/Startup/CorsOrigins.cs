using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.Api.Startup;

/// <summary>
/// Cross-origin policy for the API, driven by <c>BACKEND_CORS_ORIGINS</c> (comma-separated).
///
/// <para><b>Absent means OFF, and OFF is the safe production shape.</b> In production the SPA and the
/// API are the same origin — nginx serves the built site and proxies <c>/api</c> and <c>/hubs</c> to
/// this host (deploy/nginx/govori.conf) — so a browser never makes a cross-origin call and no CORS
/// headers are needed. Registering a permissive policy "just in case" would hand every other website
/// on the internet the ability to read authenticated responses out of a logged-in user's browser.
/// The variable therefore exists for the SPLIT-ORIGIN case only: a dev machine running Vite on
/// :5173, or a future deployment where the site and the API are on different hosts.</para>
///
/// <para><b>A wildcard is refused, not downgraded.</b> <c>*</c> combined with credentials is
/// rejected by browsers anyway, and combined with a bearer token it is exactly the hole it looks
/// like. Rather than silently drop <c>AllowCredentials</c> — which turns a security mistake into a
/// mysterious broken feature — a wildcard is reported by <see cref="Problems"/> and the Production
/// host refuses to boot (see <see cref="ProductionSecrets"/>).</para>
/// </summary>
public static class CorsOrigins
{
    /// <summary>Name of the single named policy; endpoints inherit it via <c>UseCors(PolicyName)</c>.</summary>
    public const string PolicyName = "govori";

    /// <summary>
    /// Split, trim and drop empties. Trailing slashes are stripped because the CORS <c>Origin</c>
    /// header never carries one, and <c>WithOrigins("https://govorim.uz/")</c> silently matches
    /// nothing — a configuration typo that presents as "CORS just doesn't work".
    /// </summary>
    public static string[] Parse(string? raw)
        => (raw ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(o => o.TrimEnd('/'))
            .Where(o => o.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    /// <summary>
    /// Configuration findings for <c>BACKEND_CORS_ORIGINS</c>, as human-readable sentences. An empty
    /// or absent value is FINE (same-origin deployment) and yields nothing.
    /// </summary>
    public static IReadOnlyList<string> Problems(string? raw)
    {
        var problems = new List<string>();
        foreach (var origin in Parse(raw))
        {
            if (origin == "*" || origin.Contains('*', StringComparison.Ordinal))
            {
                problems.Add(
                    $"BACKEND_CORS_ORIGINS contains a wildcard (`{origin}`). This API is called with a "
                    + "bearer token, so a wildcard origin lets any site read a logged-in user's data. "
                    + "List the exact origins instead, e.g. https://govorim.uz,https://www.govorim.uz.");
                continue;
            }

            // An Origin is scheme + host + optional port and NOTHING else. A value carrying a path
            // never matches, so it is a typo worth failing on rather than a policy worth honouring.
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
                || uri.AbsolutePath != "/")
            {
                problems.Add(
                    $"BACKEND_CORS_ORIGINS entry `{origin}` is not an origin. Use scheme://host[:port] "
                    + "with no path, e.g. https://govorim.uz.");
            }
        }
        return problems;
    }

    /// <summary>
    /// Register the named policy when — and only when — origins are configured. Returns the parsed
    /// origins so the composition root can decide whether to call <c>UseCors</c> at all; adding the
    /// middleware with no policy would emit no headers but still cost every request a pass through it.
    /// </summary>
    public static string[] AddGovoriCors(this IServiceCollection services, IConfiguration config)
    {
        var origins = Parse(config["BACKEND_CORS_ORIGINS"]);
        if (origins.Length == 0)
            return origins;

        services.AddCors(options => options.AddPolicy(PolicyName, policy => policy
            .WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            // Needed by the SignalR hub handshake, and harmless for the REST surface, which
            // authenticates with a header rather than a cookie. Legal precisely because the origin
            // list is explicit — the wildcard that would make it illegal is refused above.
            .AllowCredentials()));

        return origins;
    }
}
