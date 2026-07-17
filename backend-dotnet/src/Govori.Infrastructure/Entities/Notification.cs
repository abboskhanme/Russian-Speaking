using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Notification
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Type { get; set; } = null!;

    public string Title { get; set; } = null!;

    public string? Body { get; set; }

    public string? Link { get; set; }

    public bool IsRead { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual User User { get; set; } = null!;
}
