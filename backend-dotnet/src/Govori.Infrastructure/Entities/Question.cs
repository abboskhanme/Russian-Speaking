using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Question
{
    public Guid Id { get; set; }

    public Guid TeacherId { get; set; }

    /// <summary>Maps PG native enum <c>public.question_type</c> (docs/07 §7.4 trap #1).</summary>
    public QuestionType Type { get; set; }

    public string Title { get; set; } = null!;

    public string PromptText { get; set; } = null!;

    public string? MediaKey { get; set; }

    public string? Level { get; set; }

    public int PrepTimeSec { get; set; }

    public int AnswerTimeLimitSec { get; set; }

    public bool IsPublished { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string? Topic { get; set; }

    public string? ModelAnswerText { get; set; }

    public bool IsDeleted { get; set; }

    public bool IsPublic { get; set; }

    public Guid? BlockId { get; set; }

    public string? RuStyle { get; set; }

    public string? InstructionText { get; set; }

    public int SortOrder { get; set; }

    public virtual ICollection<Assignment> Assignments { get; set; } = new List<Assignment>();

    public virtual QuestionBlock? Block { get; set; }

    public virtual ICollection<ReviewItem> ReviewItems { get; set; } = new List<ReviewItem>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual User Teacher { get; set; } = null!;
}
