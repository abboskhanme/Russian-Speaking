namespace Govori.Contracts;

// ─── The product day (shared kernel) ─────────────────────────────────────────
// Every user-facing "day" the server decides — the streak (written by the worker, read by Identity,
// Practice and Engagement), the roleplay daily turn budget, the sound-drill daily attempts, the
// "Bugungi N daqiqa" tile, the teacher's per-day and per-month charts, the weekly trend buckets and
// /api/daily's default — is cut by THIS class and nothing else. It lives in Govori.Contracts for the
// same reason StreakRules does: every module references Contracts and Contracts depends on nothing,
// so the one rule can be shared without a single illegal domain edge (a pure static class keeps the
// "Contracts is pure" ArchTest green).

/// <summary>
/// The one rule for where a user-facing day begins: <b>local midnight in Tashkent, UTC+05:00</b>.
///
/// <para><b>Why not UTC.</b> UTC midnight is 05:00 in Tashkent. Cut there, a student who practised
/// at 00:30 local time was credited to the PREVIOUS day, two answers an hour apart (23:30 and 00:30)
/// counted as one streak day instead of two, and the AI-conversation and sound-drill budgets
/// "reset" at five in the morning — after nobody's day, in the middle of nobody's evening.</para>
///
/// <para><b>Why one fixed offset, and not the student's timezone.</b> Three facts decide it: the
/// product serves Uzbekistan only, and Uzbekistan is UTC+5 all year (no DST since 1992), so for
/// every real user this IS their local midnight; there is no per-user timezone in the schema to
/// read; and the streak's writer runs in the grading WORKER, long after the request that carried any
/// browser hint is gone. A single server-side constant is the only rule the worker and every reader
/// can apply identically — and the streak's whole correctness rests on the writer and the readers
/// never disagreeing about what "today" is.</para>
///
/// <para><b>The one exception is deliberate.</b> <c>GET /api/daily</c> still honours an explicit
/// <c>tz_offset</c> from the browser for its own session view (the browser knows its own clock best);
/// only its DEFAULT, when the client sends none, is this rule. The streak it reports is still judged
/// on the product day, because that is the calendar the writer recorded it on.</para>
///
/// <para><b>Revisit if the product ever serves another timezone.</b> At that point the offset must
/// become per-user (a stored IANA zone), the worker must look it up when it writes the streak, and
/// every caller of this class is the list of places to change.</para>
///
/// <para>All inputs are UTC instants — what every <c>timestamptz</c> column and
/// <c>DateTime.UtcNow</c> hold. An <see cref="DateTimeKind.Unspecified"/> value is taken as UTC; a
/// <see cref="DateTimeKind.Local"/> one is converted first, so a stray local clock cannot shift the
/// boundary by the server's own offset.</para>
/// </summary>
public static class ProductDay
{
    /// <summary>The product's UTC offset in minutes: Tashkent, UTC+05:00.</summary>
    public const int OffsetMinutes = 5 * 60;

    /// <summary>The product's UTC offset: Tashkent, UTC+05:00, all year round.</summary>
    public static readonly TimeSpan Offset = TimeSpan.FromMinutes(OffsetMinutes);

    /// <summary>Today's product day, from the real clock.</summary>
    public static DateOnly Today() => Today(DateTime.UtcNow);

    /// <summary>The product day that <paramref name="utcNow"/> falls in. The seam the deterministic
    /// tests use; production code calls <see cref="Today()"/>.</summary>
    public static DateOnly Today(DateTime utcNow) => Of(utcNow);

    /// <summary>The product day a stored UTC instant belongs to — e.g. which day bucket a
    /// submission's <c>created_at</c> is counted in.</summary>
    public static DateOnly Of(DateTime utcInstant) => DateOnly.FromDateTime(LocalTime(utcInstant));

    /// <summary>
    /// The wall-clock time in Tashkent at <paramref name="utcInstant"/> (Kind
    /// <see cref="DateTimeKind.Unspecified"/> — it is not an instant any more, and must never be
    /// compared against a timestamp column). For calendar bucketing that needs more than the date:
    /// ISO weeks, calendar months.
    /// </summary>
    public static DateTime LocalTime(DateTime utcInstant)
        => DateTime.SpecifyKind(AsUtc(utcInstant) + Offset, DateTimeKind.Unspecified);

    /// <summary>
    /// The UTC instant at which product day <paramref name="day"/> begins (local midnight, i.e.
    /// 19:00Z on the previous UTC date). The Kind is set to <see cref="DateTimeKind.Utc"/> EXPLICITLY:
    /// <c>DateOnly.ToDateTime</c> yields Unspecified, and Npgsql refuses to bind an Unspecified
    /// DateTime against a <c>timestamptz</c> column — every <c>created_at &gt;= since</c> query built
    /// on it would throw at the driver.
    /// </summary>
    public static DateTime StartUtc(DateOnly day)
        => DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue) - Offset, DateTimeKind.Utc);

    /// <summary>The UTC instant at which the product day containing <paramref name="utcNow"/> began —
    /// the <c>since</c> of every "spent today" count.</summary>
    public static DateTime StartOfTodayUtc(DateTime utcNow) => StartUtc(Today(utcNow));

    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Local => value.ToUniversalTime(),
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        _ => value,
    };
}
