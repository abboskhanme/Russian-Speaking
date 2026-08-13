using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Govori.Infrastructure;

/// <summary>
/// Recognising the few Postgres failures that are a normal outcome rather than a fault.
///
/// <para>A unique index is a race-closer: the application checks first, and the index catches the
/// two callers whose checks both passed before either wrote. That second caller is not an error to
/// report — it is a caller who lost, and the honest response is usually the same one it would have
/// got had it checked a millisecond later ("already taken", or "logged in as the row the winner
/// created"). Distinguishing that case needs the SQLSTATE, and reading SQLSTATE needs Npgsql —
/// which lives HERE and deliberately not in the modules, so they can ask the question without
/// taking the dependency.</para>
///
/// <para>The constraint name is part of the question on purpose. A bare "some unique index broke"
/// would also swallow a collision on <c>email</c> or <c>google_sub</c>, and swallowing a violation
/// nobody predicted turns a bug into silence.</para>
/// </summary>
public static class DbErrors
{
    /// <summary><c>unique_violation</c> — the SQLSTATE Postgres raises for a duplicate key.</summary>
    private const string UniqueViolation = "23505";

    /// <summary>
    /// True when <paramref name="ex"/> is a duplicate-key failure on exactly
    /// <paramref name="constraintName"/>. Postgres reports the INDEX name in that field for a unique
    /// index, so the name to pass is the database name (e.g. <c>ix_users_phone</c>) — which, under
    /// <c>UseSnakeCaseNamingConvention</c>, is not necessarily the name the model spells.
    /// </summary>
    public static bool IsUniqueViolation(DbUpdateException ex, string constraintName)
        => ex.InnerException is PostgresException { SqlState: UniqueViolation } pg
           && string.Equals(pg.ConstraintName, constraintName, StringComparison.Ordinal);
}
