using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Submission
{
    public Guid Id { get; set; }

    public Guid StudentId { get; set; }

    public Guid? QuestionId { get; set; }

    public string AudioKey { get; set; } = null!;

    public double? AudioDurationSec { get; set; }

    /// <summary>Set by the retention job when the audio object is purged (kept ≥90 days).
    /// The row + transcript + evaluation stay; only the heavy audio is reclaimed. Null =
    /// audio still available; non-null = playback gone (the UI shows an "expired" note).</summary>
    public DateTime? AudioDeletedAt { get; set; }

    /// <summary>Maps PG native enum <c>public.submission_status</c> (docs/07 §7.4 trap #1).</summary>
    public SubmissionStatus Status { get; set; }

    public string? ErrorMessage { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string? TeacherComment { get; set; }

    public double? TeacherBand { get; set; }

    public Guid? ReviewedBy { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public string? ReferenceText { get; set; }

    public Guid? AssignmentId { get; set; }

    public string? ModelAnswerText { get; set; }

    public virtual Assignment? Assignment { get; set; }

    public virtual Evaluation? Evaluation { get; set; }

    public virtual Question? Question { get; set; }

    public virtual User? ReviewedByNavigation { get; set; }

    public virtual User Student { get; set; } = null!;

    public virtual Transcript? Transcript { get; set; }

    public virtual ICollection<XpEvent> XpEvents { get; set; } = new List<XpEvent>();
}
