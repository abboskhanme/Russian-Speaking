using System.Globalization;
using System.Text;
using Xunit;

namespace Govori.Characterization;

/// <summary>
/// Two text rules the audit flags as correctness guards, not niceties:
///  - C6 the cosmetic-correction filter (services/llm.py:_drop_cosmetic_corrections)
///  - C10 Uzbek phone normalization (schemas/auth.py:normalize_uz_phone)
/// </summary>
public class TextRuleCharacterizationTests
{
    // Mirrors _norm_for_compare (services/llm.py:246-263): lower → ё=е →
    // strip punctuation → collapse whitespace. STT emits no punctuation, so a
    // correction that only differs cosmetically is a model hallucination and
    // must be dropped before it reaches the student.
    private static string NormForCompare(string s)
    {
        s = s.ToLowerInvariant().Replace('ё', 'е');
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            if (char.IsLetterOrDigit(ch) || char.IsWhiteSpace(ch))
                sb.Append(ch);
            else
                sb.Append(' ');   // punctuation → space, then collapse
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    [Fact]
    public void Cosmetic_filter_keeps_real_fixes_drops_punctuation()
    {
        var fx = Fixtures.Load<CosmeticFixture>("cosmetic_filter_cases.json");
        Assert.NotEmpty(fx.Cases);

        foreach (var c in fx.Cases)
        {
            Assert.Equal(c.NormOriginal, NormForCompare(c.Original));
            Assert.Equal(c.NormCorrected, NormForCompare(c.Corrected));

            var keep = NormForCompare(c.Original) != NormForCompare(c.Corrected);
            Assert.Equal(c.Keep, keep);
        }
    }

    // Mirrors normalize_uz_phone (schemas/auth.py:10-21): strip non-digits,
    // drop a leading 998, require exactly 9 remaining digits, prefix +998.
    private static string NormalizeUzPhone(string raw)
    {
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("998", StringComparison.Ordinal))
            digits = digits[3..];
        if (digits.Length != 9)
            throw new FormatException("phone must have 9 digits after the country code");
        return "+998" + digits;
    }

    [Fact]
    public void Phone_normalization_matches_Python()
    {
        var fx = Fixtures.Load<PhoneFixture>("phone_cases.json");
        Assert.NotEmpty(fx.Cases);

        foreach (var c in fx.Cases)
        {
            if (c.Raises)
            {
                Assert.ThrowsAny<Exception>(() => NormalizeUzPhone(c.Input));
            }
            else
            {
                Assert.Equal(c.Output, NormalizeUzPhone(c.Input));
            }
        }
    }
}
