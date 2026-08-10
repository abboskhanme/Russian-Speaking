using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class User
{
    public Guid Id { get; set; }

    public string Email { get; set; } = null!;

    public string? PasswordHash { get; set; }

    public string FullName { get; set; } = null!;

    /// <summary>Maps PG native enum <c>public.user_role</c> (docs/07 §7.4 trap #1).</summary>
    public UserRole Role { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public string PreferredLanguage { get; set; } = null!;

    public bool IsPremium { get; set; }

    /// <summary>Whether the user wants product notifications. Defaults to TRUE so every existing row
    /// keeps the behaviour it already had — the profile toggle previously forgot the choice on every
    /// reload because there was nowhere to put it.</summary>
    public bool NotificationsEnabled { get; set; } = true;

    public string? GoogleSub { get; set; }

    public int Xp { get; set; }

    public int DailyGoal { get; set; }

    public int StreakFreezes { get; set; }

    public int CurrentStreak { get; set; }

    public int LongestStreak { get; set; }

    public DateOnly? LastPracticeDate { get; set; }

    public string? Phone { get; set; }

    public int? Age { get; set; }

    public string? Region { get; set; }

    public string? District { get; set; }

    /// <summary>
    /// Free-text street / house / apartment ("ko'cha, uy, xonadon"), collected in the
    /// registration "Manzil" step alongside <see cref="Region"/> + <see cref="District"/>.
    /// Additive nullable <c>varchar</c> column (deploy/seed/15-address-column.sql); older rows are NULL.
    /// </summary>
    public string? Address { get; set; }

    public string? Telegram { get; set; }

    public string? AvatarKey { get; set; }

    public virtual ICollection<Assignment> AssignmentStudents { get; set; } = new List<Assignment>();

    public virtual ICollection<Assignment> AssignmentTeachers { get; set; } = new List<Assignment>();

    public virtual ICollection<GroupMember> GroupMembers { get; set; } = new List<GroupMember>();

    public virtual ICollection<Group> Groups { get; set; } = new List<Group>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<QuestionBlock> QuestionBlocks { get; set; } = new List<QuestionBlock>();

    public virtual ICollection<Question> Questions { get; set; } = new List<Question>();

    public virtual ICollection<ReviewItem> ReviewItems { get; set; } = new List<ReviewItem>();

    public virtual ICollection<ShadowingPhrase> ShadowingPhrases { get; set; } = new List<ShadowingPhrase>();

    public virtual ICollection<Submission> SubmissionReviewedByNavigations { get; set; } = new List<Submission>();

    public virtual ICollection<Submission> SubmissionStudents { get; set; } = new List<Submission>();

    public virtual ICollection<Topic> Topics { get; set; } = new List<Topic>();

    public virtual ICollection<XpEvent> XpEvents { get; set; } = new List<XpEvent>();
}
