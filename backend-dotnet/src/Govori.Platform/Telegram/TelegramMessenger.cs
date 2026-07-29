using System.Net.Http.Json;

namespace Govori.Platform.Telegram;

/// <summary>
/// Sends a plain-text DM to a Telegram user/chat via the Bot API <c>sendMessage</c> method. This is
/// the API-side push seam for PROACTIVE code delivery (docs: "Dehqon Bozor"-style login): when a
/// phone already has a proven <see cref="ITelegramBindingStore">binding</see>, the code is DM'd
/// straight to the bound account instead of routing through a deep link + contact re-share.
///
/// <para>Lives in Platform (the outside-world layer) so it can depend only on <c>HttpClient</c> + a
/// bot token, and be shared by any host that needs to push a message. It is registered in the API
/// ONLY when a bot token is configured; the Worker keeps its own richer sender for keyboard prompts.</para>
/// </summary>
public interface ITelegramMessenger
{
    /// <summary>Send a plain-text DM to <paramref name="chatId"/> via Bot API <c>sendMessage</c>.
    /// Returns <c>true</c> on a 2xx. NEVER throws for a normal Telegram error (the user blocked the
    /// bot, an unknown chat, any 4xx) or a network/timeout hiccup — it returns <c>false</c> so the
    /// caller can fall back to another delivery path. The only exception it propagates is genuine
    /// caller cancellation via <paramref name="ct"/>.</summary>
    Task<bool> SendMessageAsync(long chatId, string text, CancellationToken ct = default);
}

/// <summary>Config for <see cref="TelegramMessenger"/>. <see cref="BotToken"/> ← the
/// <c>TELEGRAM_BOT_TOKEN</c> env var (the @BotFather token used to authenticate the Bot API call).
/// When it is unset the API does not register the messenger at all, so this only ever exists with a
/// real token present.</summary>
public sealed class TelegramMessengerOptions
{
    public string BotToken { get; init; } = string.Empty;
}

/// <summary>
/// <see cref="HttpClient"/>-backed <see cref="ITelegramMessenger"/> hitting
/// <c>https://api.telegram.org/bot&lt;token&gt;/sendMessage</c>. A short (~5 s) timeout is configured
/// on the injected client; any timeout, network failure or Telegram 4xx is swallowed into a
/// <c>false</c> return so a proactive send can never take down or hang the OTP request path.
/// </summary>
public sealed class TelegramMessenger : ITelegramMessenger
{
    private readonly HttpClient _http;
    private readonly TelegramMessengerOptions _options;

    public TelegramMessenger(HttpClient http, TelegramMessengerOptions options)
    {
        _http = http;
        _options = options;
    }

    public async Task<bool> SendMessageAsync(long chatId, string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.BotToken))
            return false; // no token → nothing to authenticate with; caller falls back

        try
        {
            var url = $"https://api.telegram.org/bot{_options.BotToken}/sendMessage";
            using var response = await _http.PostAsJsonAsync(url, new { chat_id = chatId, text }, ct);
            // A blocked user / unknown chat comes back as a 4xx (NOT an exception from PostAsJsonAsync,
            // which only EnsureSuccessStatusCode would throw) → IsSuccessStatusCode is false → false.
            return response.IsSuccessStatusCode;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw; // genuine caller cancellation is not a delivery outcome
        }
        catch
        {
            // Timeout (client timeout throws a cancelled TaskCanceledException with ct NOT set),
            // DNS/network failure, malformed response — all read as "could not deliver" so the
            // caller can fall back to the deep-link path. NEVER surfaced as a 500 to the user.
            return false;
        }
    }
}
