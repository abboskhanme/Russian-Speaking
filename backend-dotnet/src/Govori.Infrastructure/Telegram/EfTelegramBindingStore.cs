using Govori.Platform.Telegram;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PlatformBinding = Govori.Platform.Telegram.TelegramBinding;
using BindingRow = Govori.Infrastructure.Entities.TelegramBinding;

namespace Govori.Infrastructure.Telegram;

/// <summary>
/// EF Core implementation of <see cref="ITelegramBindingStore"/> over the <c>telegram_bindings</c>
/// table. The CONTRACT lives in Govori.Platform (both hosts see it); the implementation lives here
/// because this project owns <see cref="GovoriDbContext"/> and Platform must not reference it.
///
/// <para><b>Why it opens its own scope.</b> The only consumer is the Worker's Telegram bot poller,
/// a long-running singleton <c>BackgroundService</c>. Injecting a scoped
/// <see cref="GovoriDbContext"/> into a singleton is the classic captive-dependency bug: one context
/// would be captured for the entire process lifetime, accumulating tracked entities and eventually
/// serving stale reads. Taking <see cref="IServiceScopeFactory"/> and opening a fresh scope per call
/// makes this type safe to register as a SINGLETON in either host, with a correctly-scoped,
/// short-lived DbContext per operation.</para>
/// </summary>
public sealed class EfTelegramBindingStore : ITelegramBindingStore
{
    private readonly IServiceScopeFactory _scopes;

    public EfTelegramBindingStore(IServiceScopeFactory scopes) => _scopes = scopes;

    public async Task<PlatformBinding?> GetAsync(long telegramUserId, CancellationToken ct = default)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();

        // AsNoTracking: this is a pure read on a throwaway context.
        var row = await db.TelegramBindings
            .AsNoTracking()
            .FirstOrDefaultAsync(b => b.TelegramUserId == telegramUserId, ct);

        return row is null ? null : new PlatformBinding(row.TelegramUserId, row.Phone, row.VerifiedAt);
    }

    public async Task<IReadOnlyList<long>> TelegramIdsForPhoneAsync(string phone, CancellationToken ct = default)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();

        // AsNoTracking: a pure read on a throwaway context. Hits ix_telegram_bindings_phone.
        return await db.TelegramBindings
            .AsNoTracking()
            .Where(b => b.Phone == phone)
            .Select(b => b.TelegramUserId)
            .ToListAsync(ct);
    }

    public async Task UpsertAsync(long telegramUserId, string phone, CancellationToken ct = default)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GovoriDbContext>();

        var now = DateTime.UtcNow;
        var existing = await db.TelegramBindings
            .FirstOrDefaultAsync(b => b.TelegramUserId == telegramUserId, ct);

        if (existing is null)
        {
            db.TelegramBindings.Add(new BindingRow
            {
                TelegramUserId = telegramUserId, // PK is ValueGeneratedNever — Telegram's id, verbatim
                Phone = phone,
                VerifiedAt = now,
            });
        }
        else
        {
            // Re-proving a DIFFERENT phone rebinds: the old pair must not survive as a stale fast
            // path (a user who changed SIM would otherwise keep receiving codes for the old number).
            existing.Phone = phone;
            existing.VerifiedAt = now;
        }

        await db.SaveChangesAsync(ct);
    }
}
