using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Topic
{
    public Guid Id { get; set; }

    public Guid TeacherId { get; set; }

    public string Name { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual User Teacher { get; set; } = null!;

    public virtual ICollection<TopicImage> TopicImages { get; set; } = new List<TopicImage>();
}
