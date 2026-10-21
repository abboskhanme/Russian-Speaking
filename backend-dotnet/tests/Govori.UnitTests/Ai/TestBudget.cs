using System.Collections.Concurrent;
using Govori.Platform.Ai;

namespace Govori.UnitTests.Ai;

/// <summary>
/// An in-memory <see cref="IAiBudget"/> for tests that build a chain by hand: open unless told
/// otherwise, and it remembers every usage the chain recorded so a test can assert on the ledger.
/// </summary>
internal sealed class TestBudget : IAiBudget
{
    public AiBudgetBlock Block { get; set; } = AiBudgetBlock.None;

    /// <summary>When set, flips <see cref="Block"/> after this many checks have answered open —
    /// simulates the cap being reached in the middle of a chain run.</summary>
    public int? CloseAfterChecks { get; set; }

    public int Checks { get; private set; }

    public ConcurrentQueue<AiUsage> Recorded { get; } = new();

    public Task<AiBudgetCheck> CheckAsync(CancellationToken ct = default)
    {
        Checks++;
        if (CloseAfterChecks is { } n && Checks > n)
            Block = AiBudgetBlock.DailyCap;
        return Task.FromResult(new AiBudgetCheck(Block));
    }

    public Task RecordAsync(AiUsage usage, CancellationToken ct = default)
    {
        Recorded.Enqueue(usage);
        return Task.CompletedTask;
    }
}
