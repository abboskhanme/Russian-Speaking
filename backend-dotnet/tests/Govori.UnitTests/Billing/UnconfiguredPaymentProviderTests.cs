using Govori.Billing;
using Govori.Infrastructure.Entities;

namespace Govori.UnitTests.Billing;

/// <summary>
/// The stub payment adapter, pinned (docs/08 Faza 6.6).
///
/// <para>These facts look trivial and are the most important ones in the module. The owner has no
/// merchant account, so this adapter is what every payment attempt actually meets — and the failure
/// mode it exists to prevent is not a crash, it is a LIE: a stub that answered "paid" would tell a
/// real student their subscription is active, stop asking them for money, and be discovered only
/// when the paywall stopped them again. There is no success path here to accidentally reach, and
/// these tests are what stops one being added by someone who finds the refusals inconvenient.</para>
/// </summary>
public sealed class UnconfiguredPaymentProviderTests
{
    private static readonly PaymentIntent Intent = new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        PlanId = Guid.NewGuid(),
        AmountMinor = 4_990_000,      // 49 900 so'm in tiyin
        Currency = "UZS",
        Status = PaymentIntentStatuses.Created,
        Provider = UnconfiguredPaymentProvider.ProviderName,
        IdempotencyKey = "key-1",
    };

    [Fact]
    public async Task It_never_reports_itself_as_configured()
    {
        var provider = new UnconfiguredPaymentProvider();
        Assert.False(await provider.IsConfiguredAsync());
        Assert.Equal("none", provider.Name);      // never claims to be payme/click
    }

    [Fact]
    public async Task Starting_a_payment_fails_with_a_reason_and_grants_nothing()
    {
        var provider = new UnconfiguredPaymentProvider();

        var result = await provider.CreatePaymentAsync(Intent);

        Assert.False(result.Ok);
        Assert.Equal(PaymentIntentStatuses.Failed, result.Status);
        Assert.Equal(UnconfiguredPaymentProvider.NotConfiguredReason, result.Reason);
        // No checkout url and no transaction id: nothing for a screen to send a payer to, and
        // nothing that could later be mistaken for a real provider reference.
        Assert.Null(result.RedirectUrl);
        Assert.Null(result.ExternalId);
    }

    /// <summary>
    /// Every callback is rejected — including well-formed ones that carry a plausible signature
    /// header. There is no shared secret with which anything could be verified, and "no secret" must
    /// resolve to "verification fails", never to "skip verification": an endpoint that grants
    /// premium on an unverified POST is a self-service premium button for anyone who can reach it.
    /// </summary>
    [Theory]
    [InlineData("", "")]
    [InlineData("{}", "")]
    [InlineData("{\"paid\":true}", "sha256=deadbeef")]
    [InlineData("{\"method\":\"PerformTransaction\",\"params\":{\"id\":\"1\"}}", "Basic UGF5Y29tOnNlY3JldA==")]
    [InlineData("click_trans_id=1&merchant_trans_id=2&sign_string=abc", "")]
    public async Task Every_webhook_is_rejected_however_convincing_it_looks(string body, string signature)
    {
        var provider = new UnconfiguredPaymentProvider();
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Authorization"] = signature,
            ["X-Signature"] = signature,
            ["Content-Type"] = "application/json",
        };

        Assert.Null(await provider.VerifyWebhookAsync(body, headers));
    }
}
