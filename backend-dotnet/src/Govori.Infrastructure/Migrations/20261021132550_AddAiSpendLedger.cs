using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAiSpendLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_spend_daily",
                columns: table => new
                {
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    operation = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    calls = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    failed_calls = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    audio_seconds = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false, defaultValue: 0m),
                    input_tokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    output_tokens = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    cost_usd = table.Column<decimal>(type: "numeric(14,6)", precision: 14, scale: 6, nullable: false, defaultValue: 0m),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("ai_spend_daily_pkey", x => new { x.day, x.provider, x.operation });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_spend_daily");
        }
    }
}
