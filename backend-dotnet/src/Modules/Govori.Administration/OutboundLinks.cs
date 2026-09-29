using System.Text.RegularExpressions;

namespace Govori.Administration;

/// <summary>
/// Validation + normalisation for the admin-edited contact links (<c>tg_support_url</c>,
/// <c>tg_channel_url</c>). Those values are rendered as <c>href</c>s in every student's sidebar, so
/// before this check an admin who pasted <c>@govori_support</c> (the way Telegram shows a handle)
/// shipped a relative link that 404s, and nothing stopped a <c>javascript:</c> value either.
///
/// <para><b>What is accepted.</b> An absolute <c>https://</c> or <c>http://</c> URL with a host is
/// stored exactly as typed (trimmed). The two Telegram shapes people actually paste are rewritten to
/// the canonical link: a bare <c>t.me/x</c> → <c>https://t.me/x</c>, and an <c>@x</c> handle →
/// <c>https://t.me/x</c>. Everything else — other schemes, bare domains, text with spaces — is
/// refused rather than guessed at: a wrong guess is a broken link in front of every student, while a
/// refusal is one message in front of the admin who can fix it.</para>
///
/// <para><b>Empty means clear.</b> <c>""</c> (or whitespace) is not a link, but it is the tri-state
/// "revert to the environment default" value (see AppSettingsService.SetManyAsync), so it passes
/// through as <c>""</c>.</para>
///
/// <para>Pure and static so the rules are unit-tested directly rather than only through HTTP.</para>
/// </summary>
public static class OutboundLinks
{
    /// <summary>A Telegram username as it can appear after <c>@</c>. Telegram's own rule is 5–32
    /// characters; the bounds here are looser on purpose — this check exists to catch things that
    /// are not handles at all, not to second-guess Telegram about which handles exist.</summary>
    private static readonly Regex TelegramHandle = new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);

    private const string TelegramHostPrefix = "t.me/";

    /// <summary>
    /// Normalise <paramref name="raw"/> to a storable link. Returns <c>false</c> when it is not a
    /// link; <paramref name="normalized"/> is then <c>null</c>. A blank value normalises to
    /// <c>""</c> (clear).
    /// </summary>
    public static bool TryNormalize(string raw, out string? normalized)
    {
        normalized = null;
        var value = raw.Trim();
        if (value.Length == 0)
        {
            normalized = string.Empty;
            return true;
        }

        // Anything with whitespace inside is prose, not a link — Uri would quietly percent-escape it
        // into something that "parses" and then goes nowhere.
        if (value.Any(char.IsWhiteSpace))
            return false;

        string candidate;
        if (value[0] == '@')
        {
            var handle = value[1..];
            if (!TelegramHandle.IsMatch(handle))
                return false;
            candidate = "https://" + TelegramHostPrefix + handle;
        }
        else if (value.StartsWith(TelegramHostPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var path = value[TelegramHostPrefix.Length..];
            if (path.Length == 0)
                return false;                       // "t.me/" alone points at Telegram's home page
            candidate = "https://" + TelegramHostPrefix + path;
        }
        else
        {
            candidate = value;
        }

        // The scheme check is load-bearing, not decoration: on Linux, Uri treats "/foo" as an
        // ABSOLUTE file:// URI, and "javascript:alert(1)" parses as absolute too.
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || string.IsNullOrEmpty(uri.Host))
        {
            return false;
        }

        normalized = candidate;
        return true;
    }
}
