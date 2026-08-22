using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Govori.Api.Startup;

/// <summary>
/// The response headers the API sets on its OWN answers.
///
/// <para><b>nginx owns the browser-facing policy; this owns what nginx cannot express.</b>
/// deploy/nginx sets Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
/// Referrer-Policy and Permissions-Policy at the server level, and the <c>/api/</c> location declares
/// no <c>add_header</c> of its own, so it inherits all of them — API responses already carry them in
/// production. Setting them again here would not add protection; it would produce two values for the
/// same header, and where the two disagree (this file previously said <c>X-Frame-Options: DENY</c>
/// while nginx says <c>SAMEORIGIN</c>) a browser is entitled to honour neither. So those five are
/// deliberately NOT set here. nginx is the right owner for them: it is the only layer that sees TLS,
/// and it fronts the SPA as well as the API, so one policy covers everything a browser loads.</para>
///
/// <para><b>What is left is genuinely this layer's.</b> A Content-Security-Policy strict enough for
/// an API response — <c>default-src 'none'</c>, load nothing, ever — would destroy the SPA if nginx
/// applied it at the server level, so it cannot live there. It belongs to the responses it describes,
/// and every response from this host is JSON, an audio blob or a Prometheus scrape: data, never a
/// document. <c>frame-ancestors 'none'</c> rides along in the same header and, where both are
/// present, takes precedence over X-Frame-Options — which is why the API's stricter framing rule
/// does not contradict the SPA's SAMEORIGIN, it simply applies to different responses.</para>
///
/// <para><c>nosniff</c> is the one repeat, and it repeats safely: it has exactly one legal value, so
/// a duplicate is inert rather than ambiguous. It is here because a JSON body a browser guesses is
/// HTML becomes a script-execution context on this origin, and that must not depend on which proxy
/// happens to be in front — a direct hit on the published API port gets it too.</para>
/// </summary>
public static class SecurityHeaders
{
    /// <summary>
    /// Add the headers to every response.
    ///
    /// <para>Written from <c>OnStarting</c> rather than before <c>next()</c> because endpoints
    /// further down may replace the response entirely; <c>OnStarting</c> runs immediately before the
    /// first byte leaves, which is the only moment the final header collection exists. Assignment,
    /// not <c>Append</c>, so a header something upstream already set stays single-valued.</para>
    /// </summary>
    public static IApplicationBuilder UseGovoriSecurityHeaders(this IApplicationBuilder app)
        => app.Use((context, next) =>
        {
            context.Response.OnStarting(static state =>
            {
                var headers = ((HttpContext)state).Response.Headers;

                // Nothing this host returns is a document. Load nothing, frame it nowhere.
                headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
                // Refuse the content-type guess that would turn a JSON body into a script context.
                headers["X-Content-Type-Options"] = "nosniff";

                return Task.CompletedTask;
            }, context);

            return next();
        });
}
