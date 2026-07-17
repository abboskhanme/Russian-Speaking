using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class ShadowingPhrase
{
    public Guid Id { get; set; }

    public Guid? CreatedBy { get; set; }

    public string Text { get; set; } = null!;

    public string Level { get; set; } = null!;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public virtual User? CreatedByNavigation { get; set; }
}
