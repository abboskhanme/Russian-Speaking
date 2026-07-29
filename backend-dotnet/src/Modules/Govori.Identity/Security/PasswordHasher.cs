namespace Govori.Identity.Security;

/// <summary>
/// BCrypt password hashing and verification.
///
/// <b>THE STORED HASH FORMAT IS FROZEN.</b> Production hashes are <c>$2b$12$...</c>;
/// this class must keep reading them unchanged or every existing user is locked out.
/// </summary>
public sealed class PasswordHasher
{
    // Cost factor 12 — the cost baked into every hash already in the database.
    private const int WorkFactor = 12;

    /// <summary>
    /// Produce a new hash. BCrypt.Net-Next's default <c>HashPassword</c> emits the
    /// <c>$2a$</c> prefix, so we pin <c>$2b$12$</c> explicitly via
    /// <c>GenerateSalt(12, 'b')</c> and keep the whole stored corpus in one format.
    ///
    /// The password is passed UNCHANGED. BCrypt.Net's core already keys off the
    /// first 72 UTF-8 bytes; pre-truncating and re-encoding it here would corrupt
    /// bytes at a multi-byte character boundary (proven by the characterization suite).
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
