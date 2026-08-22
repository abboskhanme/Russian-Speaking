using Govori.Platform.Ai;
using Govori.Platform.Ai.Backends;
using Microsoft.Extensions.DependencyInjection;

namespace Govori.UnitTests.Ai;

/// <summary>
/// Every vendor HttpClient is registered with an explicit timeout.
///
/// <para><b>The bug this guards is an ABSENT line, which is why it needs a test rather than a code
/// review.</b> The three grader backends each set a timeout on the client they resolved; the two STT
/// backends did not, and nothing in either file looked wrong. The result was that every
/// transcription ran on HttpClient's 100-second default, so one stalled vendor held a grading worker
/// for a hundred seconds per attempt — and twice that when the chain fell through to the second STT
/// backend. Reading AzureSpeechSttBackend.cs would never reveal it; only comparing five files would.</para>
///
/// <para>So the timeout moved to the single place all five are registered, and this test walks that
/// registration by NAME. A backend added later without a timeout fails here.</para>
/// </summary>
public class VendorTimeoutTests
{
    /// <summary>Every named client the AI chain resolves, with the budget its KIND gets. Kept as data
    /// rather than reflected out of the container: the point is to assert the list we EXPECT, so that
    /// deleting a registration is a failure rather than a silently shorter loop.</summary>
    public static IEnumerable<object[]> VendorClientNames() => new[]
    {
        new object[] { AnthropicGraderBackend.HttpClientName, GraderContract.VendorTimeout },
        new object[] { GeminiGraderBackend.HttpClientName, GraderContract.VendorTimeout },
        new object[] { OpenAiGraderBackend.HttpClientName, GraderContract.VendorTimeout },
        new object[] { AzureSpeechSttBackend.HttpClientName, AiRegistration.SttTimeout },
        new object[] { WhisperSttBackend.HttpClientName, AiRegistration.SttTimeout },
    };

    private static IHttpClientFactory Factory()
        => new ServiceCollection().AddGovoriAi().BuildServiceProvider().GetRequiredService<IHttpClientFactory>();

    [Theory]
    [MemberData(nameof(VendorClientNames))]
    public void Every_vendor_client_has_an_explicit_bounded_timeout(string clientName, TimeSpan expected)
    {
        using var client = Factory().CreateClient(clientName);

        Assert.Equal(expected, client.Timeout);
    }

    /// <summary>
    /// Transcription gets a shorter budget than grading, and that ordering is the decision rather
    /// than the two numbers. Transcription is one request/response over a few hundred kilobytes;
    /// a grader is generating tokens and legitimately thinks for longer. Equalising them would mean
    /// one of the two is always the wrong number.
    /// </summary>
    [Fact]
    public void Transcription_gets_a_tighter_budget_than_grading()
    {
        Assert.True(AiRegistration.SttTimeout < GraderContract.VendorTimeout);
    }

    /// <summary>
    /// Both budgets are several times a real grade. A measured end-to-end run — Azure STT plus a
    /// Gemini grade on real submitted audio — is about 16 seconds, so a per-leg budget below that
    /// would start failing healthy requests, and this is the assertion that would catch someone
    /// "tightening" it into an outage.
    /// </summary>
    [Fact]
    public void No_budget_is_tighter_than_a_real_end_to_end_grade()
    {
        var measuredEndToEnd = TimeSpan.FromSeconds(16);

        Assert.True(AiRegistration.SttTimeout > measuredEndToEnd);
        Assert.True(GraderContract.VendorTimeout > measuredEndToEnd);
    }

    /// <summary>
    /// Guards the specific regression: the STT clients must NOT be on the framework default. Stated
    /// separately from the equality above because that assertion would still pass if someone
    /// "fixed" it by changing VendorTimeout to 100 seconds, which would not be a fix.
    /// </summary>
    [Theory]
    [InlineData(AzureSpeechSttBackend.HttpClientName)]
    [InlineData(WhisperSttBackend.HttpClientName)]
    public void The_stt_clients_are_not_on_the_hundred_second_framework_default(string clientName)
    {
        using var client = Factory().CreateClient(clientName);

        Assert.True(
            client.Timeout < TimeSpan.FromSeconds(100),
            $"{clientName} is on HttpClient's default timeout — a stalled vendor would hold a "
            + "grading worker for 100 s per attempt.");
    }

    /// <summary>The chain's worst case has to be something a person can reason about. Two STT
    /// attempts plus three grader attempts at this budget is bounded; on the framework default it
    /// was over eight minutes for a single submission.</summary>
    [Fact]
    public void The_vendor_timeouts_are_short_enough_to_bound_a_full_chain_fallthrough()
    {
        var worstCase = (AiRegistration.SttTimeout * 2)          // both STT backends time out
                        + (GraderContract.VendorTimeout * 3);    // then all three graders do

        Assert.True(
            worstCase <= TimeSpan.FromMinutes(5),
            $"a full chain fall-through would take {worstCase.TotalMinutes:0.#} minutes");
    }
}
