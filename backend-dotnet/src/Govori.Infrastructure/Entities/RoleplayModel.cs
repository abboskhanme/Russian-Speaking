using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// The EF mapping for the two roleplay tables (docs/08 Faza 6.5).
///
/// <para>It hangs off <c>OnModelCreatingPartial</c> — the extension point
/// <see cref="GovoriDbContext"/> already declares — rather than being appended to the 800-line
/// scaffolded body. The scaffolded half of that file is the shape of the schema as it stood at
/// cutover and is regenerated wholesale when the database-first mapping is refreshed; a hand-written
/// block in the middle of it would be lost the first time that happened. Everything Faza 6.5 adds is
/// therefore in one file, next to the entities it maps.</para>
/// </summary>
public partial class GovoriDbContext
{
    /// <summary>The authored roleplay situations (see <see cref="Scenario"/>).</summary>
    public virtual DbSet<Scenario> Scenarios { get; set; } = null!;

    /// <summary>Every persisted exchange of every conversation (see <see cref="RoleplayTurn"/>).</summary>
    public virtual DbSet<RoleplayTurn> RoleplayTurns { get; set; } = null!;

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Scenario>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("scenarios_pkey");

            entity.ToTable("scenarios");

            // The slug is what the /chat/:id route and the start request speak in, so it has to be
            // the thing the database guarantees is singular — two rows claiming "pharmacy" would
            // make which scenario a student opened depend on row order.
            entity.HasIndex(e => e.Slug).IsUnique().HasDatabaseName("uq_scenarios_slug");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
            entity.Property(e => e.Slug).HasMaxLength(64).HasColumnName("slug");
            entity.Property(e => e.TitleRu).HasMaxLength(160).HasColumnName("title_ru");
            entity.Property(e => e.GoalUz).HasMaxLength(240).HasColumnName("goal_uz");
            entity.Property(e => e.Level).HasMaxLength(8).HasColumnName("level");
            entity.Property(e => e.Minutes).HasColumnName("minutes");
            entity.Property(e => e.Tone).HasMaxLength(16).HasColumnName("tone");
            entity.Property(e => e.Icon).HasMaxLength(16).HasColumnName("icon");
            entity.Property(e => e.PersonaRu).HasColumnName("persona_ru");
            entity.Property(e => e.OpeningRu).HasColumnName("opening_ru");
            entity.Property(e => e.Beats).HasColumnType("jsonb").HasColumnName("beats");
            entity.Property(e => e.Phrases).HasColumnType("jsonb").HasColumnName("phrases");
            entity.Property(e => e.SortOrder).HasDefaultValue(0).HasColumnName("sort_order");
            entity.Property(e => e.IsActive).HasDefaultValue(true).HasColumnName("is_active");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");
        });

        modelBuilder.Entity<RoleplayTurn>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("roleplay_turns_pkey");

            entity.ToTable("roleplay_turns");

            // One row per position per conversation. This is the idempotency guard for a
            // double-tapped send: the second insert loses to a unique violation instead of quietly
            // creating a second turn 3 and billing a second time for it.
            entity.HasIndex(e => new { e.ConversationId, e.TurnIndex })
                .IsUnique()
                .HasDatabaseName("uq_roleplay_turn_position");

            // The daily-budget count reads (student_id, created_at) and nothing else, so it is served
            // straight from this index — the cost ceiling must not itself become a table scan that
            // grows with every conversation ever held.
            entity.HasIndex(e => new { e.StudentId, e.CreatedAt })
                .HasDatabaseName("ix_roleplay_turns_student_created");

            entity.HasIndex(e => e.ScenarioId).HasDatabaseName("ix_roleplay_turns_scenario_id");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
            entity.Property(e => e.ConversationId).HasColumnName("conversation_id");
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.ScenarioId).HasColumnName("scenario_id");
            entity.Property(e => e.TurnIndex).HasColumnName("turn_index");
            entity.Property(e => e.BeatIndex).HasColumnName("beat_index");
            entity.Property(e => e.StudentText).HasColumnName("student_text");
            entity.Property(e => e.PartnerText).HasColumnName("partner_text");
            entity.Property(e => e.Relevance).HasColumnName("relevance");
            entity.Property(e => e.Overall).HasColumnName("overall");
            entity.Property(e => e.Corrections).HasColumnType("jsonb").HasColumnName("corrections");
            entity.Property(e => e.SttModel).HasMaxLength(64).HasColumnName("stt_model");
            entity.Property(e => e.LlmModel).HasMaxLength(64).HasColumnName("llm_model");
            entity.Property(e => e.AudioDurationSec).HasColumnName("audio_duration_sec");
            entity.Property(e => e.IsFinal).HasDefaultValue(false).HasColumnName("is_final");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");

            entity.HasOne(d => d.Scenario).WithMany()
                .HasForeignKey(d => d.ScenarioId)
                .HasConstraintName("roleplay_turns_scenario_id_fkey");

            // Cascade: deleting a student takes their conversations with them, the same rule every
            // other student-owned table here follows.
            entity.HasOne(d => d.Student).WithMany()
                .HasForeignKey(d => d.StudentId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("roleplay_turns_student_id_fkey");
        });
    }
}
