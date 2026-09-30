namespace Govori.Contracts;

/// <summary>
/// The wire contract for F3 · «Kunlik 5 daqiqa» (docs/01 F3, docs/04 §4.5, docs/08 Faza 6.3).
/// Serialized snake_case like every other contract here.
///
/// <para><b>This feature owns no content and no table.</b> It is an AGGREGATOR: one short session
/// assembled every day out of surfaces that already exist — a shadowing warm-up from
/// <c>shadowing_phrases</c>, the student's next actionable task from the Catalog's
/// <c>next_task_id</c>, and one due card from the SRS queue. That is why nothing here is a new
/// domain object: every step is a POINTER at a route the student could already have reached the
/// long way round, and the value F3 adds is that today's route is chosen for them.</para>
/// </summary>
public static class DailyStepKind
{
    /// <summary>«Isinish» — a handful of Russian phrases to read aloud. No recording, no upload, no
    /// grading: warming up must not cost a vendor call or one of the student's three free attempts.</summary>
    public const string Warmup = "warmup";

    /// <summary>«Gapirish» — the student's next open task, spoken and graded on the EXISTING
    /// submit path (and therefore under its existing <c>submit_audio</c> rate limit).</summary>
    public const string Task = "task";

    /// <summary>«Tuzatish» — one due card from the xato-replay drill. Absent, never empty, when the
    /// SRS queue has nothing due (or the drill itself is switched off).</summary>
    public const string Drill = "drill";
}

/// <summary>
/// One phrase of the warm-up. <c>Level</c> is the free-text CEFR band the content owner typed
/// ("A1–A2"), shown as-is rather than parsed — it is a label, not a scale.
/// </summary>
public sealed record DailyPhraseResponse(
    Guid Id,
    string Text,
    string Level);

/// <summary>
/// One step of today's session.
///
/// <para><b>Absent, not empty.</b> A step the student cannot do today is left OUT of
/// <see cref="DailySessionResponse.Steps"/> entirely. Rendering a "0 ta element" step would turn a
/// two-minute session into a screen that mostly reports its own emptiness, and the habit F3 exists
/// to build dies on the first day the queue happens to be clear.</para>
///
/// <para><b><c>Done</c> is observed, never asserted.</b> It is derived from data the student's own
/// actions already wrote — a submission for the task, an answered review for the drill — inside
/// TODAY's local-day window. The warm-up leaves no server-side trace at all and so always reports
/// <c>false</c> here; the client remembers that one locally, because inventing a row to record
/// "read three sentences aloud" would be a table earning its keep on nothing.</para>
/// </summary>
/// <param name="Kind">One of <see cref="DailyStepKind"/> — treat as an open string.</param>
/// <param name="Done">Whether today's data already shows this step finished.</param>
/// <param name="EstSeconds">The step's advertised length, so "5 daqiqa" is a promise the UI can add up.</param>
/// <param name="Phrases">Warm-up only: the phrases to read aloud. Empty for the other kinds.</param>
/// <param name="TaskId">Task step only: the question <c>/task?task=…</c> opens.</param>
/// <param name="TaskTitle">Task step only: that question's title.</param>
/// <param name="ModuleName">Task step only: the module it belongs to, for context on the card.</param>
/// <param name="Level">Task step only: the question's CEFR label, when the author set one.</param>
/// <param name="DueCount">Drill step only: how many cards are due right now — the drill screen caps
/// its own session, so this can exceed what one sitting will serve.</param>
public sealed record DailyStepResponse(
    string Kind,
    bool Done,
    int EstSeconds,
    IReadOnlyList<DailyPhraseResponse> Phrases,
    Guid? TaskId,
    string? TaskTitle,
    string? ModuleName,
    string? Level,
    int? DueCount);

/// <summary>
/// GET /api/daily — today's session, in order.
///
/// <para><b>Stable for the whole day.</b> Asking twice returns the same steps: the warm-up phrases
/// are picked by a deterministic seed over (student, local day), the task is the Catalog's own
/// <c>next_task_id</c>, and the drill card is the queue's earliest-due item. Without that a refresh
/// would reshuffle the session, and the screen would quietly become a chooser — which is exactly
/// the decision F3 exists to take away from the student.</para>
///
/// <para><b><c>Day</c> is the STUDENT's day</b> (<c>yyyy-MM-dd</c> in their local time, resolved
/// from the <c>tz_offset</c> the client sends), not the server's UTC day. A session that rolls over
/// at UTC midnight ends someone's evening practice mid-sentence, which is the one thing a habit
/// feature must never do. With no <c>tz_offset</c> it is the product day (<see cref="ProductDay"/>,
/// Tashkent local midnight) — the same calendar the streak is kept on, so for every client in
/// Tashkent the session day and the streak day are one and the same.</para>
///
/// <para><b>A 404 from this route means the <c>daily_five_enabled</c> flag is off</b> in this
/// deployment — the same "not shipped here" signal <c>/api/review/drill</c> uses (docs/08 Faza 6:
/// deploy ≠ release), not an error. Callers hide the entry point.</para>
/// </summary>
/// <param name="Day">The student's local day, <c>yyyy-MM-dd</c>. The session is stable for it.</param>
/// <param name="Streak">The student's current streak, so the card can show 🔥 without a second call.
/// The EFFECTIVE streak (<see cref="StreakRules.Effective"/>, product day): 0 once the missed days
/// outrun the student's freezes, even though the stored column only resets on their next practice.</param>
/// <param name="Completed">True when every step the server can observe is already done today.
/// A session whose only step is the warm-up is never "completed" — nothing observable was asked.</param>
/// <param name="Steps">The steps in the order they are meant to be done. 1–3 of them; never empty
/// unless the deployment has no shadowing content, no open task and no due review at all.</param>
public sealed record DailySessionResponse(
    string Day,
    int Streak,
    bool Completed,
    IReadOnlyList<DailyStepResponse> Steps);
