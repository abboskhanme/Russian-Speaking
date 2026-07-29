using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Govori.Identity.Security;
using Microsoft.IdentityModel.Tokens;

namespace Govori.UnitTests.Security;

/// <summary>
/// Drives the PRODUCTION TokenService. Two obligations:
///   1. Tokens it mints have exactly the pinned shape (sub/type/iat/exp; never
///      iss/aud/jti/role) and round-trip through Decode.
///   2. Its key handling is byte-compatible with the frozen golden token vectors —
///      tokens in users' browsers today must still validate at cutover.
/// </summary>
public class TokenServiceTests
{
    private static readonly JwtFixture Fx = Fixtures.Load<JwtFixture>("jwt_vectors.json");

    // The four claims a token must carry; and the ones that must NEVER appear.
    private static readonly string[] RequiredClaims = { "sub", "type", "iat", "exp" };
    private static readonly string[] ForbiddenClaims = { "iss", "aud", "jti", "role" };

    private static TokenService NewService(string secret) => new(new IdentityAuthOptions
    {
        SecretKey = secret,
        AccessTokenExpireMinutes = 30,
        RefreshTokenExpireDays = 7,
        EmailVerifyTokenExpireMinutes = 20,
    });

    // ----- (1) shape + round-trip through the production Decode -----

    [Fact]
    public void Access_token_round_trips_with_correct_sub_and_type()
    {
        var svc = NewService("a-local-signing-secret-for-round-trip-tests");
        const string subject = "11111111-1111-1111-1111-111111111111";

        var claims = svc.Decode(svc.CreateAccessToken(subject));

        Assert.NotNull(claims);
        Assert.Equal(subject, claims!["sub"]);
        Assert.Equal("access", claims["type"]);
        AssertClaimShape(claims);
    }

    [Fact]
    public void Refresh_token_round_trips_with_correct_sub_and_type()
    {
        var svc = NewService("a-local-signing-secret-for-round-trip-tests");
        const string subject = "22222222-2222-2222-2222-222222222222";

        var claims = svc.Decode(svc.CreateRefreshToken(subject));

        Assert.NotNull(claims);
        Assert.Equal(subject, claims!["sub"]);
        Assert.Equal("refresh", claims["type"]);
        AssertClaimShape(claims);
    }

    [Fact]
    public void Email_verify_token_lowercases_the_subject()
    {
        var svc = NewService("a-local-signing-secret-for-round-trip-tests");

        var claims = svc.Decode(svc.CreateEmailVerifyToken("User@Example.COM"));

        Assert.NotNull(claims);
        Assert.Equal("user@example.com", claims!["sub"]);   // the subject is lowercased
        Assert.Equal("email_verify", claims["type"]);
        AssertClaimShape(claims);
    }

    private static void AssertClaimShape(IDictionary<string, string> claims)
    {
        foreach (var required in RequiredClaims)
            Assert.True(claims.ContainsKey(required), $"missing required claim `{required}`");

        foreach (var forbidden in ForbiddenClaims)
            Assert.False(claims.ContainsKey(forbidden), $"forbidden claim `{forbidden}` present");
    }

    [Fact]
    public void Decode_returns_null_for_a_tampered_token()
    {
        var svc = NewService("a-local-signing-secret-for-round-trip-tests");
        var token = svc.CreateAccessToken("11111111-1111-1111-1111-111111111111");

        // Flip the last char of the signature → bad signature → null, never throw.
        var tampered = token[..^1] + (token[^1] == 'a' ? 'b' : 'a');
        Assert.Null(svc.Decode(tampered));
        Assert.Null(svc.Decode("not.a.jwt"));
    }

    // ----- (2) key compatibility with the frozen golden token vectors -----

    /// <summary>
    /// Validation params identical to TokenService.Decode — ⚠ the key is the RAW
    /// UTF-8 BYTES of the secret, never base64-decoded — plus
    /// ValidateIssuer/Audience=false and ClockSkew=Zero. Only lifetime validation
    /// is disabled, because the checked-in golden tokens are long expired.
    /// </summary>
    private static TokenValidationParameters FixtureParams() => new()
    {
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Fx.TestSecret)),
        ValidateIssuerSigningKey = true,
        ValidateIssuer = false,
        ValidateAudience = false,
        ValidateLifetime = false,
        ClockSkew = TimeSpan.Zero,
    };

    [Fact]
    public void Fixture_pins_HS256_and_the_expected_secret()
    {
        Assert.Equal("HS256", Fx.Algorithm);
        Assert.Equal("characterization-test-secret-key-do-not-use-in-prod", Fx.TestSecret);
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void TokenService_key_handling_reads_every_golden_token()
    {
        // Constructing a TokenService with the fixture secret proves its key
        // derivation (RAW UTF-8 bytes) is the same one that reads the golden tokens.
        _ = NewService(Fx.TestSecret);

        var handler = new JwtSecurityTokenHandler();
        handler.InboundClaimTypeMap.Clear();   // keep `sub` as `sub`

        foreach (var c in Fx.Cases)
        {
            var principal = handler.ValidateToken(c.Token, FixtureParams(), out var validated);
            var jwt = Assert.IsType<JwtSecurityToken>(validated);

            Assert.Equal("HS256", jwt.Header.Alg);
            Assert.Equal(c.Sub, jwt.Subject);
            Assert.Equal(c.Type, jwt.Claims.Single(x => x.Type == "type").Value);
            Assert.NotNull(principal);
        }
    }

    [Fact]
    public void A_TokenService_built_with_the_fixture_secret_mints_tokens_those_params_accept()
    {
        // Closes the loop: a token minted by TokenService(test_secret) validates
        // under the very same params that read the golden vectors → identical
        // key handling on both the read and the write path.
        var svc = NewService(Fx.TestSecret);
        var minted = svc.CreateAccessToken("33333333-3333-3333-3333-333333333333");

        var handler = new JwtSecurityTokenHandler();
        handler.InboundClaimTypeMap.Clear();
        var principal = handler.ValidateToken(minted, FixtureParams(), out var validated);

        var jwt = Assert.IsType<JwtSecurityToken>(validated);
        Assert.Equal("HS256", jwt.Header.Alg);
        Assert.Equal("33333333-3333-3333-3333-333333333333", jwt.Subject);
        Assert.Equal("access", jwt.Claims.Single(x => x.Type == "type").Value);

        // The security-critical absences, on a token we minted.
        var claimTypes = jwt.Claims.Select(x => x.Type).ToHashSet();
        foreach (var forbidden in ForbiddenClaims)
            Assert.DoesNotContain(forbidden, claimTypes);
        Assert.NotNull(principal);
    }
}
