using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class AppSetting
{
    public string Key { get; set; } = null!;

    public string? Value { get; set; }

    public bool IsSecret { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
