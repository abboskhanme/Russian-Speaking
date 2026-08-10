using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <summary>
    /// The notification preference the profile screens always showed but could never keep: the
    /// toggle was session-local because there was nowhere to put the answer, so it silently reset on
    /// every reload.
    ///
    /// <para>Purely ADDITIVE — one column with a default, no backfill and no rewrite of an existing
    /// one. <c>DEFAULT true</c> is what makes it safe on live data: every existing row keeps exactly
    /// the behaviour it already had (notifications on), so applying this to prod changes nothing
    /// until a user actually flips the switch.</para>
    /// </summary>
    public partial class AddUserNotificationsEnabled : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "notifications_enabled",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "notifications_enabled",
                table: "users");
        }
    }
}
