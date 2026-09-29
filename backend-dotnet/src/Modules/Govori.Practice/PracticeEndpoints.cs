using System.Globalization;
using System.Security.Claims;
using Govori.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Govori.Practice;

/// <summary>
/// The Practice domain's HTTP surface (docs/07 §7.2, Faza 3.3) — the student attempt/submit flow.
/// Follows the MODULAR-ENDPOINT PATTERN established by
/// <c>MapIdentityEndpoints</c>/<c>MapCatalogEndpoints</c>: a single <c>Map*Endpoints</c> extension
/// the composition root calls.
///
/// <para>Endpoints are thin by design (§7.2 — no <c>DbContext</c> here): parse claims + the
/// multipart body → <see cref="PracticeService"/> → serialize. All status decisions (404/403/402)
/// live in the service; here we only map outcomes to HTTP. Error bodies use the
/// <c>{ "detail": ... }</c> shape used across the API.</para>
///
/// <para>Path note: routes are mounted at <c>/api/submissions</c> with no <c>/v1</c> segment, to
/// match the sibling modules' <c>/api/auth</c> / <c>/api/blocks</c> convention (reconciled at the
/// gateway during cutover).</para>
///
/// <para>Submit takes <c>multipart/form-data</c> and stores the audio server-side via
/// <c>IObjectStorage</c>, rather than handing the browser a presigned PUT and accepting an
/// <c>audio_key</c> afterwards. Doing the upload server-side keeps the 402 freemium gate and the
/// upload in a single transaction, so a gated attempt provably writes NOTHING (no object, no row)
/// — the intent of "402 faqat submit'da".</para>
/// </summary>
public static class PracticeEndpoints
{
    public static IEndpointRouteBuilder MapPracticeEndpoints(this IEndpointRouteBuilder app)
    {
        var submissions = app.MapGroup("/api/submissions");

        // POST /api/submissions — submit an audio answer (multipart/form-data: question_id, audio
        // file, optional audio_duration_sec / content_type). → 201 SubmissionResponse, 400 (bad
        // form), 404 (no question), 403 (not reachable), 402 (freemium gate).
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
                // 403, not 409: the answer is refused outright and no retry will change that. The
                // service supplies the message because only it knows the limit.
                SubmitStatus.AttemptsExhausted => Detail(
                    result.Detail ?? "No attempts left for this task.", StatusCodes.Status403Forbidden),
                _ => Results.Json(result.Submission, statusCode: StatusCodes.Status201Created),
            };
        // RATE LIMIT submit_audio (60/hour, per USER, FAIL-OPEN). This is the only authenticated
        // route that spends money per call — one Azure STT plus one grader request — and it had no
        // ceiling: the 402 gate caps a FREE student at three tasks per module, but premium students,
        // teachers and admins were unbounded, and so was any client retry loop passing through here.
        // Sized well above the most energetic real student (see RateLimitPolicies), so it trims the
        // cost tail without ever interrupting practice.
        }).RequireAuthorization().RequireRateLimiting(RateLimitPolicyNames.SubmitAudio).DisableAntiforgery();

        // GET /api/submissions — list my attempts (?question_id, ?student_id, ?needs_review,
        // ?limit=1..200, ?offset>=0). Students see only their own; teachers every answer their
        // roster gives, to any question (TeacherScope); admins all. Every filter only NARROWS that
        // scope — none can widen it (see ListAsync).
        submissions.MapGet("", async (
            ClaimsPrincipal principal, PracticeService svc,
            Guid? question_id, Guid? student_id, bool? needs_review,
            int? limit, int? offset, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var list = await svc.ListAsync(
                userId, question_id, limit ?? 100, offset ?? 0, ct, student_id, needs_review);
            return list is null ? Results.Unauthorized() : Results.Ok(list);
        }).RequireAuthorization();

        // GET /api/submissions/{id} — attempt status/detail.
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

        // GET /api/submissions/{id}/detail — full result detail (audio + transcript + AI scores)
        // for the student result screen. 404 when missing OR not visible (never leaks existence).
        submissions.MapGet("/{id:guid}/detail", async (Guid id, ClaimsPrincipal principal, PracticeService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var result = await svc.GetDetailAsync(userId, id, ct);
            return result.Status switch
            {
                GetStatus.Unauthorized => Results.Unauthorized(),
                GetStatus.NotFound => Detail("Submission not found", StatusCodes.Status404NotFound),
                _ => Results.Ok(result.Detail),
            };
        }).RequireAuthorization();

        // PATCH /api/submissions/{id}/review — a teacher's manual verdict: overall band and/or the
        // "Izoh o'quvchiga" comment, or `confirm: true` → 204. Absent key = unchanged, explicit null
        // = clear (see ReviewSubmissionRequest). Teacher/admin only (403 for a student). 404 when the
        // submission is missing OR its student is outside this teacher's roster, so ids cannot be
        // probed. 400 { detail, code } with code empty_review / confirm_with_band / band_out_of_range.
        submissions.MapPatch("/{id:guid}/review", async (
            Guid id, ReviewSubmissionRequest body, ClaimsPrincipal principal,
            PracticeService svc, CancellationToken ct) =>
        {
            if (!TryGetUserId(principal, out var userId))
                return Results.Unauthorized();
            var outcome = await svc.ReviewAsync(userId, id, body, ct);
            return outcome.Status switch
            {
                ReviewStatus.Ok => Results.NoContent(),
                ReviewStatus.Unauthorized => Results.Unauthorized(),
                ReviewStatus.Forbidden => Detail("Teacher role required", StatusCodes.Status403Forbidden),
                ReviewStatus.NotFound => Detail("Submission not found", StatusCodes.Status404NotFound),
                ReviewStatus.BadRequest => Results.Json(
                    new CodedErrorResponse(outcome.Detail ?? "Bad request", outcome.Code ?? ReviewErrorCodes.EmptyReview),
                    statusCode: StatusCodes.Status400BadRequest),
                _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
            };
        }).RequireAuthorization();

        // F1 · Roleplay / AI Suhbat (docs/08 Faza 6.5) mounts here rather than from the composition
        // root: it is this module's own surface, and where a module's routes live is the module's
        // business, not Program.cs's.
        app.MapRoleplayEndpoints();

        // F3 · Kunlik 5 daqiqa (docs/08 Faza 6.3) — same reasoning. It is a read-only aggregator
        // over surfaces this module and Catalog already expose, so it adds a route, not a slice.
        app.MapDailyEndpoints();

        return app;
    }

    // A valid *access* token carrying a parseable `sub`; a refresh token presented here is
    // rejected. role/is_active are read from the DB in the service, never trusted from the token.
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
