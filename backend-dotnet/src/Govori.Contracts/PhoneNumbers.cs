namespace Govori.Contracts;

// ─── Uzbek phone normalisation (shared kernel) ───────────────────────────────
// This helper was born inside Govori.Identity (AuthService's otp/request + otp/verify entry
// points), but a SECOND surface now needs the identical canonical form: the Telegram bot poller in
// Govori.Worker must compare the phone a user SHARED over Telegram (message.contact.phone_number)
// against the phone the OTP was REQUESTED for. A Worker→Identity reference is an illegal
// host→domain edge, so the rule is promoted HERE — Govori.Contracts is the one assembly every
// module and both hosts already reference, and it has no dependencies of its own (the "Contracts
// depends on nothing" ArchTest still holds for a pure static class).
//
// Precedent: CefrScale was promoted to Contracts for exactly this reason, and RateLimitPolicyNames
// is likewise a non-DTO constant holder here. Govori.Identity.AuthService now calls THIS type, so
// the rule exists exactly once and the two sides of a Telegram phone comparison cannot drift.

/// <summary>
/// Uzbek phone normalisation, matching the behaviour asserted in the characterization suite
/// (TextRuleCharacterizationTests, C10). Strips non-digits, drops a leading 998, requires exactly
/// 9 national digits, returns <c>+998XXXXXXXXX</c>. Every phone reaches the DB in this one
/// canonical form, so lookups by number are exact-match. Throws
/// <see cref="FormatException"/> on an invalid number.
/// </summary>
public static class PhoneNumbers
{
    /// <summary>
    /// Canonicalise to <c>+998XXXXXXXXX</c>, or throw <see cref="FormatException"/>. The message is
    /// user-facing (it is surfaced verbatim as the 400 body of <c>POST /api/auth/otp/request</c>).
    /// </summary>
    public static string NormalizeUz(string? raw)
    {
        var digits = new string((raw ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.StartsWith("998", StringComparison.Ordinal))
            digits = digits[3..];
        if (digits.Length != 9)
            throw new FormatException("Telefon raqami noto'g'ri (masalan: +998 90 123 45 67)");
        return "+998" + digits;
    }

    /// <summary>
    /// Non-throwing <see cref="NormalizeUz"/>. Use this wherever a phone number arrives from a
    /// source that is NOT guaranteed to be Uzbek — most importantly a Telegram contact share, where
    /// a perfectly ordinary foreign number (or a user pressing the button with a non-UZ SIM) must be
    /// a plain "does not match", never a 500. Returns <c>false</c> and <c>null</c> instead of
    /// throwing.
    /// </summary>
    public static bool TryNormalizeUz(string? raw, out string? normalized)
    {
        try
        {
            normalized = NormalizeUz(raw);
            return true;
        }
        catch (FormatException)
        {
            normalized = null;
            return false;
        }
    }

    /// <summary>
    /// Whether two raw phone numbers denote the SAME Uzbek number, compared in canonical form.
    /// <b>Fail-closed by construction:</b> if either side is not a valid UZ number this is
    /// <c>false</c> — a number we cannot canonicalise can never be proven equal to one we can.
    /// This is the comparison the Telegram contact-share check must use (spec: "normalise BOTH
    /// sides and compare the canonical +998XXXXXXXXX … a foreign Telegram number must therefore be
    /// treated as a plain NON-MATCH, never a crash").
    /// </summary>
    public static bool AreSameUz(string? a, string? b)
        => TryNormalizeUz(a, out var left)
           && TryNormalizeUz(b, out var right)
           && string.Equals(left, right, StringComparison.Ordinal);
}
