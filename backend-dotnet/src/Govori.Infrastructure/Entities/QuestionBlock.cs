using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class QuestionBlock
{
    public Guid Id { get; set; }

    public Guid TeacherId { get; set; }

    public string Name { get; set; } = null!;

    public string? Topic { get; set; }

    public string? Level { get; set; }

    public string? RuStyle { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public int SortOrder { get; set; }

    public string Visibility { get; set; } = null!;

    public bool IsPublished { get; set; }

    public string? CoverKey { get; set; }

    public virtual ICollection<Question> Questions { get; set; } = new List<Question>();

    public virtual User Teacher { get; set; } = null!;
}
