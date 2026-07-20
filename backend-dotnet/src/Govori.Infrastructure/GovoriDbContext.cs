using System;
using System.Collections.Generic;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

public partial class GovoriDbContext : DbContext
{
    public GovoriDbContext(DbContextOptions<GovoriDbContext> options)
        : base(options)
    {
    }

    // NOTE: the `alembic_version` table is intentionally NOT mapped. Per docs/07
    // §7.4 rule 3 it stays owned by Python/Alembic; EF Core must NEVER manage it
    // (EF migrations baseline from Alembic head c1d2e3f4a5b6). Leaving it out of the
    // model guarantees EF cannot create, alter, or drop it.

    public virtual DbSet<AppSetting> AppSettings { get; set; }

    public virtual DbSet<Assignment> Assignments { get; set; }

    public virtual DbSet<Evaluation> Evaluations { get; set; }

    public virtual DbSet<Group> Groups { get; set; }

    public virtual DbSet<GroupMember> GroupMembers { get; set; }

    public virtual DbSet<Notification> Notifications { get; set; }

    public virtual DbSet<Question> Questions { get; set; }

    public virtual DbSet<QuestionBlock> QuestionBlocks { get; set; }

    public virtual DbSet<ReviewItem> ReviewItems { get; set; }

    public virtual DbSet<ShadowingPhrase> ShadowingPhrases { get; set; }

    public virtual DbSet<Submission> Submissions { get; set; }

    public virtual DbSet<Topic> Topics { get; set; }

    public virtual DbSet<TopicImage> TopicImages { get; set; }

    public virtual DbSet<Transcript> Transcripts { get; set; }

    public virtual DbSet<User> Users { get; set; }

    public virtual DbSet<XpEvent> XpEvents { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Native PG enums (docs/07 §7.4 trap #1). Typed registration with the
        // explicit `public` schema; the CLR enum labels come from [PgName] on each
        // member. Must be paired with NpgsqlDataSourceBuilder.MapEnum<T>(...) at the
        // ADO layer — see GovoriDataSourceFactory.
        modelBuilder
            .HasPostgresEnum<QuestionType>("public", "question_type")
            .HasPostgresEnum<SubmissionStatus>("public", "submission_status")
            .HasPostgresEnum<UserRole>("public", "user_role");

        modelBuilder.Entity<AppSetting>(entity =>
        {
            entity.HasKey(e => e.Key).HasName("app_settings_pkey");

            entity.ToTable("app_settings");

            entity.Property(e => e.Key)
                .HasMaxLength(64)
                .HasColumnName("key");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.IsSecret)
                .HasDefaultValue(false)
                .HasColumnName("is_secret");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.Value).HasColumnName("value");
        });

        modelBuilder.Entity<Assignment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("assignments_pkey");

            entity.ToTable("assignments");

            entity.HasIndex(e => e.GroupId, "ix_assignments_group_id");

            entity.HasIndex(e => e.QuestionId, "ix_assignments_question_id");

            entity.HasIndex(e => e.StudentId, "ix_assignments_student_id");

            entity.HasIndex(e => e.TeacherId, "ix_assignments_teacher_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.DueAt).HasColumnName("due_at");
            entity.Property(e => e.GroupId).HasColumnName("group_id");
            entity.Property(e => e.QuestionId).HasColumnName("question_id");
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.TeacherId).HasColumnName("teacher_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Group).WithMany(p => p.Assignments)
                .HasForeignKey(d => d.GroupId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("assignments_group_id_fkey");

            entity.HasOne(d => d.Question).WithMany(p => p.Assignments)
                .HasForeignKey(d => d.QuestionId)
                .HasConstraintName("assignments_question_id_fkey");

            entity.HasOne(d => d.Student).WithMany(p => p.AssignmentStudents)
                .HasForeignKey(d => d.StudentId)
                .HasConstraintName("assignments_student_id_fkey");

            entity.HasOne(d => d.Teacher).WithMany(p => p.AssignmentTeachers)
                .HasForeignKey(d => d.TeacherId)
                .HasConstraintName("assignments_teacher_id_fkey");
        });

        modelBuilder.Entity<Evaluation>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("evaluations_pkey");

            entity.ToTable("evaluations");

            entity.HasIndex(e => e.SubmissionId, "evaluations_submission_id_key").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Corrections)
                .HasColumnType("jsonb")
                .HasColumnName("corrections");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.Explanation)
                .HasColumnType("jsonb")
                .HasColumnName("explanation");
            entity.Property(e => e.Feedback)
                .HasColumnType("jsonb")
                .HasColumnName("feedback");
            entity.Property(e => e.FluencyScore).HasColumnName("fluency_score");
            entity.Property(e => e.GrammarScore).HasColumnName("grammar_score");
            entity.Property(e => e.IntonationScore).HasColumnName("intonation_score");
            entity.Property(e => e.LevelScore).HasColumnName("level_score");
            entity.Property(e => e.LexicalScore).HasColumnName("lexical_score");
            entity.Property(e => e.LlmModel)
                .HasMaxLength(64)
                .HasColumnName("llm_model");
            entity.Property(e => e.NativeLikeness).HasColumnName("native_likeness");
            entity.Property(e => e.NaturalnessScore).HasColumnName("naturalness_score");
            entity.Property(e => e.OverallBand).HasColumnName("overall_band");
            entity.Property(e => e.PronunciationScore).HasColumnName("pronunciation_score");
            entity.Property(e => e.RelevanceScore).HasColumnName("relevance_score");
            entity.Property(e => e.SpeechRateScore).HasColumnName("speech_rate_score");
            entity.Property(e => e.SubmissionId).HasColumnName("submission_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Submission).WithOne(p => p.Evaluation)
                .HasForeignKey<Evaluation>(d => d.SubmissionId)
                .HasConstraintName("evaluations_submission_id_fkey");
        });

        modelBuilder.Entity<Group>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("groups_pkey");

            entity.ToTable("groups");

            entity.HasIndex(e => e.TeacherId, "ix_groups_teacher_id");

            entity.HasIndex(e => e.JoinCode, "uq_groups_join_code").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.JoinCode)
                .HasMaxLength(12)
                .HasColumnName("join_code");
            entity.Property(e => e.Name)
                .HasMaxLength(128)
                .HasColumnName("name");
            entity.Property(e => e.TeacherId).HasColumnName("teacher_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Teacher).WithMany(p => p.Groups)
                .HasForeignKey(d => d.TeacherId)
                .HasConstraintName("groups_teacher_id_fkey");
        });

        modelBuilder.Entity<GroupMember>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("group_members_pkey");

            entity.ToTable("group_members");

            entity.HasIndex(e => e.GroupId, "ix_group_members_group_id");

            entity.HasIndex(e => e.StudentId, "ix_group_members_student_id");

            entity.HasIndex(e => new { e.GroupId, e.StudentId }, "uq_group_member").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.GroupId).HasColumnName("group_id");
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Group).WithMany(p => p.GroupMembers)
                .HasForeignKey(d => d.GroupId)
                .HasConstraintName("group_members_group_id_fkey");

            entity.HasOne(d => d.Student).WithMany(p => p.GroupMembers)
                .HasForeignKey(d => d.StudentId)
                .HasConstraintName("group_members_student_id_fkey");
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("notifications_pkey");

            entity.ToTable("notifications");

            entity.HasIndex(e => e.IsRead, "ix_notifications_is_read");

            entity.HasIndex(e => e.UserId, "ix_notifications_user_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Body).HasColumnName("body");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.IsRead)
                .HasDefaultValue(false)
                .HasColumnName("is_read");
            entity.Property(e => e.Link)
                .HasMaxLength(300)
                .HasColumnName("link");
            entity.Property(e => e.Title)
                .HasMaxLength(200)
                .HasColumnName("title");
            entity.Property(e => e.Type)
                .HasMaxLength(32)
                .HasColumnName("type");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId).HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("notifications_user_id_fkey");
        });

        modelBuilder.Entity<Question>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("questions_pkey");

            entity.ToTable("questions");

            entity.HasIndex(e => e.BlockId, "ix_questions_block_id");

            // Restored: dropped by the raw scaffold because it indexes the enum column.
            entity.HasIndex(e => e.Type, "ix_questions_type");

            entity.HasIndex(e => e.IsPublic, "ix_questions_is_public");

            entity.HasIndex(e => e.Level, "ix_questions_level");

            entity.HasIndex(e => e.RuStyle, "ix_questions_ru_style");

            entity.HasIndex(e => e.TeacherId, "ix_questions_teacher_id");

            entity.HasIndex(e => e.Topic, "ix_questions_topic");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.AnswerTimeLimitSec).HasColumnName("answer_time_limit_sec");
            entity.Property(e => e.BlockId).HasColumnName("block_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.InstructionText).HasColumnName("instruction_text");
            entity.Property(e => e.IsDeleted)
                .HasDefaultValue(false)
                .HasColumnName("is_deleted");
            entity.Property(e => e.IsPublic)
                .HasDefaultValue(false)
                .HasColumnName("is_public");
            entity.Property(e => e.IsPublished).HasColumnName("is_published");
            entity.Property(e => e.Level)
                .HasMaxLength(8)
                .HasColumnName("level");
            entity.Property(e => e.MediaKey)
                .HasMaxLength(512)
                .HasColumnName("media_key");
            entity.Property(e => e.ModelAnswerText).HasColumnName("model_answer_text");
            entity.Property(e => e.PrepTimeSec).HasColumnName("prep_time_sec");
            entity.Property(e => e.PromptText).HasColumnName("prompt_text");
            entity.Property(e => e.RuStyle)
                .HasMaxLength(8)
                .HasColumnName("ru_style");
            entity.Property(e => e.SortOrder)
                .HasDefaultValue(0)
                .HasColumnName("sort_order");
            entity.Property(e => e.TeacherId).HasColumnName("teacher_id");
            entity.Property(e => e.Title)
                .HasMaxLength(255)
                .HasColumnName("title");
            entity.Property(e => e.Topic)
                .HasMaxLength(128)
                .HasColumnName("topic");
            entity.Property(e => e.Type)
                .HasColumnName("type")
                .HasColumnType("question_type"); // PG native enum, not int
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Block).WithMany(p => p.Questions)
                .HasForeignKey(d => d.BlockId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_questions_block_id");

            entity.HasOne(d => d.Teacher).WithMany(p => p.Questions)
                .HasForeignKey(d => d.TeacherId)
                .HasConstraintName("questions_teacher_id_fkey");
        });

        modelBuilder.Entity<QuestionBlock>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("question_blocks_pkey");

            entity.ToTable("question_blocks");

            entity.HasIndex(e => e.TeacherId, "ix_question_blocks_teacher_id");

            entity.HasIndex(e => e.Visibility, "ix_question_blocks_visibility");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CoverKey)
                .HasMaxLength(512)
                .HasColumnName("cover_key");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.IsPublished)
                .HasDefaultValue(false)
                .HasColumnName("is_published");
            entity.Property(e => e.Level)
                .HasMaxLength(8)
                .HasColumnName("level");
            entity.Property(e => e.Name)
                .HasMaxLength(128)
                .HasColumnName("name");
            entity.Property(e => e.RuStyle)
                .HasMaxLength(8)
                .HasColumnName("ru_style");
            entity.Property(e => e.SortOrder)
                .HasDefaultValue(0)
                .HasColumnName("sort_order");
            entity.Property(e => e.TeacherId).HasColumnName("teacher_id");
            entity.Property(e => e.Topic)
                .HasMaxLength(128)
                .HasColumnName("topic");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.Visibility)
                .HasMaxLength(8)
                .HasDefaultValueSql("'group'::character varying")
                .HasColumnName("visibility");

            entity.HasOne(d => d.Teacher).WithMany(p => p.QuestionBlocks)
                .HasForeignKey(d => d.TeacherId)
                .HasConstraintName("question_blocks_teacher_id_fkey");
        });

        modelBuilder.Entity<ReviewItem>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("review_items_pkey");

            entity.ToTable("review_items");

            entity.HasIndex(e => e.Completed, "ix_review_items_completed");

            entity.HasIndex(e => e.DueAt, "ix_review_items_due_at");

            entity.HasIndex(e => e.QuestionId, "ix_review_items_question_id");

            entity.HasIndex(e => e.StudentId, "ix_review_items_student_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Completed)
                .HasDefaultValue(false)
                .HasColumnName("completed");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.DueAt).HasColumnName("due_at");
            entity.Property(e => e.IntervalIndex)
                .HasDefaultValue(0)
                .HasColumnName("interval_index");
            entity.Property(e => e.QuestionId).HasColumnName("question_id");
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.WeaknessDim)
                .HasMaxLength(32)
                .HasColumnName("weakness_dim");

            entity.HasOne(d => d.Question).WithMany(p => p.ReviewItems)
                .HasForeignKey(d => d.QuestionId)
                .HasConstraintName("review_items_question_id_fkey");

            entity.HasOne(d => d.Student).WithMany(p => p.ReviewItems)
                .HasForeignKey(d => d.StudentId)
                .HasConstraintName("review_items_student_id_fkey");
        });

        modelBuilder.Entity<ShadowingPhrase>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("shadowing_phrases_pkey");

            entity.ToTable("shadowing_phrases");

            entity.HasIndex(e => e.CreatedBy, "ix_shadowing_phrases_created_by");

            entity.HasIndex(e => e.IsActive, "ix_shadowing_phrases_is_active");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.IsActive).HasColumnName("is_active");
            entity.Property(e => e.Level)
                .HasMaxLength(16)
                .HasColumnName("level");
            entity.Property(e => e.Text)
                .HasMaxLength(500)
                .HasColumnName("text");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.CreatedByNavigation).WithMany(p => p.ShadowingPhrases)
                .HasForeignKey(d => d.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("shadowing_phrases_created_by_fkey");
        });

        modelBuilder.Entity<Submission>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("submissions_pkey");

            entity.ToTable("submissions");

            entity.HasIndex(e => e.AssignmentId, "ix_submissions_assignment_id");

            entity.HasIndex(e => e.QuestionId, "ix_submissions_question_id");

            // Restored: dropped by the raw scaffold because it indexes the enum column.
            entity.HasIndex(e => e.Status, "ix_submissions_status");

            entity.HasIndex(e => e.StudentId, "ix_submissions_student_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.AssignmentId).HasColumnName("assignment_id");
            entity.Property(e => e.AudioDurationSec).HasColumnName("audio_duration_sec");
            entity.Property(e => e.AudioKey)
                .HasMaxLength(512)
                .HasColumnName("audio_key");
            entity.Property(e => e.CompletedAt).HasColumnName("completed_at");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.ErrorMessage).HasColumnName("error_message");
            entity.Property(e => e.ModelAnswerText).HasColumnName("model_answer_text");
            entity.Property(e => e.QuestionId).HasColumnName("question_id");
            entity.Property(e => e.ReferenceText).HasColumnName("reference_text");
            entity.Property(e => e.ReviewedAt).HasColumnName("reviewed_at");
            entity.Property(e => e.ReviewedBy).HasColumnName("reviewed_by");
            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasColumnType("submission_status"); // PG native enum, not int
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.TeacherBand).HasColumnName("teacher_band");
            entity.Property(e => e.TeacherComment).HasColumnName("teacher_comment");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Assignment).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.AssignmentId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_submissions_assignment_id");

            entity.HasOne(d => d.Question).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.QuestionId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("submissions_question_id_fkey");

            entity.HasOne(d => d.ReviewedByNavigation).WithMany(p => p.SubmissionReviewedByNavigations)
                .HasForeignKey(d => d.ReviewedBy)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("submissions_reviewed_by_fkey");

            entity.HasOne(d => d.Student).WithMany(p => p.SubmissionStudents)
                .HasForeignKey(d => d.StudentId)
                .HasConstraintName("submissions_student_id_fkey");
        });

        modelBuilder.Entity<Topic>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("topics_pkey");

            entity.ToTable("topics");

            entity.HasIndex(e => e.TeacherId, "ix_topics_teacher_id");

            entity.HasIndex(e => new { e.TeacherId, e.Name }, "uq_topic_teacher_name").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.Name)
                .HasMaxLength(128)
                .HasColumnName("name");
            entity.Property(e => e.TeacherId).HasColumnName("teacher_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Teacher).WithMany(p => p.Topics)
                .HasForeignKey(d => d.TeacherId)
                .HasConstraintName("topics_teacher_id_fkey");
        });

        modelBuilder.Entity<TopicImage>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("topic_images_pkey");

            entity.ToTable("topic_images");

            entity.HasIndex(e => e.TopicId, "ix_topic_images_topic_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.ImageKey)
                .HasMaxLength(512)
                .HasColumnName("image_key");
            entity.Property(e => e.TopicId).HasColumnName("topic_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Topic).WithMany(p => p.TopicImages)
                .HasForeignKey(d => d.TopicId)
                .HasConstraintName("topic_images_topic_id_fkey");
        });

        modelBuilder.Entity<Transcript>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("transcripts_pkey");

            entity.ToTable("transcripts");

            entity.HasIndex(e => e.SubmissionId, "transcripts_submission_id_key").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.Language)
                .HasMaxLength(16)
                .HasColumnName("language");
            entity.Property(e => e.Pronunciation)
                .HasColumnType("jsonb")
                .HasColumnName("pronunciation");
            entity.Property(e => e.SttModel)
                .HasMaxLength(64)
                .HasColumnName("stt_model");
            entity.Property(e => e.SubmissionId).HasColumnName("submission_id");
            entity.Property(e => e.Text).HasColumnName("text");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.WordTimestamps)
                .HasColumnType("jsonb")
                .HasColumnName("word_timestamps");

            entity.HasOne(d => d.Submission).WithOne(p => p.Transcript)
                .HasForeignKey<Transcript>(d => d.SubmissionId)
                .HasConstraintName("transcripts_submission_id_fkey");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("users_pkey");

            entity.ToTable("users");

            entity.HasIndex(e => e.Email, "ix_users_email").IsUnique();

            entity.HasIndex(e => e.GoogleSub, "uq_users_google_sub").IsUnique();

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Address).HasColumnName("address"); // additive nullable varchar (15-address-column.sql)
            entity.Property(e => e.Age).HasColumnName("age");
            entity.Property(e => e.AvatarKey)
                .HasMaxLength(512)
                .HasColumnName("avatar_key");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.CurrentStreak)
                .HasDefaultValue(0)
                .HasColumnName("current_streak");
            entity.Property(e => e.DailyGoal)
                .HasDefaultValue(1)
                .HasColumnName("daily_goal");
            entity.Property(e => e.District)
                .HasMaxLength(64)
                .HasColumnName("district");
            entity.Property(e => e.Email)
                .HasMaxLength(255)
                .HasColumnName("email");
            entity.Property(e => e.FullName)
                .HasMaxLength(255)
                .HasColumnName("full_name");
            entity.Property(e => e.GoogleSub)
                .HasMaxLength(255)
                .HasColumnName("google_sub");
            entity.Property(e => e.IsActive).HasColumnName("is_active");
            entity.Property(e => e.IsPremium)
                .HasDefaultValue(false)
                .HasColumnName("is_premium");
            entity.Property(e => e.LastPracticeDate).HasColumnName("last_practice_date");
            entity.Property(e => e.LongestStreak)
                .HasDefaultValue(0)
                .HasColumnName("longest_streak");
            entity.Property(e => e.PasswordHash)
                .HasMaxLength(255)
                .HasColumnName("password_hash");
            entity.Property(e => e.Phone)
                .HasMaxLength(20)
                .HasColumnName("phone");
            entity.Property(e => e.PreferredLanguage)
                .HasMaxLength(8)
                .HasDefaultValueSql("'uz'::character varying")
                .HasColumnName("preferred_language");
            entity.Property(e => e.Region)
                .HasMaxLength(64)
                .HasColumnName("region");
            entity.Property(e => e.Role)
                .HasColumnName("role")
                .HasColumnType("user_role"); // PG native enum, not int
            entity.Property(e => e.StreakFreezes)
                .HasDefaultValue(0)
                .HasColumnName("streak_freezes");
            entity.Property(e => e.Telegram)
                .HasMaxLength(64)
                .HasColumnName("telegram");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");
            entity.Property(e => e.Xp)
                .HasDefaultValue(0)
                .HasColumnName("xp");
        });

        modelBuilder.Entity<XpEvent>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("xp_events_pkey");

            entity.ToTable("xp_events");

            entity.HasIndex(e => e.StudentId, "ix_xp_events_student_id");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnName("id");
            entity.Property(e => e.Amount).HasColumnName("amount");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("created_at");
            entity.Property(e => e.Reason)
                .HasMaxLength(32)
                .HasDefaultValueSql("'submission'::character varying")
                .HasColumnName("reason");
            entity.Property(e => e.StudentId).HasColumnName("student_id");
            entity.Property(e => e.SubmissionId).HasColumnName("submission_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("now()")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Student).WithMany(p => p.XpEvents)
                .HasForeignKey(d => d.StudentId)
                .HasConstraintName("xp_events_student_id_fkey");

            entity.HasOne(d => d.Submission).WithMany(p => p.XpEvents)
                .HasForeignKey(d => d.SubmissionId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("xp_events_submission_id_fkey");
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
