using System.Diagnostics;
using Govori.Contracts;
using Govori.Platform.Ai;
using Govori.Platform.Grader;

namespace Govori.Administration;

/// <summary>
/// Answers the one question the settings screen could not: <b>does this key actually work?</b>
///
/// <para>Until now a wrong key failed silently and late. The chain treats an unusable backend as
/// something to pass over, so a mistyped key produced no error on save, no error on the next page
/// load, and no error anywhere — the first symptom was a student's attempt being graded by a
/// different vendor, or not at all. Pasting a secret you cannot read back and then having no way to
/// confirm it is the worst shape a settings field can have.</para>
///
/// <para>This probes each backend the same way the pipeline would: it asks the backend whether it is
/// configured, and if so makes one real, minimal call. An unconfigured backend is reported as
/// <b>skipped</b>, never as failed — the same distinction the chain itself draws, because an
/// unconfigured Claude sitting first in the chain is a deliberate state, not a fault.</para>
///
/// <para><b>It costs real vendor calls</b>, which is why it is a button an admin presses rather than
/// anything automatic. The grader prompt is one short sentence and the STT clip is one second of
/// generated silence, so the bill is negligible — but it is not zero, and nothing here runs on a
/// timer.</para>
/// </summary>
public sealed class AiProbeService
{
    private readonly IEnumerable<IGraderBackend> _graders;
    private readonly IEnumerable<ISttBackend> _stt;
    private readonly IAiConfigSource _config;
    private readonly IAiBudget? _budget;

    /// <param name="budget">Where the probe's own spend is recorded. The probe is deliberately NOT
    /// gated by the budget — an admin checking a key while AI is paused is exactly when the check is
    /// needed — but what it costs still lands in the ledger, so the totals stay honest. Optional so a
    /// test can build the probe without a ledger.</param>
    public AiProbeService(
        IEnumerable<IGraderBackend> graders, IEnumerable<ISttBackend> stt, IAiConfigSource config,
        IAiBudget? budget = null)
    {
        _graders = graders;
        _stt = stt;
        _config = config;
        _budget = budget;
    }

    // Short on purpose: the probe is checking credentials and reachability, not quality, and every
    // token here is billed on every press.
    private static readonly GraderRequest Probe = new()
    {
        QuestionPrompt = "Расскажите о себе.",
        TranscriptText = "меня зовут алишер мне двадцать лет",
        Level = "A1",
    };

    /// <summary>Probe every implemented backend and report per-backend, in the chain's own order.</summary>
    public async Task<AiProbeResponse> RunAsync(CancellationToken ct = default)
    {
        var config = await _config.GetAsync(ct);
        var results = new List<ProviderProbe>();

        foreach (var name in config.GraderChain.Concat(
                     _graders.Select(g => g.Name).Where(n => !config.GraderChain.Contains(n))))
        {
            var backend = _graders.FirstOrDefault(g => string.Equals(g.Name, name, StringComparison.OrdinalIgnoreCase));
            if (backend is null)
                continue;                       // a name from a newer build; the chain ignores it too
            results.Add(await ProbeOneAsync(
                backend.Name, "grader", backend.IsConfigured(config),
                async () =>
                {
                    GraderResult? graded = null;
                    try
                    {
                        graded = await backend.AnalyzeAsync(Probe, config, ct);
                        return graded.Model;
                    }
                    finally
                    {
                        var (cost, input, output) = AiCostEstimator.Grader(
                            backend.Name, graded?.InputTokens, graded?.OutputTokens, config.Prices);
                        await RecordAsync(new AiUsage(backend.Name, AiOperations.Grader, graded is not null, cost,
                            InputTokens: input, OutputTokens: output));
                    }
                }, ct));
        }

        foreach (var name in config.SttChain.Concat(
                     _stt.Select(s => s.Name).Where(n => !config.SttChain.Contains(n))))
        {
            var backend = _stt.FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));
            if (backend is null)
                continue;
            results.Add(await ProbeOneAsync(
                backend.Name, "stt", backend.IsConfigured(config),
                async () =>
                {
                    var ok = false;
                    try
                    {
                        var model = (await backend.TranscribeAsync(SilentWav(1), "probe.wav", null, config, ct)).Model;
                        ok = true;
                        return model;
                    }
                    finally
                    {
                        await RecordAsync(new AiUsage(backend.Name, AiOperations.Stt, ok,
                            AiCostEstimator.Stt(backend.Name, 1, config.Prices), AudioSeconds: 1));
                    }
                }, ct));
        }

        return new AiProbeResponse(results);
    }

    private Task RecordAsync(AiUsage usage)
        => _budget?.RecordAsync(usage, CancellationToken.None) ?? Task.CompletedTask;

    private static async Task<ProviderProbe> ProbeOneAsync(
        string name, string kind, bool configured, Func<Task<string?>> call, CancellationToken ct)
    {
        if (!configured)
            return new ProviderProbe(name, kind, Configured: false, Ok: false, Model: null, Error: null, ElapsedMs: 0);

        var sw = Stopwatch.StartNew();
        try
        {
            var model = await call();
            return new ProviderProbe(name, kind, true, Ok: true, model, Error: null, (int)sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;                              // the admin navigated away; not a vendor fault
        }
        catch (Exception ex)
        {
            // The message is the whole value of this endpoint — "invalid_api_key" and "model not
            // found" send the admin to two different fields. Trimmed because vendor errors can
            // carry a page of JSON and this lands in a UI.
            var message = ex.Message.Replace('\n', ' ').Trim();
            return new ProviderProbe(
                name, kind, true, Ok: false, Model: null,
                Error: message.Length > 300 ? message[..300] + "…" : message,
                (int)sw.ElapsedMilliseconds);
        }
    }

    /// <summary>One second of 16 kHz mono 16-bit silence, as a valid RIFF/WAVE file.
    ///
    /// <para>Silence on purpose: the probe is asking whether Azure accepts the credentials, the
    /// headers and the content type — not whether it can hear. An empty transcript is the expected
    /// answer and a 401 is the finding.</para>
    ///
    /// <para>Already 16 kHz mono, so the transcode step's header sniff short-circuits and no ffmpeg
    /// process is spawned to test a key.</para></summary>
    private static byte[] SilentWav(int seconds)
    {
        const int rate = 16000, bits = 16, channels = 1;
        var dataBytes = rate * seconds * channels * (bits / 8);

        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);
        w.Write((short)channels);
        w.Write(rate);
        w.Write(rate * channels * (bits / 8));
        w.Write((short)(channels * (bits / 8)));
        w.Write((short)bits);
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        w.Write(new byte[dataBytes]);
        w.Flush();
        return ms.ToArray();
    }
}
