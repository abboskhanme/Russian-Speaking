using System;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One authored roleplay situation (docs/08 Faza 6.5 — the <c>scenarios</c> table). A scenario is
/// CONTENT, not code: the pharmacist's persona, the line she opens with, the beats she has to get
/// through, and the phrases the summary hands back.
///
/// <para>It lives in the database rather than in the frontend bundle because content that only a
/// deploy can change is content nobody fixes. The pre-6.5 screen shipped four scenarios inside
/// <c>frontend/src/screens/conversation/scenarios.ts</c>, which meant a typo in a Russian line — the
/// language being taught — needed a release.</para>
/// </summary>
public partial class Scenario
{
    public Guid Id { get; set; }

    /// <summary>Stable public id used in URLs (<c>/chat/pharmacy</c>) and in the start request. The
    /// route already existed with these values, so they are wire values: add, never rename.</summary>
    public string Slug { get; set; } = null!;

    /// <summary>Russian title shown on the tile and in the chat header (e.g. «В аптеке»). Literal
    /// content, never translated — the student is here to read Russian.</summary>
    public string TitleRu { get; set; } = null!;

    /// <summary>The one-line Uzbek goal ("Dori dozasini bilib ol"). The goal is stated in the
    /// learner's own language; the conversation is not.</summary>
    public string GoalUz { get; set; } = null!;

    /// <summary>CEFR band the scenario is written for (A1…B2). Passed to the grader so a beginner is
    /// judged against A1 expectations rather than against a native speaker.</summary>
    public string Level { get; set; } = null!;

    /// <summary>Rough length in minutes, for the tile's "~N daq" meta.</summary>
    public int Minutes { get; set; }

    /// <summary>Tile tint key (peach/blue/green/amber) — mapped to a design token by the grid.</summary>
    public string Tone { get; set; } = null!;

    /// <summary>Decorative emoji for the tile and chat header (aria-hidden everywhere).</summary>
    public string Icon { get; set; } = null!;

    /// <summary>Who the AI is playing, in Russian ("аптекарь в аптеке"). Sent to the grader as the
    /// situation, so its judgement of relevance is made against this conversation and not against a
    /// generic speaking task.</summary>
    public string PersonaRu { get; set; } = null!;

    /// <summary>The partner's first line — seeded as turn 0 before the student has said anything.</summary>
    public string OpeningRu { get; set; } = null!;

    /// <summary>
    /// The beats, as a JSON array (jsonb). Each element is
    /// <c>{ "goal_ru", "expect_ru", "line_ru", "nudge_ru" }</c>: what the partner is trying to
    /// establish, what a student who handled it would have said, the line that MOVES ON, and the
    /// line that asks again.
    ///
    /// <para>Stored as JSON rather than as a child table because a beat has no identity of its own —
    /// nothing references one, and editing a scenario means rewriting its script wholesale. A
    /// <c>scenario_beats</c> table would buy referential integrity for a relationship that never
    /// exists and cost a join on every turn.</para>
    /// </summary>
    public string Beats { get; set; } = null!;

    /// <summary>Three level-appropriate Russian phrases shown on the summary, as a JSON string
    /// array. The takeaway the student leaves with when the conversation itself went badly.</summary>
    public string Phrases { get; set; } = null!;

    /// <summary>Grid order. Explicit so the tiles keep the mockup's order without depending on
    /// insertion order or on a title sort that would reorder itself per locale.</summary>
    public int SortOrder { get; set; }

    /// <summary>Retired scenarios stay in the table so the <c>roleplay_turns</c> that reference them
    /// still resolve; only the listing filters on this.</summary>
    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
