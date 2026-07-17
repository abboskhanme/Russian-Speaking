using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Group
{
    public Guid Id { get; set; }

    public Guid TeacherId { get; set; }

    public string Name { get; set; } = null!;

    public string JoinCode { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Assignment> Assignments { get; set; } = new List<Assignment>();

    public virtual ICollection<GroupMember> GroupMembers { get; set; } = new List<GroupMember>();

    public virtual User Teacher { get; set; } = null!;
}
