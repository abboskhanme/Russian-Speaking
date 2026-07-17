using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class ReviewItem
{
    public Guid Id { get; set; }

    public Guid StudentId { get; set; }

    public Guid QuestionId { get; set; }

    public string WeaknessDim { get; set; } = null!;

    public int IntervalIndex { get; set; }

    public DateTime DueAt { get; set; }

    public bool Completed { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Question Question { get; set; } = null!;

    public virtual User Student { get; set; } = null!;
}
