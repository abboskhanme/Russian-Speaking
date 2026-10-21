namespace Govori.Platform.Stt;

/// <summary>
/// Whether the recogniser is told, in advance, the exact sentence it is about to hear.
///
/// <para><b>This is a separate switch from <c>referenceText</c> on purpose, and the separation is
/// load-bearing.</b> A production caller already passes a reference text —
/// <c>AssessmentService</c> (the shadowing target) — and it must keep recognising unscripted. It
/// passes the reference so our own code can compare
/// against it afterwards (<c>ComputeReferenceMatch</c>), never so Azure can be handed the answer.
/// Deriving the mode from "is there a reference text?" would therefore have flipped shadowing to
/// scripted the moment this feature landed, silently repairing exactly the mispronunciations the
/// app exists to show — the single most expensive regression available in this codebase.</para>
///
/// <para><see cref="Unscripted"/> is the DEFAULT everywhere, so a caller that says nothing gets the
/// faithful behaviour. Scripted recognition is opt-in, at one call site, in a feature whose whole
/// premise is that the learner was asked to say one specific known word.</para>
/// </summary>
public enum SttRecognitionMode
{
    /// <summary>
    /// The recogniser is told nothing. It writes what it actually heard, mistakes intact — the
    /// product promise behind <c>transcript-must-stay-faithful</c>. Every free-practice, shadowing,
    /// placement, roleplay and guest path uses this, and it is the default so that stays true for
    /// paths written later.
    /// </summary>
    Unscripted = 0,

    /// <summary>
    /// The recogniser is given the target sentence and scores the recording against it.
    ///
    /// <para>Legitimate ONLY where the learner was explicitly asked to say that exact sentence and
    /// nothing else — the phoneme drill (docs/01 F2). There the reference genuinely exists as a
    /// fact about the task, so telling Azure about it does not fabricate a transcript: the drill
    /// never presents the recognised text as "what you said" in the first place, it presents a
    /// judgement about a word the learner was handed.</para>
    ///
    /// <para>What it buys, measured against the live vendor (2026-08-23): word accuracy on flawless
    /// audio rose from 60 to 100 overall, and — the part the drill actually needs — the per-position
    /// phoneme scores become a comparison against the intended word, so saying <c>мишка</c> when
    /// <c>мышка</c> was asked returns <c>0,0,0,100,100</c> instead of a uniformly high score.</para>
    /// </summary>
    Scripted = 1,
}
