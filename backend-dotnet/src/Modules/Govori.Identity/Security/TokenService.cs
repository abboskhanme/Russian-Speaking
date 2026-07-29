using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Govori.Identity.Security;

/// <summary>
/// Mints and validates the app's HS256 JWTs.
///
/// The payload is exactly four claims — <c>sub</c>, <c>type</c>, <c>iat</c>, <c>exp</c>.
/// No iss, aud, jti, or role. Role and is_active are DB reads on every request,
/// NEVER claims, so a demotion or a block takes effect immediately instead of
/// waiting for the token to expire.
///
/// <b>WIRE FORMAT IS FROZEN.</b> Tokens already issued are live in users' browsers;
/// changing the claim set, the algorithm, or the key encoding invalidates them all
/// and drops every active session.
/// </summary>
public sealed class TokenService
{
    private readonly IdentityAuthOptions _options;
    private readonly SymmetricSecurityKey _signingKey;

    public TokenService(IdentityAuthOptions options)
    {
        _options = options;
        // THE SIGNING KEY IS THE RAW UTF-8 BYTES OF THE SECRET — it is NOT base64-decoded.
        // Base64-decoding it here would produce a different key and reject every token
        // already in circulation.
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.SecretKey));
    }

    private string Create(string subject, TimeSpan ttl, string tokenType)
    {
        var handler = new JwtSecurityTokenHandler();
        // Keep `sub` as `sub` (not the SOAP ClaimTypes URI) on the way out.
        handler.OutboundClaimTypeMap.Clear();

        var now = DateTime.UtcNow;
        var token = handler.CreateJwtSecurityToken(
            subject: new ClaimsIdentity(new[]
            {
                new Claim("sub", subject),
                new Claim("type", tokenType),
            }),
            notBefore: null,            // no nbf requested; see the note below
            expires: now.Add(ttl),      // exp as NumericDate (unix seconds)
            issuedAt: now,              // iat as NumericDate (unix seconds)
            signingCredentials: new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256));

        // NOTE: .NET's builder stamps `nbf` (= issuedAt) even though we pass
        // notBefore: null, so the emitted token carries one extra claim. This is
        // harmless and standard — any client accepts a token whose nbf is already
        // in the past — and every security-critical absence (iss/aud/jti/role) is
        // preserved. Matches the reasoning in the Characterization suite.
        return handler.WriteToken(token);
    }

    public string CreateAccessToken(string subject)
        => Create(subject, TimeSpan.FromMinutes(_options.AccessTokenExpireMinutes), "access");

    public string CreateRefreshToken(string subject)
        => Create(subject, TimeSpan.FromDays(_options.RefreshTokenExpireDays), "refresh");

    /// <summary>Subject is the lower-cased email, so a verify link works regardless of how the
    /// user capitalised their address.</summary>
    public string CreateEmailVerifyToken(string email)
        => Create(email.ToLowerInvariant(), TimeSpan.FromMinutes(_options.EmailVerifyTokenExpireMinutes), "email_verify");

    /// <summary>
    /// Validate a token and return its claims, or null on ANY failure (expired,
    /// bad signature, malformed). Never throws, so callers branch on null rather
    /// than catching — and a malformed token can never be mistaken for a valid one.
    /// </summary>
    public IDictionary<string, string>? Decode(string token)
    {
        var handler = new JwtSecurityTokenHandler();
        // Keep claim types verbatim (`sub`, `type`, ...) instead of remapping to
        // the SOAP ClaimTypes URIs.
        handler.InboundClaimTypeMap.Clear();

        var validationParameters = new TokenValidationParameters
        {
            IssuerSigningKey = _signingKey,
            ValidateIssuerSigningKey = true,
            ValidateIssuer = false,             // no iss claim
            ValidateAudience = false,           // no aud claim
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,          // .NET defaults to 5 min of grace; expire exactly at exp
        };

        try
        {
            var principal = handler.ValidateToken(token, validationParameters, out _);
            var claims = new Dictionary<string, string>();
            foreach (var claim in principal.Claims)
                claims[claim.Type] = claim.Value;
            return claims;
        }
        catch
        {
            // Every validation failure (SecurityToken* and anything else) collapses
            // to null — the caller must not be able to tell why a token was rejected.
            return null;
        }
    }
}
