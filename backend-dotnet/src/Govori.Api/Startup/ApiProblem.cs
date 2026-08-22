using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Govori.Api.Startup;

/// <summary>
/// What a client is told when a request fails in a way no endpoint anticipated.
///
/// <para><b>What this is NOT fixing.</b> ASP.NET Core does not leak stack traces in Production on its
/// own — with no handler registered an unhandled exception ends as a bare 500 with an empty body, and
/// the developer exception page is added only in Development. So this is not closing a leak; it is
/// closing the gap between that bare 500 and the <c>{ "detail": ... }</c> shape every other error in
/// this API uses. A client that parses one error shape and then receives an empty body on the worst
/// day of the deploy shows the user nothing at all.</para>
///
/// <para><b>The trace id is the point.</b> The body carries the W3C trace id of the failed request —
/// the same id OpenTelemetry stamps on the span and Serilog writes on every log line for it
/// (docs/07 §7.9). A user can read it off the screen and an operator can find the exact request,
/// without the response ever describing what went wrong.</para>
///
/// <para>Registered unconditionally. In Development the framework's own developer exception page sits
/// earlier in the pipeline and still wins, so local debugging keeps its stack trace.</para>
/// </summary>
public static class ApiProblem
{
    /// <summary>
    /// The body sent for an unhandled exception. Deliberately says nothing about the failure: the
    /// exception type alone distinguishes "database down" from "vendor rejected the key", and neither
    /// is a client's business. Pure so the no-leak property is a test rather than a code review.
    /// </summary>
    public static string Body(string? traceId)
        => JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["detail"] = "Something went wrong. Please try again.",
            // Omitted rather than null when there is no ambient Activity, so a client never shows an
            // empty "reference: " to a user.
            ["trace_id"] = string.IsNullOrEmpty(traceId) ? null : traceId,
        }.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value));

    /// <summary>Terminal handler for unhandled exceptions: 500 + the sanitized body above.</summary>
    public static IApplicationBuilder UseGovoriExceptionHandler(this IApplicationBuilder app)
        => app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
        {
            // A client that hung up mid-request is not an incident and has nobody to answer.
            if (context.RequestAborted.IsCancellationRequested)
                return;

            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json";

            // The W3C trace id when tracing is active (it is — AddAspNetCoreInstrumentation starts an
            // Activity per request), otherwise Kestrel's own per-request identifier, which Serilog
            // also logs. One of the two always exists, so the reference in the body is never empty.
            var traceId = Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier;

            await context.Response.WriteAsync(Body(traceId), context.RequestAborted);
        }));
}
