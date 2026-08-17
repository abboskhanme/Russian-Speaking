using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One exchange in a roleplay conversation (docs/08 Faza 6.5 — the <c>roleplay_turns</c> table):
/// what the student actually said, what the partner said back, and what the grader made of it.
///
/// <para><b>There is no <c>roleplay_conversations</c> table.</b> A conversation is its
/// <see cref="ConversationId"/> and the rows that carry it — turn 0 opens it,
/// <see cref="IsFinal"/> closes it. A parent row would hold a title we already have on the scenario
/// and a status we can read off the last turn, and would need its own consistency rules with the
/// children; docs/08 lists two tables for this feature and two is genuinely enough.</para>
///
/// <para><b><see cref="StudentText"/> is the faithful transcript.</b> It is written exactly as STT
/// heard it and is never repaired — not by the grader, not before the next turn, not on the way to
/// the screen. The corrected forms live in <see cref="Corrections"/>, beside it and clearly
/// separate, because a learner who is quietly shown a tidied version of their own sentence learns
/// that they said it correctly.</para>
/// </summary>
public partial class RoleplayTurn
{
    public Guid Id { get; set; }

    /// <summary>Groups the turns of one conversation. Minted by the start endpoint; the client
    /// carries it back on every turn.</summary>
    public Guid ConversationId { get; set; }

    public Guid StudentId { get; set; }

    public Guid ScenarioId { get; set; }

    /// <summary>0 for the partner's opening line, then 1..N for the student's turns. Unique per
    /// conversation, so a double-tapped send cannot interleave two rows at the same position.</summary>
    public int TurnIndex { get; set; }

    /// <summary>Which beat the conversation stands on AFTER this turn. A turn the student did not
    /// deliver leaves it where it was — that is what makes the partner ask again instead of
    /// marching on through a script.</summary>
    public int BeatIndex { get; set; }

    /// <summary>The verbatim STT transcript. <c>null</c> on turn 0 (the partner spoke first) and
    /// empty when the recording carried no speech — which is recorded as the empty answer it was,
    /// not silently dropped.</summary>
    public string? StudentText { get; set; }

    /// <summary>The Russian line the partner said in reply.</summary>
    public string PartnerText { get; set; } = null!;

    /// <summary>The grader's 0–100 relevance for this turn: did the student answer what was asked.
    /// <c>null</c> when the grader was not called (turn 0, an empty recording) or when it failed —
    /// a vendor outage costs the coaching, never the turn.</summary>
    public double? Relevance { get; set; }

    /// <summary>The grader's 0–100 overall for this turn. Averaged into the summary's fluency read,
    /// which is why the summary needs no extra model call of its own.</summary>
    public double? Overall { get; set; }

    /// <summary>Targeted corrections for this turn, as a JSON array of
    /// <c>{ original, corrected, type, explanation }</c> — the same shape
    /// <c>evaluations.corrections</c> uses, so one renderer serves both.</summary>
    public string? Corrections { get; set; }

    /// <summary>The STT engine that really transcribed this turn (docs/07 §7.9). Recorded per turn
    /// because the chain can fall through mid-conversation, and "which engine heard this" is the
    /// first question asked of a transcript that looks wrong.</summary>
    public string? SttModel { get; set; }

    /// <summary>The model that really graded this turn — never the configured name, which lies
    /// after a fallback.</summary>
    public string? LlmModel { get; set; }

    /// <summary>Length of the student's recording in seconds, as reported by STT.</summary>
    public double? AudioDurationSec { get; set; }

    /// <summary>Set on the turn that closed the conversation — the turn limit was reached, the
    /// beats ran out, or the student pressed "Tugatish". A closed conversation refuses further
    /// turns, so an old tab cannot keep spending someone's daily budget.</summary>
    public bool IsFinal { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Scenario Scenario { get; set; } = null!;

    public virtual User Student { get; set; } = null!;
}
