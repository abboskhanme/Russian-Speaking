namespace Govori.Contracts;

/// <summary>
/// The wire contract for F1 · Roleplay / AI Suhbat (docs/08 Faza 6.5). Serialized snake_case like
/// every other contract here.
///
/// <para><b>Why every response carries a <see cref="RoleplayState"/>.</b> This feature can be
/// legitimately unavailable in four different ways — the flag is off, no AI key is wired, the
/// student has spent the day's budget, or the conversation is already closed — and none of them is
/// an error. Modelling them as HTTP failures would put a red toast in front of a student whose only
/// mistake was arriving early, and would make "is it broken?" unanswerable from the client. The
/// state is data; the status code stays 200.</para>
/// </summary>
public static class RoleplayState
{
    /// <summary>Everything is wired — the student can speak.</summary>
    public const string Ready = "ready";

    /// <summary>The <c>roleplay_enabled</c> flag is off. Faza 6 ships dark and is switched on
    /// separately (docs/08: "deploy ≠ release").</summary>
    public const string Disabled = "disabled";

    /// <summary>No STT or grader backend in the admin's chain has a key. The same DEFER the
    /// Assessment pipeline performs: the student is told plainly, and nothing is consumed.</summary>
    public const string Unconfigured = "unconfigured";

    /// <summary>The per-user daily turn budget is spent. Resets at the next product-day midnight —
    /// local midnight in Tashkent (<see cref="ProductDay"/>), 19:00Z.</summary>
    public const string BudgetSpent = "budget_spent";

    /// <summary>The conversation has already been closed by the turn limit or by "Tugatish".</summary>
    public const string Finished = "finished";
}

/// <summary>One scenario tile: the presentation half of <c>scenarios</c>, without the script.</summary>
public sealed record RoleplayScenarioResponse(
    string Slug,
    string TitleRu,
    string GoalUz,
    string Level,
    int Minutes,
    string Tone,
    string Icon);

/// <summary>
/// GET /api/roleplay/scenarios — the hub grid plus the one fact the hub cannot infer: whether
/// speaking is possible at all right now. Sending the state with the list means the hub can say
/// "AI hali ulanmagan" on the tile the student is about to tap, instead of after they have recorded
/// themselves.
/// </summary>
public sealed record RoleplayCatalogResponse(
    string State,
    IReadOnlyList<RoleplayScenarioResponse> Scenarios,
    int MaxTurns,
    int DailyTurnsLeft);

/// <summary>POST /api/roleplay/conversations — start one conversation.</summary>
public sealed record RoleplayStartRequest(string ScenarioSlug);

/// <summary>
/// The opened conversation: its id, the partner's first line, and the two ceilings the client shows
/// the student. <see cref="ConversationId"/> is null whenever <see cref="State"/> is not
/// <see cref="RoleplayState.Ready"/> — nothing was created, so there is nothing to talk to.
/// </summary>
public sealed record RoleplayStartResponse(
    string State,
    Guid? ConversationId,
    RoleplayScenarioResponse? Scenario,
    string? OpeningRu,
    int TurnsLeft,
    int DailyTurnsLeft);

/// <summary>
/// One correction the coach offers on a turn. Same four fields as <c>evaluations.corrections</c>,
/// so the student result screen and the chat render them through the same component.
/// </summary>
public sealed record RoleplayCorrection(
    string Original,
    string Corrected,
    string Type,
    string Explanation);

/// <summary>
/// POST /api/roleplay/conversations/{id}/turns — the answer to one spoken turn.
///
/// <para><see cref="StudentText"/> is the transcript exactly as STT produced it. It is echoed back
/// so the student can see what was actually heard; it is never the corrected version, and
/// <see cref="Corrections"/> sits beside it rather than replacing it.</para>
/// </summary>
/// <param name="Retried">True when the partner asked again instead of moving on, so the client can
/// show the conversation is waiting for something rather than leaving the student wondering why it
/// looped.</param>
public sealed record RoleplayTurnResponse(
    string State,
    Guid ConversationId,
    int TurnIndex,
    string? StudentText,
    string PartnerRu,
    IReadOnlyList<RoleplayCorrection> Corrections,
    bool Retried,
    int TurnsLeft,
    int DailyTurnsLeft,
    bool Finished);

/// <summary>
/// POST /api/roleplay/conversations/{id}/end — the wrap-up (E4).
///
/// <para>Computed entirely from the turns already on disk: <see cref="Fluency"/> is the mean of the
/// per-turn grades that were paid for during the conversation. There is deliberately no extra model
/// call here — a summary pass over the whole transcript would double a conversation's worst-case
/// cost for a number the individual turns already answer.</para>
/// </summary>
public sealed record RoleplaySummaryResponse(
    string State,
    Guid ConversationId,
    string TitleRu,
    int Turns,
    double? Fluency,
    bool GoalReached,
    IReadOnlyList<string> Phrases,
    IReadOnlyList<RoleplayCorrection> Corrections);
