using System.Buffers.Binary;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;

namespace Govori.Platform.Ai.Backends;

/// <summary>
/// Turns whatever the browser recorded into the ONE format Azure AI Speech's REST endpoint accepts:
/// 16 kHz, mono, 16-bit little-endian PCM inside a RIFF/WAVE container.
///
/// <para>This exists because <c>MediaRecorder</c> gives us webm/opus (Chrome/Firefox) or mp4/aac
/// (Safari) and Azure's short-audio REST API will not decode either — it reads the container we
/// declare in <c>Content-Type</c> and nothing else. Decoding those codecs in managed code would mean
/// shipping a codec stack; shelling out to <c>ffmpeg</c>, which is already a runtime dependency of
/// both container images, is the smaller commitment.</para>
///
/// <para><b>Why the plumbing below is more careful than it looks.</b> Piping through a child process
/// has one classic failure that never shows up in a unit test and always shows up in production:
/// write all of stdin, then read stdout, and the moment ffmpeg's output exceeds the OS pipe buffer
/// (64 KiB on Linux) ffmpeg blocks writing while we block writing, forever. A ten-second recording
/// transcodes to ~320 KiB, so the deadlock is certain on real audio and invisible on a one-second
/// fixture. Every read here therefore runs concurrently with the write, on its own task.</para>
/// </summary>
public static class AudioTranscode
{
    /// <summary>Sample rate Azure's <c>audio/wav; codecs=audio/pcm</c> content type is declared with.
    /// Changing it means changing the <c>Content-Type</c> header at the call site too — the two are a
    /// pair, and a mismatch is accepted by the service and then transcribed as noise.</summary>
    public const int TargetSampleRate = 16_000;

    private const int TargetChannels = 1;
    private const int TargetBitsPerSample = 16;
    private const ushort WaveFormatPcm = 1;

    /// <summary>Hard ceiling on one transcode. Attempts are capped at a minute or two of speech, which
    /// ffmpeg converts in well under a second; anything still running at 30 s is wedged (a truncated
    /// container it is waiting to complete, a pathological input) and holding a Hangfire worker
    /// hostage is worse than failing over to Whisper.</summary>
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    /// <summary>How much of ffmpeg's stderr goes into the exception message. The useful diagnosis is
    /// always the last line ("Invalid data found when processing input"); the rest is banner noise.</summary>
    private const int StderrTailChars = 1_000;

    private static readonly string[] Arguments =
    {
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-vn",                              // some phones wrap the recording in a video container
        "-ar", TargetSampleRate.ToString(CultureInfo.InvariantCulture),
        "-ac", TargetChannels.ToString(CultureInfo.InvariantCulture),
        "-acodec", "pcm_s16le",
        "-f", "wav", "pipe:1",
    };

    private static readonly Lazy<string?> Executable =
        new(Locate, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>Whether an <c>ffmpeg</c> binary was found. The Azure backend reports itself
    /// unconfigured-ish through a plain, named exception rather than letting a missing binary surface
    /// as an opaque <c>Win32Exception</c> from deep inside <see cref="Process.Start()"/> — "ffmpeg is
    /// not installed in this image" is a five-minute fix, "An error occurred trying to start process"
    /// is an afternoon.</summary>
    public static bool IsAvailable => Executable.Value is not null;

    /// <summary>
    /// Decode <paramref name="audio"/> and re-encode it as 16 kHz mono 16-bit PCM WAV.
    ///
    /// <para>Input that is ALREADY in that exact shape is returned untouched — the same byte array,
    /// not a copy. Shadowing sends the same reference clip through this path on every attempt, and
    /// spawning a process to convert a WAV into an identical WAV is pure latency.</para>
    /// </summary>
    /// <exception cref="InvalidOperationException">ffmpeg is missing, could not start, exited
    /// non-zero, or produced nothing. The message carries the tail of stderr; the STT chain logs it
    /// and falls through to Whisper.</exception>
    /// <exception cref="TimeoutException">ffmpeg was still running after <see cref="Timeout"/> and its
    /// process tree was killed.</exception>
    /// <exception cref="OperationCanceledException">The CALLER cancelled. Distinguished from the
    /// timeout on purpose: the chain treats caller cancellation as "nobody is waiting for this
    /// answer" and does not fall back, but a timeout is a real failure that should try Whisper.</exception>
    public static async Task<byte[]> ToAzurePcmWavAsync(byte[] audio, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(audio);
        if (audio.Length == 0)
            throw new InvalidOperationException("The recording is empty; there is nothing to transcode.");

        if (IsAlreadyAzureReady(audio))
            return audio;

        var ffmpeg = Executable.Value ?? throw new InvalidOperationException(
            "ffmpeg was not found on PATH (nor at $FFMPEG_PATH). Browser audio is webm/opus and Azure " +
            "only accepts PCM WAV, so transcoding is not optional — install ffmpeg in the api and " +
            "worker images.");

        // Linked so a caller-cancel and our own deadline share one kill path; the two are told apart
        // afterwards by asking the ORIGINAL token which one fired.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(Timeout);

        var startInfo = new ProcessStartInfo(ffmpeg)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in Arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = startInfo };

        try
        {
            process.Start();
        }
        catch (Win32Exception ex)
        {
            throw new InvalidOperationException(
                $"ffmpeg at '{ffmpeg}' could not be started ({ex.Message}).", ex);
        }

        // All three pumps are started BEFORE anything is awaited. This is the whole point of the
        // class: stdout and stderr drain while stdin is still being written, so neither side can
        // fill a pipe buffer and stall the other.
        var stdout = DrainAsync(process.StandardOutput.BaseStream, deadline.Token);
        var stderr = process.StandardError.ReadToEndAsync(deadline.Token);
        var stdin = FeedAsync(process, audio, deadline.Token);

        Exception? failure = null;
        try
        {
            await Task.WhenAll(stdin, stdout, stderr).ConfigureAwait(false);
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            failure = ex;
        }

        if (failure is not null)
        {
            KillTree(process);
            ct.ThrowIfCancellationRequested();          // the caller left — not a vendor failure

            if (deadline.IsCancellationRequested)
                throw new TimeoutException(
                    $"ffmpeg did not finish within {Timeout.TotalSeconds:0}s and was killed.");

            throw new InvalidOperationException(
                $"ffmpeg transcode failed: {Tail(await SwallowAsync(stderr).ConfigureAwait(false))}", failure);
        }

        var diagnostics = await SwallowAsync(stderr).ConfigureAwait(false);

        if (process.ExitCode != 0)
            throw new InvalidOperationException(
                $"ffmpeg exited with code {process.ExitCode}: {Tail(diagnostics)}");

        var wav = await stdout.ConfigureAwait(false);
        if (wav.Length <= 44)
            throw new InvalidOperationException(
                $"ffmpeg produced no audible output ({wav.Length} bytes): {Tail(diagnostics)}");

        RepairStreamedHeader(wav);
        return wav;
    }

    // ─────────────────────────── process plumbing ───────────────────────────

    /// <summary>Writes the source bytes into ffmpeg's stdin and then CLOSES it. The close is what
    /// tells ffmpeg the input ended; without it ffmpeg waits for more data and we wait for its
    /// output, which is the same deadlock by a different route.</summary>
    private static async Task FeedAsync(Process process, byte[] audio, CancellationToken ct)
    {
        try
        {
            var stdin = process.StandardInput.BaseStream;
            await stdin.WriteAsync(audio, ct).ConfigureAwait(false);
            await stdin.FlushAsync(ct).ConfigureAwait(false);
        }
        catch (IOException)
        {
            // ffmpeg rejected the input and closed the pipe mid-write (EPIPE). Its exit code and
            // stderr say WHY; reporting "broken pipe" from here would replace the real reason with
            // a symptom.
        }
        catch (ObjectDisposedException)
        {
            // Same race, observed when the process was killed while a write was in flight.
        }
        finally
        {
            try { process.StandardInput.Close(); } catch { /* the process already took it down */ }
        }
    }

    private static async Task<byte[]> DrainAsync(Stream stdout, CancellationToken ct)
    {
        using var buffer = new MemoryStream(capacity: 256 * 1024);
        await stdout.CopyToAsync(buffer, ct).ConfigureAwait(false);
        return buffer.ToArray();
    }

    /// <summary>Awaits a pump that is only wanted for its diagnostics, never for its success. Used on
    /// the failure path, where the pump may itself have been cancelled or torn down by the kill.</summary>
    private static async Task<string> SwallowAsync(Task<string> pump)
    {
        try { return await pump.ConfigureAwait(false); }
        catch { return string.Empty; }
    }

    /// <summary>Kills ffmpeg AND anything it spawned. <c>entireProcessTree</c> matters because a
    /// half-killed transcode leaves a process holding the pipes open, and the read pumps then never
    /// complete — the container looks healthy while one worker slot is gone for good.</summary>
    private static void KillTree(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Already exited, or the platform refused; either way there is nothing left to do and
            // throwing here would replace the real failure with a cleanup detail.
        }
    }

    private static string Tail(string stderr)
    {
        var trimmed = stderr.Trim();
        if (trimmed.Length == 0)
            return "(no stderr output)";
        return trimmed.Length <= StderrTailChars
            ? trimmed
            : "…" + trimmed[^StderrTailChars..];
    }

    /// <summary>Resolves the binary once. <c>FFMPEG_PATH</c> wins so a non-standard install (a dev
    /// machine, a distroless base) needs no code change.</summary>
    private static string? Locate()
    {
        var configured = Environment.GetEnvironmentVariable("FFMPEG_PATH");
        if (!string.IsNullOrWhiteSpace(configured))
            return File.Exists(configured) ? configured : null;

        var name = OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;

        foreach (var directory in path.Split(
                     Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string candidate;
            try
            {
                candidate = Path.Combine(directory, name);
            }
            catch (ArgumentException)
            {
                continue;                      // a PATH entry with illegal characters — skip, don't crash
            }

            if (File.Exists(candidate))
                return candidate;
        }

        return null;
    }

    // ─────────────────────────── WAV inspection ───────────────────────────

    /// <summary>
    /// Cheap header sniff: is this already RIFF/WAVE holding 16 kHz mono 16-bit PCM? Only the <c>fmt</c>
    /// chunk is read, so this costs a few dozen bytes and can never be a reason to skip the transcode
    /// wrongly — anything it does not fully recognise falls through to ffmpeg.
    /// </summary>
    private static bool IsAlreadyAzureReady(byte[] audio)
    {
        var span = audio.AsSpan();
        if (span.Length < 44 || !span[..4].SequenceEqual("RIFF"u8) || !span.Slice(8, 4).SequenceEqual("WAVE"u8))
            return false;

        var position = 12;
        while (position + 8 <= span.Length)
        {
            var id = span.Slice(position, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(position + 4, 4));
            var body = position + 8;

            if (id.SequenceEqual("fmt "u8))
            {
                if (size < 16 || body + 16 > span.Length)
                    return false;

                var format = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(body, 2));
                var channels = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(body + 2, 2));
                var sampleRate = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(body + 4, 4));
                var bits = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(body + 14, 2));

                return format == WaveFormatPcm
                       && channels == TargetChannels
                       && sampleRate == TargetSampleRate
                       && bits == TargetBitsPerSample;
            }

            if (size > (uint)(span.Length - body))
                return false;                  // truncated or lying header — let ffmpeg deal with it

            position = body + (int)size + (int)(size & 1);   // RIFF chunks are word-aligned
        }

        return false;
    }

    /// <summary>
    /// Rewrites the RIFF and <c>data</c> chunk lengths to the sizes actually produced.
    ///
    /// <para>ffmpeg's WAV muxer normally seeks back to patch those two fields once it knows the total
    /// length. Writing to a PIPE it cannot seek, so it leaves placeholders (<c>0</c> or
    /// <c>0xFFFFFFFF</c>). Most decoders shrug and read to EOF; a service that trusts the declared
    /// length would read zero samples and return an empty transcript — a silent, total failure that
    /// looks exactly like a student who said nothing. We have the whole buffer in memory, so the
    /// honest sizes cost four bytes each.</para>
    /// </summary>
    private static void RepairStreamedHeader(byte[] wav)
    {
        var span = wav.AsSpan();
        if (span.Length < 44 || !span[..4].SequenceEqual("RIFF"u8) || !span.Slice(8, 4).SequenceEqual("WAVE"u8))
            return;

        var declaredRiff = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(4, 4));
        if (declaredRiff != (uint)(span.Length - 8))
            BinaryPrimitives.WriteUInt32LittleEndian(span.Slice(4, 4), (uint)(span.Length - 8));

        var position = 12;
        while (position + 8 <= span.Length)
        {
            var id = span.Slice(position, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(position + 4, 4));
            var body = position + 8;

            if (id.SequenceEqual("data"u8))
            {
                var actual = (uint)(span.Length - body);
                if (size != actual)
                    BinaryPrimitives.WriteUInt32LittleEndian(span.Slice(position + 4, 4), actual);
                return;
            }

            if (size > (uint)(span.Length - body))
                return;                        // a bogus length before `data`: stop rather than walk off

            position = body + (int)size + (int)(size & 1);
        }
    }
}
