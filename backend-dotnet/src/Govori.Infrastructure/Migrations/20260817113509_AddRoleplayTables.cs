using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRoleplayTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "scenarios",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    title_ru = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    goal_uz = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    level = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    minutes = table.Column<int>(type: "integer", nullable: false),
                    tone = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    icon = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    persona_ru = table.Column<string>(type: "text", nullable: false),
                    opening_ru = table.Column<string>(type: "text", nullable: false),
                    beats = table.Column<string>(type: "jsonb", nullable: false),
                    phrases = table.Column<string>(type: "jsonb", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("scenarios_pkey", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roleplay_turns",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    scenario_id = table.Column<Guid>(type: "uuid", nullable: false),
                    turn_index = table.Column<int>(type: "integer", nullable: false),
                    beat_index = table.Column<int>(type: "integer", nullable: false),
                    student_text = table.Column<string>(type: "text", nullable: true),
                    partner_text = table.Column<string>(type: "text", nullable: false),
                    relevance = table.Column<double>(type: "double precision", nullable: true),
                    overall = table.Column<double>(type: "double precision", nullable: true),
                    corrections = table.Column<string>(type: "jsonb", nullable: true),
                    stt_model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    llm_model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    audio_duration_sec = table.Column<double>(type: "double precision", nullable: true),
                    is_final = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("roleplay_turns_pkey", x => x.id);
                    table.ForeignKey(
                        name: "roleplay_turns_scenario_id_fkey",
                        column: x => x.scenario_id,
                        principalTable: "scenarios",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "roleplay_turns_student_id_fkey",
                        column: x => x.student_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_roleplay_turns_scenario_id",
                table: "roleplay_turns",
                column: "scenario_id");

            migrationBuilder.CreateIndex(
                name: "ix_roleplay_turns_student_created",
                table: "roleplay_turns",
                columns: new[] { "student_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "uq_roleplay_turn_position",
                table: "roleplay_turns",
                columns: new[] { "conversation_id", "turn_index" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_scenarios_slug",
                table: "scenarios",
                column: "slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "roleplay_turns");

            migrationBuilder.DropTable(
                name: "scenarios");
        }
    }
}
