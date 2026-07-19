using Govori.Contracts;
using Govori.Guest.Tts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.Guest;

/// <summary>
/// The Guest domain's auth-less HTTP surface (docs/07 §3.8), ported from
/// backend/app/api/v1/guest.py. The funnel's "value first": a first-time visitor records the demo
/// phrase, we run the SAME Azure pronunciation assessment the app uses and return per-criterion
/// scores + weakest words + a rough CEFR level — all WITHOUT an account, storing nothing.
///
/// <para>Same MODULAR-ENDPOINT PATTERN as <c>Govori.Identity</c>: one <c>MapGuestEndpoints</c>
/// extension the composition root calls. These endpoints are deliberately NOT
/// <c>.RequireAuthorization()</c>. They ARE rate-limited (per-IP), attaching the ASP.NET Core
/// RateLimiter policies the host registers (fail-open — see Govori.Api/RateLimiting).</para>
/// </summary>
public static class GuestEndpoints
{
    public static IEndpointRouteBuilder MapGuestEndpoints(this IEndpointRouteBuilder app)
    {
        var guest = app.MapGroup("/api/guest");

        // GET /api/guest/demo → { phrase } (guest.py:63-65). No rate limit in Python.
        guest.MapGet("/demo", (GuestService svc) =>
            Results.Ok(new GuestDemoResponse(svc.RandomPhrase())));

        // POST /api/guest/assess?phrase=... (raw audio body) → demo scores (guest.py:68-128).
        // 400 (no audio), 413 (too large), 503 (speech analysis failed), else 200.
        // RATE LIMIT: guest_assess 15/3600, per-IP, FAIL-OPEN.
        guest.MapPost("/assess", async (HttpRequest request, GuestService svc, CancellationToken ct) =>
        {
            string? phrase = request.Query["phrase"];

            using var buffer = new MemoryStream();
            await request.Body.CopyToAsync(buffer, ct);
            var audio = buffer.ToArray();

            if (audio.Length == 0)
                return Detail("No audio", StatusCodes.Status400BadRequest);
            if (audio.Length > GuestPhrases.MaxAudioBytes)
                return Detail("Audio too large", StatusCodes.Status413PayloadTooLarge);

            var result = await svc.AssessAsync(audio, phrase, ct);
            return result is null
                ? Detail("Speech analysis failed, try again", StatusCodes.Status503ServiceUnavailable)
                : Results.Ok(result);
        }).RequireRateLimiting(RateLimitPolicyNames.GuestAssess);

        // GET /api/guest/tts?text=... → MP3 of the correct pronunciation, restricted to the demo
        // phrase's own words so the public endpoint can't do arbitrary TTS (guest.py:131-146).
        // 400 (empty/too long/non-demo word), 503 (TTS unavailable), else 200 audio/mpeg.
        // RATE LIMIT: guest_tts 60/3600, per-IP, FAIL-OPEN.
        guest.MapGet("/tts", async (string? text, ITtsProvider tts, HttpResponse response, CancellationToken ct) =>
        {
            if (string.IsNullOrEmpty(text) || text.Length > GuestPhrases.MaxTtsChars)
                return Detail("Only the demo phrase can be synthesized", StatusCodes.Status400BadRequest);

            var words = GuestPhrases.Words(text);
            if (words.Count == 0 || words.Any(w => !GuestPhrases.AllowedWords.Contains(w)))
                return Detail("Only the demo phrase can be synthesized", StatusCodes.Status400BadRequest);

            byte[] audio;
            try
            {
                audio = await tts.SynthesizeAsync(text, ct);
            }
            catch
            {
                return Detail("TTS unavailable", StatusCodes.Status503ServiceUnavailable);
            }

            response.Headers.CacheControl = "public, max-age=86400"; // guest.py:145
            return Results.Bytes(audio, "audio/mpeg");
        }).RequireRateLimiting(RateLimitPolicyNames.GuestTts);

        return app;
    }

    // FastAPI's default error shape is { "detail": ... } — matched across the .NET slice.
    private static IResult Detail(string message, int statusCode)
        => Results.Json(new { detail = message }, statusCode: statusCode);
}
