using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Assignment
{
    public Guid Id { get; set; }

    public Guid TeacherId { get; set; }

    public Guid StudentId { get; set; }

    public Guid QuestionId { get; set; }

    public DateTime? DueAt { get; set; }

    /// <summary>How many times the student may answer this assignment. <c>null</c> means UNLIMITED,
    /// which is what every row written before this column existed means — so adding it changed
    /// nobody's assignment.</summary>
    public int? MaxAttempts { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public Guid? GroupId { get; set; }

    public virtual Group? Group { get; set; }

    public virtual Question Question { get; set; } = null!;

    public virtual User Student { get; set; } = null!;

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual User Teacher { get; set; } = null!;
}
