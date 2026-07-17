using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Govori.Identity.Security;

/// <summary>
/// JWT mint/decode ported 1:1 from backend/app/core/security.py:22-63.
///
/// Python:
///     payload = {"sub": subject, "type": token_type, "iat": now, "exp": now + delta}
///     jwt.encode(payload, SECRET_KEY, algorithm="HS256")
///     jwt.decode(token, SECRET_KEY, algorithms=["HS256"])  # → None on JWTError
///
/// Exactly four claims: sub, type, iat, exp. No iss, aud, jti, nbf, or role —
/// role is a DB read on every request (deps.py), never a claim. Tokens minted by
/// the Python stack are live in users' browsers now; this must read them or every
/// session drops at cutover.
/// </summary>
public sealed class TokenService
{
    private readonly IdentityAuthOptions _options;
    private readonly SymmetricSecurityKey _signingKey;

    public TokenService(IdentityAuthOptions options)
    {
        _options = options;
        // RAW UTF-8 bytes — NOT base64-decoded. python-jose uses the key bytes
        // directly; a port that base64-decodes rejects every existing token.
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
            notBefore: null,            // Python emits no nbf; see note below
            expires: now.Add(ttl),      // exp as NumericDate (unix seconds)
            issuedAt: now,              // iat as NumericDate (unix seconds)
            signingCredentials: new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256));

        // NOTE: .NET's builder stamps `nbf` (= issuedAt) even though we pass
        // notBefore: null. Python emits no nbf. This is harmless and standard —
        // python-jose and browser clients accept a token whose nbf is in the
        // past — and every security-critical absence (iss/aud/jti/role) is
        // preserved. Matches the reasoning in the Characterization suite.
        return handler.WriteToken(token);
    }

    public string CreateAccessToken(string subject)
        => Create(subject, TimeSpan.FromMinutes(_options.AccessTokenExpireMinutes), "access");

    public string CreateRefreshToken(string subject)
        => Create(subject, TimeSpan.FromDays(_options.RefreshTokenExpireDays), "refresh");

    /// <summary>Subject is the lower-cased email, matching Python's <c>email.lower()</c>.</summary>
    public string CreateEmailVerifyToken(string email)
        => Create(email.ToLowerInvariant(), TimeSpan.FromMinutes(_options.EmailVerifyTokenExpireMinutes), "email_verify");

    /// <summary>
    /// Mirror of Python's <c>decode_token</c>: validate and return the claims, or
    /// null on ANY failure (expired, bad signature, malformed). Never throws.
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
            ClockSkew = TimeSpan.Zero,          // .NET default is 5 min; python-jose is 0
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
            // JWTError in Python maps to any SecurityToken* exception here.
            return null;
        }
    }
}
