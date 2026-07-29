using System.Net;
using System.Text.Json;

namespace Govori.Identity.Providers;

/// <summary>
/// Verifies a Google ID token via Google's tokeninfo endpoint. Each failure mode maps to a
/// distinct status so the endpoint can pick the right HTTP code:
/// <list type="bullet">
///   <item>no client id ⇒ <see cref="GoogleTokenStatus.NotConfigured"/> (503)</item>
///   <item>transport failure ⇒ <see cref="GoogleTokenStatus.Unreachable"/> (502)</item>
///   <item>non-200, audience mismatch, unverified email, or no email ⇒
///         <see cref="GoogleTokenStatus.Invalid"/> (401)</item>
///   <item>otherwise ⇒ <see cref="GoogleTokenStatus.Valid"/> with (email, name, sub)</item>
/// </list>
/// </summary>
public sealed class GoogleTokenVerifier : IGoogleTokenVerifier
{
    private const string TokenInfoUrl = "https://oauth2.googleapis.com/tokeninfo";

    private readonly HttpClient _http;
    private readonly GoogleAuthOptions _options;

    public GoogleTokenVerifier(HttpClient http, GoogleAuthOptions options)
    {
        _http = http;
        _options = options;
    }

    public async Task<GoogleTokenResult> VerifyAsync(string credential, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_options.ClientId))
            return new GoogleTokenResult(GoogleTokenStatus.NotConfigured);

        HttpResponseMessage resp;
        try
        {
            resp = await _http.GetAsync(
                $"{TokenInfoUrl}?id_token={Uri.EscapeDataString(credential)}", ct);
        }
        catch (HttpRequestException)
        {
            return new GoogleTokenResult(GoogleTokenStatus.Unreachable);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return new GoogleTokenResult(GoogleTokenStatus.Unreachable); // timeout
        }

        if (resp.StatusCode != HttpStatusCode.OK)
            return new GoogleTokenResult(GoogleTokenStatus.Invalid);

        using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = doc.RootElement;

        // tokeninfo returns strings; email_verified may be "true"/"false" (string) — read raw.
        string? Field(string name)
            => root.TryGetProperty(name, out var v)
                ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString())
                : null;

        if (Field("aud") != _options.ClientId)
            return new GoogleTokenResult(GoogleTokenStatus.Invalid);
        if (!string.Equals(Field("email_verified"), "true", StringComparison.OrdinalIgnoreCase))
            return new GoogleTokenResult(GoogleTokenStatus.Invalid);

        var email = Field("email");
        if (string.IsNullOrEmpty(email))
            return new GoogleTokenResult(GoogleTokenStatus.Invalid);

        return new GoogleTokenResult(
            GoogleTokenStatus.Valid,
            new GoogleUserInfo(email, Field("name"), Field("sub")));
    }
}
