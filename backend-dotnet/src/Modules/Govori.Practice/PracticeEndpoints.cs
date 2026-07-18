using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Practice;

/// <summary>
/// The Practice domain's HTTP surface (docs/07 §7.2, Faza 3.3), ported from
/// backend/app/api/v1/submissions.py (the student attempt/submit flow). Follows the
/// MODULAR-ENDPOINT PATTERN established by <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>:
/// a single <c>Map*Endpoints</c> extension the composition root calls.
///
/// <para>Endpoints are thin by design (§7.2 — no <c>DbContext</c> here): parse claims + the
/// multipart body → <see cref="PracticeService"/> → serialize. All status decisions (404/403/402)
/// live in the service; here we only map outcomes to HTTP. Error bodies use <c>{ "detail": ... }</c>
/// to match FastAPI's default shape.</para>
///
/// <para>Path note: Python routes are <c>/api/v1/submissions</c>; the <c>/v1</c> segment is dropped
/// to match the sibling modules' <c>/api/auth</c> / <c>/api/blocks</c> convention (reconciled at the
/// gateway during cutover).</para>
///
/// <para>Submit takes <c>multipart/form-data</c> and stores the audio server-side via
/// <c>IObjectStorage</c>. Python's browser flow instead mints a presigned PUT (<c>/upload-url</c>)
/// and then POSTs the resulting <c>audio_key</c> as JSON; consolidating both into one server-side
/// upload keeps the 402 freemium gate and the upload in a single transaction, so a gated attempt
/// provably writes NOTHING (no object, no row) — the intent of "402 faqat submit'da".</para>
/// </summary>
public static class PracticeEndpoints
{
    public static IEndpointRouteBuilder MapPracticeEndpoints(this IEndpointRouteBuilder app)
    {
        var submissions = app.MapGroup("/api/submissions");

        // POST /api/submissions — submit an audio answer (multipart/form-data: question_id, audio
        // file, optional audio_duration_sec / content_type). → 201 SubmissionResponse, 400 (bad
        // form), 404 (no question), 403 (not reachable), 402 (freemium gate). submissions.py:99-158.
        // The form is read manually (not via IFormFile binding) to sidestep the antiforgery
        // middleware that form-binding minimal APIs require.
        submissions.MapPost("", async (HttpRequest request, ClaimsPrincipal principal, PracticeService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            if (!request.HasFormContentType)
                return Detail("Expected multipart/form-data", StatusCodes.Status400BadRequest);

            var form = await request.ReadFormAsync(ct);
            if (!Guid.TryParse(form["question_id"], out var questionId))
                return Detail("question_id is required", StatusCodes.Status400BadRequest);

            var file = form.Files["audio"] ?? (form.Files.Count > 0 ? form.Files[0] : null);
            if (file is null || file.Length == 0)
                return Detail("audio file is required", StatusCodes.Status400BadRequest);

            double? duration = double.TryParse(
                form["audio_duration_sec"], NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
                ? d : null;
            var contentType = FirstNonEmpty(form["content_type"], file.ContentType, "audio/webm");

            await using var stream = file.OpenReadStream();
            var result = await svc.SubmitAsync(userId, new SubmitAudio(questionId, stream, contentType, duration), ct);
            return result.Status switch
            {
                SubmitStatus.Unauthorized => Results.Unauthorized(),
                SubmitStatus.QuestionNotFound => Detail("Question not found", StatusCodes.Status404NotFound),
                SubmitStatus.Forbidden => Detail(
                    "This task isn't assigned to you, or its deadline has passed.", StatusCodes.Status403Forbidden),
                SubmitStatus.PaymentRequired => Detail(
                    "This task needs premium. Upgrade to continue this module.", StatusCodes.Status402PaymentRequired),
                _ => Results.Json(result.Submission, statusCode: StatusCodes.Status201Created),
            };
        }).RequireAuthorization().DisableAntiforgery();

        // GET /api/submissions — list my attempts (?question_id, ?limit=1..200, ?offset>=0).
        // submissions.py:199-238. Students see only their own; teachers their roster; admins all.
        submissions.MapGet("", async (
            ClaimsPrincipal principal, PracticeService svc,
            Guid? question_id, int? limit, int? offset, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var list = await svc.ListAsync(userId, question_id, limit ?? 100, offset ?? 0, ct);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/submissions/{id} — attempt status/detail. submissions.py:255-274.
        // 404 (missing OR not visible to this user — never leaks existence).
        submissions.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, PracticeService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var result = await svc.GetAsync(userId, id, ct);
            return result.Status switch
            {
                GetStatus.Unauthorized => Results.Unauthorized(),
                GetStatus.NotFound => Detail("Submission not found", StatusCodes.Status404NotFound),
                _ => Results.Ok(result.Submission),
            };
        }).RequireAuthorization();

        return app;
    }

    // A valid *access* token carrying a parseable `sub` (a refresh token is rejected, mirroring
    // deps.py:25). role/is_active are read from the DB in the service, never trusted from the token.
    private static bool TryGetUserId(ClaimsPrincipal principal, out Guid userId)
    {
        userId = Guid.Empty;
        return principal.FindFirstValue("type") == "access"
               && Guid.TryParse(principal.FindFirstValue("sub"), out userId);
    }

    private static string FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? string.Empty;

    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
