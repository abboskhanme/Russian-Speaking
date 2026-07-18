namespace Govori.Contracts;

/// <summary>
/// A single practice attempt (submission), ported from Python's <c>SubmissionOut</c>
/// (backend/app/schemas/submission.py:63-89). Serialized snake_case
/// (<c>student_id</c>, <c>audio_key</c>, <c>audio_url</c>, <c>audio_duration_sec</c>,
/// <c>error_message</c>, <c>created_at</c>, <c>completed_at</c>, <c>student_name</c>,
/// <c>question_title</c>, <c>question_topic</c>, <c>question_level</c>,
/// <c>model_answer_text</c>, <c>teacher_comment</c>, <c>teacher_band</c>, <c>reviewed_at</c>).
///
/// <para><c>Status</c> is the lowercase PG enum label ("pending"/"processing"/"done"/"failed"),
/// mirroring Python's <c>SubmissionStatus</c> value — computed in the service the same way
/// Catalog stringifies <c>question_type</c>, so it never serializes as an int.</para>
///
/// <para><c>AudioUrl</c> is a presigned GET URL minted via <c>Govori.Platform.Storage</c>
/// (Python <c>storage.presigned_get</c>, submissions.py:69). The denormalized
/// <c>student_name</c>/<c>question_*</c> labels are filled in the API layer for review lists,
/// exactly as Python's <c>_to_out</c> populates them (submissions.py:67-80).</para>
///
/// <para>Faza 3.3 (Practice) scope: a freshly created attempt is always <c>pending</c>, so the
/// grading-produced <c>transcript</c>/<c>evaluation</c> sub-objects are not carried here — they
/// land with the Assessment pipeline (Faza 3.4). Every other field of the Python shape is present
/// so the client contract stays stable when grading is wired.</para>
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
    DateTime? ReviewedAt);
