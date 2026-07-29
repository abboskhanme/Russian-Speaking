using Govori.Identity.Security;

namespace Govori.UnitTests.Security;

/// <summary>
/// Drives the PRODUCTION PasswordHasher against the frozen golden bcrypt corpus.
/// The Characterization suite proves the raw bcrypt library agrees with that
/// corpus; these tests prove the PasswordHasher wrapper (Hash/Verify) does too.
/// </summary>
public class PasswordHasherTests
{
    private static readonly BcryptFixture Fx = Fixtures.Load<BcryptFixture>("bcrypt_corpus.json");
    private readonly PasswordHasher _hasher = new();

    public static IEnumerable<object[]> Cases()
        => Fixtures.Load<BcryptFixture>("bcrypt_corpus.json").Cases.Select(c => new object[] { c });

    [Fact]
    public void Fixture_loaded_and_non_empty()
    {
        Assert.Equal("bcrypt", Fx.Algorithm);
        Assert.NotEmpty(Fx.Cases);
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Verify_accepts_every_stored_production_hash(BcryptCase c)
    {
        // The whole cutover rests on this: every stored hash must verify here.
        Assert.True(_hasher.Verify(c.Password, c.Hash),
            $"PasswordHasher failed to verify a stored hash ({c.PasswordUtf8Bytes} bytes). " +
            "On cutover this user cannot log in.");
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Verify_of_wrong_password_matches_the_recorded_outcome(BcryptCase c)
    {
        // For a password already >= 72 bytes, appending a char changes only bytes
        // past the truncation point, so bcrypt still verifies — those cases carry
        // wrong_password_verifies=true. The assertion is "matches the recorded
        // outcome", not "always rejects".
        var wrongVerifies = _hasher.Verify(c.Password + "x", c.Hash);
        Assert.Equal(c.WrongPasswordVerifies, wrongVerifies);
    }

    [Fact]
    public void Verify_of_null_hash_is_false_and_does_not_throw()
    {
        // Google/OAuth accounts have a NULL password_hash. Verifying must return
        // false, never throw, never pass (docs/07 §7.4 — null-check before verify).
        Assert.False(_hasher.Verify("anything", null));
    }

    [Fact]
    public void Verify_of_empty_hash_is_false()
    {
        Assert.False(_hasher.Verify("anything", string.Empty));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Hash_pins_2b_cost_12_and_round_trips(BcryptCase c)
    {
        var hash = _hasher.Hash(c.Password);
        Assert.StartsWith("$2b$12$", hash);
        Assert.True(_hasher.Verify(c.Password, hash),
            "PasswordHasher failed to verify a hash it just produced.");
    }
}
