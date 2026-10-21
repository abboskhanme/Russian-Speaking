using System.Net;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// The admin audit trail (<c>admin_audit_log</c>, <c>GET /api/admin/audit</c>), end to end: a real
/// admin request through the real endpoint filter into the real migrated table.
///
/// <para>What each test pins is a property the trail is worthless without: one successful mutation
/// is exactly ONE row naming the right actor, action and target; a refused request is NO row; a
/// teacher on the routes they share with admins is no row; a credential's value never lands in the
/// row nor in the list; the table refuses edits; and only an admin can read any of it.</para>
///
/// <para>Audit rows cannot be deleted (that is the point — see the trigger test), so these tests
/// never clean them up. They stay isolated anyway: every assertion is scoped to an actor id minted
/// for that test, and the per-run database is dropped at the end.</para>
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    [Fact]
    public async Task A_successful_admin_mutation_is_exactly_one_audit_row_and_a_refused_one_is_none()
    {
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var studentName = $"Audit Student {studentId:N}"[..28];
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"au-adm-{adminId:N}@example.test", UserRole.Admin, null, "Audit Admin"));
            ctx.Users.Add(NewUser(studentId, $"au-s-{studentId:N}@example.test", UserRole.Student, null, studentName));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);

            // Refused requests first: neither a 404 (unknown target) nor a student's 403 may leave a row.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Patch, $"/api/admin/students/{Guid.NewGuid()}", adminToken,
                    Json(new { is_premium = true }))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", TokenFor(studentId),
                    Json(new { is_premium = true }))).StatusCode);
            Assert.Empty(await AuditRowsAsync(adminId));
            Assert.Empty(await AuditRowsAsync(studentId));

            // The premium grant — the regression the trail most needs to answer "who did this?".
            var grant = await Send(client, HttpMethod.Patch, $"/api/admin/students/{studentId}", adminToken,
                Json(new { is_premium = true }));
            Assert.Equal(HttpStatusCode.OK, grant.StatusCode);

            var row = Assert.Single(await AuditRowsAsync(adminId));
            Assert.Equal("student.update", row.Action);
            Assert.Equal("user", row.TargetType);
            Assert.Equal(studentId.ToString(), row.TargetId);
            Assert.Equal(studentName, row.TargetLabel);

            // The list says the same thing, with the actor's name resolved and the allow-listed value.
            var list = await ReadJson(await Send(client, HttpMethod.Get, $"/api/admin/audit?actor_id={adminId}", adminToken));
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            var item = Assert.Single(list.GetProperty("items").EnumerateArray());
            Assert.Equal(adminId, item.GetProperty("actor_id").GetGuid());
            Assert.Equal("Audit Admin", item.GetProperty("actor_name").GetString());
            Assert.Equal("student.update", item.GetProperty("action").GetString());
            Assert.Equal(studentId.ToString(), item.GetProperty("target_id").GetString());
            Assert.Equal(new[] { "is_premium" }, item.GetProperty("fields").EnumerateArray().Select(f => f.GetString()));
            Assert.Equal("true", item.GetProperty("values").GetProperty("is_premium").GetString());

            // A delete: the row still names the student, read before they were gone.
            Assert.Equal(HttpStatusCode.NoContent,
                (await Send(client, HttpMethod.Delete, $"/api/admin/students/{studentId}", adminToken)).StatusCode);
            var rows = await AuditRowsAsync(adminId);
            Assert.Equal(2, rows.Count);
            var delete = rows.Single(r => r.Action == "student.delete");
            Assert.Equal(studentName, delete.TargetLabel);

            // Filters: action is a prefix, dates are inclusive product days, newest comes first.
            var students = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/audit?actor_id={adminId}&action=student", adminToken));
            Assert.Equal(2, students.GetProperty("total").GetInt32());
            Assert.Equal("student.delete",
                students.GetProperty("items")[0].GetProperty("action").GetString());
            var settings = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/audit?actor_id={adminId}&action=settings", adminToken));
            Assert.Equal(0, settings.GetProperty("total").GetInt32());
            var tomorrow = Govori.Contracts.ProductDay.Today().AddDays(1).ToString("yyyy-MM-dd");
            var future = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/audit?actor_id={adminId}&from={tomorrow}", adminToken));
            Assert.Equal(0, future.GetProperty("total").GetInt32());
            var paged = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/audit?actor_id={adminId}&page=2&page_size=1", adminToken));
            Assert.Equal(2, paged.GetProperty("total").GetInt32());
            Assert.Equal("student.update",
                Assert.Single(paged.GetProperty("items").EnumerateArray()).GetProperty("action").GetString());
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task A_secret_value_never_reaches_the_audit_trail_only_the_key_name_does()
    {
        var adminId = Guid.NewGuid();
        var secret = $"sk-audit-{Guid.NewGuid():N}";
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"au-sec-{adminId:N}@example.test", UserRole.Admin, null));
            await ctx.SaveChangesAsync();
        }
        await CleanKeysAsync("gemini_api_key", "orthoepy_enabled");

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);

            await Patch(client, adminToken, "/api/admin/settings/ai",
                new { gemini_api_key = secret, orthoepy_enabled = "false" });
            // Showing the key is a read, but the one read that hands out a credential — it is audited too.
            var reveal = await Send(client, HttpMethod.Get, "/api/admin/settings/reveal/gemini_api_key", adminToken);
            Assert.Equal(HttpStatusCode.OK, reveal.StatusCode);

            var rows = await AuditRowsAsync(adminId);
            Assert.Equal(2, rows.Count);

            var save = rows.Single(r => r.Action == "settings.ai.update");
            Assert.Equal("settings", save.TargetType);
            using (var details = JsonDocument.Parse(save.Details!))
            {
                // WHICH keys changed is recorded; the non-secret one keeps its value, the key keeps none.
                Assert.Equal(new[] { "gemini_api_key", "orthoepy_enabled" },
                    details.RootElement.GetProperty("fields").EnumerateArray().Select(f => f.GetString()));
                var values = details.RootElement.GetProperty("values");
                Assert.Equal("false", values.GetProperty("orthoepy_enabled").GetString());
                Assert.False(values.TryGetProperty("gemini_api_key", out _));
            }

            var shown = rows.Single(r => r.Action == "settings.secret_reveal");
            Assert.Equal("secret", shown.TargetType);
            Assert.Equal("gemini_api_key", shown.TargetId);

            // Belt and braces: the value appears in no column of any row, and nowhere in the list.
            Assert.DoesNotContain(rows, r =>
                $"{r.Details}|{r.TargetId}|{r.TargetLabel}|{r.Action}".Contains(secret, StringComparison.Ordinal));
            var listBody = await (await Send(client, HttpMethod.Get, $"/api/admin/audit?actor_id={adminId}", adminToken))
                .Content.ReadAsStringAsync();
            Assert.DoesNotContain(secret, listBody, StringComparison.Ordinal);
            Assert.Contains("gemini_api_key", listBody, StringComparison.Ordinal);
        }
        finally
        {
            await CleanKeysAsync("gemini_api_key", "orthoepy_enabled");
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Shared_content_routes_are_audited_for_an_admin_and_not_for_a_teacher()
    {
        var adminId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var blockIds = new List<Guid>();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"au-ca-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(teacherId, $"au-ct-{teacherId:N}@example.test", UserRole.Teacher, null));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // A teacher authoring their own module is product activity, not administration.
            var mine = await Send(client, HttpMethod.Post, "/api/blocks", TokenFor(teacherId),
                Json(new { name = "Teacher module", visibility = "private" }));
            Assert.Equal(HttpStatusCode.Created, mine.StatusCode);
            blockIds.Add((await ReadJson(mine)).GetProperty("id").GetGuid());
            Assert.Empty(await AuditRowsAsync(teacherId));

            // The admin's Kontent section is the same route: a create takes its id from the response.
            var official = await Send(client, HttpMethod.Post, "/api/blocks", TokenFor(adminId),
                Json(new { name = "Official module", visibility = "public" }));
            Assert.Equal(HttpStatusCode.Created, official.StatusCode);
            var officialId = (await ReadJson(official)).GetProperty("id").GetGuid();
            blockIds.Add(officialId);

            var row = Assert.Single(await AuditRowsAsync(adminId));
            Assert.Equal("module.create", row.Action);
            Assert.Equal("module", row.TargetType);
            Assert.Equal(officialId.ToString(), row.TargetId);
            Assert.Equal("Official module", row.TargetLabel);
            // Parsed, not string-matched: jsonb re-renders whitespace on the way back out.
            using var details = JsonDocument.Parse(row.Details!);
            Assert.Equal("public", details.RootElement.GetProperty("values").GetProperty("visibility").GetString());
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.QuestionBlocks.Where(b => blockIds.Contains(b.Id)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task The_audit_list_is_admin_only()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(studentId, $"au-ls-{studentId:N}@example.test", UserRole.Student, null));
            ctx.Users.Add(NewUser(teacherId, $"au-lt-{teacherId:N}@example.test", UserRole.Teacher, null));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/audit")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/admin/audit", TokenFor(studentId))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, "/api/admin/audit", TokenFor(teacherId))).StatusCode);
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == studentId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task The_audit_table_refuses_update_and_delete()
    {
        var rowId = Guid.CreateVersion7();
        await using (var ctx = NewContext())
        {
            ctx.AdminAuditLog.Add(new AdminAuditEntry
            {
                Id = rowId,
                ActorUserId = Guid.NewGuid(),
                Action = "test.append_only",
                TargetType = "test",
                CreatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        await using (var ctx = NewContext())
        {
            var update = await Assert.ThrowsAsync<PostgresException>(() =>
                ctx.AdminAuditLog.Where(r => r.Id == rowId)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.Action, "test.rewritten")));
            Assert.Contains("append-only", update.MessageText);
            var delete = await Assert.ThrowsAsync<PostgresException>(() =>
                ctx.AdminAuditLog.Where(r => r.Id == rowId).ExecuteDeleteAsync());
            Assert.Contains("append-only", delete.MessageText);
        }

        await using (var ctx = NewContext())
            Assert.Equal("test.append_only",
                await ctx.AdminAuditLog.AsNoTracking().Where(r => r.Id == rowId).Select(r => r.Action).SingleAsync());
    }

    private async Task<List<AdminAuditEntry>> AuditRowsAsync(Guid actorId)
    {
        await using var ctx = NewContext();
        return await ctx.AdminAuditLog.AsNoTracking()
            .Where(r => r.ActorUserId == actorId)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();
    }
}
