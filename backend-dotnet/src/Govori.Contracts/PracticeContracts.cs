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
/// <para>Both fields are optional so the two real gestures are expressible: "confirm the AI's score
/// but add a note" (comment only) and "override the score" (band only). Sending neither is a
/// 400 — an empty review would still stamp <c>ReviewedAt</c> and silently clear the queue row
/// without recording any decision.</para>
///
/// <para><b>Only ONE band.</b> The mockup's B3 screen has three per-criterion sliders, but
/// <c>submissions</c> carries a single <c>teacher_band</c>. Making the criteria individually
/// overridable needs three more columns plus a rule for how they roll up into the overall band,
/// so this endpoint deliberately writes the one field that exists rather than inventing storage.</para>
/// </summary>
public sealed record ReviewSubmissionRequest(
    /// <summary>Teacher's overall band 0..100. Rejected outside that range.</summary>
    double? TeacherBand,
    /// <summary>"Izoh o'quvchiga" — free text shown to the student. Blank clears it.</summary>
    string? TeacherComment);
