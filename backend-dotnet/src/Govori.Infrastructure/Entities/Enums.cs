using NpgsqlTypes;

namespace Govori.Infrastructure.Entities;

// Native PostgreSQL enum types (docs/07 §7.4 trap #1).
// The C# type NAME must equal the PG type name and each member's [PgName]
// must equal the PG label EXACTLY, in the SAME ORDER as CREATE TYPE.
// Mapped at the ADO layer via NpgsqlDataSourceBuilder.MapEnum<T>(...) in
// GovoriDataSourceFactory, and at the EF model layer via HasPostgresEnum<T>(...)
// in GovoriDbContext. Both registrations are required: drop either one and the
// value silently round-trips as a string or int instead of the native enum.
// The member order below is also the order CREATE TYPE emits in the migration,
// so reordering members rewrites the PG type — append new labels at the end.

/// <summary>PG type <c>public.user_role</c> — CREATE TYPE user_role AS ENUM ('teacher','student','admin').</summary>
public enum UserRole
{
    [PgName("teacher")] Teacher,
    [PgName("student")] Student,
    [PgName("admin")] Admin,
}

/// <summary>PG type <c>public.question_type</c> — CREATE TYPE question_type AS ENUM ('text','image','video').</summary>
public enum QuestionType
{
    [PgName("text")] Text,
    [PgName("image")] Image,
    [PgName("video")] Video,
}

/// <summary>PG type <c>public.submission_status</c> — CREATE TYPE submission_status AS ENUM ('pending','processing','done','failed').</summary>
public enum SubmissionStatus
{
    [PgName("pending")] Pending,
    [PgName("processing")] Processing,
    [PgName("done")] Done,
    [PgName("failed")] Failed,
}
