using Govori.Platform.Grader;
using Govori.Platform.Stt;
using Microsoft.Extensions.Logging;

namespace Govori.Platform.Ai;

/// <summary>
/// The grader the pipeline actually talks to: an ordered chain of vendor backends, tried until one
/// answers (docs/08 Faza 3.4).
///
/// <para><b>Skipped is not failed.</b> A backend with no key is passed over silently — an
/// unconfigured Claude sitting first in the chain costs nothing and logs nothing. A backend that IS
/// configured and then throws is a real failure: it is logged with its name, and the chain moves on.
/// Conflating the two would either spam the log with "Claude not configured" on every submission or
/// hide a vendor outage.</para>
///
/// <para><b>Cancellation is never a fallback trigger.</b> A cancelled request means the caller went
/// away, not that the vendor failed; retrying the whole chain against a dead request would bill
/// three vendors for an answer nobody will read.</para>
///
/// <para><b>The global AI budget is enforced here</b> (<see cref="IAiBudget"/>), because this is the
/// one door every grading, placement, roleplay and drill call goes through. Before EACH vendor call —
/// the first and every fallback — the budget is checked; when it is closed the chain throws
/// <see cref="AiBudgetExceededException"/> without contacting anyone. After each call that reached a
/// vendor, successful or not, its estimated cost is recorded (<see cref="AiCostEstimator"/>).
/// <see cref="IsConfiguredAsync"/> also answers false while the budget is closed, so every caller's
/// existing "AI is not available right now" path — a 503 on placement, the <c>unconfigured</c> state
/// on roleplay and drills — is what a student sees at the cap.</para>
///
/// <para>The result's <c>Model</c> is whatever the serving backend reports — never the configured
/// name — so <c>evaluations.llm_model</c> records what actually graded the answer (docs/07 §7.9).</para>
/// </summary>
public sealed class ChainGraderProvider : IGraderProvider
{
    private readonly IReadOnlyDictionary<string, IGraderBackend> _backends;
    private readonly IAiConfigSource _config;
    private readonly IAiBudget _budget;
    private readonly ILogger<ChainGraderProvider> _logger;

    public ChainGraderProvider(
        IEnumerable<IGraderBackend> backends, IAiConfigSource config, IAiBudget budget,
        ILogger<ChainGraderProvider> logger)
    {
        _backends = backends.ToDictionary(b => b.Name, StringComparer.OrdinalIgnoreCase);
        _config = config;
        _budget = budget;
        _logger = logger;
    }

    /// <summary>True when at least one backend in the configured order can run AND the global AI
    /// budget is open. False means the pipeline DEFERS the attempt (leaves it pending) rather than
    /// burning it — see <see cref="IGraderProvider.IsConfiguredAsync"/>.</summary>
    public async ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default)
    {
        var config = await _config.GetAsync(ct);
        return Usable(config).Any() && (await _budget.CheckAsync(ct)).IsOpen;
    }

    public async Task<GraderResult> AnalyzeAsync(GraderRequest request, CancellationToken ct = default)
    {
        var config = await _config.GetAsync(ct);
        var usable = Usable(config).ToList();

        if (usable.Count == 0)
            throw new InvalidOperationException(
                $"No grader backend is configured. Chain: [{string.Join(", ", config.GraderChain)}].");

        List<Exception>? failures = null;
        foreach (var backend in usable)
        {
            // Checked before EVERY vendor call, fallbacks included: a retry storm against a failing
            // vendor is exactly the spend this ceiling exists to stop.
            await AiBudgetGuard.EnsureOpenAsync(_budget, ct);

            GraderResult? result = null;
            try
            {
                result = await backend.AnalyzeAsync(request, config, ct);
                if (failures is not null)
                    _logger.LogInformation(
                        "grader {Backend} served the request after {Failed} failure(s)", backend.Name, failures.Count);
                return result;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;                       // the caller left — not a vendor failure, do not fall back
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "grader {Backend} failed; trying the next backend", backend.Name);
                (failures ??= new List<Exception>()).Add(
                    new InvalidOperationException($"grader '{backend.Name}' failed", ex));
            }
            finally
            {
                // Every call that reached the vendor is recorded — including a failure, a timeout or
                // a caller who left mid-call, all of which are usually still billed.
                var (cost, input, output) = AiCostEstimator.Grader(
                    backend.Name, result?.InputTokens, result?.OutputTokens, config.Prices);
                await _budget.RecordAsync(new AiUsage(
                    backend.Name, AiOperations.Grader, Succeeded: result is not null, cost,
                    InputTokens: input, OutputTokens: output), CancellationToken.None);
            }
        }

        // Every configured backend failed. Surface all of them: one vendor's 429 and another's
        // malformed JSON are different problems, and a single "grading failed" hides that.
        throw new AggregateException(
            $"All {usable.Count} configured grader backend(s) failed.", failures!);
    }

    // The chain, in the admin's order, keeping only names we have an implementation for AND that
    // are configured. Unknown names are ignored rather than throwing: a settings row written by a
    // newer build must not break an older one.
    private IEnumerable<IGraderBackend> Usable(AiRuntimeConfig config)
        => config.GraderChain
            .Select(name => _backends.GetValueOrDefault(name))
            .Where(b => b is not null && b.IsConfigured(config))!;
}

/// <summary>
/// The STT provider the pipeline talks to — same chain semantics as <see cref="ChainGraderProvider"/>,
/// including the global AI budget check before every vendor call and a ledger row after it.
///
/// <para>The fallback here is lossier than the grader's: only Azure returns a pronunciation
/// assessment, so falling through to Whisper yields <c>Pronunciation = null</c> and the C5 blend
/// degrades to text-only. That is deliberately preferred to failing the attempt — a student who
/// spoke should get a score, even one computed from four criteria instead of five.</para>
/// </summary>
public sealed class ChainSttProvider : ISttProvider
{
    private readonly IReadOnlyDictionary<string, ISttBackend> _backends;
    private readonly IAiConfigSource _config;
    private readonly IAiBudget _budget;
    private readonly ILogger<ChainSttProvider> _logger;

    public ChainSttProvider(
        IEnumerable<ISttBackend> backends, IAiConfigSource config, IAiBudget budget,
        ILogger<ChainSttProvider> logger)
    {
        _backends = backends.ToDictionary(b => b.Name, StringComparer.OrdinalIgnoreCase);
        _config = config;
        _budget = budget;
        _logger = logger;
    }

    public async ValueTask<bool> IsConfiguredAsync(CancellationToken ct = default)
    {
        var config = await _config.GetAsync(ct);
        return Usable(config).Any() && (await _budget.CheckAsync(ct)).IsOpen;
    }

    public async Task<SttResult> TranscribeAsync(
        byte[] audio, string filename, string? referenceText, CancellationToken ct = default,
        SttRecognitionMode mode = SttRecognitionMode.Unscripted)
    {
        var config = await _config.GetAsync(ct);
        var usable = Usable(config).ToList();

        if (usable.Count == 0)
            throw new InvalidOperationException(
                $"No STT backend is configured. Chain: [{string.Join(", ", config.SttChain)}].");

        List<Exception>? failures = null;
        foreach (var backend in usable)
        {
            await AiBudgetGuard.EnsureOpenAsync(_budget, ct);

            SttResult? result = null;
            try
            {
                result = await backend.TranscribeAsync(audio, filename, referenceText, config, ct, mode);
                if (failures is not null)
                    _logger.LogInformation(
                        "stt {Backend} served the request after {Failed} failure(s)", backend.Name, failures.Count);
                return result;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "stt {Backend} failed; trying the next backend", backend.Name);
                (failures ??= new List<Exception>()).Add(
                    new InvalidOperationException($"stt '{backend.Name}' failed", ex));
            }
            finally
            {
                var seconds = AiCostEstimator.AudioSeconds(audio, result?.DurationSec);
                await _budget.RecordAsync(new AiUsage(
                    backend.Name, AiOperations.Stt, Succeeded: result is not null,
                    AiCostEstimator.Stt(backend.Name, seconds, config.Prices),
                    AudioSeconds: seconds), CancellationToken.None);
            }
        }

        throw new AggregateException($"All {usable.Count} configured STT backend(s) failed.", failures!);
    }

    private IEnumerable<ISttBackend> Usable(AiRuntimeConfig config)
        => config.SttChain
            .Select(name => _backends.GetValueOrDefault(name))
            .Where(b => b is not null && b.IsConfigured(config))!;
}

/// <summary>The one "refuse before spending" rule both chains share.</summary>
internal static class AiBudgetGuard
{
    public static async Task EnsureOpenAsync(IAiBudget budget, CancellationToken ct)
    {
        var check = await budget.CheckAsync(ct);
        if (!check.IsOpen)
            throw new AiBudgetExceededException(check.Block);
    }
}
