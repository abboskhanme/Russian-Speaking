using System;
using System.Collections.Generic;

namespace Govori.Infrastructure.Entities;

public partial class Evaluation
{
    public Guid Id { get; set; }

    public Guid SubmissionId { get; set; }

    public double FluencyScore { get; set; }

    public double LexicalScore { get; set; }

    public double GrammarScore { get; set; }

    public double? PronunciationScore { get; set; }

    public double OverallBand { get; set; }

    public string? Feedback { get; set; }

    public string? Corrections { get; set; }

    public string? LlmModel { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public double? RelevanceScore { get; set; }

    public string? Explanation { get; set; }

    public double? LevelScore { get; set; }

    public double? NaturalnessScore { get; set; }

    public double? SpeechRateScore { get; set; }

    public double? IntonationScore { get; set; }

    public double? NativeLikeness { get; set; }

    public virtual Submission Submission { get; set; } = null!;
}
