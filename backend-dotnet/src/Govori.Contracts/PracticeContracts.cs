namespace Govori.Contracts;

/// <summary>
/// A single practice attempt (submission). Serialized snake_case for wire compatibility with
/// existing clients (<c>student_id</c>, <c>audio_key</c>, <c>audio_url</c>,
/// <c>audio_duration_sec</c>, <c>error_message</c>, <c>created_at</c>, <c>completed_at</c>,
/// <c>student_name</c>, <c>question_title</c>, <c>question_topic</c>, <c>question_level</c>,
/// <c>model_answer_text</c>, <c>teacher_comment</c>, <c>teacher_band</c>, <c>reviewed_at</c>).
///
/// <para><c>Status</c> is the lowercase PG enum label ("pending"/"processing"/"done"/"failed") —
/// stringified in the service the same way Catalog stringifies <c>question_type</c>, so it never
/// serializes as an int. On a <c>failed</c> attempt <c>ErrorMessage</c> is a
/// <see cref="SubmissionErrorCodes">machine code</see> for the client to translate, not text to
/// display; rows that failed before the codes existed may still hold free text.</para>
///
/// <para><c>AudioUrl</c> is a presigned GET URL minted via <c>Govori.Platform.Storage</c>. The
/// DENORMALIZED <c>student_name</c>/<c>question_*</c> labels are not columns on the submission —
/// they are filled in the API layer so review lists render without an extra round-trip.</para>
///
/// <para>Faza 3.3 (Practice) scope: a freshly created attempt is always <c>pending</c>, so the
/// grading-produced <c>transcript</c>/<c>evaluation</c> sub-objects are not carried here — they
/// land with the Assessment pipeline (Faza 3.4). Every other field is present already so the
/// client contract stays stable when grading is wired.</para>
/// </summary>
public sealed record SubmissionResponse(
    Guid Id,
    Guid StudentId,
    Guid? QuestionId,
    string? ReferenceText,
    string AudioKey,
    string? AudioUrl,
    double? AudioDurationSec,
    string Status,
    string? ErrorMessage,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    string? StudentName,
    string? QuestionTitle,
    string? QuestionTopic,
    string? QuestionLevel,
    string? ModelAnswerText,
    string? TeacherComment,
    double? TeacherBand,
    DateTime? ReviewedAt,
    // ── AI scores, 0..100; null until the attempt is graded ────────────────────
    // ADDITIVE (appended, so existing positional/JSON consumers are unaffected).
    // The Evaluation row already held all of these; the LIST projection simply
    // never surfaced them, which forced every caller that needed a score to fetch
    // /detail per attempt. That gap is why the teacher panel could show neither
    // per-attempt scores, nor skill averages, nor a score TREND. Exposed here so
    // one list call answers all three.
    double? OverallBand,
    double? FluencyScore,
    double? LexicalScore,
    double? GrammarScore,
    double? PronunciationScore);

/// <summary>
/// GET /api/submissions/{id}/detail — one attempt's FULL detail for the student
/// result screen: the recorded audio (presigned; null once the retention job has
/// purged it, with <c>AudioExpired = true</c>), the STT transcript, and the AI
/// evaluation (overall band + per-criterion scores, all 0..100, plus feedback and
/// corrections), with the question context. Read-only; the richer sibling of
/// <see cref="SubmissionResponse"/> (which is left untouched so grading/polling
/// and teacher views keep their exact shape). Scores are null until graded.
/// </summary>
public sealed record AttemptDetailResponse(
    Guid Id,
    string Status,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    // Question context
    string? QuestionTitle,
    string? QuestionTopic,
    string? QuestionLevel,
    string? ReferenceText,
    string? ModelAnswerText,
    // Recorded audio
    string? AudioUrl,
    double? AudioDurationSec,
    bool AudioExpired,
    // What the student said (STT)
    string? Transcript,
    // AI evaluation (0..100)
    int? Band,
    double? OverallBand,
    double? FluencyScore,
    double? LexicalScore,
    double? GrammarScore,
    double? PronunciationScore,
    double? RelevanceScore,
    string? Feedback,
    string? Corrections,
    // Teacher's manual review, when present
    double? TeacherBand,
    string? TeacherComment,
    DateTime? ReviewedAt,
    // ── Per-word pronunciation (ADDITIVE, appended) ────────────────────────────
    // Parsed from Transcript.WordTimestamps, which the STT provider has always
    // written and NOTHING has ever read out to a client. It is what makes the
    // word-by-word coloured transcript possible instead of one flat paragraph.
    // Empty (never null) when the attempt has no per-word data — an older row, a
    // provider that returned none, or an ungraded attempt.
    IReadOnlyList<TranscriptWordResponse> Words,
    /// <summary>Who recorded it. Null on legacy rows with no user. ADDITIVE: this DTO was written
    /// for the STUDENT's own result screen, where their own name is redundant — but a TEACHER
    /// reaching an attempt by direct link has nothing else to identify it by.</summary>
    string? StudentName);

/// <summary>
/// One word of the STT transcript with its pronunciation accuracy.
///
/// <para><b>This is what the student actually said.</b> `Word` is reproduced verbatim from the STT
/// output and is never corrected, normalised or swapped for the expected word — the transcript's
/// whole value is that it is faithful. Corrections belong in
/// <see cref="AttemptDetailResponse.Corrections"/>, alongside the answer, never inside it.</para>
/// </summary>
public sealed record TranscriptWordResponse(
    string Word,
    /// <summary>Seconds from the start of the recording — lets a UI seek to the word.</summary>
    double? Start,
    double? End,
    /// <summary>Pronunciation accuracy 0..100; null when the provider gave none.</summary>
    double? Accuracy,
    /// <summary>Provider's error label (e.g. "None", "Mispronunciation", "Omission").</summary>
    string? ErrorType);

/// <summary>
/// Body of PATCH /api/submissions/{id}/review — a teacher's manual verdict on one attempt.
///
/// <para><b>Every field is a three-way switch, and the three ways are explicit.</b> A key that is
/// ABSENT leaves the stored value alone; a key sent as <c>null</c> CLEARS it (a cleared
/// <c>teacher_band</c> hands the grade back to the AI's; a cleared comment removes the note); a value
/// sets it. A blank <c>teacher_comment</c> also clears, as it always has. Before this, <c>null</c>
/// and absent were the same thing on the wire, so an override could never be withdrawn.</para>
///
/// <para><b><c>confirm: true</c> is the "✓ Tasdiqlash" gesture</b> — "I accept the AI's score".
/// It stamps the review without touching the band, and a <c>teacher_comment</c> sent with it is
/// written ONLY when the attempt has no comment yet. That is the fix for the review leak: the
/// confirm button used to send its canned note as an ordinary comment, which overwrote whatever the
/// teacher had actually written while the teacher's band stayed — a stored verdict that
/// contradicted itself. <c>confirm</c> together with a <c>teacher_band</c> key is a 400
/// <c>confirm_with_band</c>: accepting the AI's number and replacing it in one request is not a
/// decision the server can record.</para>
///
/// <para>A body that changes nothing — no <c>teacher_band</c>, no <c>teacher_comment</c>, no
/// <c>confirm: true</c> — is a 400 <c>empty_review</c>: it would still stamp <c>ReviewedAt</c> and
/// silently clear the queue row without recording any decision. A band outside 0..100 is a 400
/// <c>band_out_of_range</c>.</para>
///
/// <para><b>Only ONE band.</b> The mockup's B3 screen has three per-criterion sliders, but
/// <c>submissions</c> carries a single <c>teacher_band</c>. Making the criteria individually
/// overridable needs three more columns plus a rule for how they roll up into the overall band,
/// so this endpoint deliberately writes the one field that exists rather than inventing storage.</para>
///
/// <para>Backward compatible: every body the client sends today (<c>{teacher_band}</c>,
/// <c>{teacher_comment}</c>, both) means exactly what it meant. Presence is tracked through the init
/// accessors (System.Text.Json only calls them for keys present in the body), which is why this is
/// no longer a positional record.</para>
/// </summary>
public sealed record ReviewSubmissionRequest
{
    private readonly double? _teacherBand;
    private readonly string? _teacherComment;

    /// <summary>Teacher's overall band 0..100. Absent = unchanged, <c>null</c> = withdraw the
    /// override. Rejected outside the range.</summary>
    public double? TeacherBand
    {
        get => _teacherBand;
        init { _teacherBand = value; HasTeacherBand = true; }
    }

    /// <summary>"Izoh o'quvchiga" — free text shown to the student. Absent = unchanged,
    /// <c>null</c> or blank = clear.</summary>
    public string? TeacherComment
    {
        get => _teacherComment;
        init { _teacherComment = value; HasTeacherComment = true; }
    }

    /// <summary>"✓ Tasdiqlash" — accept the AI's score. Never overwrites an existing comment.</summary>
    public bool? Confirm { get; init; }

    /// <summary>Whether <c>teacher_band</c> was in the body (explicit <c>null</c> included).
    /// Server-side only — never on the wire.</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public bool HasTeacherBand { get; private init; }

    /// <summary>Whether <c>teacher_comment</c> was in the body (explicit <c>null</c> included).
    /// Server-side only — never on the wire.</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public bool HasTeacherComment { get; private init; }
}

/// <summary>
/// The <c>code</c> values PATCH /api/submissions/{id}/review puts in a
/// <see cref="CodedErrorResponse"/> (all 400s). Wire contract: renaming one is a breaking change.
/// </summary>
public static class ReviewErrorCodes
{
    /// <summary>No <c>teacher_band</c>, no <c>teacher_comment</c>, no <c>confirm: true</c>.</summary>
    public const string EmptyReview = "empty_review";

    /// <summary><c>confirm</c> sent together with a <c>teacher_band</c> key.</summary>
    public const string ConfirmWithBand = "confirm_with_band";

    /// <summary><c>teacher_band</c> outside 0..100.</summary>
    public const string BandOutOfRange = "band_out_of_range";
}
