using System.Globalization;
using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Assessment;

/// <summary>
/// The placement test's HTTP surface (owner mockup "dastlabki sinov"): a new student answers 3 short
/// Russian voice questions and gets a CEFR level. Same MODULAR-ENDPOINT PATTERN as the sibling
/// modules — one <c>MapPlacementEndpoints</c> extension the composition root calls; thin endpoints
/// that parse the request → <see cref="PlacementService"/> → serialize.
///
/// <para>All routes <c>RequireAuthorization()</c> (a student only takes placement AFTER registering).
/// The flow stores NOTHING server-side (no schema change): questions are hardcoded, per-answer bands
/// are returned and discarded, and the client marks "placement done" in localStorage. Error bodies
/// use the <c>{ "detail": ... }</c> shape used across the API.</para>
/// </summary>
public static class PlacementEndpoints
{
    // Cap the placement upload the same order of magnitude as a ~2-min answer; guards the buffer read.
    private const long MaxAudioBytes = 12 * 1024 * 1024;

    public static IEndpointRouteBuilder MapPlacementEndpoints(this IEndpointRouteBuilder app)
    {
        var placement = app.MapGroup("/api/placement");

        // GET /api/placement/questions → the 3 fixed Russian prompts [{ index, prompt_ru }].
        placement.MapGet("/questions", (ClaimsPrincipal principal, PlacementService svc) =>
            !IsAccess(principal) ? Results.Unauthorized() : Results.Ok(svc.Questions()))
            .RequireAuthorization();

        // POST /api/placement/submit (multipart: question_index + audio file) → { index, band }.
        // 400 (bad form / index), else 200. Reads the form manually to sidestep antiforgery, exactly
        // like Practice's submit. Stores nothing.
        placement.MapPost("/submit", async (HttpRequest request, ClaimsPrincipal principal, PlacementService svc, CancellationToken ct) =>
        {
            if (!IsAccess(principal))
                return Results.Unauthorized();
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
            return Results.Ok(new PlacementSubmitResponse(index, band));
            // RATE LIMIT placement_submit (30/hour, per user, FAIL-OPEN). This route runs the SAME
            // STT + grader seams as a real submission, so it costs the same money — but because it
            // stores nothing, none of the freemium or attempt-budget logic that bounds
            // POST /api/submissions applies to it, and it had no ceiling whatsoever. 30/hour is ten
            // full 3-answer sessions: room to retry a bad recording, none for a loop.
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.PlacementSubmit).DisableAntiforgery();

        // POST /api/placement/complete { bands: [...] } → { level, label_uz, band }. Averages the
        // client-collected bands → CEFR. 400 when the body is missing/malformed.
        placement.MapPost("/complete", (PlacementCompleteRequest? body, ClaimsPrincipal principal) =>
        {
            if (!IsAccess(principal))
                return Results.Unauthorized();
            if (body?.Bands is null)
                return Detail("bands is required", StatusCodes.Status400BadRequest);
            return Results.Ok(PlacementService.Complete(body.Bands));
        }).RequireAuthorization();

        return app;
    }

    // A valid *access* token carrying a parseable `sub` (a refresh token is rejected) — same guard as
    // Practice. Placement reads no DB, so the token alone is sufficient authorization.
    private static bool IsAccess(ClaimsPrincipal principal) =>
        principal.FindFirstValue("type") == "access"
        && Guid.TryParse(principal.FindFirstValue("sub"), out _);

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
