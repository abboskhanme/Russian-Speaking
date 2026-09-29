using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Govori.Api.Startup;

/// <summary>
/// A request the CLIENT walked away from is not a server error, and must not be logged as one.
///
/// <para><b>What it looked like before.</b> When a browser closes a tab, a phone drops off wifi or the
/// SPA aborts a superseded fetch, <c>HttpContext.RequestAborted</c> fires, the handler's next awaited
/// call throws <see cref="OperationCanceledException"/> (or an <see cref="IOException"/> while reading
/// the body of a half-sent upload), and that exception travelled up through Serilog's request logger,
/// which records any escaping exception as "responded 500" at Error. Nothing was wrong on our side and
/// nobody was left to answer, yet each one read as an incident — and on a mobile audience they are
/// common enough to bury the real 500s an operator is paging through.</para>
///
/// <para><b>What it does.</b> Sits directly inside the request logger. When the exception is a
/// cancellation or I/O failure AND the client's own abort token has fired, it is swallowed, the
/// response is marked 499 (nginx's "client closed request", which ASP.NET Core also uses for this
/// case) if nothing was sent yet, and a single Debug line is written. The request logger then records
/// an ordinary 499 completion at Information. Both conditions are required: a cancellation the
/// client did NOT cause — a vendor timeout, a shutdown — is still a real failure and still
/// propagates to <see cref="ApiProblem"/> as a 500. The framework's exception handler applies this
/// same test and quietly answers 499 on its own, but it sits OUTSIDE the request logger: by the time
/// the exception reached it, the request logger had already written its Error-level 500.</para>
/// </summary>
public static class ClientAbort
{
    /// <summary>Register directly after <c>UseSerilogRequestLogging()</c> — inside it, so the request
    /// logger sees the 499 instead of the exception.</summary>
    public static IApplicationBuilder UseGovoriClientAbortHandling(this IApplicationBuilder app)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Govori.Api.ClientAbort");
        return app.Use((context, next) => InvokeAsync(context, next, logger));
    }

    /// <summary>The middleware body, separate from the registration so it can be exercised with a
    /// hand-built context.</summary>
    public static async Task InvokeAsync(HttpContext context, RequestDelegate next, ILogger logger)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex) when (IsClientAbort(ex, context))
        {
            if (!context.Response.HasStarted)
                context.Response.StatusCode = StatusCodes.Status499ClientClosedRequest;
            logger.LogDebug(
                "Client closed the request before it completed ({Method} {Path}, {ExceptionType})",
                context.Request.Method, context.Request.Path, ex.GetType().Name);
        }
    }

    /// <summary>A cancellation or I/O failure while the client's abort token has fired.</summary>
    public static bool IsClientAbort(Exception ex, HttpContext context)
        => ex is OperationCanceledException or IOException
           && context.RequestAborted.IsCancellationRequested;
}
