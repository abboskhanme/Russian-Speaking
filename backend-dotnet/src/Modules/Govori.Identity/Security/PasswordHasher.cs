namespace Govori.Identity.Security;

/// <summary>
/// Password hashing/verification ported 1:1 from the Python stack
/// (backend/app/core/security.py:12-19). Production hashes were written by
/// Python's bcrypt as <c>$2b$12$...</c>; this class must read them unchanged or
/// every live user is locked out on cutover.
/// </summary>
public sealed class PasswordHasher
{
    // Cost factor 12, matching Python's bcrypt.gensalt() default.
    private const int WorkFactor = 12;

    /// <summary>
    /// New hashes. BCrypt.Net-Next's default <c>HashPassword</c> emits
    /// <c>$2a$</c>; Python emits <c>$2b$</c>. We pin <c>$2b$12$</c> via
    /// <c>GenerateSalt(12, 'b')</c> so the stored corpus stays uniform and a
    /// rollback to Python keeps verifying.
    ///
    /// The password is passed UNCHANGED — BCrypt.Net's core already keys off the
    /// first 72 UTF-8 bytes, identically to Python's <c>password.encode()[:72]</c>.
    /// Manually pre-truncating and re-encoding would corrupt bytes at a
    /// multi-byte character boundary (proven by the characterization suite).
    /// </summary>
    public string Hash(string password)
        => BCrypt.Net.BCrypt.HashPassword(password, BCrypt.Net.BCrypt.GenerateSalt(WorkFactor, 'b'));

    /// <summary>
    /// Verify a plaintext password against a stored hash.
    ///
    /// <paramref name="hash"/> is nullable on purpose: Google/OAuth accounts have
    /// a NULL <c>password_hash</c> (docs/07 §7.4). Verifying null must not throw
    /// and must not pass — otherwise a password login against an OAuth-only
    /// account could succeed. Null-check happens BEFORE the bcrypt call.
    /// </summary>
    public bool Verify(string password, string? hash)
    {
        if (string.IsNullOrEmpty(hash))
            return false;

        return BCrypt.Net.BCrypt.Verify(password, hash);
    }
}
