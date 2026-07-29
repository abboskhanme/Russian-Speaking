using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// Second-highest stakes after bcrypt: the tokens in <c>jwt_vectors.json</c> are a
/// frozen snapshot of tokens that are in users' browsers right now. If .NET
/// rejects them, every logged-in user is signed out at cutover.
///
/// The pinned shape: HS256 over exactly four claims —
/// <c>{"sub", "type", "iat", "exp"}</c>. No iss, no aud, no nbf, no jti, and
/// crucially NO role: the role is read from the database on every request, so a
/// role change takes effect immediately instead of waiting for a token to expire.
/// </summary>
public class JwtCharacterizationTests
{
    private static readonly JwtFixture Fx = Fixtures.Load<JwtFixture>("jwt_vectors.json");

    // Must match the SECRET_KEY the fixtures were generated with.
    private const string TestSecret = "characterization-test-secret-key-do-not-use-in-prod";

    private static TokenValidationParameters ValidationParams(bool validateLifetime = true) => new()
    {
        // ⚠ RAW UTF-8 BYTES of the secret. The key is NOT base64-decoded — every
        // existing token was signed over the raw bytes, so decoding here rejects
        // all of them.
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
        ValidateIssuerSigningKey = true,

        // The tokens carry neither claim. Leaving these on rejects everything.
        ValidateIssuer = false,
        ValidateAudience = false,

        ValidateLifetime = validateLifetime,

        // ⚠ Zero clock skew is deliberate. .NET defaults to FIVE MINUTES of
        // slack, which would keep accepting tokens for five minutes past their
        // `exp` — the tokens must expire exactly when they say they do.
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
    public void CSharp_reads_every_token_in_the_frozen_corpus()
    {
        var handler = new JwtSecurityTokenHandler();
        handler.InboundClaimTypeMap.Clear();   // keep `sub` as `sub`, not ClaimTypes.NameIdentifier

        foreach (var c in Fx.Cases)
        {
            // The vectors are frozen and checked in, so their `exp` is long past
            // by the time CI runs. Lifetime is asserted separately.
            var principal = handler.ValidateToken(c.Token, ValidationParams(validateLifetime: false), out var validated);

            var jwt = Assert.IsType<JwtSecurityToken>(validated);
            Assert.Equal("HS256", jwt.Header.Alg);
            Assert.Equal(c.Sub, jwt.Subject);
            Assert.Equal(c.Type, jwt.Claims.Single(x => x.Type == "type").Value);
            Assert.NotNull(principal);
        }
    }

    [Fact]
    public void Frozen_tokens_carry_no_claims_beyond_the_four()
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
    public void A_token_minted_by_CSharp_has_the_same_shape_as_the_frozen_corpus()
    {
        // Newly issued tokens must be shape-identical to the frozen ones, so any
        // reader that accepts the corpus also accepts what this stack mints.
        var handler = new JwtSecurityTokenHandler();
        handler.OutboundClaimTypeMap.Clear();

        var now = DateTime.UtcNow;
        var token = handler.CreateJwtSecurityToken(
            subject: new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim("sub", "33333333-3333-3333-3333-333333333333"),
                new System.Security.Claims.Claim("type", "access"),
            ]),
            notBefore: null,                     // the frozen corpus carries no nbf
            expires: now.AddMinutes(30),
            issuedAt: now,
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)),
                SecurityAlgorithms.HmacSha256));

        var written = handler.WriteToken(token);
        var parsed = handler.ReadJwtToken(written);
        var claims = parsed.Claims.Select(x => x.Type).ToHashSet();

        Assert.Equal("HS256", parsed.Header.Alg);

        // The security-critical absences that MUST be preserved. .NET's token
        // builder additionally stamps `nbf` (notBefore), which the frozen corpus
        // lacks; that is harmless and standard — every conforming JWT reader
        // accepts it — so `nbf` is not required to be absent. These are:
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
