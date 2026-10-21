using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Govori.Infrastructure.Entities;

/// <summary>
/// One successful admin mutation (the <c>admin_audit_log</c> table): who did it, what, to which row,
/// from where, and when. Written by <see cref="Govori.Infrastructure.Audit.AdminAuditFilter"/> and
/// nothing else; read by <c>GET /api/admin/audit</c>.
///
/// <para><b>Append-only, and the database says so.</b> A trigger rejects every UPDATE and DELETE
/// (see the AddAdminAuditLog migration). An audit trail an admin could edit is a trail that proves
/// nothing about admins, and an application-level "we never call Update" is a convention, not a
/// guarantee.</para>
///
/// <para><b>No foreign keys, on purpose.</b> Deleting a user cascades almost everywhere in this
/// schema; an FK from here would either delete the record of who deleted whom (cascade) or make the
/// user undeletable (restrict). The ids are kept as plain values and <see cref="TargetLabel"/>
/// snapshots a human name at write time, so a row stays readable after its subject is gone.</para>
/// </summary>
[EntityTypeConfiguration(typeof(AdminAuditEntryConfiguration))]
public class AdminAuditEntry
{
    public Guid Id { get; set; }

    /// <summary>The admin who made the call — the access token's <c>sub</c>.</summary>
    public Guid ActorUserId { get; set; }

    /// <summary>Stable dotted verb, e.g. <c>teacher.create</c>, <c>settings.ai.update</c>. The
    /// list filters on its prefix, so the dots are a hierarchy, not decoration.</summary>
    public string Action { get; set; } = null!;

    /// <summary>What kind of row was touched (<c>user</c>, <c>module</c>, <c>plan</c>, <c>settings</c>…).</summary>
    public string TargetType { get; set; } = null!;

    /// <summary>The touched row's id as text (a Guid, or a setting key). Null when the action has
    /// no single target, e.g. a settings PATCH whose keys are listed in <see cref="Details"/>.</summary>
    public string? TargetId { get; set; }

    /// <summary>The target's human name AT THE TIME (a deleted teacher is still "Aziza Karimova").</summary>
    public string? TargetLabel { get; set; }

    /// <summary>jsonb <c>{ "fields": [...], "values": { ... } }</c>: the request fields that were SENT
    /// and, for an explicit per-endpoint allow-list only, their values. Secret values never land here.</summary>
    public string? Details { get; set; }

    /// <summary>Client address, resolved the same way the rate limiter does (last X-Forwarded-For hop).</summary>
    public string? Ip { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>Column mapping for <see cref="AdminAuditEntry"/>.</summary>
public sealed class AdminAuditEntryConfiguration : IEntityTypeConfiguration<AdminAuditEntry>
{
    public void Configure(EntityTypeBuilder<AdminAuditEntry> entity)
    {
        entity.HasKey(e => e.Id).HasName("admin_audit_log_pkey");

        entity.ToTable("admin_audit_log");

        // The list is "newest first", optionally narrowed to one admin — these two indexes are
        // exactly those two reads. Action is filtered by prefix on an already-narrow page, so it
        // gets no index of its own.
        entity.HasIndex(e => e.CreatedAt).HasDatabaseName("ix_admin_audit_log_created_at");
        entity.HasIndex(e => new { e.ActorUserId, e.CreatedAt })
            .HasDatabaseName("ix_admin_audit_log_actor_created");

        entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
        entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
        entity.Property(e => e.Action).HasMaxLength(64).HasColumnName("action");
        entity.Property(e => e.TargetType).HasMaxLength(32).HasColumnName("target_type");
        entity.Property(e => e.TargetId).HasMaxLength(64).HasColumnName("target_id");
        entity.Property(e => e.TargetLabel).HasMaxLength(200).HasColumnName("target_label");
        entity.Property(e => e.Details).HasColumnType("jsonb").HasColumnName("details");
        entity.Property(e => e.Ip).HasMaxLength(64).HasColumnName("ip");
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
    }
}
