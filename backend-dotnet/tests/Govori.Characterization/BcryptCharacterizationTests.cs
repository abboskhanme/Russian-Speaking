using Xunit;

namespace Govori.Characterization;

/// <summary>
/// The single highest-stakes test in the suite: the hashes in
/// <c>bcrypt_corpus.json</c> are a frozen snapshot of REAL production password
/// hashes. If C# cannot verify them, all ~50 live users are locked out on cutover
/// with no recovery short of a mass password reset.
///
/// The scheme the corpus was written under, which this code must implement:
/// bcrypt, <c>$2b$</c> prefix, cost 12, and the password truncated to its first
/// 72 UTF-8 bytes.
///
/// <para><b>Always pass the password to <c>BCrypt.Verify</c> UNCHANGED.</b>
/// <c>Verify(string, hash)</c> already does <c>UTF8.GetBytes</c> internally and the
/// bcrypt core reads at most the first 72 bytes — exactly the truncation the stored
/// corpus was hashed under, even when byte 72 splits a multi-byte character (both
/// sides start from the identical UTF-8 array and cut at the same index). Manually
/// pre-truncating and re-encoding corrupts those bytes and silently fails to verify
/// real production hashes.</para>
/// </summary>
public class BcryptCharacterizationTests
{
    private static readonly BcryptFixture Fx = Fixtures.Load<BcryptFixture>("bcrypt_corpus.json");

    [Fact]
    public void Fixture_describes_the_scheme_the_port_must_implement()
    {
        Assert.Equal("bcrypt", Fx.Algorithm);
        Assert.Equal("$2b$", Fx.Prefix);
        Assert.Equal(12, Fx.Cost);
        Assert.Equal(72, Fx.TruncateBytes);
        Assert.NotEmpty(Fx.Cases);
    }

    [Fact]
    public void Every_stored_hash_is_bcrypt_2b_cost_12()
    {
        // Guards against a library that emits $2a$ or $2y$: those still verify
        // old hashes, but drift newly written hashes away from the stored corpus.
        foreach (var c in Fx.Cases)
            Assert.StartsWith("$2b$12$", c.Hash);
    }

    [Fact]
    public void CSharp_verifies_every_stored_production_hash()
    {
        // The whole cutover rests on this assertion.
        foreach (var c in Fx.Cases)
        {
            var ok = BCrypt.Net.BCrypt.Verify(c.Password, c.Hash);
            Assert.True(ok,
                $"C# failed to verify a stored production hash. " +
                $"password={c.Password.Length} chars / {c.PasswordUtf8Bytes} bytes. " +
                $"On cutover this user cannot log in.");
        }
    }

    [Fact]
    public void CSharp_rejects_wrong_passwords_exactly_as_the_corpus_records()
    {
        // C# must agree with the recorded outcome on EVERY case — including the
        // subtle one: for a password already ≥72 bytes, appending a character
        // changes only bytes past the truncation point, so bcrypt still verifies
        // it. Those cases carry wrong_password_verifies=true. The correct
        // assertion is therefore "C# matches the recorded answer", not "always
        // rejects".
        foreach (var c in Fx.Cases)
        {
            var csharpVerifiesWrong = BCrypt.Net.BCrypt.Verify(c.Password + "x", c.Hash);
            Assert.Equal(c.WrongPasswordVerifies, csharpVerifiesWrong);
        }
    }

    [Fact]
    public void A_changed_character_within_72_bytes_is_always_rejected()
    {
        // The security property that actually matters: for a normal-length
        // password, a wrong password must never verify.
        foreach (var c in Fx.Cases.Where(x => x.PasswordUtf8Bytes is > 0 and < 72))
            Assert.False(BCrypt.Net.BCrypt.Verify(c.Password + "x", c.Hash),
                $"C# accepted a wrong password for a {c.PasswordUtf8Bytes}-byte password.");
    }

    [Fact]
    public void Passwords_over_72_bytes_are_truncated_not_rejected()
    {
        // Over-length passwords must be silently truncated, never rejected: an
        // implementation that throws on long input breaks sign-in for every user
        // who set a password longer than 72 bytes.
        var longCases = Fx.Cases.Where(c => c.PasswordUtf8Bytes > 72).ToArray();
        Assert.NotEmpty(longCases);

        foreach (var c in longCases)
            Assert.True(BCrypt.Net.BCrypt.Verify(c.Password, c.Hash),
                $"Truncation mismatch at {c.PasswordUtf8Bytes} bytes — this is the " +
                $"multi-byte boundary trap described in docs/07 §7.5.");
    }

    [Fact]
    public void Hashes_written_by_CSharp_are_verifiable_by_the_same_scheme()
    {
        // Newly written hashes must be indistinguishable from the stored corpus:
        // same prefix, same cost, same truncation. That keeps any bcrypt-
        // compatible reader (including a rollback to an older deployment) able to
        // verify passwords changed on this stack.
        //
        // RULE (docs/07 §7.5): BCrypt.Net-Next's default HashPassword emits $2a$,
        // but the stored corpus is $2b$. The two cross-verify, but production
        // pins $2b$ via GenerateSalt(workFactor, 'b') to keep the corpus uniform.
        foreach (var c in Fx.Cases.Take(4))
        {
            var mine = BCrypt.Net.BCrypt.HashPassword(c.Password, BCrypt.Net.BCrypt.GenerateSalt(12, 'b'));
            Assert.StartsWith("$2b$12$", mine);
            Assert.True(BCrypt.Net.BCrypt.Verify(c.Password, mine));
        }
    }
}
