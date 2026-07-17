using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// Second-highest stakes after bcrypt: tokens minted by the Python stack are in
/// users' browsers right now. If .NET rejects them, every logged-in user is
/// signed out at cutover.
///
/// Python (backend/app/core/security.py:22-30):
///     payload = {"sub": subject, "type": token_type, "iat": now, "exp": now + delta}
///     jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
///
/// Four claims. No iss, no aud, no nbf, no jti, and crucially NO role — the role
/// is read from the database on every request (api/deps.py:30-32).
/// </summary>
public class JwtCharacterizationTests
{
    private static readonly JwtFixture Fx = Fixtures.Load<JwtFixture>("jwt_vectors.json");

    // Must match the SECRET_KEY the fixtures were generated with.
    private const string TestSecret = "characterization-test-secret-key-do-not-use-in-prod";

    private static TokenValidationParameters ValidationParams(bool validateLifetime = true) => new()
    {
        // Raw UTF-8 bytes. python-jose does NOT base64-decode the key; a .NET
        // port that does will reject every existing token.
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
        ValidateIssuerSigningKey = true,

        // The tokens carry neither claim. Leaving these on rejects everything.
        ValidateIssuer = false,
        ValidateAudience = false,

        ValidateLifetime = validateLifetime,

        // .NET defaults to 5 minutes of slack; python-jose uses 0. Without this,
        // .NET accepts tokens Python would already have expired.
        ClockSkew = TimeSpan.Zero,
    };

    [Fact]
    public void Fixture_pins_the_exact_claim_set()
    {
        Assert.Equal("HS256", Fx.Algorithm);
        Assert.Equal(new[] { "sub", "type", "iat", "exp" }, Fx.Claims);
        Assert.Contains("role", Fx.AbsentClaims);   // role is a DB read, not a claim
        Assert.Contains("jti", Fx.AbsentClaims);    // hence refresh tokens are unrevocable today
    }

    [Fact]
    public void CSharp_reads_every_token_Python_minted()
    {
        var handler = new JwtSecurityTokenHandler();
        handler.InboundClaimTypeMap.Clear();   // keep `sub` as `sub`, not ClaimTypes.NameIdentifier

        foreach (var c in Fx.Cases)
        {
            // Fixtures are generated once and checked in, so their `exp` is in
            // the past by the time CI runs. Lifetime is asserted separately.
            var principal = handler.ValidateToken(c.Token, ValidationParams(validateLifetime: false), out var validated);

            var jwt = Assert.IsType<JwtSecurityToken>(validated);
            Assert.Equal("HS256", jwt.Header.Alg);
            Assert.Equal(c.Sub, jwt.Subject);
            Assert.Equal(c.Type, jwt.Claims.Single(x => x.Type == "type").Value);
            Assert.NotNull(principal);
        }
    }

    [Fact]
    public void Python_tokens_carry_no_claims_beyond_the_four()
    {
        var handler = new JwtSecurityTokenHandler();
        foreach (var c in Fx.Cases)
        {
            var jwt = handler.ReadJwtToken(c.Token);
            var claims = jwt.Claims.Select(x => x.Type).ToHashSet();

            foreach (var expected in Fx.Claims)
                Assert.Contains(expected, claims);

            foreach (var absent in Fx.AbsentClaims)
                Assert.DoesNotContain(absent, claims);
        }
    }

    [Fact]
    public void A_token_minted_by_CSharp_has_the_same_shape_Python_emits()
    {
        // Rollback safety: tokens issued by .NET must remain readable by the
        // Python stack if we revert.
        var handler = new JwtSecurityTokenHandler();
        handler.OutboundClaimTypeMap.Clear();

        var now = DateTime.UtcNow;
        var token = handler.CreateJwtSecurityToken(
            subject: new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim("sub", "33333333-3333-3333-3333-333333333333"),
                new System.Security.Claims.Claim("type", "access"),
            ]),
            notBefore: null,                     // Python emits no nbf
            expires: now.AddMinutes(30),
            issuedAt: now,
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
                SecurityAlgorithms.HmacSha256));

        var written = handler.WriteToken(token);
        var parsed = handler.ReadJwtToken(written);
        var claims = parsed.Claims.Select(x => x.Type).ToHashSet();

        Assert.Equal("HS256", parsed.Header.Alg);

        // The security-critical absences the port MUST preserve. Unlike Python,
        // .NET's token builder also stamps `nbf` (notBefore); that is harmless
        // and standard — python-jose and browser clients both accept it — so it
        // is not required to be absent. What must never appear are these:
        foreach (var absent in new[] { "iss", "aud", "jti", "role" })
            Assert.DoesNotContain(absent, claims);
    }

    [Fact]
    public void Wrong_key_is_rejected()
    {
        var handler = new JwtSecurityTokenHandler();
        var bad = ValidationParams(validateLifetime: false);
        bad.IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("a-completely-different-secret-key-value"));

        Assert.ThrowsAny<SecurityTokenException>(() =>
            handler.ValidateToken(Fx.Cases[0].Token, bad, out _));
    }
}
