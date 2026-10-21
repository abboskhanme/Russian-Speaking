using System.Globalization;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Assessment;

/// <summary>
/// The AUTH-LESS "try the placement test" surface. A brand-new visitor can experience the level check
/// WITHOUT registering (reached from the "try it" link on the login/register screens), then is nudged
/// to sign up. Mirrors <see cref="PlacementEndpoints"/> route-for-route under <c>/api/guest/placement</c>
/// and delegates to the SAME <see cref="PlacementService"/> — the identical hardcoded questions,
/// grading (STT+grader seam / deterministic-band fallback) and CEFR mapping — so there is ZERO
/// duplication of the placement logic.
///
/// <para>Unlike the authed sibling these routes are deliberately NOT <c>.RequireAuthorization()</c>
/// (the API's only auth-less grading surface). The two write endpoints are per-IP
/// rate-limited via the shared ASP.NET Core RateLimiter (<see cref="RateLimitPolicyNames.GuestPlacement"/>),
/// which is FAIL-OPEN (a store outage ALLOWS the request — see Govori.Api/RateLimiting). The flow stores
/// NOTHING server-side (questions are hardcoded, bands are returned and discarded); the guest is a trial,
/// so no <c>govori_placed</c> flag is set. Error bodies use the <c>{ "detail": ... }</c> shape used
/// across the API.</para>
/// </summary>
public static class GuestPlacementEndpoints
{
    // Same cap as the authed placement submit (~2-min answer); guards the buffer read.
    private const long MaxAudioBytes = 12 * 1024 * 1024;

    public static IEndpointRouteBuilder MapGuestPlacementEndpoints(this IEndpointRouteBuilder app)
    {
        var placement = app.MapGroup("/api/guest/placement");

        // GET /api/guest/placement/questions → the same 3 fixed Russian prompts (no auth, no rate
        // limit — static + cheap).
        placement.MapGet("/questions", (PlacementService svc) => Results.Ok(svc.Questions()));

        // POST /api/guest/placement/submit (multipart: question_index + audio) → { index, band }.
        // No auth; RATE LIMIT guest_placement (per-IP, fail-open). Reads the form manually to sidestep
        // antiforgery, exactly like the authed placement submit. Stores nothing. 503 placement_unavailable
        // when the answer cannot be scored right now (never an invented band).
        placement.MapPost("/submit", async (HttpRequest request, PlacementService svc, CancellationToken ct) =>
        {
            if (!request.HasFormContentType)
                return Detail("Expected multipart/form-data", StatusCodes.Status400BadRequest);

            var form = await request.ReadFormAsync(ct);
            if (!int.TryParse(form["question_index"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var index)
                || !PlacementService.IsValidIndex(index))
                return Detail("question_index is out of range", StatusCodes.Status400BadRequest);

            var file = form.Files["audio"] ?? (form.Files.Count > 0 ? form.Files[0] : null);
            if (file is null || file.Length == 0)
                return Detail("audio file is required", StatusCodes.Status400BadRequest);
            if (file.Length > MaxAudioBytes)
                return Detail("Audio too large", StatusCodes.Status413PayloadTooLarge);

            await using var stream = file.OpenReadStream();
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, ct);

            var band = await svc.GradeAnswerAsync(index, buffer.ToArray(), ct);
            // No band is ever invented: an answer that cannot be scored right now is a 503 the
            // screen turns into "retry or skip", not a level made of file size (see PlacementService).
            return band is { } b
                ? Results.Ok(new PlacementSubmitResponse(index, b))
                : Results.Json(
                    new CodedErrorResponse("Placement cannot be assessed right now", PlacementErrorCodes.Unavailable),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
        }).RequireRateLimiting(RateLimitPolicyNames.GuestPlacement).DisableAntiforgery();

        // POST /api/guest/placement/complete { bands: [...] } → { level, label_uz, band }. No auth;
        // RATE LIMIT guest_placement. Averages the client-collected bands → CEFR (same as authed).
        placement.MapPost("/complete", (PlacementCompleteRequest? body) =>
        {
            if (body?.Bands is null)
                return Detail("bands is required", StatusCodes.Status400BadRequest);
            return Results.Ok(PlacementService.Complete(body.Bands));
        }).RequireRateLimiting(RateLimitPolicyNames.GuestPlacement);

        return app;
    }

    // Error bodies use the { "detail": ... } shape used across the API.
    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
