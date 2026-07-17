using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class TopicImage
{
    public Guid Id { get; set; }

    public Guid TopicId { get; set; }

    public string ImageKey { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Topic Topic { get; set; } = null!;
}
