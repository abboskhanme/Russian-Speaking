using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// Account management on a FRESH install, where sign-up only ever makes students and
/// bootstrap-admin.sh only makes admins: the admin must be able to create a teacher (who then signs
/// in by phone OTP), move people between roles without breaking the platform, see who the admins
/// are, find people by phone, and save contact links that actually work. Plus the grading-queue
/// counters on the dashboard.
///
/// <para>Every new route is proven RBAC-protected here: anonymous → 401, a student or teacher →
/// 403, an admin → the real answer. Phones are random per run so reruns never collide, and every
/// seeded or created row is deleted in a finally.</para>
/// </summary>
public sealed partial class AdministrationEndpointsTests
{
    // ── POST /api/admin/teachers ─────────────────────────────────────────────

    [Fact]
    public async Task Create_teacher_validates_refuses_taken_phones_and_the_teacher_signs_in_by_otp()
    {
        var adminId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var studentPhone = RandomUzPhone();
        var teacherPhone = RandomUzPhone();
        var newPhone = RandomUzPhone();
        var studentName = $"Promote Me {studentId:N}"[..24];
        Guid? createdId = null;

        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"ct-adm-{adminId:N}@example.test", UserRole.Admin, null));
            var student = NewUser(studentId, $"ct-s-{studentId:N}@example.test", UserRole.Student, null, studentName);
            student.Phone = studentPhone;
            ctx.Users.Add(student);
            var teacher = NewUser(teacherId, $"ct-t-{teacherId:N}@example.test", UserRole.Teacher, null);
            teacher.Phone = teacherPhone;
            ctx.Users.Add(teacher);
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);
            object Body(string? phone, string? name) => new { phone, full_name = name };

            // ── RBAC: anonymous 401, student 403, teacher 403 — and none of them created anything ──
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsJsonAsync("/api/admin/teachers", Body(newPhone, "X"))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Post, "/api/admin/teachers", TokenFor(studentId), Json(Body(newPhone, "X")))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Post, "/api/admin/teachers", TokenFor(teacherId), Json(Body(newPhone, "X")))).StatusCode);

            // ── 400s carry a code the UI can branch on ──
            var badPhone = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken, Json(Body("12345", "Ustoz")));
            Assert.Equal(HttpStatusCode.BadRequest, badPhone.StatusCode);
            var badPhoneBody = await ReadJson(badPhone);
            Assert.Equal("invalid_phone", badPhoneBody.GetProperty("code").GetString());
            Assert.False(string.IsNullOrEmpty(badPhoneBody.GetProperty("detail").GetString()));

            var blankName = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken, Json(Body(newPhone, "   ")));
            Assert.Equal(HttpStatusCode.BadRequest, blankName.StatusCode);
            Assert.Equal("invalid_full_name", (await ReadJson(blankName)).GetProperty("code").GetString());

            // ── A STUDENT's phone → 409 that names the student, so the UI can offer "promote" ──
            // Sent in a human format to prove it is normalised exactly as sign-up does.
            var takenByStudent = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken,
                Json(Body(Spaced(studentPhone), "Duplicate Person")));
            Assert.Equal(HttpStatusCode.Conflict, takenByStudent.StatusCode);
            var tbs = await ReadJson(takenByStudent);
            Assert.Equal("phone_taken_by_student", tbs.GetProperty("code").GetString());
            Assert.Equal(studentId, tbs.GetProperty("user_id").GetGuid());
            Assert.Equal(studentName, tbs.GetProperty("full_name").GetString());

            // ── A TEACHER's phone → plain phone_taken ──
            var takenByTeacher = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken,
                Json(Body(teacherPhone, "Duplicate Teacher")));
            Assert.Equal(HttpStatusCode.Conflict, takenByTeacher.StatusCode);
            Assert.Equal("phone_taken", (await ReadJson(takenByTeacher)).GetProperty("code").GetString());

            // ── Success: 201 TeacherResponse with the CANONICAL phone ──
            var nationalDigits = newPhone["+998".Length..];          // "77 123 45 67" style input
            var created = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken,
                Json(Body(nationalDigits, "  Yangi Ustoz  ")));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var teacherRow = await ReadJson(created);
            createdId = teacherRow.GetProperty("id").GetGuid();
            Assert.Equal(newPhone, teacherRow.GetProperty("phone").GetString());
            Assert.Equal("Yangi Ustoz", teacherRow.GetProperty("full_name").GetString());
            Assert.Equal($"{newPhone}@govori.uz", teacherRow.GetProperty("email").GetString());
            Assert.True(teacherRow.GetProperty("is_active").GetBoolean());
            Assert.Equal(0, teacherRow.GetProperty("question_count").GetInt32());

            // The row is shaped exactly like a phone sign-up, except for the role.
            await using (var ctx = NewContext())
            {
                var row = await ctx.Users.AsNoTracking().SingleAsync(u => u.Id == createdId);
                Assert.Equal(UserRole.Teacher, row.Role);
                Assert.Null(row.PasswordHash);
                Assert.Equal(newPhone, row.Phone);
                Assert.Equal("uz", row.PreferredLanguage);
                Assert.False(row.IsPremium);
                Assert.True(row.IsActive);
            }

            // Creating the same teacher twice is a conflict, not a second account.
            var again = await Send(client, HttpMethod.Post, "/api/admin/teachers", adminToken, Json(Body(newPhone, "Again")));
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
            Assert.Equal("phone_taken", (await ReadJson(again)).GetProperty("code").GetString());

            // ── The new teacher signs in through the ordinary phone OTP login (dev delivery accepts
            // 000000) and the session is a TEACHER session — no password, no extra step ──
            var verify = await client.PostAsJsonAsync("/api/auth/otp/verify", new { phone = newPhone, code = "000000" });
            Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
            var accessToken = (await ReadJson(verify)).GetProperty("access_token").GetString()!;
            var me = await ReadJson(await Send(client, HttpMethod.Get, "/api/auth/me", accessToken));
            Assert.Equal(createdId, me.GetProperty("id").GetGuid());
            Assert.Equal("teacher", me.GetProperty("role").GetString());

            // ── ?search= matches phone digits in whatever format the admin has them ──
            var last7 = newPhone[^7..];
            var byPhone = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/teachers?search={Uri.EscapeDataString($"{last7[..3]} {last7[3..5]}-{last7[5..]}")}", adminToken));
            var found = byPhone.EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == createdId);
            Assert.Equal(newPhone, found.GetProperty("phone").GetString());

            // The seeded student's email is NOT derived from their phone, so this can only match on
            // the phone column — the "+998 77 …" spacing proves the digits are extracted first.
            var studentsByPhone = await ReadJson(await Send(client, HttpMethod.Get,
                $"/api/admin/students?search={Uri.EscapeDataString(Spaced(studentPhone))}", adminToken));
            Assert.Contains(studentsByPhone.EnumerateArray(), s => s.GetProperty("id").GetGuid() == studentId);
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == studentId || u.Id == teacherId || u.Phone == newPhone)
                .ExecuteDeleteAsync();
        }
    }

    // ── PATCH /api/admin/users/{id}/role + GET /api/admin/admins ─────────────

    [Fact]
    public async Task Role_change_is_admin_only_guarded_and_takes_effect_on_the_next_request()
    {
        var adminId = Guid.NewGuid();
        var otherAdminId = Guid.NewGuid();
        var groupOwnerId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var groupId = Guid.NewGuid();
        var adminPhone = RandomUzPhone();

        await using (var ctx = NewContext())
        {
            var admin = NewUser(adminId, $"rc-a-{adminId:N}@example.test", UserRole.Admin, null, "Role Admin");
            admin.Phone = adminPhone;
            ctx.Users.Add(admin);
            ctx.Users.Add(NewUser(otherAdminId, $"rc-a2-{otherAdminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(groupOwnerId, $"rc-go-{groupOwnerId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(teacherId, $"rc-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"rc-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
            ctx.Groups.Add(new Group
            {
                Id = groupId,
                TeacherId = groupOwnerId,
                Name = "Role grp",
                JoinCode = $"RC{groupId:N}".ToUpperInvariant()[..8],
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);
            string RolePath(Guid id) => $"/api/admin/users/{id}/role";
            Task<HttpResponseMessage> SetRole(Guid id, object body, string? token = null)
                => Send(client, HttpMethod.Patch, RolePath(id), token ?? adminToken, Json(body));

            // ── RBAC: anonymous 401; student 403; teacher 403 ──
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PatchAsJsonAsync(RolePath(studentId), new { role = "admin" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await SetRole(studentId, new { role = "admin" }, TokenFor(studentId))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await SetRole(studentId, new { role = "admin" }, TokenFor(teacherId))).StatusCode);
            await using (var ctx = NewContext())
                Assert.Equal(UserRole.Student, await ctx.Users.Where(u => u.Id == studentId).Select(u => u.Role).SingleAsync());

            // ── 400 invalid_role (unknown value, or none at all) ──
            foreach (var body in new object[] { new { role = "superuser" }, new { } })
            {
                var bad = await SetRole(studentId, body);
                Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
                Assert.Equal("invalid_role", (await ReadJson(bad)).GetProperty("code").GetString());
            }

            // ── 400 cannot_change_own_role — even to the role already held ──
            var self = await SetRole(adminId, new { role = "teacher" });
            Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);
            Assert.Equal("cannot_change_own_role", (await ReadJson(self)).GetProperty("code").GetString());

            // ── 404 unknown user ──
            Assert.Equal(HttpStatusCode.NotFound, (await SetRole(Guid.NewGuid(), new { role = "teacher" })).StatusCode);

            // ── Same role → 200 no-op ──
            var noop = await SetRole(studentId, new { role = "student" });
            Assert.Equal(HttpStatusCode.OK, noop.StatusCode);
            Assert.Equal("student", (await ReadJson(noop)).GetProperty("role").GetString());

            // ── Before promotion the student cannot reach the teacher surface... ──
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/api/blocks", TokenFor(studentId))).StatusCode);

            // ── Promote student → teacher: 200 { id, role } and the SAME token now opens the teacher
            // surface — role is read from the DB on every request, never from the token ──
            var promoted = await ReadJson(await SetRole(studentId, new { role = "teacher" }));
            Assert.Equal(studentId, promoted.GetProperty("id").GetGuid());
            Assert.Equal("teacher", promoted.GetProperty("role").GetString());
            Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, "/api/blocks", TokenFor(studentId))).StatusCode);

            // ── Demoting a teacher who still owns a group → 409 with the count; nothing changes ──
            var owns = await SetRole(groupOwnerId, new { role = "student" });
            Assert.Equal(HttpStatusCode.Conflict, owns.StatusCode);
            var ownsBody = await ReadJson(owns);
            Assert.Equal("teacher_owns_groups", ownsBody.GetProperty("code").GetString());
            Assert.Equal(1, ownsBody.GetProperty("group_count").GetInt32());
            await using (var ctx = NewContext())
                Assert.Equal(UserRole.Teacher, await ctx.Users.Where(u => u.Id == groupOwnerId).Select(u => u.Role).SingleAsync());

            // ── Teacher → admin (the role is matched case-insensitively) ──
            Assert.Equal("admin", (await ReadJson(await SetRole(teacherId, new { role = "Admin" }))).GetProperty("role").GetString());

            // ── Demote another admin while admins remain → 200 ──
            Assert.Equal(HttpStatusCode.OK, (await SetRole(otherAdminId, new { role = "teacher" })).StatusCode);

            // ── GET /api/admin/admins: RBAC, then the rows with is_self ──
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/admins")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/api/admin/admins", TokenFor(groupOwnerId))).StatusCode);
            var admins = (await ReadJson(await Send(client, HttpMethod.Get, "/api/admin/admins", adminToken)))
                .EnumerateArray().ToDictionary(a => a.GetProperty("id").GetGuid());
            Assert.True(admins[adminId].GetProperty("is_self").GetBoolean());
            Assert.Equal(adminPhone, admins[adminId].GetProperty("phone").GetString());
            Assert.Equal("Role Admin", admins[adminId].GetProperty("full_name").GetString());
            Assert.False(admins[teacherId].GetProperty("is_self").GetBoolean());   // the promoted one
            Assert.DoesNotContain(otherAdminId, admins.Keys);                      // the demoted one
            Assert.All(admins.Values, a => Assert.True(a.TryGetProperty("question_count", out _)));
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Groups.Where(g => g.Id == groupId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == otherAdminId || u.Id == groupOwnerId
                                      || u.Id == teacherId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    // ── PATCH /api/admin/settings/links validation ───────────────────────────

    [Fact]
    public async Task Links_are_validated_telegram_shorthand_is_normalised_and_a_bad_field_is_named()
    {
        var adminId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"ln-a-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(teacherId, $"ln-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            await ctx.SaveChangesAsync();
        }
        await CleanKeysAsync("tg_support_url", "tg_channel_url");

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);

            // A teacher is not an admin.
            Assert.Equal(HttpStatusCode.Forbidden,
                (await Send(client, HttpMethod.Patch, "/api/admin/settings/links", TokenFor(teacherId),
                    Json(new { tg_support_url = "https://t.me/x" }))).StatusCode);

            // The two shapes people paste for Telegram become working links.
            await Patch(client, adminToken, "/api/admin/settings/links",
                new { tg_support_url = "@govori_help", tg_channel_url = "t.me/govori_news" });
            var (support, channel) = await GetLinks(client, adminToken);
            Assert.Equal("https://t.me/govori_help", support);
            Assert.Equal("https://t.me/govori_news", channel);

            // Not a link → 400 invalid_link NAMING the field, and nothing is written — not even the
            // valid field sent alongside it.
            var bad = await Send(client, HttpMethod.Patch, "/api/admin/settings/links", adminToken,
                Json(new { tg_support_url = "https://govori.uz/help", tg_channel_url = "javascript:alert(1)" }));
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            var badBody = await ReadJson(bad);
            Assert.Equal("invalid_link", badBody.GetProperty("code").GetString());
            Assert.Equal("tg_channel_url", badBody.GetProperty("field").GetString());
            Assert.Equal(("https://t.me/govori_help", "https://t.me/govori_news"), await GetLinks(client, adminToken));

            // "" still clears, exactly as before.
            await Patch(client, adminToken, "/api/admin/settings/links", new { tg_support_url = "" });
            Assert.Equal(("", "https://t.me/govori_news"), await GetLinks(client, adminToken));
        }
        finally
        {
            await CleanKeysAsync("tg_support_url", "tg_channel_url");
            await using var ctx = NewContext();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == teacherId).ExecuteDeleteAsync();
        }
    }

    // ── GET /api/admin/stats: queue counters + soft-deleted tasks ────────────

    [Fact]
    public async Task Stats_count_the_grading_queue_and_ignore_soft_deleted_tasks()
    {
        var adminId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var liveQ = Guid.NewGuid();
        var deletedQ = Guid.NewGuid();

        await using (var ctx = NewContext())
        {
            ctx.Users.Add(NewUser(adminId, $"st-a-{adminId:N}@example.test", UserRole.Admin, null));
            ctx.Users.Add(NewUser(teacherId, $"st-t-{teacherId:N}@example.test", UserRole.Teacher, null));
            ctx.Users.Add(NewUser(studentId, $"st-s-{studentId:N}@example.test", UserRole.Student, null));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            var adminToken = TokenFor(adminId);

            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/stats")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/api/admin/stats", TokenFor(teacherId))).StatusCode);

            // Deltas, not absolutes: the per-run database is shared by the whole suite.
            var before = await ReadJson(await Send(client, HttpMethod.Get, "/api/admin/stats", adminToken));

            await using (var ctx = NewContext())
            {
                ctx.Questions.Add(StatsQuestion(liveQ, teacherId, deleted: false));
                ctx.Questions.Add(StatsQuestion(deletedQ, teacherId, deleted: true));
                await ctx.SaveChangesAsync();
                foreach (var status in new[]
                         {
                             SubmissionStatus.Pending, SubmissionStatus.Processing,
                             SubmissionStatus.Failed, SubmissionStatus.Failed, SubmissionStatus.Done,
                         })
                {
                    ctx.Submissions.Add(new Submission
                    {
                        Id = Guid.NewGuid(),
                        StudentId = studentId,
                        QuestionId = liveQ,
                        AudioKey = "stats/x.webm",
                        Status = status,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow,
                    });
                }
                await ctx.SaveChangesAsync();
            }

            var after = await ReadJson(await Send(client, HttpMethod.Get, "/api/admin/stats", adminToken));
            int Delta(string key) => after.GetProperty(key).GetInt32() - before.GetProperty(key).GetInt32();
            Assert.Equal(2, Delta("pending_submissions"));     // pending + processing
            Assert.Equal(2, Delta("failed_submissions"));
            Assert.Equal(1, Delta("evaluated_submissions"));
            Assert.Equal(5, Delta("submissions"));
            Assert.Equal(1, Delta("questions"));               // the soft-deleted one is not counted
            Assert.Equal(1, Delta("published_questions"));

            // The teacher's own question_count agrees.
            var teachers = await ReadJson(await Send(client, HttpMethod.Get, "/api/admin/teachers", adminToken));
            var row = teachers.EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == teacherId);
            Assert.Equal(1, row.GetProperty("question_count").GetInt32());
        }
        finally
        {
            await using var ctx = NewContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(q => q.Id == liveQ || q.Id == deletedQ).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == adminId || u.Id == teacherId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    // ── helpers (account tests) ──────────────────────────────────────────────

    /// <summary>A random canonical <c>+99877XXXXXXX</c>. The 77 operator code keeps these apart from
    /// the +99899 numbers the Identity suites generate.</summary>
    private static string RandomUzPhone() => "+99877" + Random.Shared.Next(0, 10_000_000).ToString("D7");

    /// <summary>"+998771234567" → "+998 77 123 45 67", the way a person types it.</summary>
    private static string Spaced(string canonical)
        => $"{canonical[..4]} {canonical[4..6]} {canonical[6..9]} {canonical[9..11]} {canonical[11..]}";

    private static async Task<JsonElement> ReadJson(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.Clone();
    }

    private static Question StatsQuestion(Guid id, Guid teacherId, bool deleted) => new()
    {
        Id = id,
        TeacherId = teacherId,
        Type = QuestionType.Text,
        Title = "Stats task",
        PromptText = "p",
        IsPublished = !deleted,
        IsDeleted = deleted,
        IsPublic = false,
        PrepTimeSec = 0,
        AnswerTimeLimitSec = 60,
        SortOrder = 0,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow,
    };
}
