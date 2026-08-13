using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Govori.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddUsersPhoneUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_users_phone",
                table: "users",
                column: "phone",
                unique: true,
                filter: "phone IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_users_phone",
                table: "users");
        }
    }
}
