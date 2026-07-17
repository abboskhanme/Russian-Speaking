using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class GroupMember
{
    public Guid Id { get; set; }

    public Guid GroupId { get; set; }

    public Guid StudentId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual Group Group { get; set; } = null!;

    public virtual User Student { get; set; } = null!;
}
