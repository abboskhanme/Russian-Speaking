using Govori.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Govori.Infrastructure;

/// <summary>
/// The EF mapping for the three billing tables (docs/08 Faza 6.6 — <c>plans</c>,
/// <c>subscriptions</c>, <c>payment_intents</c>).
///
/// <para>Same arrangement as <c>RoleplayModel.cs</c>, and for the same reason: the 800-line
/// scaffolded body of <see cref="GovoriDbContext"/> is the shape of the schema as it stood at
/// cutover and is regenerated wholesale when the database-first mapping is refreshed, so a
/// hand-written block inside it would be lost. <c>OnModelCreatingPartial</c> is already implemented
/// once (a partial method may only have one body), so this file exposes
/// <see cref="ConfigureBilling"/> and that single implementation calls it — one added line there
/// rather than a rewrite of it.</para>
///
/// <para>Everything here is ADDITIVE. No existing table, column or index is touched: the freemium
/// model in production today is <c>users.is_premium</c> granted by a teacher, and it keeps working
/// exactly as it does now. See <see cref="PremiumAccess"/> for how the two layers combine.</para>
/// </summary>
public partial class GovoriDbContext
{
    /// <summary>The purchasable tariffs (see <see cref="Plan"/>).</summary>
    public virtual DbSet<Plan> Plans { get; set; } = null!;

    /// <summary>Who holds premium through a purchase, and until when (see <see cref="Subscription"/>).</summary>
    public virtual DbSet<Subscription> Subscriptions { get; set; } = null!;

    /// <summary>Every attempt to pay, successful or not (see <see cref="PaymentIntent"/>).</summary>
    public virtual DbSet<PaymentIntent> PaymentIntents { get; set; } = null!;

    internal static void ConfigureBilling(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Plan>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("plans_pkey");

            entity.ToTable("plans");

            // The code is what a request, a receipt and a support conversation all name the tariff
            // by, so the database is what guarantees it is singular — two rows called "monthly"
            // would make which price a student was quoted depend on row order.
            entity.HasIndex(e => e.Code).IsUnique().HasDatabaseName("uq_plans_code");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
            entity.Property(e => e.Code).HasMaxLength(32).HasColumnName("code");
            entity.Property(e => e.Name).HasMaxLength(120).HasColumnName("name");
            entity.Property(e => e.Description).HasColumnName("description");
            // bigint, not numeric: the value is a whole number of tiyin and never divided.
            entity.Property(e => e.PriceMinor).HasColumnName("price_minor");
            entity.Property(e => e.Currency).HasMaxLength(3).HasDefaultValue("UZS").HasColumnName("currency");
            entity.Property(e => e.DurationDays).HasColumnName("duration_days");
            entity.Property(e => e.IsActive).HasDefaultValue(true).HasColumnName("is_active");
            entity.Property(e => e.SortOrder).HasDefaultValue(0).HasColumnName("sort_order");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");
        });

        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("subscriptions_pkey");

            entity.ToTable("subscriptions");

            // PremiumAccess asks exactly one question of this table — "does this user hold an active
            // row right now?" — and it asks it on the catalog read path, which every student hits on
            // every module view. This index is what keeps that an index probe instead of a scan that
            // grows with every subscription ever sold.
            entity.HasIndex(e => new { e.UserId, e.Status }).HasDatabaseName("ix_subscriptions_user_status");

            entity.HasIndex(e => e.PlanId).HasDatabaseName("ix_subscriptions_plan_id");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.PlanId).HasColumnName("plan_id");
            entity.Property(e => e.Status).HasMaxLength(16).HasColumnName("status");
            entity.Property(e => e.StartsAt).HasColumnName("starts_at");
            entity.Property(e => e.EndsAt).HasColumnName("ends_at");
            entity.Property(e => e.Provider).HasMaxLength(32).HasColumnName("provider");
            entity.Property(e => e.ExternalId).HasMaxLength(128).HasColumnName("external_id");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");

            // Deleting a user takes their subscriptions with them — the rule every other
            // student-owned table here follows.
            entity.HasOne(d => d.User).WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("subscriptions_user_id_fkey");

            // RESTRICT, deliberately: a plan that something was sold under must not be deletable.
            // Retiring a tariff is `is_active = false`; deleting one would leave a paid subscription
            // unable to say what was bought.
            entity.HasOne(d => d.Plan).WithMany()
                .HasForeignKey(d => d.PlanId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("subscriptions_plan_id_fkey");
        });

        modelBuilder.Entity<PaymentIntent>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("payment_intents_pkey");

            entity.ToTable("payment_intents");

            // THE idempotency guard, and it is a DATABASE constraint rather than a service-layer
            // check on purpose: two concurrent requests both pass a "does one already exist?" read
            // before either writes, and the loser of that race is a second charge. Scoped per user
            // so one caller's key can never block another's.
            entity.HasIndex(e => new { e.UserId, e.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName("uq_payment_intents_idempotency");

            entity.HasIndex(e => new { e.UserId, e.CreatedAt })
                .HasDatabaseName("ix_payment_intents_user_created");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnName("id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.PlanId).HasColumnName("plan_id");
            entity.Property(e => e.AmountMinor).HasColumnName("amount_minor");
            entity.Property(e => e.Currency).HasMaxLength(3).HasDefaultValue("UZS").HasColumnName("currency");
            entity.Property(e => e.Status).HasMaxLength(16).HasColumnName("status");
            entity.Property(e => e.Provider).HasMaxLength(32).HasColumnName("provider");
            entity.Property(e => e.ExternalId).HasMaxLength(128).HasColumnName("external_id");
            entity.Property(e => e.IdempotencyKey).HasMaxLength(80).HasColumnName("idempotency_key");
            entity.Property(e => e.ProviderPayload).HasColumnType("jsonb").HasColumnName("provider_payload");
            entity.Property(e => e.FailureReason).HasMaxLength(200).HasColumnName("failure_reason");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("now()").HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("now()").HasColumnName("updated_at");

            entity.HasOne(d => d.User).WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("payment_intents_user_id_fkey");

            entity.HasOne(d => d.Plan).WithMany()
                .HasForeignKey(d => d.PlanId)
                .OnDelete(DeleteBehavior.Restrict)
                .HasConstraintName("payment_intents_plan_id_fkey");
        });
    }
}
