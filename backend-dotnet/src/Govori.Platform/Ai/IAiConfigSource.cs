namespace Govori.Platform.Ai;

/// <summary>
/// Where the AI configuration comes from. Declared HERE, in Platform, and implemented in
/// <c>Govori.Administration</c> against <c>app_settings</c> — the same seam pattern
/// <c>IObjectStorage</c> and the Telegram stores use.
///
/// <para>The direction matters: Platform must not know about modules, the DbContext, or the
/// tri-state rules that govern how a setting is stored. It only needs the answer.</para>
/// </summary>
public interface IAiConfigSource
{
    /// <summary>The current configuration. Implementations are expected to be cheap enough to call
    /// once per grading run (the admin settings read is cached for ~30s).</summary>
    Task<AiRuntimeConfig> GetAsync(CancellationToken ct = default);
}
