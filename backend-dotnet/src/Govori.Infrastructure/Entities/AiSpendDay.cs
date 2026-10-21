using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// The AI spend ledger (<c>ai_spend_daily</c>): one row per product day × backend × operation,
/// holding running totals of the ESTIMATED cost of every vendor call (see
/// <c>Govori.Platform.Ai.AiCostEstimator</c>). Read by the global AI budget before every vendor call
/// and by the admin settings screen.
///
/// <para><b>Aggregated, not one row per call.</b> The budget sums this table before every vendor
/// call; per-day rows keep that a scan of at most ~31 × backends × 2 rows for the month, whatever the
/// traffic. Increments are a single atomic <c>INSERT … ON CONFLICT DO UPDATE SET x = x + …</c>, so
/// concurrent writers never lose an update.</para>
///
/// <para><b>Day</b> is the PRODUCT day (Tashkent, <c>Govori.Contracts.ProductDay</c>) — the same
/// calendar the caps are judged on, so "today's spend" and "the daily cap resets at midnight" agree.</para>
/// </summary>
[EntityTypeConfiguration(typeof(AiSpendDayConfiguration))]
public class AiSpendDay
{
    public DateOnly Day { get; set; }

    /// <summary>Backend wire name (<c>azure</c>, <c>whisper</c>, <c>anthropic</c>, <c>gemini</c>, <c>openai</c>).</summary>
    public string Provider { get; set; } = null!;

    /// <summary><c>stt</c> or <c>grader</c> (<c>Govori.Platform.Ai.AiOperations</c>).</summary>
    public string Operation { get; set; } = null!;

    /// <summary>Vendor calls made (successful or not).</summary>
    public int Calls { get; set; }

    /// <summary>Of <see cref="Calls"/>, how many failed — still billed, still counted in the cost.</summary>
    public int FailedCalls { get; set; }

    public decimal AudioSeconds { get; set; }

    public long InputTokens { get; set; }

    public long OutputTokens { get; set; }

    /// <summary>Estimated cost in US dollars.</summary>
    public decimal CostUsd { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>Column mapping for <see cref="AiSpendDay"/>.</summary>
public sealed class AiSpendDayConfiguration : IEntityTypeConfiguration<AiSpendDay>
{
    public void Configure(EntityTypeBuilder<AiSpendDay> entity)
    {
        // The natural key IS the upsert target — no surrogate id to keep in step with it.
        entity.HasKey(e => new { e.Day, e.Provider, e.Operation }).HasName("ai_spend_daily_pkey");

        entity.ToTable("ai_spend_daily");

        entity.Property(e => e.Day).HasColumnName("day");
        entity.Property(e => e.Provider).HasMaxLength(32).HasColumnName("provider");
        entity.Property(e => e.Operation).HasMaxLength(16).HasColumnName("operation");
        entity.Property(e => e.Calls).HasDefaultValue(0).HasColumnName("calls");
        entity.Property(e => e.FailedCalls).HasDefaultValue(0).HasColumnName("failed_calls");
        entity.Property(e => e.AudioSeconds).HasPrecision(14, 2).HasDefaultValue(0m).HasColumnName("audio_seconds");
        entity.Property(e => e.InputTokens).HasDefaultValue(0L).HasColumnName("input_tokens");
        entity.Property(e => e.OutputTokens).HasDefaultValue(0L).HasColumnName("output_tokens");
        // Six decimals: one Azure second is ~$0.00028, and a ledger that rounds every call to the
        // cent would record most of them as nothing.
        entity.Property(e => e.CostUsd).HasPrecision(14, 6).HasDefaultValue(0m).HasColumnName("cost_usd");
        entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");
    }
}
