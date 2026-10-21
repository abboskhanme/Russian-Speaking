using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Govori.Infrastructure.Entities;
using Govori.Platform.Storage;
using Microsoft.EntityFrameworkCore;

namespace Govori.IntegrationTests;

/// <summary>
/// An answer is stored with the Content-Type its uploader declared, and prod serves the bucket
/// from the app's own origin — so anything a browser would RENDER (HTML, SVG, XML) is refused
/// before a byte is stored. A partial of <see cref="PracticeEndpointsTests"/> for the same host.
/// </summary>
public sealed partial class PracticeEndpointsTests
{
    [Theory]
    [InlineData("text/html", "form")]
    [InlineData("image/svg+xml", "form")]
    [InlineData("application/xhtml+xml", "file")]
    [InlineData("text/html; charset=utf-8", "file")]
    public async Task Submit_refuses_a_renderable_content_type_and_stores_nothing(string contentType, string declaredIn)
    {
        var authorId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(authorId, $"mt-a-{authorId:N}@example.test", UserRole.Admin, null, premium: false));
            ctx.Users.Add(NewUser(studentId, $"mt-s-{studentId:N}@example.test", UserRole.Student, null, premium: false));
            ctx.QuestionBlocks.Add(NewBlock(blockId, authorId, "public"));
            ctx.Questions.Add(NewQuestion(questionId, authorId, blockId, sortOrder: 0));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();

            // The type can arrive two ways — the form's content_type field (which wins) or the
            // file part's own header — and both must be judged.
            var form = new MultipartFormDataContent
            {
                { new StringContent(questionId.ToString()), "question_id" },
                { new StringContent(3.5.ToString(CultureInfo.InvariantCulture)), "audio_duration_sec" },
            };
            if (declaredIn == "form")
                form.Add(new StringContent(contentType), "content_type");
            var body = new ByteArrayContent(Encoding.UTF8.GetBytes("<script>alert(document.domain)</script>"));
            body.Headers.ContentType = MediaTypeHeaderValue.Parse(declaredIn == "file" ? contentType : "audio/webm");
            form.Add(body, "audio", "answer.html");

            var resp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(studentId), form);

            Assert.Equal(HttpStatusCode.UnsupportedMediaType, resp.StatusCode);
            await using var ctx = CreateContext();
            Assert.Equal(0, await ctx.Submissions.CountAsync(s => s.StudentId == studentId));
        }
        finally
        {
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == authorId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Submit_accepts_the_recorder_types_every_browser_sends()
    {
        var authorId = Guid.NewGuid();
        var studentId = Guid.NewGuid();
        var blockId = Guid.NewGuid();
        var questionId = Guid.NewGuid();
        using var storage = new MinioObjectStorage(BuildStorageOptions());
        var keys = new List<string>();

        await using (var ctx = CreateContext())
        {
            ctx.Users.Add(NewUser(authorId, $"mt2-a-{authorId:N}@example.test", UserRole.Admin, null, premium: false));
            ctx.Users.Add(NewUser(studentId, $"mt2-s-{studentId:N}@example.test", UserRole.Student, null, premium: false));
            ctx.QuestionBlocks.Add(NewBlock(blockId, authorId, "public"));
            ctx.Questions.Add(NewQuestion(questionId, authorId, blockId, sortOrder: 0));
            await ctx.SaveChangesAsync();
        }

        try
        {
            var client = _factory.CreateClient();
            // Chrome/Android, Firefox, Safari/iOS — with the codec parameters they really send.
            foreach (var type in new[] { "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4" })
            {
                var form = new MultipartFormDataContent
                {
                    { new StringContent(questionId.ToString()), "question_id" },
                };
                var body = new ByteArrayContent(Encoding.UTF8.GetBytes($"fake-audio-{Guid.NewGuid():N}"));
                body.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
                form.Add(body, "audio", "answer");

                var resp = await Send(client, HttpMethod.Post, "/api/submissions", TokenFor(studentId), form);
                Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                keys.Add(doc.RootElement.GetProperty("audio_key").GetString()!);
            }
        }
        finally
        {
            foreach (var key in keys)
                await storage.DeleteAsync(key);
            await using var ctx = CreateContext();
            await ctx.Submissions.Where(s => s.StudentId == studentId).ExecuteDeleteAsync();
            await ctx.Questions.Where(x => x.BlockId == blockId).ExecuteDeleteAsync();
            await ctx.QuestionBlocks.Where(b => b.Id == blockId).ExecuteDeleteAsync();
            await ctx.Users.Where(u => u.Id == authorId || u.Id == studentId).ExecuteDeleteAsync();
        }
    }
}
