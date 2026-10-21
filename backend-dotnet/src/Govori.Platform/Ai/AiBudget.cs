namespace Govori.Platform.Ai;

/// <summary>
/// The GLOBAL ceiling on AI spend — every user, every feature, one number per product day and one
/// per product month (Tashkent calendar, <c>Govori.Contracts.ProductDay</c>).
///
/// <para><b>Why this exists next to the per-user limits.</b> Freemium, attempt budgets, the roleplay
/// and drill daily allowances and the rate limiter all bound what ONE account can spend. None of them
/// bounds the sum: a retry storm, a bug that re-enqueues grading, or a wave of sign-ups each stays
/// inside every per-user rule and still burns money without limit. This seam is the one place that
/// sees the total, and the one switch an operator can throw to stop all of it.</para>
///
/// <para>Declared in Platform (the chain providers consult it before every vendor call) and
/// implemented in <c>Govori.Administration</c>, where the settings and the ledger table live — the
/// same seam direction as <see cref="IAiConfigSource"/>.</para>
/// </summary>
public interface IAiBudget
{
    /// <summary>May a new vendor call start right now? Reads the kill switch, the caps and the spend
    /// recorded so far. Cheap enough to call before every vendor call (one indexed aggregate).</summary>
    Task<AiBudgetCheck> CheckAsync(CancellationToken ct = default);

    /// <summary>Add one vendor call's ESTIMATED cost to the ledger. Called after every call that
    /// reached a vendor — successful or not, because a failed or timed-out call is usually still
    /// billed. Must never throw into the caller: the student's result is worth more than a ledger
    /// row, so implementations log and swallow a write failure.</summary>
    Task RecordAsync(AiUsage usage, CancellationToken ct = default);
}

/// <summary>Why the budget is closed — or <see cref="None"/> when it is open.</summary>
public enum AiBudgetBlock
{
    /// <summary>Open: new AI work may start.</summary>
    None,

    /// <summary>An operator has paused all AI (the kill switch).</summary>
    Paused,

    /// <summary>Today's recorded spend has reached the daily cap. Re-opens at Tashkent midnight.</summary>
    DailyCap,

    /// <summary>This month's recorded spend has reached the monthly cap. Re-opens on the 1st.</summary>
    MonthlyCap,
}

/// <summary>The answer to "may AI work start now?".</summary>
public sealed record AiBudgetCheck(AiBudgetBlock Block)
{
    public static readonly AiBudgetCheck Open = new(AiBudgetBlock.None);

    public bool IsOpen => Block == AiBudgetBlock.None;
}

/// <summary>Operation labels written to the ledger. Wire values (they are stored) — add, don't rename.</summary>
public static class AiOperations
{
    public const string Stt = "stt";
    public const string Grader = "grader";
}

/// <summary>
/// One vendor call as the ledger records it. <see cref="CostUsd"/> is an ESTIMATE made by
/// <see cref="AiCostEstimator"/> from configurable unit prices — not a figure read off a vendor
/// invoice. See that class for exactly how each number is derived.
/// </summary>
public sealed record AiUsage(
    string Provider,
    string Operation,
    bool Succeeded,
    decimal CostUsd,
    double AudioSeconds = 0,
    long InputTokens = 0,
    long OutputTokens = 0);

/// <summary>
/// Thrown by the chain providers when the budget is closed, BEFORE any vendor is contacted. Not a
/// vendor failure: the chain does not fall through on it, and callers map it to the "AI is not
/// available right now" answer they already give for an unconfigured provider.
/// </summary>
public sealed class AiBudgetExceededException : Exception
{
    public AiBudgetExceededException(AiBudgetBlock block)
        : base($"AI work is refused: the global AI budget is closed ({block}).")
        => Block = block;

    public AiBudgetBlock Block { get; }
}
