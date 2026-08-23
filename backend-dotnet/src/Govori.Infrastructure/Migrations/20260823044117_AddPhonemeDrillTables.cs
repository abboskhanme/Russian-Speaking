using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPhonemeDrillTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "minimal_pairs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    contrast_ru = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    why_uz = table.Column<string>(type: "text", nullable: false),
                    level = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    word_a = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    word_b = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    gloss_a_uz = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    gloss_b_uz = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ipa_a = table.Column<string>(type: "jsonb", nullable: false),
                    ipa_b = table.Column<string>(type: "jsonb", nullable: false),
                    focus_index_a = table.Column<int>(type: "integer", nullable: false),
                    focus_index_b = table.Column<int>(type: "integer", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("minimal_pairs_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "drills",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    pair_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_word = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    heard_text = table.Column<string>(type: "text", nullable: true),
                    outcome = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    accuracy = table.Column<double>(type: "double precision", nullable: true),
                    phonemes = table.Column<string>(type: "jsonb", nullable: true),
                    focus_score = table.Column<double>(type: "double precision", nullable: true),
                    stt_model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    audio_duration_sec = table.Column<double>(type: "double precision", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("drills_pkey", x => x.id);
                    table.ForeignKey(
                        name: "drills_pair_id_fkey",
                        column: x => x.pair_id,
                        principalTable: "minimal_pairs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "drills_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_drills_pair_id",
                table: "drills",
                column: "pair_id");

            migrationBuilder.CreateIndex(
                name: "ix_drills_student_created",
                table: "drills",
                columns: new[] { "student_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_drills_student_pair",
                table: "drills",
                columns: new[] { "student_id", "pair_id" });

            migrationBuilder.CreateIndex(
                name: "uq_minimal_pairs_slug",
                table: "minimal_pairs",
                column: "slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "drills");

            migrationBuilder.DropTable(
                name: "minimal_pairs");
        }
    }
}
