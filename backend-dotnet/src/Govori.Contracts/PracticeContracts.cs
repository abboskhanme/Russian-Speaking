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
/// serializes as an int.</para>
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
    DateTime? ReviewedAt);
