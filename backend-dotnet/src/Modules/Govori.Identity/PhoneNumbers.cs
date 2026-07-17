namespace Govori.Identity;

/// <summary>
/// Uzbek phone normalisation — a 1:1 port of <c>normalize_uz_phone</c>
/// (backend/app/schemas/auth.py:10-21), and consistent with the C# reference already
/// asserted in the characterization suite (TextRuleCharacterizationTests). Strips
/// non-digits, drops a leading 998, requires exactly 9 national digits, returns
/// <c>+998XXXXXXXXX</c>. Throws <see cref="FormatException"/> on an invalid number.
/// </summary>
public static class PhoneNumbers
{
    public static string NormalizeUz(string? raw)
    {
        var digits = new string((raw ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.StartsWith("998", StringComparison.Ordinal))
            digits = digits[3..];
        if (digits.Length != 9)
            throw new FormatException("Telefon raqami noto'g'ri (masalan: +998 90 123 45 67)");
        return "+998" + digits;
    }
}
