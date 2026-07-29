using Govori.Identity;

namespace Govori.UnitTests.Identity;

/// <summary>
/// Drives the pure avatar-upload validator (<see cref="AuthService.ValidateAvatarUpload"/>) directly.
/// It is the security-critical accept/reject decision — SVG must never pass (a stored-XSS vector),
/// and the 5 MB ceiling bounds the blast radius — so it is asserted without a DB or storage, exactly
/// like the achievement-catalogue builder. The endpoint wiring (multipart parse → service → HTTP
/// status) is covered by the curl smoke.
/// </summary>
public class AvatarValidationTests
{
    private const long OneMb = 1024 * 1024;

    [Theory]
    [InlineData("image/jpeg", "jpg")]
    [InlineData("image/png", "png")]
    [InlineData("image/webp", "webp")]
    // A charset/parameter suffix and odd casing still resolve to the base type.
    [InlineData("image/jpeg; charset=binary", "jpg")]
    [InlineData("IMAGE/PNG", "png")]
    public void Accepts_the_three_raster_types_and_maps_the_extension(string contentType, string expectedExt)
    {
        var result = AuthService.ValidateAvatarUpload(contentType, OneMb);

        Assert.True(result.IsValid);
        Assert.Equal(expectedExt, result.Ext);
        // The stored content-type is the normalised (lower-cased, parameter-stripped) base type.
        Assert.StartsWith("image/", result.ContentType);
    }

    [Theory]
    // The whole point: SVG is REJECTED (script-carrying → stored XSS), as is every non-raster type.
    [InlineData("image/svg+xml")]
    [InlineData("text/html")]
    [InlineData("application/octet-stream")]
    [InlineData("image/gif")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_svg_and_every_non_allowlisted_type(string? contentType)
    {
        var result = AuthService.ValidateAvatarUpload(contentType, OneMb);

        Assert.False(result.IsValid);
        Assert.Equal(AvatarUpdateStatus.InvalidType, result.RejectStatus);
        Assert.False(string.IsNullOrWhiteSpace(result.Error));
    }

    [Fact]
    public void Rejects_an_upload_over_five_megabytes_as_too_large()
    {
        var result = AuthService.ValidateAvatarUpload("image/png", 5L * 1024 * 1024 + 1);

        Assert.False(result.IsValid);
        Assert.Equal(AvatarUpdateStatus.TooLarge, result.RejectStatus);
    }

    [Fact]
    public void Accepts_an_upload_exactly_at_the_five_megabyte_ceiling()
    {
        var result = AuthService.ValidateAvatarUpload("image/png", 5L * 1024 * 1024);

        Assert.True(result.IsValid);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Rejects_an_empty_upload(long length)
    {
        var result = AuthService.ValidateAvatarUpload("image/jpeg", length);

        Assert.False(result.IsValid);
        Assert.Equal(AvatarUpdateStatus.Empty, result.RejectStatus);
    }

    [Fact]
    public void The_wrong_type_and_too_big_messages_are_distinct()
    {
        var wrongType = AuthService.ValidateAvatarUpload("image/svg+xml", OneMb);
        var tooBig = AuthService.ValidateAvatarUpload("image/png", 6L * 1024 * 1024);

        // Distinct messages so the client can show errorType vs errorSize.
        Assert.NotEqual(wrongType.Error, tooBig.Error);
    }
}
