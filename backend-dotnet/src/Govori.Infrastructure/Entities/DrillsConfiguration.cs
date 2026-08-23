using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Govori.Infrastructure.Entities;

/// <summary>Column mapping for <see cref="MinimalPair"/> — the authored drill content.</summary>
public sealed class MinimalPairConfiguration : IEntityTypeConfiguration<MinimalPair>
{
    public void Configure(EntityTypeBuilder<MinimalPair> entity)
    {
        entity.HasKey(e => e.Id).HasName("minimal_pairs_pkey");

        entity.ToTable("minimal_pairs");

        // The slug is what the route and the submit request speak in, so the database has to be what
        // guarantees it is singular — two rows claiming "my-mi" would make which pair a student
        // opened depend on row order.
        entity.HasIndex(e => e.Slug).IsUnique().HasDatabaseName("uq_minimal_pairs_slug");

        entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
        entity.Property(e => e.Slug).HasMaxLength(64).HasColumnName("slug");
        entity.Property(e => e.ContrastRu).HasMaxLength(32).HasColumnName("contrast_ru");
        entity.Property(e => e.WhyUz).HasColumnName("why_uz");
        entity.Property(e => e.Level).HasMaxLength(8).HasColumnName("level");
        entity.Property(e => e.WordA).HasMaxLength(64).HasColumnName("word_a");
        entity.Property(e => e.WordB).HasMaxLength(64).HasColumnName("word_b");
        entity.Property(e => e.GlossAUz).HasMaxLength(160).HasColumnName("gloss_a_uz");
        entity.Property(e => e.GlossBUz).HasMaxLength(160).HasColumnName("gloss_b_uz");
        entity.Property(e => e.IpaA).HasColumnType("jsonb").HasColumnName("ipa_a");
        entity.Property(e => e.IpaB).HasColumnType("jsonb").HasColumnName("ipa_b");
        entity.Property(e => e.FocusIndexA).HasColumnName("focus_index_a");
        entity.Property(e => e.FocusIndexB).HasColumnName("focus_index_b");
        entity.Property(e => e.SortOrder).HasDefaultValue(0).HasColumnName("sort_order");
        entity.Property(e => e.IsActive).HasDefaultValue(true).HasColumnName("is_active");
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
        entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");
    }
}

/// <summary>Column mapping for <see cref="Drill"/> — one attempt.</summary>
public sealed class DrillConfiguration : IEntityTypeConfiguration<Drill>
{
    public void Configure(EntityTypeBuilder<Drill> entity)
    {
        entity.HasKey(e => e.Id).HasName("drills_pkey");

        entity.ToTable("drills");

        // The daily cost ceiling counts (student_id, created_at) and nothing else, so it is served
        // straight from this index — a budget that is itself a growing table scan stops being a
        // budget on the day it matters.
        entity.HasIndex(e => new { e.StudentId, e.CreatedAt })
            .HasDatabaseName("ix_drills_student_created");

        // "How is this student doing on ы/и" is the whole progress story of the feature, and it
        // reads exactly this pair of columns.
        entity.HasIndex(e => new { e.StudentId, e.PairId })
            .HasDatabaseName("ix_drills_student_pair");

        entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
        entity.Property(e => e.StudentId).HasColumnName("student_id");
        entity.Property(e => e.PairId).HasColumnName("pair_id");
        entity.Property(e => e.TargetWord).HasMaxLength(64).HasColumnName("target_word");
        entity.Property(e => e.HeardText).HasColumnName("heard_text");
        entity.Property(e => e.Outcome).HasMaxLength(16).HasColumnName("outcome");
        entity.Property(e => e.Accuracy).HasColumnName("accuracy");
        entity.Property(e => e.Phonemes).HasColumnType("jsonb").HasColumnName("phonemes");
        entity.Property(e => e.FocusScore).HasColumnName("focus_score");
        entity.Property(e => e.SttModel).HasMaxLength(64).HasColumnName("stt_model");
        entity.Property(e => e.AudioDurationSec).HasColumnName("audio_duration_sec");
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
        entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");

        // Restrict, not cascade: retiring a pair must not silently delete the practice history of
        // everyone who ever drilled it. `is_active` is how a pair leaves the listing.
        entity.HasOne(d => d.Pair).WithMany()
            .HasForeignKey(d => d.PairId)
            .OnDelete(DeleteBehavior.Restrict)
            .HasConstraintName("drills_pair_id_fkey");

        // Cascade: deleting a student takes their attempts with them, the rule every other
        // student-owned table here follows.
        entity.HasOne(d => d.Student).WithMany()
            .HasForeignKey(d => d.StudentId)
            .OnDelete(DeleteBehavior.Cascade)
            .HasConstraintName("drills_student_id_fkey");
    }
}
