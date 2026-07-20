using System.Net.Http.Json;
using System.Text.Json;
using Govori.Platform.Telegram;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Govori.Worker;

/// <summary>Config for <see cref="TelegramBotPoller"/> — the bot API token from
/// <c>TELEGRAM_BOT_TOKEN</c>. Registered (with the poller) only when the token is present.</summary>
public sealed record TelegramBotPollerOptions(string Token);

/// <summary>
/// The Telegram bot poller for phone-OTP delivery (deep-link + bot-sends-code). Long-polls the Bot
/// API <c>getUpdates</c>; when a user opens the <c>t.me/&lt;bot&gt;?start=&lt;token&gt;</c> deep link
/// minted by <c>TelegramBotOtpSender</c>, Telegram delivers a <c>/start &lt;token&gt;</c> message —
/// this resolves the token via <see cref="ITelegramOtpLinkStore"/> (shared Redis) and DMs the code
/// back with <c>sendMessage</c>.
///
/// <para>Runs ONLY in the Worker, and ONLY when <c>TELEGRAM_BOT_TOKEN</c> is set (dev stacks have no
/// token → no poller; the dev delivery stub + fixed code 000000 cover local testing). The update
/// offset is kept in-memory and advanced past processed updates so nothing is reprocessed within a
/// run. Errors are logged and retried with a short backoff — a Telegram/Redis blip never crashes the
/// host.</para>
/// </summary>
public sealed class TelegramBotPoller : BackgroundService
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly ITelegramOtpLinkStore _links;
    private readonly TelegramBotPollerOptions _options;
    private readonly ILogger<TelegramBotPoller> _log;

    private long _offset; // last confirmed update_id + 1; in-memory (a restart re-reads pending updates)

    public TelegramBotPoller(
        IHttpClientFactory httpFactory,
        ITelegramOtpLinkStore links,
        TelegramBotPollerOptions options,
        ILogger<TelegramBotPoller> log)
    {
        _httpFactory = httpFactory;
        _links = links;
        _options = options;
        _log = log;
    }

    private string ApiBase => $"https://api.telegram.org/bot{_options.Token}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Telegram bot OTP poller started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break; // shutting down
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Telegram bot poller iteration failed; backing off.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
        _log.LogInformation("Telegram bot OTP poller stopped.");
    }

    private async Task PollOnceAsync(CancellationToken ct)
    {
        // Long-poll: the server holds the request up to `timeout`s; give the client more headroom.
        var http = _httpFactory.CreateClient("telegram-bot");
        http.Timeout = TimeSpan.FromSeconds(45);

        var url = $"{ApiBase}/getUpdates?timeout=30&allowed_updates=%5B%22message%22%5D"
                  + (_offset > 0 ? $"&offset={_offset}" : string.Empty);

        using var resp = await http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("getUpdates returned {Status}; backing off.", (int)resp.StatusCode);
            await Task.Delay(TimeSpan.FromSeconds(3), ct);
            return;
        }

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var root = doc.RootElement;
        if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True
            || !root.TryGetProperty("result", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var update in results.EnumerateArray())
        {
            if (update.TryGetProperty("update_id", out var idEl) && idEl.TryGetInt64(out var updateId))
                _offset = Math.Max(_offset, updateId + 1); // advance past this update either way

            var token = ExtractStartToken(update);
            if (token is null)
                continue;

            var chatId = update.GetProperty("message").GetProperty("chat").GetProperty("id");
            var link = await _links.ResolveAsync(token, ct);
            if (link is null)
            {
                await SendMessageAsync(http, chatId,
                    "Kod topilmadi yoki muddati o'tgan. Iltimos, ilovada qaytadan urinib ko'ring.", ct);
                continue;
            }

            await SendMessageAsync(http, chatId, $"Govori — kirish kodingiz: {link.Code}", ct);
            _log.LogInformation("Delivered OTP via bot for phone={Phone}.", link.Phone);
        }
    }

    // Match "/start <token>" (Telegram passes the deep-link start param as the message text).
    private static string? ExtractStartToken(JsonElement update)
    {
        if (!update.TryGetProperty("message", out var message)
            || !message.TryGetProperty("text", out var textEl)
            || textEl.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = textEl.GetString() ?? string.Empty;
        const string prefix = "/start ";
        if (!text.StartsWith(prefix, StringComparison.Ordinal))
            return null;

        var token = text[prefix.Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    private async Task SendMessageAsync(HttpClient http, JsonElement chatId, string text, CancellationToken ct)
    {
        // chat_id may be a JSON number; forward it verbatim as a long.
        object chat = chatId.ValueKind == JsonValueKind.Number && chatId.TryGetInt64(out var id)
            ? id
            : chatId.ToString();
        using var resp = await http.PostAsJsonAsync($"{ApiBase}/sendMessage", new { chat_id = chat, text }, ct);
        if (!resp.IsSuccessStatusCode)
            _log.LogWarning("sendMessage returned {Status}.", (int)resp.StatusCode);
    }
}
