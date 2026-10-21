using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "admin_audit_log",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    target_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    target_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    target_label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    details = table.Column<string>(type: "jsonb", nullable: true),
                    ip = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("admin_audit_log_pkey", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_admin_audit_log_actor_created",
                table: "admin_audit_log",
                columns: new[] { "actor_user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_admin_audit_log_created_at",
                table: "admin_audit_log",
                column: "created_at");

            // Append-only, enforced where nobody can route around it. An audit trail that an admin (or
            // a bug, or a hand-run psql session) can edit proves nothing about admins, so UPDATE, DELETE
            // and TRUNCATE are refused by the database itself. A future retention job has to drop this
            // trigger in its own migration — i.e. as a reviewed decision, not as a side effect.
            migrationBuilder.Sql("""
                CREATE FUNCTION admin_audit_log_append_only() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'admin_audit_log is append-only: % refused', TG_OP;
                END
                $$;

                CREATE TRIGGER admin_audit_log_no_update_delete
                    BEFORE UPDATE OR DELETE ON admin_audit_log
                    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();

                CREATE TRIGGER admin_audit_log_no_truncate
                    BEFORE TRUNCATE ON admin_audit_log
                    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_append_only();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Dropping the table takes its triggers with it; the function is a separate object.
            migrationBuilder.DropTable(
                name: "admin_audit_log");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS admin_audit_log_append_only();");
        }
    }
}
