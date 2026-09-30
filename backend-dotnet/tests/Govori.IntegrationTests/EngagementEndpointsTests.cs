using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Engagement;
using Govori.Identity.Security;
using Govori.Infrastructure;
using Govori.Infrastructure.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.IntegrationTests;

/// <summary>
/// End-to-end coverage for the Engagement slice (docs/07 §3.6, Faza 3.6): the leaderboard / review /
/// notification HTTP surface (HTTP → EngagementService → EF Core → back) plus the worker-side
/// XP/streak/SRS-scheduling AWARD paths (which deliberately have NO HTTP route, so no client can
/// self-award — they are exercised here by constructing
/// <see cref="EngagementService"/> directly against a real prod-shaped Postgres, the same way the
/// Catalog SQL-parity suite drives CatalogService).
///
/// <list type="bullet">
///   <item><b>XP (C8)</b>: awarding a graded submission writes an XpEvent and bumps the user total by
///     the frozen <c>XpForBand</c> value; the level-relative score is the basis, else the band; a
///     non-answered attempt earns nothing.</item>
///   <item><b>Leaderboard</b>: the group board ranks members by the period's XP (weekly vs all flips
///     the order deterministically); the global board surfaces the current student's own row.</item>
///   <item><b>Streak</b>: consecutive-day practice increments; a same-day repeat is a no-op; a
///     multiple-of-5 day earns a freeze; a gap is bridged by a freeze, and breaks (resets to 1) when
///     none is left — longest never regresses.</item>
///   <item><b>SRS</b>: the due-queue returns due, open reviews; scheduling completes the prior open
///     review and enqueues one for the weakest skill dimension a day out.</item>
///   <item><b>Notifications</b>: list (newest first / unread-only), unread-count, mark-one/all read,
///     delete-one/clear-all — a foreign notification is never touched (404).</item>
///   <item><b>Auth negatives</b>: anonymous ⇒ 401; a student POSTing /review ⇒ 403.</item>
/// </list>
///
/// Every seeded row is removed in a finally so the run is idempotent.
/// </summary>
[Collection(PerRunDatabaseFixture.CollectionName)]
public sealed class EngagementEndpointsTests : IClassFixture<EngagementEndpointsTests.EngagementApiFactory>, IDisposable
{
    private readonly EngagementApiFactory _factory;
    private readonly NpgsqlDataSource _dataSource;
    private const string Password = "Engagement!123";

    public EngagementEndpointsTests(EngagementApiFactory factory)
    {
        _factory = factory;
        _dataSource = GovoriDataSourceFactory.Build(factory.ConnectionString);
    }

    private GovoriDbContext CreateContext()
    {
        var builder = new DbContextOptionsBuilder<GovoriDbContext>();
        builder.UseGovori(_dataSource);
        return new GovoriDbContext(builder.Options);
    }

    // ─── XP (C8) ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Xp_award_writes_event_and_updates_total_with_C8_values()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subHigh = Guid.NewGuid();   // level_score 88 → 22 XP
        var subBand = Guid.NewGuid();   // level_score null, band 52 → 13 XP
        var subTeacher = Guid.NewGuid(); // teacher run → 0 XP, no streak

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subHigh, studentId, questionId));
            ctx.Submissions.Add(NewSubmission(subBand, studentId, questionId));
            ctx.Submissions.Add(NewSubmission(subTeacher, teacherId, questionId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            // level_score 88 → XpForBand(88) = 22.
            await using (var ctx = CreateContext())
            {
                var svc = new EngagementService(ctx);
                var sub = new Submission { Id = subHigh, StudentId = studentId };
                var eval = new Evaluation { FluencyScore = 80, LexicalScore = 80, GrammarScore = 80, OverallBand = 70, LevelScore = 88 };
                await svc.AwardSubmissionAsync(sub, eval, answered: true, today: new DateOnly(2025, 3, 1));
            }
            await using (var ctx = CreateContext())
            {
                Assert.Equal(22, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync());
                var ev = await ctx.XpEvents.SingleAsync(e => e.SubmissionId == subHigh);
                Assert.Equal(22, ev.Amount);
                Assert.Equal("submission", ev.Reason);
                Assert.Equal(studentId, ev.StudentId);
                // Streak rolled on the first practice day.
                Assert.Equal(1, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.CurrentStreak).FirstAsync());
            }

            // level_score null → basis falls back to overall_band 52 → XpForBand(52) = 13. Total 35.
            await using (var ctx = CreateContext())
            {
                var svc = new EngagementService(ctx);
                var sub = new Submission { Id = subBand, StudentId = studentId };
                var eval = new Evaluation { FluencyScore = 80, LexicalScore = 80, GrammarScore = 80, OverallBand = 52, LevelScore = null };
                await svc.AwardSubmissionAsync(sub, eval, answered: true, today: new DateOnly(2025, 3, 1));
            }
            await using (var ctx = CreateContext())
            {
                Assert.Equal(35, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync());
                Assert.Equal(13, await ctx.XpEvents.Where(e => e.SubmissionId == subBand).Select(e => e.Amount).SingleAsync());
            }

            // Non-answered attempt → no XP, no event.
            await using (var ctx = CreateContext())
            {
                var svc = new EngagementService(ctx);
                var sub = new Submission { Id = subHigh, StudentId = studentId };
                var eval = new Evaluation { FluencyScore = 80, LexicalScore = 80, GrammarScore = 80, OverallBand = 90, LevelScore = 90 };
                await svc.AwardSubmissionAsync(sub, eval, answered: false, today: new DateOnly(2025, 3, 2));
            }
            // Teacher run → no XP (only students accrue).
            await using (var ctx = CreateContext())
            {
                var svc = new EngagementService(ctx);
                var sub = new Submission { Id = subTeacher, StudentId = teacherId };
                var eval = new Evaluation { FluencyScore = 90, LexicalScore = 90, GrammarScore = 90, OverallBand = 90, LevelScore = 90 };
                await svc.AwardSubmissionAsync(sub, eval, answered: true, today: new DateOnly(2025, 3, 1));
            }
            await using (var ctx = CreateContext())
            {
                Assert.Equal(35, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync());
                Assert.Equal(0, await ctx.Users.Where(u => u.Id == teacherId).Select(u => u.Xp).FirstAsync());
                Assert.Equal(0, await ctx.XpEvents.CountAsync(e => e.StudentId == teacherId));
                // Only the two answered student submissions produced events.
                Assert.Equal(2, await ctx.XpEvents.CountAsync(e => e.StudentId == studentId));
            }
        }
        finally
        {
            await CleanupUsersAsync(studentId, teacherId);
        }
    }

    // ─── XP reward wiring (grading pipeline → IGradingRewarder) ─────────────────

    [Fact]
    public async Task Grading_reward_awards_xp_once_and_is_idempotent_on_re_run()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();   // graded, level_score 88 → XpForBand(88) = 22

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            var now = DateTime.UtcNow;
            // A graded submission = a persisted Evaluation + a non-blank Transcript (answered).
            ctx.Evaluations.Add(new Evaluation
            {
                Id = Guid.NewGuid(), SubmissionId = subId,
                FluencyScore = 80, LexicalScore = 80, GrammarScore = 80,
                OverallBand = 70, LevelScore = 88, CreatedAt = now, UpdatedAt = now,
            });
            ctx.Transcripts.Add(new Transcript
            {
                Id = Guid.NewGuid(), SubmissionId = subId,
                Text = "привет как дела", CreatedAt = now, UpdatedAt = now,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            // First reward: the student earns the graded XP + one submission event.
            await using (var ctx = CreateContext())
                await new SubmissionRewarder(ctx, new EngagementService(ctx)).RewardGradedAsync(subId);

            await using (var ctx = CreateContext())
            {
                Assert.Equal(22, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync());
                Assert.Equal(1, await ctx.XpEvents.CountAsync(e => e.SubmissionId == subId && e.Reason == "submission"));
            }

            // Re-run (Hangfire retry / crash-resume): the idempotency guard must NOT double-award.
            await using (var ctx = CreateContext())
                await new SubmissionRewarder(ctx, new EngagementService(ctx)).RewardGradedAsync(subId);

            await using (var ctx = CreateContext())
            {
                Assert.Equal(22, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync());
                Assert.Equal(1, await ctx.XpEvents.CountAsync(e => e.SubmissionId == subId && e.Reason == "submission"));
            }
        }
        finally
        {
            await CleanupUsersAsync(studentId, teacherId);
        }
    }

    // ─── Leaderboard ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Leaderboard_group_ranks_by_period_and_global_surfaces_me()
    {
        var teacherId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var s1 = Guid.NewGuid();   // weekly 50, total 50
        var s2 = Guid.NewGuid();   // weekly 10, total 110 (100 is >7d old)
        var s3 = Guid.NewGuid();   // weekly 90, total 90
        var outsiderId = Guid.NewGuid();  // NOT a member of the group
        var questionId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        var old = now.AddDays(-10);

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(s1, UserRole.Student, hasher.Hash(Password), "Alpha", xp: 50));
            ctx.Users.Add(NewUser(s2, UserRole.Student, hasher.Hash(Password), "Bravo", xp: 110));
            ctx.Users.Add(NewUser(s3, UserRole.Student, hasher.Hash(Password), "Charlie", xp: 90));
            ctx.Users.Add(NewUser(outsiderId, UserRole.Student, hasher.Hash(Password), "Outsider"));
            ctx.Groups.Add(new Group { Id = groupId, TeacherId = teacherId, Name = "LB Group", JoinCode = $"LB{groupId:N}".Substring(0, 6).ToUpperInvariant(), CreatedAt = now, UpdatedAt = now });
            foreach (var sid in new[] { s1, s2, s3 })
                ctx.GroupMembers.Add(new GroupMember { Id = Guid.NewGuid(), GroupId = groupId, StudentId = sid, CreatedAt = now, UpdatedAt = now });
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            await ctx.SaveChangesAsync();

            // Each student gets an assignment in THIS group + a submission linked to it + xp event(s).
            foreach (var sid in new[] { s1, s2, s3 })
            {
                var aId = Guid.NewGuid();
                var subId = Guid.NewGuid();
                ctx.Assignments.Add(new Assignment { Id = aId, TeacherId = teacherId, StudentId = sid, QuestionId = questionId, GroupId = groupId, CreatedAt = now, UpdatedAt = now });
                ctx.Submissions.Add(new Submission { Id = subId, StudentId = sid, QuestionId = questionId, AssignmentId = aId, AudioKey = $"a/{subId:N}.webm", Status = SubmissionStatus.Done, CreatedAt = now, UpdatedAt = now });
                if (sid == s1) AddXp(ctx, s1, subId, 50, now);
                else if (sid == s3) AddXp(ctx, s3, subId, 90, now);
                else { AddXp(ctx, s2, subId, 100, old); AddXp(ctx, s2, subId, 10, now); }
            }
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenTeacher = TokenFor(teacherId);
            var tokenS3 = TokenFor(s3);
            var tokenOutsider = TokenFor(outsiderId);

            // Anonymous → 401.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/leaderboard")).StatusCode);

            // Group weekly: S3 (90) > S1 (50) > S2 (10).
            var weekly = await GetLeaderboard(client, tokenTeacher, $"/api/leaderboard?group_id={groupId}&period=weekly");
            AssertGroupOrder(weekly, new[] { (s3, 1, 90, 90), (s1, 2, 50, 50), (s2, 3, 10, 110) });

            // Group all-time: S2 (110) > S3 (90) > S1 (50).
            var all = await GetLeaderboard(client, tokenTeacher, $"/api/leaderboard?group_id={groupId}&period=all");
            AssertGroupOrder(all, new[] { (s2, 1, 10, 110), (s3, 2, 90, 90), (s1, 3, 50, 50) });

            // A non-member student requesting this group's board → 403.
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Get, $"/api/leaderboard?group_id={groupId}", tokenOutsider)).StatusCode);

            // Global board as S3: the current student's own row is present with the right all-time +
            // weekly totals, regardless of how many other students exist.
            var global = await GetLeaderboard(client, tokenS3, "/api/leaderboard");
            var me = global.Single(e => e.GetProperty("is_me").GetBoolean());
            Assert.Equal(s3, me.GetProperty("id").GetGuid());
            Assert.Equal(90, me.GetProperty("xp").GetInt32());
            Assert.Equal(90, me.GetProperty("weekly_xp").GetInt32());
            Assert.True(me.GetProperty("rank").GetInt32() >= 1);
        }
        finally
        {
            await using var ctx = CreateContext();
            var ids = new[] { teacherId, s1, s2, s3, outsiderId };
            await ctx.XpEvents.Where(e => ids.Contains(e.StudentId)).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => ids.Contains(s.StudentId)).ExecuteDeleteAsync();
            await ctx.Assignments.Where(a => a.TeacherId == teacherId).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => gm.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == questionId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ─── Progress: skills breakdown (Ko'nikmalar tab) ───────────────────────────

    [Fact]
    public async Task Progress_skills_four_skills_level_trend_and_empty_history_safe()
    {
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();     // graded history across 2 ISO weeks
        var emptyId = Guid.NewGuid();       // no evaluations at all
        var questionId = Guid.NewGuid();
        var sub1 = Guid.NewGuid();          // ISO 2025-W02
        var sub2 = Guid.NewGuid();          // ISO 2025-W03
        var weekA = new DateTime(2025, 1, 7, 9, 0, 0, DateTimeKind.Utc);
        var weekB = new DateTime(2025, 1, 14, 9, 0, 0, DateTimeKind.Utc);

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password), "Skills Student"));
            ctx.Users.Add(NewUser(emptyId, UserRole.Student, hasher.Hash(Password), "No History"));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmissionAt(sub1, studentId, questionId, weekA));
            ctx.Submissions.Add(NewSubmissionAt(sub2, studentId, questionId, weekB));
            // Pronunciation NULL on BOTH → the pronunciation skill must average to 0 (unscored), never crash.
            ctx.Evaluations.Add(NewEvaluation(sub1, fluency: 80, pronunciation: null, lexical: 60, grammar: 70, overall: 66, at: weekA));
            ctx.Evaluations.Add(NewEvaluation(sub2, fluency: 60, pronunciation: null, lexical: 80, grammar: 50, overall: 62, at: weekB));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // Anonymous → 401.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/progress/skills")).StatusCode);

            // Student WITH history.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/skills", TokenFor(studentId))).Content.ReadAsStringAsync()))
            {
                var root = doc.RootElement;

                // Four skills, ALWAYS present, in the fixed order.
                var skills = root.GetProperty("skills").EnumerateArray().ToList();
                Assert.Equal(4, skills.Count);
                Assert.Equal(new[] { "fluency", "pronunciation", "lexical", "grammar" },
                    skills.Select(s => s.GetProperty("key").GetString()).ToArray());
                Assert.Equal(70, skills[0].GetProperty("score").GetInt32());   // (80+60)/2
                Assert.Equal(0, skills[1].GetProperty("score").GetInt32());    // pronunciation all-null → 0
                Assert.Equal(70, skills[2].GetProperty("score").GetInt32());   // (60+80)/2
                Assert.Equal(60, skills[3].GetProperty("score").GetInt32());   // (70+50)/2

                // Level derived from the average band (64.0) via the shared CefrScale → B1.
                Assert.Equal(64.0, root.GetProperty("band").GetDouble(), 3);
                Assert.Equal("B1", root.GetProperty("level").GetString());
                Assert.False(string.IsNullOrEmpty(root.GetProperty("level_label").GetString()));

                // Trend: two ISO-week buckets, oldest→newest, 0-based index.
                var trend = root.GetProperty("trend").EnumerateArray().ToList();
                Assert.Equal(2, trend.Count);
                Assert.Equal(new[] { 0, 1 }, trend.Select(t => t.GetProperty("week_index").GetInt32()).ToArray());
                Assert.Equal(66.0, trend[0].GetProperty("band").GetDouble(), 3);
                Assert.Equal(62.0, trend[1].GetProperty("band").GetDouble(), 3);

                // band_delta = band(64.0) − earliest-window band(66.0) = −2.0 over 2 weeks.
                Assert.Equal(-2.0, root.GetProperty("band_delta").GetDouble(), 3);
                Assert.Equal(2, root.GetProperty("delta_weeks").GetInt32());
            }

            // Empty-history student: four skills all 0, level/band/delta null, delta_weeks 0, no trend.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/skills", TokenFor(emptyId))).Content.ReadAsStringAsync()))
            {
                var root = doc.RootElement;
                var skills = root.GetProperty("skills").EnumerateArray().ToList();
                Assert.Equal(new[] { "fluency", "pronunciation", "lexical", "grammar" },
                    skills.Select(s => s.GetProperty("key").GetString()).ToArray());
                Assert.All(skills, s => Assert.Equal(0, s.GetProperty("score").GetInt32()));
                Assert.Equal(JsonValueKind.Null, root.GetProperty("level").ValueKind);
                Assert.Equal(JsonValueKind.Null, root.GetProperty("band").ValueKind);
                Assert.Equal(JsonValueKind.Null, root.GetProperty("band_delta").ValueKind);
                Assert.Equal(0, root.GetProperty("delta_weeks").GetInt32());
                Assert.Empty(root.GetProperty("trend").EnumerateArray());
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            var ids = new[] { teacherId, studentId, emptyId };
            await ctx.Evaluations.Where(e => e.SubmissionId == sub1 || e.SubmissionId == sub2).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => ids.Contains(s.StudentId)).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == questionId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ─── Progress: leaderboard summary (Reyting tab) ─────────────────────────────

    [Fact]
    public async Task Progress_leaderboard_summary_ranks_percentile_league_and_neighbors_include_me()
    {
        // Five students with astronomically high, DISTINCT weekly XP so they deterministically occupy
        // the top five ranks of the global student board, whatever the seeded population beneath them.
        var sA = Guid.NewGuid();   // weekly 5_000_050 → rank 1
        var sB = Guid.NewGuid();   // weekly 5_000_040 → rank 2
        var sC = Guid.NewGuid();   // weekly 5_000_030 → rank 3 (the caller)
        var sD = Guid.NewGuid();   // weekly 5_000_020 → rank 4
        var sE = Guid.NewGuid();   // weekly 5_000_010 → rank 5
        var order = new[] { sA, sB, sC, sD, sE };
        var xp = new Dictionary<Guid, int>
        {
            [sA] = 5_000_050, [sB] = 5_000_040, [sC] = 5_000_030, [sD] = 5_000_020, [sE] = 5_000_010,
        };
        var now = DateTime.UtcNow;

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            foreach (var id in order)
            {
                ctx.Users.Add(NewUser(id, UserRole.Student, hasher.Hash(Password), $"LB {id:N}".Substring(0, 8), xp: xp[id]));
                // One recent XpEvent = the whole weekly total (dated now → inside the 7-day window).
                ctx.XpEvents.Add(new XpEvent { Id = Guid.NewGuid(), StudentId = id, SubmissionId = null, Amount = xp[id], Reason = "submission", CreatedAt = now, UpdatedAt = now });
            }
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // Anonymous → 401.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/progress/leaderboard")).StatusCode);

            // Caller = sC (the middle of the cluster) on the WEEKLY board.
            var scResp = await Send(client, HttpMethod.Get, "/api/progress/leaderboard?period=weekly", TokenFor(sC));
            var scBody = await scResp.Content.ReadAsStringAsync();
            Assert.True(scResp.StatusCode == HttpStatusCode.OK, $"weekly board status {scResp.StatusCode}: {scBody}");
            using (var doc = JsonDocument.Parse(scBody))
            {
                var root = doc.RootElement;
                Assert.Equal("weekly", root.GetProperty("period").GetString());

                var myRank = root.GetProperty("my_rank").GetInt32();
                var total = root.GetProperty("total_students").GetInt32();
                Assert.Equal(3, myRank);                                   // exactly sA, sB strictly ahead
                Assert.True(total >= 5);
                Assert.Equal(5_000_030, root.GetProperty("my_xp").GetInt32());

                // percentile = ceil(my_rank / total * 100), clamped 1..100; league derived from it.
                var expectedPct = Math.Clamp((int)Math.Ceiling((double)myRank / total * 100), 1, 100);
                Assert.Equal(expectedPct, root.GetProperty("percentile").GetInt32());
                var expectedLeague = expectedPct <= 10 ? "gold" : expectedPct <= 35 ? "silver" : "bronze";
                Assert.Equal(expectedLeague, root.GetProperty("league").GetString());

                // Neighbours: 2 above + me + 2 below, ascending by rank; the caller present exactly once.
                var neighbors = root.GetProperty("neighbors").EnumerateArray().ToList();
                Assert.Equal(5, neighbors.Count);
                Assert.Equal(new[] { 1, 2, 3, 4, 5 }, neighbors.Select(n => n.GetProperty("rank").GetInt32()).ToArray());
                Assert.Equal(new[] { sA, sB, sC, sD, sE }, neighbors.Select(n => n.GetProperty("id").GetGuid()).ToArray());
                Assert.Equal(1, neighbors.Count(n => n.GetProperty("is_me").GetBoolean()));
                var me = neighbors[2];                                     // rank 3 = index 2
                Assert.True(me.GetProperty("is_me").GetBoolean());
                Assert.Equal(sC, me.GetProperty("id").GetGuid());
                Assert.Equal(5_000_030, me.GetProperty("xp").GetInt32());

                // rank_delta is best-effort but computed (non-null) on a bounded period.
                Assert.Equal(JsonValueKind.Number, root.GetProperty("rank_delta").ValueKind);
            }

            // Caller = sA (top of the cluster ⇒ global rank 1): the window CLAMPS to me + four below.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/leaderboard?period=weekly", TokenFor(sA))).Content.ReadAsStringAsync()))
            {
                var root = doc.RootElement;
                Assert.Equal(1, root.GetProperty("my_rank").GetInt32());
                var neighbors = root.GetProperty("neighbors").EnumerateArray().ToList();
                Assert.Equal(5, neighbors.Count);
                Assert.Equal(new[] { 1, 2, 3, 4, 5 }, neighbors.Select(n => n.GetProperty("rank").GetInt32()).ToArray());
                Assert.Equal(new[] { sA, sB, sC, sD, sE }, neighbors.Select(n => n.GetProperty("id").GetGuid()).ToArray());
                Assert.True(neighbors[0].GetProperty("is_me").GetBoolean());  // rank 1 is me, first row
            }

            // period=all ⇒ ranking by User.Xp; rank_delta null (no previous period).
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/leaderboard?period=all", TokenFor(sC))).Content.ReadAsStringAsync()))
            {
                var root = doc.RootElement;
                Assert.Equal("all", root.GetProperty("period").GetString());
                Assert.Equal(3, root.GetProperty("my_rank").GetInt32());
                Assert.Equal(JsonValueKind.Null, root.GetProperty("rank_delta").ValueKind);
            }

            // A non-student (teacher) caller → 403 (the ranking population is students).
            var teacherId = Guid.NewGuid();
            await using (var ctx = CreateContext())
            {
                ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, new PasswordHasher().Hash(Password)));
                await ctx.SaveChangesAsync();
            }
            try
            {
                Assert.Equal(HttpStatusCode.Forbidden,
                    (await Send(client, HttpMethod.Get, "/api/progress/leaderboard", TokenFor(teacherId))).StatusCode);
            }
            finally
            {
                await using var ctx = CreateContext();
                await ctx.Users.Where(u => u.Id == teacherId).ExecuteDeleteAsync();
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.XpEvents.Where(e => order.Contains(e.StudentId)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => order.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ─── Streak ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Streak_increments_bridges_freezes_and_breaks()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();
        var d = new DateOnly(2025, 1, 1);

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            // Day 1 (last = null) → streak 1.
            await Practice(subId, studentId, d);
            await AssertStreak(studentId, current: 1, longest: 1, freezes: 0);

            // Day 2 (gap 1) → streak 2.
            await Practice(subId, studentId, d.AddDays(1));
            await AssertStreak(studentId, current: 2, longest: 2, freezes: 0);

            // Same day again → streak unchanged, but XP still added.
            var xpBefore = await Xp(studentId);
            await Practice(subId, studentId, d.AddDays(1));
            await AssertStreak(studentId, current: 2, longest: 2, freezes: 0);
            Assert.Equal(xpBefore + EngagementService.PracticeXp, await Xp(studentId));

            // Days 3,4,5 (consecutive) → streak 5, earns a freeze on the 5th.
            await Practice(subId, studentId, d.AddDays(2));
            await Practice(subId, studentId, d.AddDays(3));
            await Practice(subId, studentId, d.AddDays(4));
            await AssertStreak(studentId, current: 5, longest: 5, freezes: 1);

            // Skip day 6, practice day 7 (gap 2, missed 1) → the freeze bridges it: streak 6, freezes 0.
            await Practice(subId, studentId, d.AddDays(6));
            await AssertStreak(studentId, current: 6, longest: 6, freezes: 0);

            // Skip days 8,9, practice day 10 (gap 3, missed 2) → no freeze left → streak resets to 1;
            // longest is preserved at 6.
            await Practice(subId, studentId, d.AddDays(9));
            await AssertStreak(studentId, current: 1, longest: 6, freezes: 0);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.XpEvents.Where(e => e.StudentId == studentId).ExecuteDeleteAsync();
            await CleanupSubmissionsQuestionUsers(ctx, questionId, studentId, teacherId);
        }
    }

    /// <summary>
    /// The S6 fix, through the real writer: an answer at 23:30 and another at 00:30 Tashkent time
    /// (18:30Z and 19:30Z) are TWO consecutive streak days. Under the old UTC-day rule both instants
    /// were the same date, the second award hit "already counted today", and the student's evening
    /// earned one day instead of two. The instants go through <c>StreakRules.Today(utcNow)</c> — the
    /// same function the writer's default and every reader call.
    /// </summary>
    [Fact]
    public async Task Answers_either_side_of_Tashkent_midnight_are_two_streak_days()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();
        var lateEvening = new DateTime(2025, 3, 1, 18, 30, 0, DateTimeKind.Utc);   // 23:30 local, 1 Mar
        var afterMidnight = new DateTime(2025, 3, 1, 19, 30, 0, DateTimeKind.Utc); // 00:30 local, 2 Mar

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            // The contrast being fixed: one UTC date for both answers.
            Assert.Equal(DateOnly.FromDateTime(lateEvening), DateOnly.FromDateTime(afterMidnight));

            await Practice(subId, studentId, Govori.Contracts.StreakRules.Today(lateEvening));
            await AssertStreak(studentId, current: 1, longest: 1, freezes: 0);

            await Practice(subId, studentId, Govori.Contracts.StreakRules.Today(afterMidnight));
            await AssertStreak(studentId, current: 2, longest: 2, freezes: 0);

            await using var ctx = CreateContext();
            Assert.Equal(
                new DateOnly(2025, 3, 2),
                await ctx.Users.Where(u => u.Id == studentId).Select(u => u.LastPracticeDate).FirstAsync());
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.XpEvents.Where(e => e.StudentId == studentId).ExecuteDeleteAsync();
            await CleanupSubmissionsQuestionUsers(ctx, questionId, studentId, teacherId);
        }
    }

    /// <summary>
    /// The worker passes no <c>today</c>: the day it records must be the one the READ paths judge the
    /// streak against (<c>StreakRules.Today()</c>, the product day), never a separately computed UTC
    /// date — a writer and readers on different calendars disagree for five hours of every day. The
    /// clock is live here, so the check brackets the call rather than racing midnight.
    /// </summary>
    [Fact]
    public async Task The_workers_default_day_is_the_day_the_readers_use()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var before = Govori.Contracts.StreakRules.Today();
            await using (var ctx = CreateContext())
                await new EngagementService(ctx).AwardPracticeAsync(new Submission { Id = subId, StudentId = studentId });
            var after = Govori.Contracts.StreakRules.Today();

            await using var read = CreateContext();
            var written = await read.Users.Where(u => u.Id == studentId).Select(u => u.LastPracticeDate).FirstAsync();
            Assert.NotNull(written);
            Assert.True(written == before || written == after, $"wrote {written}, product day was {before}..{after}");
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.XpEvents.Where(e => e.StudentId == studentId).ExecuteDeleteAsync();
            await CleanupSubmissionsQuestionUsers(ctx, questionId, studentId, teacherId);
        }
    }

    // ─── SRS review queue + scheduling + notifications + auth negatives ─────────

    [Fact]
    public async Task Review_queue_scheduling_notifications_and_auth_negatives()
    {
        var teacherId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var studentId = Guid.NewGuid();      // on the teacher's roster
        var outsiderId = Guid.NewGuid();     // not on the roster
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password), "Roster Student"));
            ctx.Users.Add(NewUser(outsiderId, UserRole.Student, hasher.Hash(Password), "Outsider"));
            ctx.Groups.Add(new Group { Id = groupId, TeacherId = teacherId, Name = "Rev Group", JoinCode = $"RV{groupId:N}".Substring(0, 6).ToUpperInvariant(), CreatedAt = now, UpdatedAt = now });
            ctx.GroupMembers.Add(new GroupMember { Id = Guid.NewGuid(), GroupId = groupId, StudentId = studentId, CreatedAt = now, UpdatedAt = now });
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var tokenTeacher = TokenFor(teacherId);
            var tokenStudent = TokenFor(studentId);

            // Auth negatives: anonymous → 401; student POST /review → 403 (require_teacher).
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/review")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Post, "/api/review", tokenStudent, Json(new { question_ids = new[] { questionId } }))).StatusCode);

            // Teacher queues a review for the rostered student → 201, tagged "teacher", due now.
            var createResp = await Send(client, HttpMethod.Post, "/api/review", tokenTeacher,
                Json(new { question_ids = new[] { questionId }, student_ids = new[] { studentId } }));
            Assert.Equal(HttpStatusCode.Created, createResp.StatusCode);
            using (var doc = JsonDocument.Parse(await createResp.Content.ReadAsStringAsync()))
            {
                var rows = doc.RootElement.EnumerateArray().ToList();
                Assert.Single(rows);
                Assert.Equal(questionId, rows[0].GetProperty("question_id").GetGuid());
                Assert.Equal("teacher", rows[0].GetProperty("weakness_dim").GetString());
            }

            // Targeting only the outsider → filtered out → 400 (no valid targets).
            Assert.Equal(HttpStatusCode.BadRequest,
                (await Send(client, HttpMethod.Post, "/api/review", tokenTeacher,
                    Json(new { question_ids = new[] { questionId }, student_ids = new[] { outsiderId } }))).StatusCode);

            // Re-queueing the same (student, question) with an open review → 201 with an empty list.
            using (var dup = JsonDocument.Parse(await (await Send(client, HttpMethod.Post, "/api/review", tokenTeacher,
                Json(new { question_ids = new[] { questionId }, student_ids = new[] { studentId } }))).Content.ReadAsStringAsync()))
                Assert.Empty(dup.RootElement.EnumerateArray());

            // The student's due-queue returns the open, due "teacher" review with question metadata.
            using (var queue = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/review", tokenStudent)).Content.ReadAsStringAsync()))
            {
                var item = queue.RootElement.EnumerateArray().Single(r => r.GetProperty("question_id").GetGuid() == questionId);
                Assert.Equal("teacher", item.GetProperty("weakness_dim").GetString());
                Assert.False(string.IsNullOrEmpty(item.GetProperty("question_title").GetString()));
            }

            // The student was notified once (review_added) — list + unread-count + mark-read.
            Guid notifId;
            using (var notes = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications?unread_only=true", tokenStudent)).Content.ReadAsStringAsync()))
            {
                var note = notes.RootElement.EnumerateArray().Single(n => n.GetProperty("type").GetString() == "review_added");
                notifId = note.GetProperty("id").GetGuid();
                Assert.Equal("/review", note.GetProperty("link").GetString());
                Assert.False(note.GetProperty("is_read").GetBoolean());
            }
            using (var cnt = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications/unread-count", tokenStudent)).Content.ReadAsStringAsync()))
                Assert.True(cnt.RootElement.GetProperty("count").GetInt32() >= 1);

            // A foreign notification id (teacher marking the student's) → 404, never touches it.
            Assert.Equal(HttpStatusCode.NotFound,
                (await Send(client, HttpMethod.Post, $"/api/notifications/{notifId}/read", tokenTeacher)).StatusCode);
            // The owner marks it read → 204.
            Assert.Equal(HttpStatusCode.NoContent,
                (await Send(client, HttpMethod.Post, $"/api/notifications/{notifId}/read", tokenStudent)).StatusCode);
            await using (var ctx = CreateContext())
                Assert.True(await ctx.Notifications.Where(n => n.Id == notifId).Select(n => n.IsRead).SingleAsync());

            // ── Scheduling: a graded answer with a weak "fluency" dim completes the open review and
            //    enqueues a fresh one for the weakest dimension, due a day out. ──
            await using (var ctx = CreateContext())
            {
                var svc = new EngagementService(ctx);
                var sub = new Submission { Id = subId, StudentId = studentId, QuestionId = questionId };
                var eval = new Evaluation { FluencyScore = 50, LexicalScore = 80, GrammarScore = 80, RelevanceScore = 90 };
                await svc.ScheduleReviewAsync(sub, eval);
            }
            await using (var ctx = CreateContext())
            {
                // Prior "teacher" review is now completed.
                Assert.True(await ctx.ReviewItems.Where(r => r.StudentId == studentId && r.WeaknessDim == "teacher").AllAsync(r => r.Completed));
                // A new open review for the weakest dim (fluency), interval 0, due ~ +1 day.
                var fresh = await ctx.ReviewItems.SingleAsync(r => r.StudentId == studentId && r.WeaknessDim == "fluency" && !r.Completed);
                Assert.Equal(0, fresh.IntervalIndex);
                Assert.Equal(questionId, fresh.QuestionId);
                Assert.True(fresh.DueAt > DateTime.UtcNow.AddHours(12));
            }
            // The fresh review is not yet due, so the student's queue no longer surfaces this question.
            using (var queue = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/review", tokenStudent)).Content.ReadAsStringAsync()))
                Assert.DoesNotContain(queue.RootElement.EnumerateArray(), r => r.GetProperty("question_id").GetGuid() == questionId);
        }
        finally
        {
            await using var ctx = CreateContext();
            var ids = new[] { teacherId, studentId, outsiderId };
            await ctx.ReviewItems.Where(r => ids.Contains(r.StudentId)).ExecuteDeleteAsync();
            await ctx.Notifications.Where(n => ids.Contains(n.UserId)).ExecuteDeleteAsync();
            await ctx.XpEvents.Where(e => ids.Contains(e.StudentId)).ExecuteDeleteAsync();
            await ctx.Submissions.Where(s => ids.Contains(s.StudentId)).ExecuteDeleteAsync();
            await ctx.GroupMembers.Where(gm => gm.GroupId == groupId).ExecuteDeleteAsync();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == questionId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Notifications_list_filter_mark_delete_and_clear()
    {
        var userId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        var nRead = Guid.NewGuid();
        var nUnread1 = Guid.NewGuid();
        var nUnread2 = Guid.NewGuid();
        var nForeign = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(userId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(otherId, UserRole.Student, hasher.Hash(Password), "Other"));
            ctx.Notifications.Add(NewNotification(nRead, userId, "result_ready", isRead: true, at: now.AddMinutes(-30)));
            ctx.Notifications.Add(NewNotification(nUnread1, userId, "assignment_new", isRead: false, at: now.AddMinutes(-10)));
            ctx.Notifications.Add(NewNotification(nUnread2, userId, "assignment_new", isRead: false, at: now));   // newest
            ctx.Notifications.Add(NewNotification(nForeign, otherId, "assignment_new", isRead: false, at: now));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var token = TokenFor(userId);
            var otherToken = TokenFor(otherId);

            // Anonymous → 401.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notifications")).StatusCode);

            // Full list, newest first — three of mine, never the foreign one.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications", token)).Content.ReadAsStringAsync()))
            {
                var ids = doc.RootElement.EnumerateArray().Select(n => n.GetProperty("id").GetGuid()).ToList();
                Assert.Equal(new[] { nUnread2, nUnread1, nRead }, ids.Where(i => i == nUnread2 || i == nUnread1 || i == nRead).ToArray());
                Assert.DoesNotContain(nForeign, ids);
            }

            // unread_only filter → exactly the two unread.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications?unread_only=true", token)).Content.ReadAsStringAsync()))
            {
                var ids = doc.RootElement.EnumerateArray().Select(n => n.GetProperty("id").GetGuid()).ToHashSet();
                Assert.Contains(nUnread1, ids);
                Assert.Contains(nUnread2, ids);
                Assert.DoesNotContain(nRead, ids);
            }

            // unread-count = 2.
            using (var cnt = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications/unread-count", token)).Content.ReadAsStringAsync()))
                Assert.Equal(2, cnt.RootElement.GetProperty("count").GetInt32());

            // Delete one unread → 204; a foreign delete → 404.
            Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, $"/api/notifications/{nUnread1}", token)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Delete, $"/api/notifications/{nForeign}", token)).StatusCode);

            // Mark-all read → 204, then unread-count = 0.
            Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Post, "/api/notifications/read-all", token)).StatusCode);
            using (var cnt = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications/unread-count", token)).Content.ReadAsStringAsync()))
                Assert.Equal(0, cnt.RootElement.GetProperty("count").GetInt32());

            // Clear-all → 204; the list is now empty, while the foreign notification is untouched.
            Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Delete, "/api/notifications", token)).StatusCode);
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/notifications", token)).Content.ReadAsStringAsync()))
                Assert.Empty(doc.RootElement.EnumerateArray());
            await using (var ctx = CreateContext())
                Assert.Equal(1, await ctx.Notifications.CountAsync(n => n.UserId == otherId));
        }
        finally
        {
            await using var ctx = CreateContext();
            var ids = new[] { userId, otherId };
            await ctx.Notifications.Where(n => ids.Contains(n.UserId)).ExecuteDeleteAsync();
            await ctx.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    // ─── SRS scheduled BY THE GRADING REWARD (legacy schedule_review, finally wired) ──

    /// <summary>
    /// The grading reward is what puts a weak answer on the review queue. ScheduleReviewAsync existed
    /// but had no production caller, so nothing ever reached the queue on its own; the rewarder now runs
    /// it after the XP award, as legacy's worker did.
    /// </summary>
    [Fact]
    public async Task A_weak_graded_answer_is_queued_for_review_once_and_a_rerun_adds_nothing()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        var subId = Guid.NewGuid();
        var olderReviewId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(questionId, teacherId));
            ctx.Submissions.Add(NewSubmission(subId, studentId, questionId));
            // Two dims below 67; grammar (55) is the weakest. Pronunciation is not one of the four.
            SeedGraded(ctx, subId, fluency: 80, lexical: 60, grammar: 55, relevance: 90, transcript: "я иду домой");
            // An older open review of the same question: this graded attempt supersedes it.
            ctx.ReviewItems.Add(new ReviewItem
            {
                Id = olderReviewId, StudentId = studentId, QuestionId = questionId, WeaknessDim = "teacher",
                IntervalIndex = 2, DueAt = now, Completed = false, CreatedAt = now.AddDays(-3), UpdatedAt = now.AddDays(-3),
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            await using (var ctx = CreateContext())
                await new SubmissionRewarder(ctx, new EngagementService(ctx)).RewardGradedAsync(subId);

            Guid scheduledId;
            await using (var ctx = CreateContext())
            {
                var items = await ctx.ReviewItems.Where(r => r.StudentId == studentId).ToListAsync();
                Assert.Equal(2, items.Count);
                Assert.True(items.Single(r => r.Id == olderReviewId).Completed);

                var scheduled = items.Single(r => !r.Completed);
                scheduledId = scheduled.Id;
                Assert.Equal("grammar", scheduled.WeaknessDim);
                Assert.Equal(questionId, scheduled.QuestionId);
                Assert.Equal(0, scheduled.IntervalIndex);
                // First rung of [1, 3, 7, 16, 35]: due a day out.
                Assert.InRange(scheduled.DueAt, now.AddDays(1).AddMinutes(-5), DateTime.UtcNow.AddDays(1).AddMinutes(5));
                // Freshly enqueued, not "answered": the Daily drill step tells them apart this way.
                Assert.Equal(scheduled.CreatedAt, scheduled.UpdatedAt);
                // And the XP was awarded alongside it, exactly once.
                Assert.Equal(1, await ctx.XpEvents.CountAsync(e => e.SubmissionId == subId));
            }

            // Re-run (Hangfire crash-resume / retry): nothing new, and the scheduled item is left
            // alone rather than superseded by a copy of itself.
            await using (var ctx = CreateContext())
                await new SubmissionRewarder(ctx, new EngagementService(ctx)).RewardGradedAsync(subId);

            await using (var ctx = CreateContext())
            {
                var items = await ctx.ReviewItems.Where(r => r.StudentId == studentId).ToListAsync();
                Assert.Equal(2, items.Count);
                Assert.Equal(scheduledId, items.Single(r => !r.Completed).Id);
                Assert.Equal(1, await ctx.XpEvents.CountAsync(e => e.SubmissionId == subId));
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.ReviewItems.Where(r => r.StudentId == studentId).ExecuteDeleteAsync();
            await CleanupUsersAsync(studentId, teacherId);
        }
    }

    [Fact]
    public async Task A_strong_or_a_silent_answer_is_not_queued_for_review()
    {
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var strongQuestion = Guid.NewGuid();
        var silentQuestion = Guid.NewGuid();
        var strongSub = Guid.NewGuid();
        var silentSub = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            ctx.Users.Add(NewUser(studentId, UserRole.Student, hasher.Hash(Password)));
            ctx.Users.Add(NewUser(teacherId, UserRole.Teacher, hasher.Hash(Password)));
            ctx.Questions.Add(NewQuestion(strongQuestion, teacherId));
            ctx.Questions.Add(NewQuestion(silentQuestion, teacherId));
            ctx.Submissions.Add(NewSubmission(strongSub, studentId, strongQuestion));
            ctx.Submissions.Add(NewSubmission(silentSub, studentId, silentQuestion));
            // Every dim at or above the 67 threshold (67 itself is NOT weak: the rule is "< 67").
            SeedGraded(ctx, strongSub, fluency: 67, lexical: 80, grammar: 90, relevance: 75, transcript: "всё хорошо");
            // Weak everywhere, but nothing was said: no weakness to replay (and no XP either).
            SeedGraded(ctx, silentSub, fluency: 10, lexical: 10, grammar: 10, relevance: 10, transcript: "   ");
            await ctx.SaveChangesAsync();
        }

        try
        {
            foreach (var sub in new[] { strongSub, silentSub })
                await using (var ctx = CreateContext())
                    await new SubmissionRewarder(ctx, new EngagementService(ctx)).RewardGradedAsync(sub);

            await using (var ctx = CreateContext())
            {
                Assert.Equal(0, await ctx.ReviewItems.CountAsync(r => r.StudentId == studentId));
                Assert.Equal(1, await ctx.XpEvents.CountAsync(e => e.SubmissionId == strongSub));
                Assert.Equal(0, await ctx.XpEvents.CountAsync(e => e.SubmissionId == silentSub));
            }
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.ReviewItems.Where(r => r.StudentId == studentId).ExecuteDeleteAsync();
            await CleanupUsersAsync(studentId, teacherId);
        }
    }

    // ─── Streak READ paths report the streak alive today, not the stored column ──

    /// <summary>
    /// The stored streak only changes on the student's next award, so a student who stopped
    /// practising kept a "live" streak on every screen (43 such rows in the dev DB). Every read path
    /// now reports StreakRules.Effective — and reading must never spend a freeze.
    /// </summary>
    [Fact]
    public async Task A_broken_streak_reads_as_zero_on_every_surface_and_reading_spends_no_freeze()
    {
        var brokenId = Guid.NewGuid();    // last practised 10 days ago, 2 freezes: 9 missed days → broken
        var coveredId = Guid.NewGuid();   // last practised 3 days ago, 2 freezes: 2 missed days → alive
        // "Today" as the server judges it — the product day. A bare UTC date here would put the
        // covered student's gap at 4 (not 3) between 19:00Z and midnight and fail for five hours a day.
        var today = Govori.Contracts.StreakRules.Today();

        await using (var ctx = CreateContext())
        {
            var hasher = new PasswordHasher();
            // Huge XP so both sit in the global top 50 whatever else the run has seeded.
            var broken = NewUser(brokenId, UserRole.Student, hasher.Hash(Password), "Broken Streak", xp: 9_000_000);
            broken.CurrentStreak = 9;
            broken.LongestStreak = 9;
            broken.StreakFreezes = 2;
            broken.LastPracticeDate = today.AddDays(-10);
            var covered = NewUser(coveredId, UserRole.Student, hasher.Hash(Password), "Covered Streak", xp: 8_999_999);
            covered.CurrentStreak = 6;
            covered.LongestStreak = 6;
            covered.StreakFreezes = 2;
            covered.LastPracticeDate = today.AddDays(-3);
            ctx.Users.AddRange(broken, covered);
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var brokenToken = TokenFor(brokenId);

            // Global leaderboard — both rows.
            var board = await GetLeaderboard(client, brokenToken, "/api/leaderboard?period=all");
            Assert.Equal(0, board.Single(e => e.GetProperty("id").GetGuid() == brokenId).GetProperty("current_streak").GetInt32());
            Assert.Equal(6, board.Single(e => e.GetProperty("id").GetGuid() == coveredId).GetProperty("current_streak").GetInt32());

            // Progress leaderboard — the caller's own streak.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/leaderboard?period=all", brokenToken)).Content.ReadAsStringAsync()))
                Assert.Equal(0, doc.RootElement.GetProperty("current_streak").GetInt32());
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/progress/leaderboard?period=all", TokenFor(coveredId))).Content.ReadAsStringAsync()))
                Assert.Equal(6, doc.RootElement.GetProperty("current_streak").GetInt32());

            // Profile stats (Identity module — same rule through Govori.Contracts). The best run
            // ever is history and stays.
            using (var doc = JsonDocument.Parse(await (await Send(client, HttpMethod.Get, "/api/profile/stats", brokenToken)).Content.ReadAsStringAsync()))
            {
                Assert.Equal(0, doc.RootElement.GetProperty("current_streak").GetInt32());
                Assert.Equal(9, doc.RootElement.GetProperty("longest_streak").GetInt32());
            }

            // Nothing was written by reading: the columns and — above all — the freezes are intact.
            // They are spent only when the student actually comes back (UpdateStreak).
            await AssertStreak(brokenId, current: 9, longest: 9, freezes: 2);
            await AssertStreak(coveredId, current: 6, longest: 6, freezes: 2);
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Users.Where(u => u.Id == brokenId || u.Id == coveredId).ExecuteDeleteAsync();
        }
    }

    // ── helpers ──

    // A graded submission as the pipeline leaves it: an Evaluation plus a Transcript whose text
    // decides whether the student "answered".
    private static void SeedGraded(
        GovoriDbContext ctx, Guid subId, double fluency, double lexical, double grammar, double relevance, string transcript)
    {
        var now = DateTime.UtcNow;
        ctx.Evaluations.Add(new Evaluation
        {
            Id = Guid.NewGuid(), SubmissionId = subId,
            FluencyScore = fluency, LexicalScore = lexical, GrammarScore = grammar, RelevanceScore = relevance,
            PronunciationScore = 20,      // deliberately weak: pronunciation must NOT drive a review
            OverallBand = 70, LevelScore = 75, CreatedAt = now, UpdatedAt = now,
        });
        ctx.Transcripts.Add(new Transcript
        {
            Id = Guid.NewGuid(), SubmissionId = subId, Text = transcript, CreatedAt = now, UpdatedAt = now,
        });
    }

    private async Task Practice(Guid subId, Guid studentId, DateOnly today)
    {
        await using var ctx = CreateContext();
        var svc = new EngagementService(ctx);
        await svc.AwardPracticeAsync(new Submission { Id = subId, StudentId = studentId }, today: today);
    }

    private async Task AssertStreak(Guid studentId, int current, int longest, int freezes)
    {
        await using var ctx = CreateContext();
        var u = await ctx.Users.SingleAsync(x => x.Id == studentId);
        Assert.Equal(current, u.CurrentStreak);
        Assert.Equal(longest, u.LongestStreak);
        Assert.Equal(freezes, u.StreakFreezes);
    }

    private async Task<int> Xp(Guid studentId)
    {
        await using var ctx = CreateContext();
        return await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Xp).FirstAsync();
    }

    private static void AddXp(GovoriDbContext ctx, Guid studentId, Guid subId, int amount, DateTime at)
        => ctx.XpEvents.Add(new XpEvent { Id = Guid.NewGuid(), StudentId = studentId, SubmissionId = subId, Amount = amount, Reason = "submission", CreatedAt = at, UpdatedAt = at });

    private static async Task<List<JsonElement>> GetLeaderboard(HttpClient client, string token, string url)
    {
        var resp = await Send(client, HttpMethod.Get, url, token);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
    }

    // Assert the exact rank/xp/weekly_xp of each seeded student, in the returned order.
    private static void AssertGroupOrder(List<JsonElement> entries, (Guid Id, int Rank, int Weekly, int Total)[] expected)
    {
        var mine = entries.Where(e => expected.Any(x => x.Id == e.GetProperty("id").GetGuid())).ToList();
        Assert.Equal(expected.Length, mine.Count);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].Id, mine[i].GetProperty("id").GetGuid());
            Assert.Equal(expected[i].Rank, mine[i].GetProperty("rank").GetInt32());
            Assert.Equal(expected[i].Weekly, mine[i].GetProperty("weekly_xp").GetInt32());
            Assert.Equal(expected[i].Total, mine[i].GetProperty("xp").GetInt32());
        }
    }

    private async Task CleanupUsersAsync(Guid studentId, Guid teacherId)
    {
        await using var ctx = CreateContext();
        await ctx.XpEvents.Where(e => e.StudentId == studentId || e.StudentId == teacherId).ExecuteDeleteAsync();
        await ctx.Submissions.Where(s => s.StudentId == studentId || s.StudentId == teacherId).ExecuteDeleteAsync();
        await ctx.Questions.Where(q => q.TeacherId == teacherId).ExecuteDeleteAsync();
        await ctx.Users.Where(u => u.Id == studentId || u.Id == teacherId).ExecuteDeleteAsync();
    }

    private static async Task CleanupSubmissionsQuestionUsers(GovoriDbContext ctx, Guid questionId, params Guid[] userIds)
    {
        await ctx.Submissions.Where(s => userIds.Contains(s.StudentId)).ExecuteDeleteAsync();
        await ctx.Questions.Where(q => q.Id == questionId).ExecuteDeleteAsync();
        await ctx.Users.Where(u => userIds.Contains(u.Id)).ExecuteDeleteAsync();
    }

    // Auth is phone-OTP now (no email/password login). These non-auth tests only need a bearer for a
    // seeded user, so mint the SAME access token login used to return (sub = user id) with the test secret.
    private static string TokenFor(Guid userId) =>
        new TokenService(new IdentityAuthOptions { SecretKey = EngagementApiFactory.TestSecretKey })
            .CreateAccessToken(userId.ToString());

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var req = new HttpRequestMessage(method, url) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(req);
    }

    private static HttpContent Json(object body) => JsonContent.Create(body);

    private static string Email(Guid id) => $"eng-{id:N}@example.test";

    private static User NewUser(Guid id, UserRole role, string? passwordHash, string fullName = "Engagement Seed", int xp = 0) => new()
    {
        Id = id,
        Email = Email(id),
        FullName = fullName,
        PasswordHash = passwordHash,
        Role = role,
        IsActive = true,
        IsPremium = false,
        PreferredLanguage = "uz",
        Xp = xp,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Question NewQuestion(Guid id, Guid teacherId) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Type = QuestionType.Text,
        Title = "Takrorlash topshirig'i",
        Topic = "family",
        Level = "A2",
        PromptText = "p",
        IsPublished = true,
        IsDeleted = false,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 0,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Submission NewSubmission(Guid id, Guid studentId, Guid questionId) => new()
    {
        Id = id,
        StudentId = studentId,
        QuestionId = questionId,
        AudioKey = $"answers/{id:N}.webm",
        Status = SubmissionStatus.Done,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };

    private static Submission NewSubmissionAt(Guid id, Guid studentId, Guid questionId, DateTime at) => new()
    {
        Id = id,
        StudentId = studentId,
        QuestionId = questionId,
        AudioKey = $"answers/{id:N}.webm",
        Status = SubmissionStatus.Done,
        CreatedAt = at,
        UpdatedAt = at,
    };

    private static Evaluation NewEvaluation(
        Guid submissionId, double fluency, double? pronunciation, double lexical, double grammar, double overall, DateTime at) => new()
    {
        Id = Guid.NewGuid(),
        SubmissionId = submissionId,
        FluencyScore = fluency,
        PronunciationScore = pronunciation,
        LexicalScore = lexical,
        GrammarScore = grammar,
        OverallBand = overall,
        CreatedAt = at,
        UpdatedAt = at,
    };

    private static Notification NewNotification(Guid id, Guid userId, string type, bool isRead, DateTime at) => new()
    {
        Id = id,
        UserId = userId,
        Type = type,
        Title = "Test",
        Body = "b",
        Link = "/x",
        IsRead = isRead,
        CreatedAt = at,
        UpdatedAt = at,
    };

    public void Dispose() => _dataSource.Dispose();

    /// <summary>Boots Govori.Api against the schema DB with a fixed test SECRET_KEY (same pattern as
    /// the other endpoint suites).</summary>
    public sealed class EngagementApiFactory : WebApplicationFactory<Program>
    {
        // The per-run throwaway database (see TestDatabase) — never the shared dev one.
        public string ConnectionString { get; } = TestDatabase.ConnectionString;

        internal const string TestSecretKey =
            "engagement-domain-integration-test-secret-key-do-not-use-in-prod";

        public EngagementApiFactory()
        {
            Environment.SetEnvironmentVariable("SECRET_KEY", TestSecretKey);
            Environment.SetEnvironmentVariable("GOVORI_DB", ConnectionString);
        }
    }
}
