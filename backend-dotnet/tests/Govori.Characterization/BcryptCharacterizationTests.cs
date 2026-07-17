using Xunit;

namespace Govori.Characterization;

/// <summary>
/// The single highest-stakes test in the port: production password hashes were
/// written by Python's bcrypt. If C# cannot verify them, all ~50 live users are
/// locked out on cutover with no recovery short of a mass password reset.
///
/// Python (backend/app/core/security.py:12-19):
///     pw = password.encode("utf-8")[:72]
///     bcrypt.hashpw(pw, bcrypt.gensalt())      # → $2b$12$...
///     bcrypt.checkpw(plain.encode("utf-8")[:72], hashed)
/// </summary>
public class BcryptCharacterizationTests
{
    private static readonly BcryptFixture Fx = Fixtures.Load<BcryptFixture>("bcrypt_corpus.json");

    /// <summary>
    /// Python: bcrypt.checkpw(plain.encode("utf-8")[:72], hash).
    /// BCrypt.Net.Verify(string, hash) internally does UTF8.GetBytes(string) and
    /// the bcrypt core uses at most the first 72 bytes — the SAME first-72-bytes
    /// Python hands it, even when byte 72 splits a multi-byte character (both
    /// sides start from the identical UTF-8 byte array and cut at the same
    /// index). So the correct thing is to pass the password UNCHANGED; any
    /// manual pre-truncation + re-encode corrupts the bytes.
    /// </summary>
    private static bool VerifyLikePython(string password, string hash)
        => BCrypt.Net.BCrypt.Verify(password, hash);

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
    public void Every_python_hash_is_bcrypt_2b_cost_12()
    {
        // Guards against a library that emits $2a$ or $2y$: those still verify
        // old hashes, but drift the stored corpus away from what Python wrote.
        foreach (var c in Fx.Cases)
            Assert.StartsWith("$2b$12$", c.Hash);
    }

    [Fact]
    public void CSharp_verifies_every_hash_Python_produced()
    {
        // The whole port rests on this assertion.
        foreach (var c in Fx.Cases)
        {
            var ok = BCrypt.Net.BCrypt.Verify(c.Password, c.Hash);
            Assert.True(ok,
                $"C# failed to verify a Python-generated hash. " +
                $"password={c.Password.Length} chars / {c.PasswordUtf8Bytes} bytes. " +
                $"On cutover this user cannot log in.");
        }
    }

    [Fact]
    public void CSharp_rejects_wrong_passwords_exactly_as_Python_does()
    {
        // C# must agree with Python on EVERY case — including the subtle one:
        // for a password already ≥72 bytes, appending a character changes only
        // bytes past the truncation point, so bcrypt still verifies it. Python
        // records that as wrong_password_verifies=true. The correct assertion is
        // therefore "C# matches Python's answer", not "always rejects".
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
        // Python silently truncates; a port that throws on long input would
        // break sign-in for anyone who set a long password.
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
        // Rollback safety: if we revert to Python, passwords changed on the .NET
        // stack must still work there. Same prefix, same cost, same truncation.
        //
        // PORT RULE (docs/07 §7.5): BCrypt.Net-Next's default HashPassword emits
        // $2a$; Python emits $2b$. The two cross-verify, but the port pins $2b$
        // via GenerateSalt(workFactor, 'b') to keep the stored corpus uniform.
        foreach (var c in Fx.Cases.Take(4))
        {
            var mine = BCrypt.Net.BCrypt.HashPassword(c.Password, BCrypt.Net.BCrypt.GenerateSalt(12, 'b'));
            Assert.StartsWith("$2b$12$", mine);
            Assert.True(BCrypt.Net.BCrypt.Verify(c.Password, mine));
        }
    }
}
