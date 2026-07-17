using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Transcript
{
    public Guid Id { get; set; }

    public Guid SubmissionId { get; set; }

    public string Text { get; set; } = null!;

    public string? Language { get; set; }

    public string? WordTimestamps { get; set; }

    public string? SttModel { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string? Pronunciation { get; set; }

    public virtual Submission Submission { get; set; } = null!;
}
