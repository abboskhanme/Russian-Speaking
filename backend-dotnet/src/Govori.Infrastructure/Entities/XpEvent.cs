using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class XpEvent
{
    public Guid Id { get; set; }

    public Guid StudentId { get; set; }

    public Guid? SubmissionId { get; set; }

    public int Amount { get; set; }

    public string Reason { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual User Student { get; set; } = null!;

    public virtual Submission? Submission { get; set; }
}
