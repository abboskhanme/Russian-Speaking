using System;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialBaseline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:Enum:public.question_type", "text,image,video")
                .Annotation("Npgsql:Enum:public.submission_status", "pending,processing,done,failed")
                .Annotation("Npgsql:Enum:public.user_role", "teacher,student,admin");

            migrationBuilder.CreateTable(
                name: "app_settings",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    value = table.Column<string>(type: "text", nullable: true),
                    is_secret = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("app_settings_pkey", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    full_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    role = table.Column<UserRole>(type: "user_role", nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    preferred_language = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false, defaultValueSql: "'uz'::character varying"),
                    is_premium = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    google_sub = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    xp = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    daily_goal = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    streak_freezes = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    current_streak = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    longest_streak = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_practice_date = table.Column<DateOnly>(type: "date", nullable: true),
                    phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    age = table.Column<int>(type: "integer", nullable: true),
                    region = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    district = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    address = table.Column<string>(type: "text", nullable: true),
                    telegram = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    avatar_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("users_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "groups",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    teacher_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    join_code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("groups_pkey", x => x.id);
                    table.ForeignKey(
                        name: "groups_teacher_id_fkey",
                        column: x => x.teacher_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "text", nullable: true),
                    link = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    is_read = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("notifications_pkey", x => x.id);
                    table.ForeignKey(
                        name: "notifications_user_id_fkey",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "question_blocks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    teacher_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    topic = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    level = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    ru_style = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    visibility = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false, defaultValueSql: "'group'::character varying"),
                    is_published = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    cover_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("question_blocks_pkey", x => x.id);
                    table.ForeignKey(
                        name: "question_blocks_teacher_id_fkey",
                        column: x => x.teacher_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shadowing_phrases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    text = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    level = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("shadowing_phrases_pkey", x => x.id);
                    table.ForeignKey(
                        name: "shadowing_phrases_created_by_fkey",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "topics",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    teacher_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("topics_pkey", x => x.id);
                    table.ForeignKey(
                        name: "topics_teacher_id_fkey",
                        column: x => x.teacher_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "group_members",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    group_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("group_members_pkey", x => x.id);
                    table.ForeignKey(
                        name: "group_members_group_id_fkey",
                        column: x => x.group_id,
                        principalTable: "groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "group_members_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "questions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    teacher_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<QuestionType>(type: "question_type", nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    prompt_text = table.Column<string>(type: "text", nullable: false),
                    media_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    level = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    prep_time_sec = table.Column<int>(type: "integer", nullable: false),
                    answer_time_limit_sec = table.Column<int>(type: "integer", nullable: false),
                    is_published = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    topic = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    model_answer_text = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    is_public = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    block_id = table.Column<Guid>(type: "uuid", nullable: true),
                    ru_style = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    instruction_text = table.Column<string>(type: "text", nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("questions_pkey", x => x.id);
                    table.ForeignKey(
                        name: "fk_questions_block_id",
                        column: x => x.block_id,
                        principalTable: "question_blocks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "questions_teacher_id_fkey",
                        column: x => x.teacher_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "topic_images",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    topic_id = table.Column<Guid>(type: "uuid", nullable: false),
                    image_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("topic_images_pkey", x => x.id);
                    table.ForeignKey(
                        name: "topic_images_topic_id_fkey",
                        column: x => x.topic_id,
                        principalTable: "topics",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "assignments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    teacher_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    due_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    group_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("assignments_pkey", x => x.id);
                    table.ForeignKey(
                        name: "assignments_group_id_fkey",
                        column: x => x.group_id,
                        principalTable: "groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "assignments_question_id_fkey",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "assignments_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "assignments_teacher_id_fkey",
                        column: x => x.teacher_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "review_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    weakness_dim = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    interval_index = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    due_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    completed = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("review_items_pkey", x => x.id);
                    table.ForeignKey(
                        name: "review_items_question_id_fkey",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "review_items_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "submissions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: true),
                    audio_key = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    audio_duration_sec = table.Column<double>(type: "double precision", nullable: true),
                    status = table.Column<SubmissionStatus>(type: "submission_status", nullable: false),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    teacher_comment = table.Column<string>(type: "text", nullable: true),
                    teacher_band = table.Column<double>(type: "double precision", nullable: true),
                    reviewed_by = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reference_text = table.Column<string>(type: "text", nullable: true),
                    assignment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    model_answer_text = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("submissions_pkey", x => x.id);
                    table.ForeignKey(
                        name: "fk_submissions_assignment_id",
                        column: x => x.assignment_id,
                        principalTable: "assignments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "submissions_question_id_fkey",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "submissions_reviewed_by_fkey",
                        column: x => x.reviewed_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "submissions_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "evaluations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    submission_id = table.Column<Guid>(type: "uuid", nullable: false),
                    fluency_score = table.Column<double>(type: "double precision", nullable: false),
                    lexical_score = table.Column<double>(type: "double precision", nullable: false),
                    grammar_score = table.Column<double>(type: "double precision", nullable: false),
                    pronunciation_score = table.Column<double>(type: "double precision", nullable: true),
                    overall_band = table.Column<double>(type: "double precision", nullable: false),
                    feedback = table.Column<string>(type: "jsonb", nullable: true),
                    corrections = table.Column<string>(type: "jsonb", nullable: true),
                    llm_model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    relevance_score = table.Column<double>(type: "double precision", nullable: true),
                    explanation = table.Column<string>(type: "jsonb", nullable: true),
                    level_score = table.Column<double>(type: "double precision", nullable: true),
                    naturalness_score = table.Column<double>(type: "double precision", nullable: true),
                    speech_rate_score = table.Column<double>(type: "double precision", nullable: true),
                    intonation_score = table.Column<double>(type: "double precision", nullable: true),
                    native_likeness = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("evaluations_pkey", x => x.id);
                    table.ForeignKey(
                        name: "evaluations_submission_id_fkey",
                        column: x => x.submission_id,
                        principalTable: "submissions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "transcripts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    submission_id = table.Column<Guid>(type: "uuid", nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    language = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    word_timestamps = table.Column<string>(type: "jsonb", nullable: true),
                    stt_model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    pronunciation = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("transcripts_pkey", x => x.id);
                    table.ForeignKey(
                        name: "transcripts_submission_id_fkey",
                        column: x => x.submission_id,
                        principalTable: "submissions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "xp_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    submission_id = table.Column<Guid>(type: "uuid", nullable: true),
                    amount = table.Column<int>(type: "integer", nullable: false),
                    reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValueSql: "'submission'::character varying"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("xp_events_pkey", x => x.id);
                    table.ForeignKey(
                        name: "xp_events_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "xp_events_submission_id_fkey",
                        column: x => x.submission_id,
                        principalTable: "submissions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_assignments_group_id",
                table: "assignments",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "ix_assignments_question_id",
                table: "assignments",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "ix_assignments_student_id",
                table: "assignments",
                column: "student_id");

            migrationBuilder.CreateIndex(
                name: "ix_assignments_teacher_id",
                table: "assignments",
                column: "teacher_id");

            migrationBuilder.CreateIndex(
                name: "ix_evaluations_submission_id",
                table: "evaluations",
                column: "submission_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_group_members_group_id",
                table: "group_members",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "ix_group_members_group_id_student_id",
                table: "group_members",
                columns: new[] { "group_id", "student_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_group_members_student_id",
                table: "group_members",
                column: "student_id");

            migrationBuilder.CreateIndex(
                name: "ix_groups_join_code",
                table: "groups",
                column: "join_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_groups_teacher_id",
                table: "groups",
                column: "teacher_id");

            migrationBuilder.CreateIndex(
                name: "ix_notifications_is_read",
                table: "notifications",
                column: "is_read");

            migrationBuilder.CreateIndex(
                name: "ix_notifications_user_id",
                table: "notifications",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_blocks_teacher_id",
                table: "question_blocks",
                column: "teacher_id");

            migrationBuilder.CreateIndex(
                name: "ix_question_blocks_visibility",
                table: "question_blocks",
                column: "visibility");

            migrationBuilder.CreateIndex(
                name: "ix_questions_block_id",
                table: "questions",
                column: "block_id");

            migrationBuilder.CreateIndex(
                name: "ix_questions_is_public",
                table: "questions",
                column: "is_public");

            migrationBuilder.CreateIndex(
                name: "ix_questions_level",
                table: "questions",
                column: "level");

            migrationBuilder.CreateIndex(
                name: "ix_questions_ru_style",
                table: "questions",
                column: "ru_style");

            migrationBuilder.CreateIndex(
                name: "ix_questions_teacher_id",
                table: "questions",
                column: "teacher_id");

            migrationBuilder.CreateIndex(
                name: "ix_questions_topic",
                table: "questions",
                column: "topic");

            migrationBuilder.CreateIndex(
                name: "ix_questions_type",
                table: "questions",
                column: "type");

            migrationBuilder.CreateIndex(
                name: "ix_review_items_completed",
                table: "review_items",
                column: "completed");

            migrationBuilder.CreateIndex(
                name: "ix_review_items_due_at",
                table: "review_items",
                column: "due_at");

            migrationBuilder.CreateIndex(
                name: "ix_review_items_question_id",
                table: "review_items",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "ix_review_items_student_id",
                table: "review_items",
                column: "student_id");

            migrationBuilder.CreateIndex(
                name: "ix_shadowing_phrases_created_by",
                table: "shadowing_phrases",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_shadowing_phrases_is_active",
                table: "shadowing_phrases",
                column: "is_active");

            migrationBuilder.CreateIndex(
                name: "ix_submissions_assignment_id",
                table: "submissions",
                column: "assignment_id");

            migrationBuilder.CreateIndex(
                name: "ix_submissions_question_id",
                table: "submissions",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "ix_submissions_reviewed_by",
                table: "submissions",
                column: "reviewed_by");

            migrationBuilder.CreateIndex(
                name: "ix_submissions_status",
                table: "submissions",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_submissions_student_id",
                table: "submissions",
                column: "student_id");

            migrationBuilder.CreateIndex(
                name: "ix_topic_images_topic_id",
                table: "topic_images",
                column: "topic_id");

            migrationBuilder.CreateIndex(
                name: "ix_topics_teacher_id",
                table: "topics",
                column: "teacher_id");

            migrationBuilder.CreateIndex(
                name: "ix_topics_teacher_id_name",
                table: "topics",
                columns: new[] { "teacher_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_transcripts_submission_id",
                table: "transcripts",
                column: "submission_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_users_google_sub",
                table: "users",
                column: "google_sub",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_xp_events_student_id",
                table: "xp_events",
                column: "student_id");

            migrationBuilder.CreateIndex(
                name: "ix_xp_events_submission_id",
                table: "xp_events",
                column: "submission_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "app_settings");

            migrationBuilder.DropTable(
                name: "evaluations");

            migrationBuilder.DropTable(
                name: "group_members");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropTable(
                name: "review_items");

            migrationBuilder.DropTable(
                name: "shadowing_phrases");

            migrationBuilder.DropTable(
                name: "topic_images");

            migrationBuilder.DropTable(
                name: "transcripts");

            migrationBuilder.DropTable(
                name: "xp_events");

            migrationBuilder.DropTable(
                name: "topics");

            migrationBuilder.DropTable(
                name: "submissions");

            migrationBuilder.DropTable(
                name: "assignments");

            migrationBuilder.DropTable(
                name: "groups");

            migrationBuilder.DropTable(
                name: "questions");

            migrationBuilder.DropTable(
                name: "question_blocks");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
