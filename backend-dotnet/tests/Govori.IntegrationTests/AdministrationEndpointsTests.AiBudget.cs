using System.Net;
using System.Text.Json;
using Govori.Administration;
using Govori.Infrastructure.Entities;
using Govori.Platform.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.IntegrationTests;

/// <summary>
/// <c>GET/PATCH /api/admin/settings/ai-budget</c> end to end: the kill switch and the caps are
/// edited through the existing settings mechanism, every successful change is ONE audit row with the
/// values, a refused change is none, a non-admin is refused, and the switch the panel shows is the
/// switch the pipeline obeys (the host's own <see cref="IAiBudget"/>).
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    private static readonly string[] AiBudgetKeys = ["ai_paused", "ai_daily_cap_usd", "ai_monthly_cap_usd"];

    [Fact]
    public async Task The_AI_kill_switch_and_caps_are_admin_settings_audited_and_obeyed()
    {
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"aib-adm-{adminId:N}@example.test", UserRole.Admin, null, "Budget Admin"));
            ctx.Users.Add(NewUser(studentId, $"aib-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
        }
        await CleanKeysAsync(AiBudgetKeys);
        await using (var ctx = NewContext())
            await ctx.AiSpendDaily.ExecuteDeleteAsync();
        _factory.Services.GetRequiredService<IAppSettingsCache>().Invalidate();

        try
        {
            var client = _factory.CreateClient();
            var admin = TokenFor(adminId);
            const string path = "/api/admin/settings/ai-budget";

            // Unset: the documented defaults, open, nothing spent.
            var initial = await ReadJson(await Send(client, HttpMethod.Get, path, admin));
            Assert.False(initial.GetProperty("ai_paused").GetBoolean());
            Assert.Equal((double)AiBudgetSettings.DefaultDailyCapUsd, initial.GetProperty("daily_cap_usd").GetDouble());
            Assert.Equal((double)AiBudgetSettings.DefaultMonthlyCapUsd, initial.GetProperty("monthly_cap_usd").GetDouble());
            Assert.Equal("open", initial.GetProperty("state").GetString());
            Assert.Equal(0, initial.GetProperty("spent_today_usd").GetDouble());

            // A student can neither read nor flip it — and leaves no row.
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, path, TokenFor(studentId))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Patch, path, TokenFor(studentId), Json(new { ai_paused = "true" }))).StatusCode);

            // Nonsense caps are refused, not silently replaced by the default — and leave no row.
            foreach (var bad in new[] { "0", "-5", "abc", "12,5", "5000000" })
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await Send(client, HttpMethod.Patch, path, admin, Json(new { daily_cap_usd = bad }))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Send(client, HttpMethod.Patch, path, admin, Json(new { ai_paused = "maybe" }))).StatusCode);
            Assert.Empty(await AuditRowsAsync(adminId));

            // Pause + new caps in one save.
            var paused = await ReadJson(await Send(client, HttpMethod.Patch, path, admin,
                Json(new { ai_paused = "on", daily_cap_usd = "4.50", monthly_cap_usd = "60" })));
            Assert.True(paused.GetProperty("ai_paused").GetBoolean());
            Assert.Equal("paused", paused.GetProperty("state").GetString());
            Assert.Equal(4.5, paused.GetProperty("daily_cap_usd").GetDouble());
            Assert.Equal(60, paused.GetProperty("monthly_cap_usd").GetDouble());

            // What the panel shows is what the pipeline obeys.
            using (var scope = _factory.Services.CreateScope())
                Assert.Equal(AiBudgetBlock.Paused,
                    (await scope.ServiceProvider.GetRequiredService<IAiBudget>().CheckAsync()).Block);

            // Exactly one audit row, carrying the values (none of these is secret).
            var row = Assert.Single(await AuditRowsAsync(adminId));
            Assert.Equal("settings.ai_budget.update", row.Action);
            Assert.Equal("settings", row.TargetType);
            using (var details = JsonDocument.Parse(row.Details!))
            {
                var values = details.RootElement.GetProperty("values");
                Assert.Equal("on", values.GetProperty("ai_paused").GetString());
                Assert.Equal("4.50", values.GetProperty("daily_cap_usd").GetString());
                Assert.Equal("60", values.GetProperty("monthly_cap_usd").GetString());
            }

            // Resume; "" clears the caps back to the defaults. A second row.
            var resumed = await ReadJson(await Send(client, HttpMethod.Patch, path, admin,
                Json(new { ai_paused = "false", daily_cap_usd = "", monthly_cap_usd = "" })));
            Assert.False(resumed.GetProperty("ai_paused").GetBoolean());
            Assert.Equal("open", resumed.GetProperty("state").GetString());
            Assert.Equal((double)AiBudgetSettings.DefaultDailyCapUsd, resumed.GetProperty("daily_cap_usd").GetDouble());
            Assert.Equal(2, (await AuditRowsAsync(adminId)).Count);

            // Spend recorded by the pipeline shows up against the cap.
            using (var scope = _factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<IAiBudget>().RecordAsync(
                    new AiUsage(AiProviders.AzureSpeech, AiOperations.Stt, true, 0.25m, AudioSeconds: 900));
            var spent = await ReadJson(await Send(client, HttpMethod.Get, path, admin));
            Assert.Equal(0.25, spent.GetProperty("spent_today_usd").GetDouble(), 6);
            Assert.Equal(0.25, spent.GetProperty("spent_month_usd").GetDouble(), 6);
            var line = Assert.Single(spent.GetProperty("month").EnumerateArray());
            Assert.Equal("azure", line.GetProperty("provider").GetString());
            Assert.Equal("stt", line.GetProperty("operation").GetString());
            Assert.Equal(1, line.GetProperty("calls").GetInt32());
        }
        finally
        {
            await CleanKeysAsync(AiBudgetKeys);
            await using var ctx = NewContext();
            await ctx.AiSpendDaily.ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == studentId).ExecuteDeleteAsync();
            _factory.Services.GetRequiredService<IAppSettingsCache>().Invalidate();
        }
    }
}
